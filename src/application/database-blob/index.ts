import { stringify as uuidStringify } from 'uuid';
import * as Y from 'yjs';

import { hasRowConditionData, invalidateRowConditionCache } from '@/application/database-yjs/condition-value-cache';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  captureDatabaseStorageFence,
  rotateDatabaseStorageFence,
  publishWithDatabaseStorageFence,
  deleteCollabDB,
  getCachedProviderDoc,
  getCachedRowProvider,
  openCollabDBWithProvider,
  openRowCollabDBWithProvider,
} from '@/application/db';
import {
  DatabaseStorageGenerationChangedError,
  type DatabaseStorageFence,
  isDatabaseStorageFenceCurrent,
  withDatabaseStorageFence,
} from '@/application/db/database-storage-fence';
import { deleteRow as deleteCachedRow, getCachedRowDoc } from '@/application/services/js-services/cache';
import { databaseBlobDiff } from '@/application/services/js-services/http/http_api';
import { EventType, on } from '@/application/session/event';
import { deleteOutboxByObjectId, getCurrentOutboxSession, type SyncOutboxSession } from '@/application/sync-outbox';
import { YDoc, YjsEditorKey } from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';
import { database_blob } from '@/proto/database_blob';
import { Log } from '@/utils/log';

import { createDatabaseBlobDiffPageStage, type DatabaseBlobDiffPageStage } from './page-stage';
import {
  createDatabaseRowDocSeed,
  invalidateDatabaseRowDocSeedGeneration,
  type DatabaseRowDocSeed,
  isDatabaseRowDocSeedCurrent,
} from './row-seed-fence';

type DatabaseBlobRowRid = {
  timestamp: number;
  seqNo: number;
  storageEpoch?: string | null;
};

type PrefetchOptions = {
  /** Restore completion requires every page to reach canonical row storage. */
  requirePersistence?: boolean;
  priorityRowIds?: string[];
  /**
   * Fetch a complete row seed set even when a cached RID exists. Filtered and
   * sorted views need row data for the full view, not only recent changes.
   */
  forceFullSync?: boolean;
  /** Allow the next caller to reuse this entry after it settles. */
  reuseSettled?: boolean;
  /** Called after a terminal page makes the cached seeds committable. */
  onSeedsReady?: () => void;
  /**
   * Called when a non-terminal page, or a restart or failure that dropped
   * provisional seeds, changed what filter and sort can read before
   * `onSeedsReady`. See `getDatabaseRowDocFromSeed`.
   */
  onSeedsProgress?: () => void;
};

class InvalidatedRows extends Set<string> {
  all = false;
  storageFence?: DatabaseStorageFence;

  has(rowId: string): boolean {
    return (
      this.all || Boolean(this.storageFence && !isDatabaseStorageFenceCurrent(this.storageFence)) || super.has(rowId)
    );
  }
}

type SharedPrefetchEntry = {
  invalidated?: boolean;
  storageFence?: DatabaseStorageFence;
  priorityRowIds: Set<string>;
  /** Rows reset after this prefetch started must not consume its stale snapshot. */
  invalidatedRowIds: InvalidatedRows;
  onSeedsReadyCallbacks: Set<() => void>;
  onSeedsProgressCallbacks: Set<() => void>;
  /** Row keys this walk published provisional seeds for before its terminal page. */
  provisionalRowKeys: Set<string>;
  seedsReady: boolean;
  hasCompleteSeedSet: boolean;
  /** True only after all pages reached durable canonical storage. */
  persisted?: boolean;
  coversFullSnapshot: boolean;
  reuseSettled?: boolean;
  settled?: boolean;
  clearWhenSettled?: boolean;
  promise?: Promise<database_blob.DatabaseBlobDiffResponse>;
};

type FetchDiffResult = {
  diff: database_blob.DatabaseBlobDiffResponse;
  ready: boolean;
  /**
   * Provisional pages are encoded and staged outside the JS heap. They remain
   * invisible until a terminal Ready page validates the complete walk.
   */
  stagedPages: DatabaseBlobDiffPageStage | null;
};

const RID_CACHE_PREFIX = 'af_database_blob_rid:';
const APPLY_CONCURRENCY = 6;
const MAX_ROW_DOC_SEEDS = 2000;
const MAX_ROW_DOC_SEEDS_LOOKUP = 10000;
const BLOB_DIFF_PENDING_RETRIES = 1;
const BLOB_DIFF_DEFAULT_RETRY_MS = 1000;
const BLOB_DIFF_MAX_RETRY_MS = 5000;
const BLOB_DIFF_PAGE_MAX_ITEMS = 256;
const BLOB_DIFF_PAGE_MAX_BYTES = 16 * 1024 * 1024;
const BLOB_DIFF_MAX_RESTARTS = 2;

/**
 * How long a database keeps its seeds after the last view that retained it
 * unmounts. A view mounted in that window, such as a dashboard widget opened
 * right after its source grid, joins the settled seed set instead of walking
 * every page again.
 */
export const ROW_DOC_SEED_CACHE_RELEASE_GRACE_MS = 45_000;
/** Released databases whose seeds are kept at once; the oldest is cleared first. */
const MAX_RELEASED_ROW_DOC_SEED_CACHES = 2;
/** Set from a sign-out until the next sign-in: released seeds are cleared at once. */
let releaseRowDocSeedsWithoutGrace = false;

const readyStatus = database_blob.DiffStatus.READY;
const pendingStatus = database_blob.DiffStatus.PENDING;
const sharedPrefetchEntries = new Map<string, SharedPrefetchEntry>();

function ridCacheKey(databaseId: string) {
  return `${RID_CACHE_PREFIX}${databaseId}`;
}

function sharedPrefetchKey(workspaceId: string, databaseId: string) {
  return `${workspaceId}:${databaseId}:delta`;
}

function fullSharedPrefetchKey(workspaceId: string, databaseId: string) {
  return `${workspaceId}:${databaseId}:full`;
}

function sharedPrefetchKeyForOptions(workspaceId: string, databaseId: string, options?: PrefetchOptions) {
  return options?.forceFullSync
    ? fullSharedPrefetchKey(workspaceId, databaseId)
    : sharedPrefetchKey(workspaceId, databaseId);
}

function findSharedPrefetchEntry(
  workspaceId: string,
  databaseId: string,
  options?: PrefetchOptions
): { sharedKey: string; entry?: SharedPrefetchEntry } {
  const requestedKey = sharedPrefetchKeyForOptions(workspaceId, databaseId, options);
  const requestedEntry = sharedPrefetchEntries.get(requestedKey);

  if (requestedEntry || !options?.forceFullSync) {
    return { sharedKey: requestedKey, entry: requestedEntry };
  }

  // A cold delta request has no RID and therefore already asks the server for
  // the complete snapshot. A later filtered/sorted view can reuse that work.
  const deltaKey = sharedPrefetchKey(workspaceId, databaseId);
  const deltaEntry = sharedPrefetchEntries.get(deltaKey);

  if (deltaEntry?.coversFullSnapshot) {
    return { sharedKey: deltaKey, entry: deltaEntry };
  }

  return { sharedKey: requestedKey };
}

function sharedPrefetchEntryMatchesDatabase(sharedKey: string, databaseId: string) {
  return sharedKey.includes(`:${databaseId}:`) || sharedKey.endsWith(`:${databaseId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function retryDelayMs(retryAfterSecs?: number | null): number {
  if (!retryAfterSecs || retryAfterSecs <= 0) return BLOB_DIFF_DEFAULT_RETRY_MS;
  return Math.min(retryAfterSecs * 1000, BLOB_DIFF_MAX_RETRY_MS);
}

function applyPrefetchOptions(entry: SharedPrefetchEntry, options?: PrefetchOptions) {
  if (options?.reuseSettled) {
    entry.reuseSettled = true;
  }

  options?.priorityRowIds?.forEach((rowId) => entry.priorityRowIds.add(rowId));

  const onSeedsProgress = options?.onSeedsProgress;

  if (onSeedsProgress && !entry.seedsReady) {
    entry.onSeedsProgressCallbacks.add(onSeedsProgress);

    // A caller joining a walk in flight reads the pages it already staged.
    if (entry.provisionalRowKeys.size > 0) {
      void Promise.resolve().then(() => {
        if (entry.onSeedsProgressCallbacks.has(onSeedsProgress)) onSeedsProgress();
      });
    }
  }

  if (!options?.onSeedsReady) return;

  if (entry.seedsReady) {
    void Promise.resolve().then(() => {
      if (!entry.storageFence || isDatabaseStorageFenceCurrent(entry.storageFence)) options.onSeedsReady?.();
    });
    return;
  }

  entry.onSeedsReadyCallbacks.add(options.onSeedsReady);
}

function notifySeedsReady(entry: SharedPrefetchEntry) {
  if (entry.invalidated || (entry.storageFence && !isDatabaseStorageFenceCurrent(entry.storageFence)))
    throw new Error('Database prefetch superseded by restore');
  entry.seedsReady = true;
  const callbacks = Array.from(entry.onSeedsReadyCallbacks);

  entry.onSeedsReadyCallbacks.clear();
  entry.onSeedsProgressCallbacks.clear();
  callbacks.forEach((callback) => callback());
}

function notifySeedsProgress(entry: SharedPrefetchEntry) {
  Array.from(entry.onSeedsProgressCallbacks).forEach((callback) => callback());
}

function clearSharedPrefetchEntryAfterSettle(databaseId: string, sharedKey: string, entry: SharedPrefetchEntry) {
  if (entry.clearWhenSettled) return;
  entry.clearWhenSettled = true;

  entry.promise
    ?.finally(() => {
      entry.clearWhenSettled = false;

      if ((rowDocSeedCacheRetainCounts.get(databaseId) ?? 0) === 0 && sharedPrefetchEntries.get(sharedKey) === entry) {
        clearDatabaseRowDocSeedCache(databaseId);
      }
    })
    .catch(() => undefined);
}

function parseRid(rid?: database_blob.IDatabaseBlobRowRid | null): DatabaseBlobRowRid | null {
  if (!rid) return null;

  const timestamp = typeof rid.timestamp === 'number' ? rid.timestamp : Number(rid.timestamp);

  if (!Number.isFinite(timestamp)) return null;

  return {
    timestamp,
    seqNo: rid.seqNo ?? 0,
  };
}

function readCachedRid(databaseId: string, fence?: DatabaseStorageFence): DatabaseBlobRowRid | null {
  try {
    const raw = localStorage.getItem(ridCacheKey(databaseId));

    if (!raw) return null;
    const parsed = JSON.parse(raw) as DatabaseBlobRowRid;

    if (typeof parsed?.timestamp !== 'number' || typeof parsed?.seqNo !== 'number') return null;
    if (fence && (parsed.storageEpoch ?? null) !== fence.epoch) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedRid(databaseId: string, rid: DatabaseBlobRowRid, fence: DatabaseStorageFence) {
  try {
    localStorage.setItem(
      ridCacheKey(databaseId),
      JSON.stringify(fence.epoch === null ? rid : { ...rid, storageEpoch: fence.epoch })
    );
  } catch {
    // Ignore storage failures (private mode/quota).
  }
}

function compareRid(a: DatabaseBlobRowRid, b: DatabaseBlobRowRid) {
  if (a.timestamp === b.timestamp) {
    return a.seqNo - b.seqNo;
  }

  return a.timestamp > b.timestamp ? 1 : -1;
}

function latestRid(current: DatabaseBlobRowRid | null, candidate: DatabaseBlobRowRid | null) {
  if (!candidate || (current && compareRid(current, candidate) >= 0)) return current;
  return candidate;
}

function cursorKey(cursor: Uint8Array) {
  return cursor.join(',');
}

const rowDocSeedCache = new Map<string, DatabaseRowDocSeed>();
const rowDocSeedLookup = new Map<string, DatabaseRowDocSeed>();
const rowDocSeedDocCache = new Map<string, YDoc>();
const seedDocumentFences = new WeakMap<YDoc, DatabaseStorageFence>();
const rowDocSeedCacheRetainCounts = new Map<string, number>();
const pendingRowDocSeedCacheReleases = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * Seeds from pages of a walk that has not reached its terminal page, with the
 * walk that staged them. They are only read to build detached docs for filter
 * and sort: never persisted, never applied to a live row doc, and never used
 * for rendering.
 */
const provisionalRowDocSeeds = new Map<string, { seed: DatabaseRowDocSeed; owner: SharedPrefetchEntry }>();
/** Shared seed docs built from provisional bytes that no terminal page confirmed yet, with their walk. */
const provisionalSeedDocOwners = new Map<string, { doc: YDoc; owner: SharedPrefetchEntry; seed: DatabaseRowDocSeed }>();
const ROW_KEY_SEPARATOR = '_rows_';

/** Destroys a shared seed doc that only provisional bytes built. */
function dropProvisionalSeedDoc(rowKey: string) {
  const provisional = provisionalSeedDocOwners.get(rowKey);

  if (!provisional) return;
  provisionalSeedDocOwners.delete(rowKey);
  if (rowDocSeedDocCache.get(rowKey) !== provisional.doc) return;
  rowDocSeedDocCache.delete(rowKey);
  provisional.doc.destroy();
}

function clearRowDocSeeds(databaseId: string, rowId: string) {
  const rowKey = getRowKey(databaseId, rowId);
  const seedDoc = rowDocSeedDocCache.get(rowKey);

  rowDocSeedCache.delete(rowKey);
  rowDocSeedLookup.delete(rowKey);
  provisionalRowDocSeeds.delete(rowKey);
  provisionalSeedDocOwners.delete(rowKey);

  if (seedDoc) {
    seedDoc.destroy();
    rowDocSeedDocCache.delete(rowKey);
  }
}

/**
 * Publishes the rows of a validated, non-terminal page for filter and sort.
 * The terminal page commits the walk's seeds in the usual atomic pass and
 * confirms these; a restart or failure drops them.
 */
function stageProvisionalSeeds(
  databaseId: string,
  entry: SharedPrefetchEntry,
  diff: database_blob.DatabaseBlobDiffResponse
) {
  if (entry.invalidated || (entry.storageFence && !isDatabaseStorageFenceCurrent(entry.storageFence))) return 0;
  let staged = 0;

  [...diff.creates, ...diff.updates].forEach((update) => {
    const rowId = decodeRowId(update.rowId);

    // Bounded like the committed lookup: the page stage keeps large walks off the heap.
    if (!rowId || entry.invalidatedRowIds.has(rowId) || provisionalRowDocSeeds.size >= MAX_ROW_DOC_SEEDS_LOOKUP) return;
    const state = getDocState(update.docState);

    if (!state) return;
    const rowKey = getRowKey(databaseId, rowId);

    provisionalRowDocSeeds.set(rowKey, {
      seed: createDatabaseRowDocSeed(rowId, { ...state, storageFence: entry.storageFence }),
      owner: entry,
    });
    entry.provisionalRowKeys.add(rowKey);
    staged += 1;
  });

  diff.deletes.forEach((deletion) => {
    const rowId = decodeRowId(deletion.rowId);

    if (!rowId) return;
    const rowKey = getRowKey(databaseId, rowId);

    provisionalRowDocSeeds.delete(rowKey);
    dropProvisionalSeedDoc(rowKey);
  });

  return staged;
}

/**
 * Forgets a walk's provisional seeds. After a terminal page, `commit` keeps the
 * docs built from them: the committed seeds were applied to those same docs.
 */
function releaseProvisionalSeeds(entry: SharedPrefetchEntry, options?: { commit?: boolean }) {
  if (entry.provisionalRowKeys.size === 0) return false;

  entry.provisionalRowKeys.forEach((rowKey) => {
    if (provisionalRowDocSeeds.get(rowKey)?.owner === entry) provisionalRowDocSeeds.delete(rowKey);
    if (provisionalSeedDocOwners.get(rowKey)?.owner !== entry) return;
    if (options?.commit) {
      provisionalSeedDocOwners.delete(rowKey);
    } else {
      dropProvisionalSeedDoc(rowKey);
    }
  });
  entry.provisionalRowKeys.clear();
  return true;
}

/**
 * Remove every cached seed for a row and fence it out of blob requests that
 * started before a version reset. Row object IDs are globally unique, while
 * the database ID is not available to the row sync reset handler.
 */
export function invalidateDatabaseRowDocSeed(rowId: string) {
  if (!rowId) return;

  invalidateDatabaseRowDocSeedGeneration(rowId);
  const rowKeySuffix = `${ROW_KEY_SEPARATOR}${rowId}`;

  for (const key of rowDocSeedCache.keys()) {
    if (key.endsWith(rowKeySuffix)) {
      rowDocSeedCache.delete(key);
    }
  }

  for (const key of rowDocSeedLookup.keys()) {
    if (key.endsWith(rowKeySuffix)) {
      rowDocSeedLookup.delete(key);
    }
  }

  for (const key of provisionalRowDocSeeds.keys()) {
    if (key.endsWith(rowKeySuffix)) {
      provisionalRowDocSeeds.delete(key);
    }
  }

  for (const [key, doc] of rowDocSeedDocCache.entries()) {
    if (key.endsWith(rowKeySuffix)) {
      doc.destroy();
      rowDocSeedDocCache.delete(key);
      provisionalSeedDocOwners.delete(key);
    }
  }

  sharedPrefetchEntries.forEach((entry) => {
    entry.invalidatedRowIds.add(rowId);
  });
}

function sameSeedBytes(left: DatabaseRowDocSeed, right: DatabaseRowDocSeed) {
  if (left.encoderVersion !== right.encoderVersion || left.bytes.length !== right.bytes.length) return false;

  for (let index = 0; index < left.bytes.length; index += 1) {
    if (left.bytes[index] !== right.bytes[index]) return false;
  }

  return true;
}

function applySeedToSharedRowDoc(rowKey: string, seed: DatabaseRowDocSeed) {
  const doc = rowDocSeedDocCache.get(rowKey);

  if (!doc) return;

  const provisional = provisionalSeedDocOwners.get(rowKey);

  // The terminal page confirms the bytes a provisional page already built
  // this doc from: decoding them again would change nothing.
  if (provisional?.doc === doc && isDatabaseRowDocSeedCurrent(seed) && sameSeedBytes(provisional.seed, seed)) return;

  try {
    if (!isDatabaseRowDocSeedCurrent(seed)) return;
    withDatabaseStorageFence(doc, seed.storageFence, () => applyYDoc(doc, seed.bytes, seed.encoderVersion));
    if (seed.storageFence) seedDocumentFences.set(doc, seed.storageFence);
    invalidateRowConditionCache(doc);
  } catch {
    doc.destroy();
    rowDocSeedDocCache.delete(rowKey);
  }
}

function trimRowDocSeedLookup() {
  while (rowDocSeedLookup.size > MAX_ROW_DOC_SEEDS_LOOKUP) {
    const oldestKey = rowDocSeedLookup.keys().next().value;

    if (!oldestKey) break;
    rowDocSeedLookup.delete(oldestKey);
  }
}

function cacheRowDocSeed(
  rowKey: string,
  rowId: string,
  docState?: database_blob.ICollabDocState | null,
  storageFence?: DatabaseStorageFence
) {
  const cachedDoc = getCachedRowDoc(rowKey);

  if (hasRowConditionData(cachedDoc)) return;

  const state = getDocState(docState);

  if (!state) return;

  const seed = createDatabaseRowDocSeed(rowId, { ...state, storageFence });

  applySeedToSharedRowDoc(rowKey, seed);
  rowDocSeedCache.set(rowKey, seed);

  while (rowDocSeedCache.size > MAX_ROW_DOC_SEEDS) {
    const oldestKey = rowDocSeedCache.keys().next().value;

    if (!oldestKey) break;
    rowDocSeedCache.delete(oldestKey);
  }
}

export function takeDatabaseRowDocSeed(rowKey: string): DatabaseRowDocSeed | null {
  const source = rowDocSeedCache.has(rowKey) ? 'cache' : 'lookup';
  const cachedSeed = peekDatabaseRowDocSeed(rowKey);

  if (cachedSeed) {
    rowDocSeedCache.delete(rowKey);
    rowDocSeedLookup.delete(rowKey);
    Log.debug('[Database] row seed hit', {
      rowKey,
      source,
      cacheSize: rowDocSeedCache.size,
      lookupSize: rowDocSeedLookup.size,
    });
    return cachedSeed;
  }

  Log.debug('[Database] row seed miss', {
    rowKey,
    cacheSize: rowDocSeedCache.size,
    lookupSize: rowDocSeedLookup.size,
  });
  return null;
}

/**
 * Non-destructive read of a row doc seed. Multiple database views may need
 * the same row seed at the same time: one to build an in-memory doc for
 * filter/sort, another to open the IndexedDB-backed row doc for rendering.
 */
export function peekDatabaseRowDocSeed(rowKey: string): DatabaseRowDocSeed | null {
  const seed = rowDocSeedCache.get(rowKey) ?? rowDocSeedLookup.get(rowKey) ?? null;

  if (seed && !isDatabaseRowDocSeedCurrent(seed)) {
    rowDocSeedCache.delete(rowKey);
    rowDocSeedLookup.delete(rowKey);
    rowDocSeedDocCache.delete(rowKey);
    return null;
  }

  return seed;
}

function peekProvisionalRowDocSeed(rowKey: string) {
  const provisional = provisionalRowDocSeeds.get(rowKey);

  if (!provisional) return undefined;
  if (provisional.owner.invalidated || !isDatabaseRowDocSeedCurrent(provisional.seed)) {
    provisionalRowDocSeeds.delete(rowKey);
    return undefined;
  }

  return provisional;
}

/**
 * Shared read-only row doc for filter/sort. Reuses an existing live row doc
 * when one is already cached; otherwise builds one shared in-memory doc from
 * seed bytes so multiple views of the same database can reuse cell values.
 *
 * Before a walk reaches its terminal page, the doc may come from a page it
 * already validated. The terminal page applies the committed seed to that same
 * doc; a restart or failure destroys it.
 */
export function getDatabaseRowDocFromSeed(rowKey: string): YDoc | null {
  const liveDoc = getCachedRowDoc(rowKey);
  const liveFence = liveDoc && seedDocumentFences.get(liveDoc);

  if (liveFence && !isDatabaseStorageFenceCurrent(liveFence)) return null;
  if (hasRowConditionData(liveDoc)) return liveDoc;

  const cachedDoc = rowDocSeedDocCache.get(rowKey);

  if (cachedDoc) {
    const fence = seedDocumentFences.get(cachedDoc);

    if (fence && !isDatabaseStorageFenceCurrent(fence)) {
      rowDocSeedDocCache.delete(rowKey);
      provisionalSeedDocOwners.delete(rowKey);
      return null;
    }

    if (hasRowConditionData(cachedDoc)) return cachedDoc;
    cachedDoc.destroy();
    rowDocSeedDocCache.delete(rowKey);
    provisionalSeedDocOwners.delete(rowKey);
  }

  const committedSeed = peekDatabaseRowDocSeed(rowKey);
  const provisional = committedSeed ? undefined : peekProvisionalRowDocSeed(rowKey);
  const seed = committedSeed ?? provisional?.seed;

  if (!seed) return null;

  const doc = new Y.Doc({ guid: rowKey }) as YDoc;

  try {
    applyYDoc(doc, seed.bytes, seed.encoderVersion);
  } catch {
    doc.destroy();
    return null;
  }

  const dataSection = doc.getMap(YjsEditorKey.data_section);

  if (!dataSection.has(YjsEditorKey.database_row)) {
    doc.destroy();
    return null;
  }

  rowDocSeedDocCache.set(rowKey, doc);
  if (provisional) {
    provisionalSeedDocOwners.set(rowKey, { doc, owner: provisional.owner, seed: provisional.seed });
  } else {
    provisionalSeedDocOwners.delete(rowKey);
  }

  if (seed.storageFence) seedDocumentFences.set(doc, seed.storageFence);
  return doc;
}

export function clearDatabaseRowDocSeedCache(databaseId: string) {
  const prefix = `${databaseId}_rows_`;
  let hasUnsettledPrefetch = false;

  cancelPendingRowDocSeedCacheRelease(databaseId);

  for (const [key, entry] of sharedPrefetchEntries.entries()) {
    if (sharedPrefetchEntryMatchesDatabase(key, databaseId)) {
      entry.onSeedsReadyCallbacks.clear();
      entry.onSeedsProgressCallbacks.clear();

      if (entry.promise && !entry.settled) {
        clearSharedPrefetchEntryAfterSettle(databaseId, key, entry);
        hasUnsettledPrefetch = true;
      }
    }
  }

  if (hasUnsettledPrefetch) return;

  for (const key of rowDocSeedCache.keys()) {
    if (key.startsWith(prefix)) {
      rowDocSeedCache.delete(key);
    }
  }

  for (const key of rowDocSeedLookup.keys()) {
    if (key.startsWith(prefix)) {
      rowDocSeedLookup.delete(key);
    }
  }

  for (const key of provisionalRowDocSeeds.keys()) {
    if (key.startsWith(prefix)) {
      provisionalRowDocSeeds.delete(key);
    }
  }

  for (const [key, doc] of rowDocSeedDocCache.entries()) {
    if (key.startsWith(prefix)) {
      doc.destroy();
      rowDocSeedDocCache.delete(key);
      provisionalSeedDocOwners.delete(key);
    }
  }

  for (const [key, entry] of sharedPrefetchEntries.entries()) {
    if (sharedPrefetchEntryMatchesDatabase(key, databaseId)) {
      entry.onSeedsReadyCallbacks.clear();
      entry.onSeedsProgressCallbacks.clear();
      entry.provisionalRowKeys.clear();
      sharedPrefetchEntries.delete(key);
    }
  }
}

/** Retires an aggregate generation before deleting its canonical row storage. */
export async function invalidateDatabaseBlobAfterRestore(
  databaseId: string,
  databaseRestoreId: string,
  expectedStorageEpoch: string | null
): Promise<void> {
  await rotateDatabaseStorageFence(databaseId, databaseRestoreId, expectedStorageEpoch);
  const storageFence: DatabaseStorageFence = { databaseId, epoch: databaseRestoreId, cacheEpoch: databaseRestoreId };

  if (!isDatabaseStorageFenceCurrent(storageFence)) throw new DatabaseStorageGenerationChangedError();
  const retiring: Promise<unknown>[] = [];

  for (const [key, entry] of sharedPrefetchEntries) {
    if (!sharedPrefetchEntryMatchesDatabase(key, databaseId) || entry.storageFence?.epoch === databaseRestoreId)
      continue;
    entry.invalidated = true;
    entry.onSeedsReadyCallbacks.clear();
    entry.onSeedsProgressCallbacks.clear();
    entry.invalidatedRowIds.all = true;
    releaseProvisionalSeeds(entry);
    if (entry.promise) retiring.push(entry.promise);
  }

  for (const key of new Set([...rowDocSeedCache.keys(), ...rowDocSeedLookup.keys(), ...rowDocSeedDocCache.keys()])) {
    if (!key.startsWith(`${databaseId}_rows_`)) continue;
    const doc = rowDocSeedDocCache.get(key);
    const fence =
      (rowDocSeedCache.get(key) ?? rowDocSeedLookup.get(key))?.storageFence ?? (doc && seedDocumentFences.get(doc));

    if (fence?.epoch === databaseRestoreId) continue;
    invalidateDatabaseRowDocSeedGeneration(key.slice(`${databaseId}_rows_`.length));
    rowDocSeedCache.delete(key);
    rowDocSeedLookup.delete(key);
    rowDocSeedDocCache.delete(key);
    provisionalSeedDocOwners.delete(key);
    doc?.destroy();
  }

  await Promise.allSettled(retiring);
  for (const [key, entry] of sharedPrefetchEntries) {
    if (sharedPrefetchEntryMatchesDatabase(key, databaseId) && entry.invalidated) sharedPrefetchEntries.delete(key);
  }

  // Do not remove the checkpoint that a faster tab already published for R.
  const current = await publishWithDatabaseStorageFence(storageFence, () => {
    const rid = readCachedRid(databaseId);

    if (rid && rid.storageEpoch !== databaseRestoreId) localStorage.removeItem(ridCacheKey(databaseId));
  });

  if (!current) throw new DatabaseStorageGenerationChangedError();
}

function cancelPendingRowDocSeedCacheRelease(databaseId: string) {
  const timer = pendingRowDocSeedCacheReleases.get(databaseId);

  if (timer === undefined) return;
  clearTimeout(timer);
  pendingRowDocSeedCacheReleases.delete(databaseId);
}

export function retainDatabaseRowDocSeedCache(databaseId: string) {
  cancelPendingRowDocSeedCacheRelease(databaseId);
  rowDocSeedCacheRetainCounts.set(databaseId, (rowDocSeedCacheRetainCounts.get(databaseId) ?? 0) + 1);
}

/**
 * Releases one view's hold on a database's seeds. The last release keeps them
 * for `ROW_DOC_SEED_CACHE_RELEASE_GRACE_MS`, so the next view of the database
 * reuses the settled walk; only the most recently released databases are kept.
 */
export function releaseDatabaseRowDocSeedCache(databaseId: string) {
  const count = rowDocSeedCacheRetainCounts.get(databaseId) ?? 0;

  if (count > 1) {
    rowDocSeedCacheRetainCounts.set(databaseId, count - 1);
    return;
  }

  rowDocSeedCacheRetainCounts.delete(databaseId);
  if (releaseRowDocSeedsWithoutGrace) {
    clearDatabaseRowDocSeedCache(databaseId);
    return;
  }

  cancelPendingRowDocSeedCacheRelease(databaseId);
  pendingRowDocSeedCacheReleases.set(
    databaseId,
    setTimeout(() => {
      pendingRowDocSeedCacheReleases.delete(databaseId);
      if ((rowDocSeedCacheRetainCounts.get(databaseId) ?? 0) === 0) clearDatabaseRowDocSeedCache(databaseId);
    }, ROW_DOC_SEED_CACHE_RELEASE_GRACE_MS)
  );

  while (pendingRowDocSeedCacheReleases.size > MAX_RELEASED_ROW_DOC_SEED_CACHES) {
    const oldestDatabaseId = pendingRowDocSeedCacheReleases.keys().next().value;

    if (oldestDatabaseId === undefined) break;
    clearDatabaseRowDocSeedCache(oldestDatabaseId);
  }
}

/**
 * Clears the seeds of every released database now instead of after its grace
 * period, so the next account to sign in never joins a walk another account's
 * session downloaded.
 */
function clearReleasedDatabaseRowDocSeedCaches() {
  Array.from(pendingRowDocSeedCacheReleases.keys()).forEach((databaseId) => clearDatabaseRowDocSeedCache(databaseId));
}

// Signing out unmounts the views after this event, so their releases skip the
// grace period until the next sign-in.
on(EventType.SESSION_INVALID, () => {
  releaseRowDocSeedsWithoutGrace = true;
  clearReleasedDatabaseRowDocSeedCaches();
});
on(EventType.SESSION_VALID, () => {
  releaseRowDocSeedsWithoutGrace = false;
});

function maxRidFromDiff(diff: database_blob.DatabaseBlobDiffResponse): DatabaseBlobRowRid | null {
  let maxRid: DatabaseBlobRowRid | null = null;

  const updates = [...diff.creates, ...diff.updates];

  updates.forEach((update) => {
    const rid = parseRid(update.rid);

    if (!rid) return;
    if (!maxRid || compareRid(rid, maxRid) > 0) {
      maxRid = rid;
    }
  });

  diff.deletes.forEach((del) => {
    const rid = parseRid(del.rid);

    if (!rid) return;
    if (!maxRid || compareRid(rid, maxRid) > 0) {
      maxRid = rid;
    }
  });

  return maxRid;
}

function summarizeDiff(diff: database_blob.DatabaseBlobDiffResponse) {
  const updates = diff.updates.length;
  const creates = diff.creates.length;
  const deletes = diff.deletes.length;
  let rowDocStates = 0;
  let documentDocStates = 0;

  [...diff.creates, ...diff.updates].forEach((update) => {
    if (update.docState?.docState && update.docState.docState.length > 0) {
      rowDocStates += 1;
    }

    if (update.document?.docState?.docState && update.document.docState.docState.length > 0) {
      documentDocStates += 1;
    }
  });

  return {
    creates,
    updates,
    deletes,
    rowDocStates,
    documentDocStates,
    missingRowIds: diff.missingRowIds.length,
  };
}

function getDocState(state?: database_blob.ICollabDocState | null) {
  if (!state?.docState || state.docState.length === 0) return null;
  return {
    // protobuf.js decodes bytes as a view into the complete response buffer.
    // Cache an owned copy so one small row seed cannot pin an entire staged
    // page in the browser heap after that page has been processed.
    bytes: new Uint8Array(state.docState),
    encoderVersion: typeof state.encoderVersion === 'number' ? state.encoderVersion : 1,
  };
}

function decodeRowId(rowIdBytes?: Uint8Array | null) {
  if (!rowIdBytes || rowIdBytes.length !== 16) return null;
  return uuidStringify(rowIdBytes);
}

function applySeedToCachedDoc(rowKey: string, seed: DatabaseRowDocSeed) {
  const cachedDoc = getCachedRowDoc(rowKey);

  if (!cachedDoc) return false;

  if (!isDatabaseRowDocSeedCurrent(seed)) return false;
  withDatabaseStorageFence(cachedDoc, seed.storageFence, () => applyYDoc(cachedDoc, seed.bytes, seed.encoderVersion));
  if (seed.storageFence) seedDocumentFences.set(cachedDoc, seed.storageFence);
  invalidateRowConditionCache(cachedDoc);
  return true;
}

function seedRowDocCacheFromDiff(
  databaseId: string,
  diff: database_blob.DatabaseBlobDiffResponse,
  options?: Pick<PrefetchOptions, 'priorityRowIds'> & {
    invalidatedRowIds?: ReadonlySet<string>;
    storageFence?: DatabaseStorageFence;
  }
) {
  const updates = [...diff.creates, ...diff.updates];

  const priorityRowIds = options?.priorityRowIds ?? [];
  const prioritySet = new Set(priorityRowIds);
  const updatesByRowId = priorityRowIds.length > 0 ? new Map<string, database_blob.IDatabaseBlobRowUpdate>() : null;
  let seeded = 0;
  let prioritized = 0;
  let appliedToCached = 0;
  let deleted = 0;
  let invalidated = 0;

  updates.forEach((update) => {
    const rowId = decodeRowId(update.rowId);

    if (!rowId) return;
    if (options?.invalidatedRowIds?.has(rowId)) {
      invalidated += 1;
      return;
    }

    const rowKey = getRowKey(databaseId, rowId);

    const state = getDocState(update.docState);

    if (!state) return;

    const seed = createDatabaseRowDocSeed(rowId, { ...state, storageFence: options?.storageFence });

    applySeedToSharedRowDoc(rowKey, seed);
    rowDocSeedLookup.set(rowKey, seed);
    if (rowDocSeedLookup.size > MAX_ROW_DOC_SEEDS_LOOKUP) {
      trimRowDocSeedLookup();
    }

    if (applySeedToCachedDoc(rowKey, seed)) {
      appliedToCached += 1;
      return;
    }

    if (prioritySet.has(rowId)) {
      if (updatesByRowId) {
        updatesByRowId.set(rowId, update);
      }

      return;
    }

    rowDocSeedCache.set(rowKey, seed);
    seeded += 1;

    while (rowDocSeedCache.size > MAX_ROW_DOC_SEEDS) {
      const oldestKey = rowDocSeedCache.keys().next().value;

      if (!oldestKey) break;
      rowDocSeedCache.delete(oldestKey);
    }
  });

  priorityRowIds.forEach((rowId) => {
    const update = updatesByRowId?.get(rowId);

    if (!update) return;

    const rowKey = getRowKey(databaseId, rowId);

    const state = getDocState(update.docState);

    if (!state) return;

    const seed = createDatabaseRowDocSeed(rowId, { ...state, storageFence: options?.storageFence });

    applySeedToSharedRowDoc(rowKey, seed);
    rowDocSeedLookup.set(rowKey, seed);
    if (rowDocSeedLookup.size > MAX_ROW_DOC_SEEDS_LOOKUP) {
      trimRowDocSeedLookup();
    }

    if (applySeedToCachedDoc(rowKey, seed)) {
      appliedToCached += 1;
      return;
    }

    rowDocSeedCache.set(rowKey, seed);
    seeded += 1;
    prioritized += 1;

    while (rowDocSeedCache.size > MAX_ROW_DOC_SEEDS) {
      const oldestKey = rowDocSeedCache.keys().next().value;

      if (!oldestKey) break;
      rowDocSeedCache.delete(oldestKey);
    }
  });

  diff.deletes.forEach((del) => {
    const rowId = decodeRowId(del.rowId);

    if (!rowId) return;
    if (options?.invalidatedRowIds?.has(rowId)) {
      invalidated += 1;
      return;
    }

    clearRowDocSeeds(databaseId, rowId);
    deleted += 1;
  });

  return {
    seeded,
    prioritized,
    priorityRequested: priorityRowIds.length,
    appliedToCached,
    deleted,
    invalidated,
  };
}

function inspectDocRowData(
  doc: YDoc,
  objectId: string
): {
  hasDataSection: boolean;
  hasDatabaseRow: boolean;
  rowKeys: string[];
} {
  try {
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const hasDataSection = Boolean(sharedRoot);

    if (!sharedRoot) {
      return { hasDataSection: false, hasDatabaseRow: false, rowKeys: [] };
    }

    const row = sharedRoot.get(YjsEditorKey.database_row);
    const hasDatabaseRow = Boolean(row);
    let rowKeys: string[] = [];

    if (row && typeof row.keys === 'function') {
      try {
        rowKeys = Array.from(row.keys() as Iterable<string>);
      } catch {
        rowKeys = [];
      }
    }

    return { hasDataSection, hasDatabaseRow, rowKeys };
  } catch (e) {
    Log.debug('[Database] inspectDocRowData error', { objectId, error: e });
    return { hasDataSection: false, hasDatabaseRow: false, rowKeys: [] };
  }
}

async function applyCollabUpdate(
  objectId: string,
  docState: database_blob.ICollabDocState,
  options?: { useSharedRowStorage?: boolean; shouldApply?: () => boolean; storageFence?: DatabaseStorageFence }
) {
  const state = getDocState(docState);

  if (!state) {
    Log.debug('[Database] applyCollabUpdate skipped - no doc state', { objectId });
    return;
  }

  if (options?.shouldApply?.() === false) return;

  const cachedDoc = getCachedRowDoc(objectId) || getCachedProviderDoc(objectId);

  if (cachedDoc) {
    const beforeState = inspectDocRowData(cachedDoc, objectId);

    Log.debug('[Database] applyCollabUpdate to in-memory cached doc (before)', {
      objectId,
      bytes: state.bytes.length,
      encoderVersion: state.encoderVersion,
      ...beforeState,
    });
    withDatabaseStorageFence(cachedDoc, options?.storageFence, () =>
      applyYDoc(cachedDoc, state.bytes, state.encoderVersion)
    );
    invalidateRowConditionCache(cachedDoc);

    const afterState = inspectDocRowData(cachedDoc, objectId);

    Log.debug('[Database] applyCollabUpdate to in-memory cached doc (after)', {
      objectId,
      bytes: state.bytes.length,
      ...afterState,
    });
    if (!options?.useSharedRowStorage) return;
    const provider = getCachedRowProvider(objectId);

    if (provider?.doc === cachedDoc) {
      await provider.whenPersisted();
      return;
    }

    // A seed-only document has no provider to confirm its write. Persist the
    // server bytes through shared storage before advancing the checkpoint.
  }

  Log.debug('[Database] applyCollabUpdate opening IndexedDB for write (NO CACHED DOC)', {
    objectId,
    bytes: state.bytes.length,
    encoderVersion: state.encoderVersion,
  });

  const openStartedAt = Date.now();
  const { doc, provider } = options?.useSharedRowStorage
    ? await openRowCollabDBWithProvider(objectId, { skipCache: true })
    : await openCollabDBWithProvider(objectId, { skipCache: true });

  Log.debug('[Database] applyCollabUpdate IndexedDB opened', {
    objectId,
    openDurationMs: Date.now() - openStartedAt,
  });

  try {
    // The storage open above yields. A row version reset may have invalidated
    // this prefetch while it was pending, so check the fence again before
    // merging any structs into the newly opened canonical document.
    if (options?.shouldApply?.() === false) return;

    const beforeState = inspectDocRowData(doc, objectId);
    const applyStartedAt = Date.now();

    withDatabaseStorageFence(doc, options?.storageFence, () => applyYDoc(doc, state.bytes, state.encoderVersion));
    if ('whenPersisted' in provider) await provider.whenPersisted();

    const afterState = inspectDocRowData(doc, objectId);

    Log.debug('[Database] applyCollabUpdate written to IndexedDB', {
      objectId,
      bytes: state.bytes.length,
      applyDurationMs: Date.now() - applyStartedAt,
      beforeApply: beforeState,
      afterApply: afterState,
    });
  } finally {
    const destroyStartedAt = Date.now();

    await provider.destroy();
    doc.destroy();
    Log.debug('[Database] applyCollabUpdate provider destroyed', {
      objectId,
      destroyDurationMs: Date.now() - destroyStartedAt,
    });
  }
}

async function applyRowUpdate(
  databaseId: string,
  update: database_blob.IDatabaseBlobRowUpdate,
  options?: { seedCache?: boolean; invalidatedRowIds?: ReadonlySet<string>; storageFence?: DatabaseStorageFence }
) {
  const rowId = decodeRowId(update.rowId);

  if (!rowId) {
    Log.debug('[Database] applyRowUpdate skipped - invalid rowId bytes');
    return;
  }

  const isInvalidated = () => options?.invalidatedRowIds?.has(rowId) ?? false;

  if (isInvalidated()) return;

  const rowDocState = update.docState;
  const hasRowDocState = Boolean(rowDocState?.docState?.length);
  const hasDocument = Boolean(update.document?.docState?.docState?.length);

  Log.debug('[Database] applyRowUpdate start', {
    databaseId,
    rowId,
    hasRowDocState,
    hasDocument,
    documentDeleted: update.document?.deleted ?? false,
    seedCache: options?.seedCache !== false,
  });

  const startedAt = Date.now();

  if (rowDocState) {
    const rowKey = getRowKey(databaseId, rowId);

    if (options?.seedCache !== false) {
      cacheRowDocSeed(rowKey, rowId, rowDocState, options?.storageFence);
    }

    await applyCollabUpdate(rowId, rowDocState, {
      useSharedRowStorage: true,
      storageFence: options?.storageFence,
      shouldApply: () => !isInvalidated(),
    });

    if (isInvalidated()) return;
  }

  const doc = update.document;

  if (!doc || doc.deleted) {
    Log.debug('[Database] applyRowUpdate completed (no document)', {
      databaseId,
      rowId,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  if (!doc.docState) {
    Log.debug('[Database] applyRowUpdate completed (no document docState)', {
      databaseId,
      rowId,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  const docIdBytes = doc.documentId;

  if (!docIdBytes || docIdBytes.length !== 16) {
    Log.debug('[Database] applyRowUpdate completed (invalid documentId)', {
      databaseId,
      rowId,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  const docId = uuidStringify(docIdBytes);

  Log.debug('[Database] applyRowUpdate applying document', {
    databaseId,
    rowId,
    docId,
    docBytes: doc.docState.docState?.length ?? 0,
  });

  await applyCollabUpdate(docId, doc.docState);

  Log.debug('[Database] applyRowUpdate completed', {
    databaseId,
    rowId,
    docId,
    durationMs: Date.now() - startedAt,
  });
}

async function applyRowDelete(
  databaseId: string,
  deletion: database_blob.IDatabaseBlobRowDelete,
  outboxSession: SyncOutboxSession | null,
  invalidatedRowIds?: ReadonlySet<string>,
  storageFence?: DatabaseStorageFence
) {
  const rowId = decodeRowId(deletion.rowId);

  if (!rowId) {
    throw new Error('database blob diff contained a delete with an invalid row ID');
  }

  const isInvalidated = () => invalidatedRowIds?.has(rowId) ?? false;

  if (isInvalidated()) return;

  const rowKey = getRowKey(databaseId, rowId);

  clearRowDocSeeds(databaseId, rowId);

  try {
    if (!outboxSession) {
      throw new Error(`cannot persist database row tombstone ${rowId} without its originating outbox session`);
    }

    // A drain can be waiting on restore reconciliation, which in turn retires
    // this prefetch. Object generations fence its captured bytes without
    // waiting on that same drain and forming a cycle.
    await deleteOutboxByObjectId(rowId, { session: outboxSession, storageFence, skipActiveDrain: true });

    if (isInvalidated()) return;

    const storageDeletes = await Promise.allSettled([
      deleteCollabDB(rowId, { destroyDoc: false, storageFence }),
      // Older Web clients persisted rows under the composite row key. Leaving
      // that database behind lets legacy backfill resurrect a tombstoned row.
      deleteCollabDB(rowKey, storageFence ? { storageFence } : undefined),
    ]);
    const rejectedDelete = storageDeletes.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );

    if (rejectedDelete) {
      throw rejectedDelete.reason;
    }

    if (storageDeletes.some((result) => result.status === 'fulfilled' && !result.value)) {
      throw new Error(`failed to delete local database row ${rowId}`);
    }
  } finally {
    // deleteCollabDB must dispose its provider before deleteCachedRow evicts
    // that provider entry. The cached Y.Doc is removed even when storage
    // deletion fails, and the unchanged RID makes the next diff retry it.
    if (!isInvalidated()) {
      deleteCachedRow(rowKey);
    }
  }
}

async function awaitBatch(operations: Promise<void>[]) {
  const results = await Promise.allSettled(operations);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');

  if (rejected) {
    throw rejected.reason;
  }
}

async function applyDiff(
  databaseId: string,
  diff: database_blob.DatabaseBlobDiffResponse,
  options?: {
    seedCache?: boolean;
    outboxSession?: SyncOutboxSession | null;
    invalidatedRowIds?: ReadonlySet<string>;
    storageFence?: DatabaseStorageFence;
  }
) {
  const updates = [...diff.creates, ...diff.updates];
  const totalUpdates = updates.length;
  const deletes = diff.deletes;
  const totalBatches = Math.ceil(totalUpdates / APPLY_CONCURRENCY) + Math.ceil(deletes.length / APPLY_CONCURRENCY);

  Log.debug('[Database] applyDiff start', {
    databaseId,
    totalUpdates,
    totalBatches,
    concurrency: APPLY_CONCURRENCY,
    creates: diff.creates.length,
    updates: diff.updates.length,
    deletes: deletes.length,
    seedCache: options?.seedCache !== false,
  });

  const startedAt = Date.now();

  for (let i = 0; i < updates.length; i += APPLY_CONCURRENCY) {
    const batchIndex = Math.floor(i / APPLY_CONCURRENCY);
    const batch = updates.slice(i, i + APPLY_CONCURRENCY);
    const batchStartedAt = Date.now();

    Log.debug('[Database] applyDiff batch start', {
      databaseId,
      batchIndex,
      batchSize: batch.length,
      progress: `${i}/${totalUpdates}`,
    });

    await awaitBatch(batch.map((update) => applyRowUpdate(databaseId, update, options)));

    Log.debug('[Database] applyDiff batch completed', {
      databaseId,
      batchIndex,
      batchSize: batch.length,
      batchDurationMs: Date.now() - batchStartedAt,
      progress: `${Math.min(i + APPLY_CONCURRENCY, totalUpdates)}/${totalUpdates}`,
    });
  }

  for (let i = 0; i < deletes.length; i += APPLY_CONCURRENCY) {
    const batch = deletes.slice(i, i + APPLY_CONCURRENCY);

    await awaitBatch(
      batch.map((deletion) =>
        applyRowDelete(
          databaseId,
          deletion,
          options?.outboxSession ?? null,
          options?.invalidatedRowIds,
          options?.storageFence
        )
      )
    );
  }

  Log.debug('[Database] applyDiff completed', {
    databaseId,
    totalUpdates,
    totalDeletes: deletes.length,
    totalBatches,
    totalDurationMs: Date.now() - startedAt,
  });
}

async function persistDiffToIndexedDB(
  databaseId: string,
  diff: database_blob.DatabaseBlobDiffResponse,
  source: string,
  outboxSession: SyncOutboxSession | null,
  invalidatedRowIds?: ReadonlySet<string>,
  storageFence?: DatabaseStorageFence
): Promise<boolean> {
  const applyStartedAt = Date.now();

  try {
    await applyDiff(databaseId, diff, { seedCache: false, outboxSession, invalidatedRowIds, storageFence });
    Log.debug('[Database] blob diff persisted to IndexedDB', {
      databaseId,
      source,
      durationMs: Date.now() - applyStartedAt,
      ...summarizeDiff(diff),
    });
    return true;
  } catch (error) {
    Log.warn('[Database] blob diff persist failed', {
      databaseId,
      source,
      error,
    });
    return false;
  }
}

async function fetchReadyDiff(
  workspaceId: string,
  databaseId: string,
  options: {
    cachedRid: DatabaseBlobRowRid | null;
    forceFullSync?: boolean;
    /** A non-terminal Ready page passed validation and was staged. */
    onProvisionalPage?: (diff: database_blob.DatabaseBlobDiffResponse) => void;
    /** Pages staged so far were discarded: the walk restarts or gives up. */
    onDiscardPages?: () => void;
  }
): Promise<FetchDiffResult> {
  const cachedRid = options.cachedRid;
  const maxKnownRid = cachedRid ? { timestamp: cachedRid.timestamp, seqNo: cachedRid.seqNo } : undefined;
  let cursor = new Uint8Array();
  const stagedPages = createDatabaseBlobDiffPageStage();
  let seenCursors = new Set([cursorKey(cursor)]);
  let restartCount = 0;

  Log.debug('[Database] blob diff request', {
    workspaceId,
    databaseId,
    forceFullSync: options?.forceFullSync ?? false,
    maxKnownRid: cachedRid ?? null,
    version: 3,
    pageMaxItems: BLOB_DIFF_PAGE_MAX_ITEMS,
    pageMaxBytes: BLOB_DIFF_PAGE_MAX_BYTES,
  });

  const walkStartedAt = Date.now();
  const maxAttempts = BLOB_DIFF_PENDING_RETRIES + 1;

  try {
    for (;;) {
      const request = database_blob.DatabaseBlobDiffRequest.create({
        maxKnownRid,
        version: 3,
        // The existing RID cache is document-aware. Keep this field absent so
        // its RID domain remains compatible with legacy requests.
        page: {
          maxItems: BLOB_DIFF_PAGE_MAX_ITEMS,
          maxBytes: BLOB_DIFF_PAGE_MAX_BYTES,
          cursor,
        },
      });

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptStartedAt = Date.now();
        const diff = await databaseBlobDiff(workspaceId, databaseId, request);

        Log.debug('[Database] blob diff page response', {
          databaseId,
          status: diff.status,
          retryAfterSecs: diff.retryAfterSecs ?? null,
          pageNumber: stagedPages.pageCount + 1,
          attempt,
          durationMs: Date.now() - attemptStartedAt,
          totalDurationMs: Date.now() - walkStartedAt,
          ...summarizeDiff(diff),
        });

        const page = diff.page;

        if (!page) {
          throw new Error('database blob diff paging protocol error: version 3 response omitted page metadata');
        }

        if (page.restartRequired) {
          if (
            page.hasMore ||
            (page.nextCursor?.length ?? 0) > 0 ||
            diff.creates.length > 0 ||
            diff.updates.length > 0 ||
            diff.deletes.length > 0 ||
            diff.missingRowIds.length > 0
          ) {
            throw new Error(
              'database blob diff paging protocol error: restart response contained payload or a continuation cursor'
            );
          }

          if (restartCount >= BLOB_DIFF_MAX_RESTARTS) {
            Log.warn('[Database] blob diff page walk kept restarting; falling back to row sync', {
              databaseId,
              restartCount,
              totalDurationMs: Date.now() - walkStartedAt,
            });
            options.onDiscardPages?.();
            await stagedPages.clear();
            return { diff, ready: false, stagedPages: null };
          }

          restartCount += 1;
          cursor = new Uint8Array();
          options.onDiscardPages?.();
          await stagedPages.clear();
          seenCursors = new Set([cursorKey(cursor)]);
          Log.warn('[Database] blob diff page walk restarted', {
            databaseId,
            restartCount,
            totalDurationMs: Date.now() - walkStartedAt,
          });
          break;
        }

        if (diff.status === readyStatus) {
          const nextCursor = page.nextCursor ?? new Uint8Array();

          // Validate the continuation contract before handing the page over, so a
          // misbehaving server cannot get its payload seeded or persisted.
          if (!page.hasMore && nextCursor.length > 0) {
            throw new Error('database blob diff paging protocol error: final page contained a continuation cursor');
          }

          if (page.hasMore && nextCursor.length === 0) {
            throw new Error('database blob diff paging protocol error: non-final page omitted its continuation cursor');
          }

          const nextCursorKey = cursorKey(nextCursor);

          if (page.hasMore && seenCursors.has(nextCursorKey)) {
            throw new Error('database blob diff paging protocol error: server repeated a continuation cursor');
          }

          try {
            await stagedPages.append(database_blob.DatabaseBlobDiffResponse.encode(diff).finish());
          } catch (error) {
            Log.warn('[Database] blob diff page staging failed; falling back to row sync', {
              databaseId,
              pageNumber: stagedPages.pageCount + 1,
              stagedPages: stagedPages.pageCount,
              stagedBytes: stagedPages.byteLength,
              error,
            });
            await stagedPages.clear();
            return { diff, ready: false, stagedPages: null };
          }

          if (!page.hasMore) {
            return { diff, ready: true, stagedPages };
          }

          options.onProvisionalPage?.(diff);
          seenCursors.add(nextCursorKey);
          cursor = new Uint8Array(nextCursor);
          break;
        }

        if (diff.status !== pendingStatus) {
          throw new Error(
            `database blob diff failed: status=${diff.status}, attempts=${attempt}, message=${diff.message ?? 'none'}`
          );
        }

        if (attempt === maxAttempts) {
          Log.warn('[Database] blob diff still pending; abandoning page walk and falling back to row sync', {
            databaseId,
            pageNumber: stagedPages.pageCount + 1,
            stagedPages: stagedPages.pageCount,
            attempts: attempt,
            message: diff.message ?? null,
            ...summarizeDiff(diff),
          });
          await stagedPages.clear();
          return { diff, ready: false, stagedPages: null };
        }

        const delayMs = retryDelayMs(diff.retryAfterSecs);

        Log.debug('[Database] blob diff page pending; retrying unchanged cursor', {
          databaseId,
          pageNumber: stagedPages.pageCount + 1,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          message: diff.message ?? null,
        });

        await sleep(delayMs);
      }
    }
  } catch (error) {
    await stagedPages.clear();
    throw error;
  }
}

export async function prefetchDatabaseBlobDiff(workspaceId: string, databaseId: string, options?: PrefetchOptions) {
  const { sharedKey, entry: existingEntry } = findSharedPrefetchEntry(workspaceId, databaseId, options);

  if (existingEntry?.storageFence && !isDatabaseStorageFenceCurrent(existingEntry.storageFence))
    existingEntry.invalidated = true;

  if (existingEntry?.promise && !existingEntry.invalidated) {
    const canReuseSettledFullSeed = Boolean(
      options?.forceFullSync && existingEntry.settled && existingEntry.hasCompleteSeedSet
    );
    const canReuseSettledSeed = Boolean(
      existingEntry.reuseSettled && existingEntry.settled && existingEntry.hasCompleteSeedSet
    );

    if (!existingEntry.settled || canReuseSettledFullSeed || canReuseSettledSeed) {
      applyPrefetchOptions(existingEntry, options);

      if (canReuseSettledSeed && !options?.reuseSettled) {
        existingEntry.reuseSettled = false;
      }

      const result = await existingEntry.promise;

      // A restore may join an ordinary prefetch that tolerates unavailable
      // storage. Shared downloads retain each caller's persistence contract.
      if (options?.requirePersistence && !existingEntry.persisted) {
        if (sharedPrefetchEntries.get(sharedKey) === existingEntry) sharedPrefetchEntries.delete(sharedKey);
        throw new Error('Some restored database rows could not be saved locally. Retry the reload.');
      }

      return result;
    }
  }

  if (existingEntry) {
    existingEntry.onSeedsReadyCallbacks.clear();
    existingEntry.onSeedsProgressCallbacks.clear();
    sharedPrefetchEntries.delete(sharedKey);
  }

  // The page walk can finish after a workspace switch. Capture its owner now
  // and thread it through tombstone persistence instead of consulting the
  // sync-outbox module's replacement session at completion time.
  const outboxSession = getCurrentOutboxSession(workspaceId);
  const cachedRid = options?.forceFullSync ? null : readCachedRid(databaseId);
  const entry: SharedPrefetchEntry = {
    priorityRowIds: new Set(),
    invalidatedRowIds: new InvalidatedRows(),
    onSeedsReadyCallbacks: new Set(),
    onSeedsProgressCallbacks: new Set(),
    provisionalRowKeys: new Set(),
    seedsReady: false,
    hasCompleteSeedSet: false,
    coversFullSnapshot: cachedRid === null,
  };

  applyPrefetchOptions(entry, options);

  const seedDiff = (diff: database_blob.DatabaseBlobDiffResponse, source: string) => {
    if (entry.invalidated || (entry.storageFence && !isDatabaseStorageFenceCurrent(entry.storageFence)))
      throw new Error('Database prefetch superseded by restore');
    const seedSummary = seedRowDocCacheFromDiff(databaseId, diff, {
      priorityRowIds: Array.from(entry.priorityRowIds),
      invalidatedRowIds: entry.invalidatedRowIds,
      storageFence: entry.storageFence,
    });

    Log.debug('[Database] blob seed cache prepared', {
      databaseId,
      source,
      forceFullSync: options?.forceFullSync ?? false,
      ...seedSummary,
      seedCount: rowDocSeedCache.size,
      lookupCount: rowDocSeedLookup.size,
    });

    return seedSummary;
  };

  const dropProvisionalSeeds = () => {
    if (releaseProvisionalSeeds(entry)) notifySeedsProgress(entry);
  };

  const stagePage = (page: database_blob.DatabaseBlobDiffResponse) => {
    const staged = stageProvisionalSeeds(databaseId, entry, page);

    Log.debug('[Database] blob provisional seeds staged', {
      databaseId,
      staged,
      provisionalRows: entry.provisionalRowKeys.size,
    });
    if (staged > 0) notifySeedsProgress(entry);
  };

  const promise = (async () => {
    const storageFence = await captureDatabaseStorageFence(databaseId, { required: options?.requirePersistence });

    entry.storageFence = storageFence;
    entry.invalidatedRowIds.storageFence = storageFence;
    const capturedRid = options?.forceFullSync ? null : readCachedRid(databaseId, storageFence);

    entry.coversFullSnapshot = capturedRid === null;
    const sourceLabel = options?.forceFullSync ? 'ready full' : 'ready delta';
    const { diff, ready, stagedPages } = await fetchReadyDiff(workspaceId, databaseId, {
      cachedRid: capturedRid,
      forceFullSync: options?.forceFullSync,
      onProvisionalPage: stagePage,
      onDiscardPages: dropProvisionalSeeds,
    });

    if (!ready) {
      releaseProvisionalSeeds(entry);
      if (options?.requirePersistence) throw new Error('The restored database is still finalizing. Retry shortly.');
      notifySeedsReady(entry);
      return diff;
    }

    let allPagesPersisted = true;
    let maxRid: DatabaseBlobRowRid | null = null;
    const pageCount = stagedPages?.pageCount ?? 0;

    if (!stagedPages) {
      throw new Error('database blob diff paging protocol error: Ready walk did not stage any pages');
    }

    try {
      if (entry.invalidated || (entry.storageFence && !isDatabaseStorageFenceCurrent(entry.storageFence)))
        throw new Error('Database prefetch superseded by restore');
      if (pageCount === 0) {
        throw new Error('database blob diff paging protocol error: Ready walk did not stage any pages');
      }

      // Decode one provisional page at a time only after the terminal page made
      // the walk committable. This preserves atomic visibility while keeping both
      // the encoded and decoded JS-heap working sets bounded to one page.
      for (let index = 0; index < pageCount; index += 1) {
        const page = database_blob.DatabaseBlobDiffResponse.decode(await stagedPages.read(index));

        seedDiff(page, `ready page ${index + 1}/${pageCount}`);
        maxRid = latestRid(maxRid, maxRidFromDiff(page));
      }

      // The pass above applied every committed seed to the shared docs that
      // provisional pages built, so those docs now hold committed data.
      releaseProvisionalSeeds(entry, { commit: true });
      entry.hasCompleteSeedSet = true;
      notifySeedsReady(entry);

      for (let index = 0; index < pageCount; index += 1) {
        const page = database_blob.DatabaseBlobDiffResponse.decode(await stagedPages.read(index));
        const persisted = await persistDiffToIndexedDB(
          databaseId,
          page,
          `${sourceLabel} page ${index + 1}/${pageCount}`,
          outboxSession,
          entry.invalidatedRowIds,
          storageFence
        );

        allPagesPersisted = persisted && allPagesPersisted;
      }

      if (options?.requirePersistence && !allPagesPersisted) {
        throw new Error('Some restored database rows could not be saved locally. Retry the reload.');
      }

      const checkpointPublished = await publishWithDatabaseStorageFence(storageFence, () => {
        if (!entry.invalidated && !options?.forceFullSync && allPagesPersisted && maxRid) {
          writeCachedRid(databaseId, maxRid, storageFence);
        }
      });

      if (!checkpointPublished || entry.invalidated) throw new Error('Database prefetch superseded by restore');
      entry.persisted = allPagesPersisted && !storageFence.nonDurable;
      if (!options?.forceFullSync && allPagesPersisted && maxRid) {
        Log.debug('[Database] blob updated rid cache after terminal page', { databaseId, maxRid, pageCount });
      } else if (!allPagesPersisted) {
        Log.warn('[Database] blob rid cache unchanged because one or more pages failed to persist', {
          databaseId,
          pageCount,
        });
      }
    } finally {
      await stagedPages.clear();
    }

    return diff;
  })().finally(() => {
    entry.settled = true;
    // A failed or superseded walk never commits what its pages staged.
    dropProvisionalSeeds();
  });

  entry.promise = promise;
  sharedPrefetchEntries.set(sharedKey, entry);

  try {
    return await promise;
  } catch (error) {
    const currentEntry = sharedPrefetchEntries.get(sharedKey);

    if (currentEntry === entry) {
      sharedPrefetchEntries.delete(sharedKey);
    }

    entry.onSeedsReadyCallbacks.clear();
    throw error;
  }
}
