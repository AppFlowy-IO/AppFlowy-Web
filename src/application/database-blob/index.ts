import { stringify as uuidStringify } from 'uuid';

import { getRowKey } from '@/application/database-yjs/row_meta';
import { openCollabDBWithProvider } from '@/application/db';
import { getCachedRowDoc } from '@/application/services/js-services/cache';
import { databaseBlobDiff } from '@/application/services/js-services/http/http_api';
import { applyYDoc } from '@/application/ydoc/apply';
import { database_blob } from '@/proto/database_blob';
import { Log } from '@/utils/log';

type DatabaseBlobRowRid = {
  timestamp: number;
  seqNo: number;
};

type RowDocSeed = {
  bytes: Uint8Array;
  encoderVersion: number;
};

type PrefetchOptions = {
  priorityRowIds?: string[];
};

const RID_CACHE_PREFIX = 'af_database_blob_rid:';
const APPLY_CONCURRENCY = 6;
const DIFF_RETRY_COUNT = 2;
const DIFF_RETRY_DELAY_MS = 5000;
const MAX_ROW_DOC_SEEDS = 2000;
const MAX_ROW_DOC_SEEDS_LOOKUP = 10000;

const readyStatus = database_blob.DiffStatus.READY;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function ridCacheKey(databaseId: string) {
  return `${RID_CACHE_PREFIX}${databaseId}`;
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

function readCachedRid(databaseId: string): DatabaseBlobRowRid | null {
  try {
    const raw = localStorage.getItem(ridCacheKey(databaseId));

    if (!raw) return null;
    const parsed = JSON.parse(raw) as DatabaseBlobRowRid;

    if (typeof parsed?.timestamp !== 'number' || typeof parsed?.seqNo !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedRid(databaseId: string, rid: DatabaseBlobRowRid) {
  try {
    localStorage.setItem(ridCacheKey(databaseId), JSON.stringify(rid));
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

const rowDocSeedCache = new Map<string, RowDocSeed>();
const rowDocSeedLookup = new Map<string, RowDocSeed>();

function trimRowDocSeedLookup() {
  while (rowDocSeedLookup.size > MAX_ROW_DOC_SEEDS_LOOKUP) {
    const oldestKey = rowDocSeedLookup.keys().next().value;

    if (!oldestKey) break;
    rowDocSeedLookup.delete(oldestKey);
  }
}

function cacheRowDocSeed(rowKey: string, docState?: database_blob.ICollabDocState | null) {
  if (getCachedRowDoc(rowKey)) return;

  const seed = getDocState(docState);

  if (!seed) return;

  rowDocSeedCache.set(rowKey, seed);

  while (rowDocSeedCache.size > MAX_ROW_DOC_SEEDS) {
    const oldestKey = rowDocSeedCache.keys().next().value;

    if (!oldestKey) break;
    rowDocSeedCache.delete(oldestKey);
  }
}

export function takeDatabaseRowDocSeed(rowKey: string): RowDocSeed | null {
  const cachedSeed = rowDocSeedCache.get(rowKey);

  if (cachedSeed) {
    rowDocSeedCache.delete(rowKey);
    rowDocSeedLookup.delete(rowKey);
    Log.debug('[Database] row seed hit', {
      rowKey,
      source: 'cache',
      cacheSize: rowDocSeedCache.size,
      lookupSize: rowDocSeedLookup.size,
    });
    return cachedSeed;
  }

  const seed = rowDocSeedLookup.get(rowKey);

  if (!seed) {
    Log.debug('[Database] row seed miss', {
      rowKey,
      cacheSize: rowDocSeedCache.size,
      lookupSize: rowDocSeedLookup.size,
    });
    return null;
  }

  rowDocSeedLookup.delete(rowKey);
  Log.debug('[Database] row seed hit', {
    rowKey,
    source: 'lookup',
    cacheSize: rowDocSeedCache.size,
    lookupSize: rowDocSeedLookup.size,
  });
  return seed;
}

export function clearDatabaseRowDocSeedCache(databaseId: string) {
  const prefix = `${databaseId}_rows_`;

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
}

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
  };
}

function getDocState(state?: database_blob.ICollabDocState | null) {
  if (!state?.docState || state.docState.length === 0) return null;
  return {
    bytes: state.docState,
    encoderVersion: typeof state.encoderVersion === 'number' ? state.encoderVersion : 1,
  };
}

function decodeRowId(rowIdBytes?: Uint8Array | null) {
  if (!rowIdBytes || rowIdBytes.length !== 16) return null;
  return uuidStringify(rowIdBytes);
}

function applySeedToCachedDoc(rowKey: string, seed: RowDocSeed) {
  const cachedDoc = getCachedRowDoc(rowKey);

  if (!cachedDoc) return false;

  applyYDoc(cachedDoc, seed.bytes, seed.encoderVersion);
  return true;
}

function seedRowDocCacheFromDiff(databaseId: string, diff: database_blob.DatabaseBlobDiffResponse, options?: PrefetchOptions) {
  const updates = [...diff.creates, ...diff.updates];

  if (updates.length === 0) {
    return { seeded: 0, prioritized: 0, priorityRequested: 0, appliedToCached: 0 };
  }

  const priorityRowIds = options?.priorityRowIds ?? [];
  const prioritySet = new Set(priorityRowIds);
  const updatesByRowId = priorityRowIds.length > 0 ? new Map<string, database_blob.IDatabaseBlobRowUpdate>() : null;
  let seeded = 0;
  let prioritized = 0;
  let appliedToCached = 0;

  updates.forEach((update) => {
    const rowId = decodeRowId(update.rowId);

    if (!rowId) return;

    const rowKey = getRowKey(databaseId, rowId);

    const seed = getDocState(update.docState);

    if (!seed) return;

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

    const seed = getDocState(update.docState);

    if (!seed) return;

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

  return {
    seeded,
    prioritized,
    priorityRequested: priorityRowIds.length,
    appliedToCached,
  };
}

async function applyCollabUpdate(objectId: string, docState: database_blob.ICollabDocState) {
  const state = getDocState(docState);

  if (!state) return;

  const cachedDoc = getCachedRowDoc(objectId);

  if (cachedDoc) {
    Log.debug('[Database] apply blob update to cached doc', {
      objectId,
      bytes: state.bytes.length,
      encoderVersion: state.encoderVersion,
    });
    applyYDoc(cachedDoc, state.bytes, state.encoderVersion);
    return;
  }

  const { doc, provider } = await openCollabDBWithProvider(objectId);

  try {
    applyYDoc(doc, state.bytes, state.encoderVersion);
  } finally {
    await provider.destroy();
    doc.destroy();
  }
}

async function applyRowUpdate(
  databaseId: string,
  update: database_blob.IDatabaseBlobRowUpdate,
  options?: { seedCache?: boolean }
) {
  const rowId = decodeRowId(update.rowId);

  if (!rowId) return;
  const rowDocState = update.docState;

  if (rowDocState) {
    const rowKey = getRowKey(databaseId, rowId);

    if (options?.seedCache !== false) {
      cacheRowDocSeed(rowKey, rowDocState);
    }

    await applyCollabUpdate(rowKey, rowDocState);
  }

  const doc = update.document;

  if (!doc || doc.deleted) return;

  if (!doc.docState) return;

  const docIdBytes = doc.documentId;

  if (!docIdBytes || docIdBytes.length !== 16) return;

  const docId = uuidStringify(docIdBytes);

  await applyCollabUpdate(docId, doc.docState);
}

async function applyDiff(
  databaseId: string,
  diff: database_blob.DatabaseBlobDiffResponse,
  options?: { seedCache?: boolean }
) {
  const updates = [...diff.creates, ...diff.updates];

  for (let i = 0; i < updates.length; i += APPLY_CONCURRENCY) {
    const batch = updates.slice(i, i + APPLY_CONCURRENCY);

    await Promise.all(batch.map((update) => applyRowUpdate(databaseId, update, options)));
  }
}

async function fetchReadyDiff(workspaceId: string, databaseId: string) {
  const cachedRid = readCachedRid(databaseId);
  const request = database_blob.DatabaseBlobDiffRequest.create({
    maxKnownRid: cachedRid ? { timestamp: cachedRid.timestamp, seqNo: cachedRid.seqNo } : undefined,
    version: 1,
  });

  Log.debug('[Database] blob diff request', {
    workspaceId,
    databaseId,
    maxKnownRid: cachedRid ?? null,
  });

  for (let attempt = 0; attempt <= DIFF_RETRY_COUNT; attempt += 1) {
    const startedAt = Date.now();
    const diff = await databaseBlobDiff(workspaceId, databaseId, request);

    Log.debug('[Database] blob diff response', {
      databaseId,
      status: diff.status,
      retryAfterSecs: diff.retryAfterSecs ?? null,
      durationMs: Date.now() - startedAt,
      attempt,
      ...summarizeDiff(diff),
    });

    if (diff.status === readyStatus) {
      return diff;
    }

    if (attempt >= DIFF_RETRY_COUNT) {
      break;
    }

    await sleep(DIFF_RETRY_DELAY_MS);
  }

  throw new Error('database blob diff is not ready');
}

export async function prefetchDatabaseBlobDiff(
  workspaceId: string,
  databaseId: string,
  options?: PrefetchOptions
) {
  const diff = await fetchReadyDiff(workspaceId, databaseId);
  const seedSummary = seedRowDocCacheFromDiff(databaseId, diff, options);

  Log.debug('[Database] blob seed cache prepared', {
    databaseId,
    ...seedSummary,
    seedCount: rowDocSeedCache.size,
    lookupCount: rowDocSeedLookup.size,
  });

  const applyStartedAt = Date.now();

  try {
    await applyDiff(databaseId, diff, { seedCache: false });
    Log.debug('[Database] blob diff persisted to IndexedDB', {
      databaseId,
      durationMs: Date.now() - applyStartedAt,
      ...summarizeDiff(diff),
    });

    const maxRid = maxRidFromDiff(diff);

    if (maxRid) {
      writeCachedRid(databaseId, maxRid);
      Log.debug('[Database] blob updated rid cache', { databaseId, maxRid });
    }
  } catch (error) {
    Log.warn('[Database] blob diff persist failed', {
      databaseId,
      error,
    });
  }

  return diff;
}
