import { FieldType } from '@/application/database-yjs/database.type';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  RowId,
  YDatabase,
  YDatabaseCell,
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

const RELATION_CACHE_TTL_MS = 5_000;
const RELATION_CACHE_PRUNE_INTERVAL_MS = 2_000;
const RELATION_MAX_CONCURRENCY = 4;
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
const generations = new Map<string, number>();
const listeners = new Set<() => void>();
const relatedDocCache = new Map<string, Promise<YDoc | null>>();
let lastPruneAt = 0;

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
  listeners.forEach((cb) => cb());
}

function pruneCache(now = Date.now()) {
  if (now - lastPruneAt < RELATION_CACHE_PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;

  for (const [cellId, entry] of cache) {
    if (now - entry.updatedAt > RELATION_CACHE_TTL_MS) {
      cache.delete(cellId);
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

function getRelationRowIds(cell?: YDatabaseCell): RowId[] {
  if (!cell) return [];
  const data = cell.get(YjsDatabaseKey.data);

  if (!data) return [];
  if (typeof data === 'object' && 'toJSON' in data) {
    const ids = (data as { toJSON: () => unknown }).toJSON();

    return Array.isArray(ids) ? (ids as RowId[]) : [];
  }

  return Array.isArray(data) ? (data as RowId[]) : [];
}

function getPrimaryFieldId(database: YDatabase): string | undefined {
  const fields = database?.get(YjsDatabaseKey.fields);

  return Array.from(fields?.keys() || []).find((fieldId) => fields?.get(fieldId)?.get(YjsDatabaseKey.is_primary));
}

async function loadRelatedDoc(
  viewId: string,
  loadView?: (viewId: string) => Promise<YDoc | null>
) {
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
    const relatedRowIds = getRelationRowIds(relationCell);

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

export function subscribeRelationCache(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function invalidateRelationCell(cellId: string) {
  bumpGeneration(cellId);
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
