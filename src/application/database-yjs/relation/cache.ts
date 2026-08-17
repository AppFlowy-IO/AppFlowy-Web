import { FieldType } from '@/application/database-yjs/database.type';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { Log } from '@/utils/log';

type RelationCellValue = {
  value: string;
};

type RelationCacheEntry = RelationCellValue & {
  generation: number;
  updatedAt: number;
};

export type RelationComputeContext = {
  baseDoc: YDoc;
  database: YDatabase;
  relationField: YDatabaseField;
  row: YDatabaseRow;
  rowId: RowId;
  fieldId: string;
  loadView?: (viewId: string) => Promise<YDoc | null>;
  createRow?: (rowKey: string) => Promise<YDoc>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
};

export type RelationGroupLabelContext = {
  relationField: YDatabaseField;
  relatedRowId: RowId;
  loadView?: (viewId: string) => Promise<YDoc | null>;
  createRow?: (rowKey: string) => Promise<YDoc>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
};

const RELATION_CACHE_TTL_MS = 5_000;
const RELATION_CACHE_PRUNE_INTERVAL_MS = 2_000;
const RELATION_MAX_CONCURRENCY = 8;
const RELATION_RELATED_DOC_CACHE_MAX = 50;

class Semaphore {
  private count = 0;
  private queue: Array<(release: () => void) => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.count < this.max) {
      this.count += 1;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.queue.push((release) => resolve(release));
    });
  }

  private release() {
    this.count = Math.max(0, this.count - 1);
    const next = this.queue.shift();

    if (!next) return;
    this.count += 1;
    next(() => this.release());
  }
}

const semaphore = new Semaphore(RELATION_MAX_CONCURRENCY);
const cache = new Map<string, RelationCacheEntry>();
const inflight = new Map<string, Promise<RelationCellValue>>();
const groupLabelCache = new Map<string, RelationCacheEntry>();
const groupLabelInflight = new Map<string, Promise<RelationCellValue>>();
const groupLabelGenerations = new Map<string, number>();
const observedGroupLabelDocs = new WeakMap<YDoc, Set<string>>();
const generations = new Map<string, number>();
const listeners = new Set<() => void>();
const relatedDocCache = new Map<string, Promise<YDoc | null>>();
let lastPruneAt = 0;
let relationCacheRevision = 0;

function getGeneration(cellId: string) {
  return generations.get(cellId) ?? 0;
}

function bumpGeneration(cellId: string) {
  const next = getGeneration(cellId) + 1;

  generations.set(cellId, next);
  cache.delete(cellId);
  inflight.delete(cellId);
  return next;
}

function isEntryFresh(entry: RelationCacheEntry, generation: number) {
  if (entry.generation !== generation) return false;
  return Date.now() - entry.updatedAt <= RELATION_CACHE_TTL_MS;
}

function emit() {
  relationCacheRevision += 1;
  listeners.forEach((cb) => cb());
}

function getGroupLabelGeneration(labelId: string) {
  return groupLabelGenerations.get(labelId) ?? 0;
}

function bumpGroupLabelGeneration(labelId: string) {
  groupLabelGenerations.set(labelId, getGroupLabelGeneration(labelId) + 1);
  groupLabelCache.delete(labelId);
  // The work cannot be cancelled, but removing its identity lets the next
  // render start a fresh lookup. Its captured generation prevents a stale
  // completion from overwriting the newer value.
  groupLabelInflight.delete(labelId);
}

function observeGroupLabelDoc(rowDoc: YDoc, labelId: string) {
  const observedLabels = observedGroupLabelDocs.get(rowDoc);

  if (observedLabels) {
    observedLabels.add(labelId);
    return;
  }

  const labelIds = new Set([labelId]);

  observedGroupLabelDocs.set(rowDoc, labelIds);
  rowDoc.on('update', () => {
    labelIds.forEach((id) => {
      bumpGroupLabelGeneration(id);
    });
    emit();
  });
}

function pruneCache(now = Date.now()) {
  if (now - lastPruneAt < RELATION_CACHE_PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;

  for (const [cellId, entry] of cache) {
    if (now - entry.updatedAt > RELATION_CACHE_TTL_MS) {
      cache.delete(cellId);
    }
  }

  for (const [labelId, entry] of groupLabelCache) {
    if (now - entry.updatedAt > RELATION_CACHE_TTL_MS) {
      groupLabelCache.delete(labelId);
    }
  }
}

function touchRelatedDocCache(viewId: string, promise: Promise<YDoc | null>) {
  relatedDocCache.delete(viewId);
  relatedDocCache.set(viewId, promise);

  if (relatedDocCache.size > RELATION_RELATED_DOC_CACHE_MAX) {
    const oldestKey = relatedDocCache.keys().next().value;

    if (oldestKey) {
      relatedDocCache.delete(oldestKey);
    }
  }
}

function getPrimaryFieldId(database: YDatabase): string | undefined {
  const fields = database?.get(YjsDatabaseKey.fields);

  return Array.from(fields?.keys() || []).find((fieldId) => fields?.get(fieldId)?.get(YjsDatabaseKey.is_primary));
}

function getDatabaseFromDoc(doc: YDoc): YDatabase | undefined {
  return doc.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase | undefined;
}

async function loadRelatedDoc(viewId: string, loadView?: (viewId: string) => Promise<YDoc | null>) {
  if (!loadView) return null;
  const cached = relatedDocCache.get(viewId);

  if (cached) {
    touchRelatedDocCache(viewId, cached);
    return cached;
  }

  const promise = loadView(viewId).catch(() => {
    relatedDocCache.delete(viewId);
    return null;
  });

  touchRelatedDocCache(viewId, promise);
  return promise;
}

async function computeRelationCellValue(context: RelationComputeContext): Promise<RelationCellValue> {
  try {
    const { relationField, row, fieldId } = context;

    if (Number(relationField.get(YjsDatabaseKey.type)) !== FieldType.Relation) {
      return { value: '' };
    }

    const relationOption = parseRelationTypeOption(relationField);

    if (!relationOption?.database_id) {
      return { value: '' };
    }

    const relationCell = row?.get(YjsDatabaseKey.cells)?.get(fieldId);
    const relatedRowIds = getRelationRowIdsFromCell(relationCell);

    if (relatedRowIds.length === 0) return { value: '' };

    const viewId = await context.getViewIdFromDatabaseId?.(relationOption.database_id);

    if (!viewId) return { value: '' };

    const relatedDoc = await loadRelatedDoc(viewId, context.loadView);

    if (!relatedDoc) return { value: '' };

    const relatedRoot = relatedDoc.getMap(YjsEditorKey.data_section);
    const relatedDatabase = relatedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;

    if (!relatedDatabase) return { value: '' };

    const primaryFieldId = getPrimaryFieldId(relatedDatabase);

    if (!primaryFieldId) return { value: '' };

    const relatedFields = relatedDatabase.get(YjsDatabaseKey.fields) as YDatabaseFields | undefined;
    const primaryField = relatedFields?.get(primaryFieldId);

    if (!primaryField) return { value: '' };

    const values: string[] = [];

    for (const relatedRowId of relatedRowIds) {
      if (!context.createRow) continue;
      const rowKey = getRowKey(relatedDoc.guid, relatedRowId);
      const relatedRowDoc = await context.createRow(rowKey);
      const relatedRowRoot = relatedRowDoc.getMap(YjsEditorKey.data_section);
      const relatedRow = relatedRowRoot?.get(YjsEditorKey.database_row) as YDatabaseRow | undefined;

      if (!relatedRow) continue;
      const cell = relatedRow.get(YjsDatabaseKey.cells)?.get(primaryFieldId);

      if (!cell) continue;
      const text = decodeCellToText(cell, primaryField);

      if (text.trim() !== '') {
        values.push(text);
      }
    }

    return { value: values.join(', ') };
  } catch (error) {
    Log.error('Failed to compute relation cell', error);
    return { value: '' };
  }
}

async function computeRelationGroupLabel(
  context: RelationGroupLabelContext,
  labelId: string
): Promise<RelationCellValue> {
  try {
    if (Number(context.relationField.get(YjsDatabaseKey.type)) !== FieldType.Relation) {
      return { value: '' };
    }

    const relationOption = parseRelationTypeOption(context.relationField);

    if (!relationOption.database_id || !context.relatedRowId || !context.createRow) {
      return { value: '' };
    }

    const viewId = await context.getViewIdFromDatabaseId?.(relationOption.database_id);

    if (!viewId) return { value: '' };

    const relatedDoc = await loadRelatedDoc(viewId, context.loadView);

    if (!relatedDoc) return { value: '' };

    const relatedDatabase = getDatabaseFromDoc(relatedDoc);
    const primaryFieldId = relatedDatabase ? getPrimaryFieldId(relatedDatabase) : undefined;
    const primaryField = primaryFieldId ? relatedDatabase?.get(YjsDatabaseKey.fields)?.get(primaryFieldId) : undefined;

    if (!primaryFieldId || !primaryField) return { value: '' };

    const relatedRowDoc = await context.createRow(getRowKey(relatedDoc.guid, context.relatedRowId));

    observeGroupLabelDoc(relatedRowDoc, labelId);
    const relatedRow = relatedRowDoc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database_row) as
      | YDatabaseRow
      | undefined;
    const primaryCell = relatedRow?.get(YjsDatabaseKey.cells)?.get(primaryFieldId);

    return { value: primaryCell ? decodeCellToText(primaryCell, primaryField).trim() : '' };
  } catch (error) {
    Log.error('Failed to compute relation group label', error);
    return { value: '' };
  }
}

export function subscribeRelationCache(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getRelationCacheRevision() {
  return relationCacheRevision;
}

export function invalidateRelationCell(cellId: string) {
  bumpGeneration(cellId);
}

/**
 * Returns the cached primary-field title immediately and starts one bounded
 * lookup when it is missing. Consumers subscribe through relation cache so
 * headers update without exposing relation row UUIDs while data is loading.
 */
export function readRelationGroupLabel(context: RelationGroupLabelContext): string {
  pruneCache();
  const databaseId = parseRelationTypeOption(context.relationField).database_id;

  if (!databaseId || !context.relatedRowId) return '';

  const labelId = `${databaseId}:${context.relatedRowId}`;
  const generation = getGroupLabelGeneration(labelId);
  const cached = groupLabelCache.get(labelId);

  if (cached && isEntryFresh(cached, generation)) return cached.value;

  if (!groupLabelInflight.has(labelId)) {
    const promise = (async () => {
      const release = await semaphore.acquire();

      try {
        const value = await computeRelationGroupLabel(context, labelId);

        if (getGroupLabelGeneration(labelId) === generation) {
          groupLabelCache.set(labelId, {
            value: value.value,
            generation,
            updatedAt: Date.now(),
          });
          emit();
        }

        return value;
      } finally {
        release();
        if (getGroupLabelGeneration(labelId) === generation) {
          groupLabelInflight.delete(labelId);
        }
      }
    })();

    groupLabelInflight.set(labelId, promise);
  }

  return cached?.value ?? '';
}

export function readRelationCellText(context: RelationComputeContext): string {
  pruneCache();
  if (!context.row || !context.relationField || !context.database) return '';
  const cellId = `${context.rowId}:${context.fieldId}`;
  const generation = getGeneration(cellId);
  const cached = cache.get(cellId);

  if (cached && isEntryFresh(cached, generation)) {
    return cached.value;
  }

  if (!inflight.has(cellId)) {
    const promise = (async () => {
      const release = await semaphore.acquire();

      try {
        const value = await computeRelationCellValue(context);
        const currentGen = getGeneration(cellId);

        if (currentGen === generation) {
          cache.set(cellId, {
            value: value.value,
            generation: currentGen,
            updatedAt: Date.now(),
          });
          emit();
        }

        return value;
      } finally {
        release();
        inflight.delete(cellId);
      }
    })();

    inflight.set(cellId, promise);
  }

  return cached ? cached.value : '';
}
