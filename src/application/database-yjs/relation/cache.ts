import { FieldType } from '@/application/database-yjs/database.type';
import { decodeCellToText } from '@/application/database-yjs/decode';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  RowId,
  LoadViewOptions,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { Log } from '@/utils/log';

import type { YEvent } from 'yjs';

type RelationCellValue = {
  value: string;
};

type RelatedViewLoader = (
  viewId: string,
  isSubDocument?: boolean,
  loadAwareness?: boolean,
  options?: LoadViewOptions
) => Promise<YDoc | null>;

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
  loadView?: RelatedViewLoader;
  createRow?: (rowKey: string) => Promise<YDoc>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
};

/** Identifies a group label. This is all a render-time read needs. */
export type RelationGroupLabelKey = {
  relationField: YDatabaseField;
  relatedRowId: RowId;
};

/** Adds the loaders only a resolution needs, so reads cannot trigger one. */
export type RelationGroupLabelContext = RelationGroupLabelKey & {
  loadView?: RelatedViewLoader;
  createRow?: (rowKey: string) => Promise<YDoc>;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
};

const RELATION_CACHE_TTL_MS = 5_000;
const RELATION_CACHE_PRUNE_INTERVAL_MS = 2_000;
const RELATION_MAX_CONCURRENCY = 8;
const RELATION_RELATED_DOC_CACHE_MAX = 50;
const RELATION_GROUP_LABEL_CACHE_MAX = 500;

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
const retainedGroupLabels = new Map<string, number>();
const observedGroupLabelDocs = new WeakMap<YDoc, Set<string>>();
const generations = new Map<string, number>();
const listeners = new Set<() => void>();
// Group labels get their own channel. Cell text resolves once per relation cell
// during sorting and filtering, so folding both into one counter would make
// every one of those resolutions invalidate every grouped view's memo.
const groupLabelListeners = new Set<() => void>();
const relatedDocCache = new Map<string, Promise<YDoc | null>>();
let lastPruneAt = 0;
let groupLabelRevision = 0;

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

function emitGroupLabels() {
  groupLabelRevision += 1;
  groupLabelListeners.forEach((cb) => cb());
}

function getGroupLabelGeneration(labelId: string) {
  return groupLabelGenerations.get(labelId) ?? 0;
}

function bumpGroupLabelGeneration(labelId: string) {
  groupLabelGenerations.set(labelId, getGroupLabelGeneration(labelId) + 1);
  groupLabelCache.delete(labelId);
  // The work cannot be cancelled, but removing its identity lets the next
  // lookup start fresh. Its captured generation prevents a stale completion
  // from overwriting the newer value.
  groupLabelInflight.delete(labelId);
}

function pruneGroupLabelCacheToLimit() {
  if (groupLabelCache.size <= RELATION_GROUP_LABEL_CACHE_MAX) return;

  for (const labelId of groupLabelCache.keys()) {
    if (retainedGroupLabels.has(labelId)) continue;

    // Only the title is dropped. groupLabelGenerations must survive eviction:
    // resetting a label's generation would let work that is still in flight
    // match again and write its stale title back.
    groupLabelCache.delete(labelId);
    if (groupLabelCache.size <= RELATION_GROUP_LABEL_CACHE_MAX) return;
  }
}

function touchGroupLabelCache(labelId: string, entry: RelationCacheEntry) {
  groupLabelCache.delete(labelId);
  groupLabelCache.set(labelId, entry);
  pruneGroupLabelCacheToLimit();
}

function eventTouchesGroupLabel(event: YEvent, primaryFieldId: string) {
  const [rowKey, cellsKey, fieldId] = event.path;

  // A cold row document has no nested row/cells maps yet. Treat creation of
  // either map as label hydration so an initially empty lookup is retried.
  if (rowKey === undefined) return event.changes.keys.has(YjsEditorKey.database_row);
  if (rowKey !== YjsEditorKey.database_row) return false;
  if (cellsKey === undefined) return event.changes.keys.has(YjsDatabaseKey.cells);
  if (cellsKey !== YjsDatabaseKey.cells) return false;
  if (fieldId === undefined) return event.changes.keys.has(primaryFieldId);

  return fieldId === primaryFieldId;
}

function observeGroupLabelRow(rowDoc: YDoc, primaryFieldId: string, labelId: string) {
  const observedLabels = observedGroupLabelDocs.get(rowDoc);

  if (observedLabels) {
    observedLabels.add(labelId);
    return;
  }

  const labelIds = new Set([labelId]);

  observedGroupLabelDocs.set(rowDoc, labelIds);
  // Observe the always-available root before reading its nested maps. This
  // catches WebSocket hydration of a row that was absent from IndexedDB while
  // still ignoring edits outside the primary cell once the row exists.
  rowDoc.getMap(YjsEditorKey.data_section).observeDeep((events: YEvent[]) => {
    if (!events.some((event) => eventTouchesGroupLabel(event, primaryFieldId))) return;
    labelIds.forEach((id) => {
      bumpGroupLabelGeneration(id);
    });
    emitGroupLabels();
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

  // Group labels are deliberately not evicted on TTL. A header that dropped
  // back to its "Untitled relation" placeholder while revalidating would read
  // as real data, so the stale title is served until a newer one resolves.
  // Live edits already invalidate through bumpGroupLabelGeneration, and size
  // is bounded by touchGroupLabelCache.
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

async function loadRelatedDoc(viewId: string, databaseId: string, loadView?: RelatedViewLoader) {
  if (!loadView) return null;
  const cacheKey = `${databaseId}:${viewId}`;
  const cached = relatedDocCache.get(cacheKey);

  if (cached) {
    touchRelatedDocCache(cacheKey, cached);
    return cached;
  }

  const promise = loadView(viewId, false, false, { databaseId, databaseMetadataOnly: true }).catch(() => {
    relatedDocCache.delete(cacheKey);
    return null;
  });

  touchRelatedDocCache(cacheKey, promise);
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

    const relatedDoc = await loadRelatedDoc(viewId, relationOption.database_id, context.loadView);

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

    const relatedDoc = await loadRelatedDoc(viewId, relationOption.database_id, context.loadView);

    if (!relatedDoc) return { value: '' };

    const relatedDatabase = getDatabaseFromDoc(relatedDoc);
    const primaryFieldId = relatedDatabase ? getPrimaryFieldId(relatedDatabase) : undefined;
    const primaryField = primaryFieldId ? relatedDatabase?.get(YjsDatabaseKey.fields)?.get(primaryFieldId) : undefined;

    if (!primaryFieldId || !primaryField) return { value: '' };

    const relatedRowDoc = await context.createRow(getRowKey(relatedDoc.guid, context.relatedRowId));

    // createRow can resolve with a sync-bound but still empty document. Install
    // the observer before the first read so later hydration invalidates the
    // empty result and schedules a fresh lookup through subscribers.
    observeGroupLabelRow(relatedRowDoc, primaryFieldId, labelId);
    const relatedRow = relatedRowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as
      | YDatabaseRow
      | undefined;
    const relatedCells = relatedRow?.get(YjsDatabaseKey.cells);
    const primaryCell = relatedCells?.get(primaryFieldId);

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

/**
 * Group labels resolve independently of relation cell text, so they publish on
 * their own channel. Subscribers here are not woken by the per-cell lookups
 * that sorting and filtering trigger.
 */
export function subscribeRelationGroupLabels(cb: () => void) {
  groupLabelListeners.add(cb);
  return () => {
    groupLabelListeners.delete(cb);
  };
}

export function getRelationGroupLabelRevision() {
  return groupLabelRevision;
}

export function invalidateRelationCell(cellId: string) {
  bumpGeneration(cellId);
}

function getGroupLabelId(context: RelationGroupLabelKey): string | undefined {
  const databaseId = parseRelationTypeOption(context.relationField).database_id;

  if (!databaseId || !context.relatedRowId) return undefined;

  return `${databaseId}:${context.relatedRowId}`;
}

/**
 * Pins labels used by a mounted grouping so the bounded LRU only evicts
 * inactive entries. The cache may exceed its soft limit when a single active
 * grouping contains more labels; it returns to the limit after release.
 */
export function retainRelationGroupLabels(contexts: readonly RelationGroupLabelKey[]): () => void {
  const labelIds = new Set<string>();

  contexts.forEach((context) => {
    const labelId = getGroupLabelId(context);

    if (labelId) labelIds.add(labelId);
  });
  labelIds.forEach((labelId) => {
    retainedGroupLabels.set(labelId, (retainedGroupLabels.get(labelId) ?? 0) + 1);
  });

  let released = false;

  return () => {
    if (released) return;
    released = true;
    labelIds.forEach((labelId) => {
      const retainCount = retainedGroupLabels.get(labelId) ?? 0;

      if (retainCount <= 1) {
        retainedGroupLabels.delete(labelId);
      } else {
        retainedGroupLabels.set(labelId, retainCount - 1);
      }
    });
    pruneGroupLabelCacheToLimit();
  };
}

/**
 * Pure read of the last resolved primary-field title, or '' when nothing has
 * resolved yet. Safe to call while rendering: it never starts work and never
 * mutates module state. Pair it with ensureRelationGroupLabel in an effect.
 */
export function readRelationGroupLabel(context: RelationGroupLabelKey): string {
  const labelId = getGroupLabelId(context);

  if (!labelId) return '';

  return groupLabelCache.get(labelId)?.value ?? '';
}

/**
 * Starts one bounded lookup when the cached title is missing or past its TTL.
 * This mutates module state and schedules async work, so call it from an
 * effect rather than during render.
 */
export function ensureRelationGroupLabel(context: RelationGroupLabelContext): void {
  pruneCache();
  const labelId = getGroupLabelId(context);

  if (!labelId) return;

  const generation = getGroupLabelGeneration(labelId);
  const cached = groupLabelCache.get(labelId);

  if (cached && isEntryFresh(cached, generation)) return;
  if (groupLabelInflight.has(labelId)) return;

  const promise = (async () => {
    const release = await semaphore.acquire();

    try {
      const value = await computeRelationGroupLabel(context, labelId);

      if (getGroupLabelGeneration(labelId) === generation) {
        const changed = cached?.value !== value.value;

        touchGroupLabelCache(labelId, {
          value: value.value,
          generation,
          updatedAt: Date.now(),
        });
        // A TTL revalidation that confirms the same title must not wake
        // subscribers; re-rendering every grouped view on an unchanged
        // value is exactly the churn this cache exists to avoid.
        if (changed) emitGroupLabels();
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
