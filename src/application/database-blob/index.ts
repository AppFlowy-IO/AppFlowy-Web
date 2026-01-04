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

const RID_CACHE_PREFIX = 'af_database_blob_rid:';
const APPLY_CONCURRENCY = 6;
const DIFF_RETRY_COUNT = 2;
const DIFF_RETRY_DELAY_MS = 5000;
const MAX_ROW_DOC_SEEDS = 2000;

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
  const seed = rowDocSeedCache.get(rowKey);

  if (!seed) return null;

  rowDocSeedCache.delete(rowKey);
  return seed;
}

export function clearDatabaseRowDocSeedCache(databaseId: string) {
  const prefix = `${databaseId}_rows_`;

  for (const key of rowDocSeedCache.keys()) {
    if (key.startsWith(prefix)) {
      rowDocSeedCache.delete(key);
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

async function applyRowUpdate(databaseId: string, update: database_blob.IDatabaseBlobRowUpdate) {
  const rowIdBytes = update.rowId;

  if (!rowIdBytes || rowIdBytes.length !== 16) return;

  const rowId = uuidStringify(rowIdBytes);
  const rowDocState = update.docState;

  if (rowDocState) {
    const rowKey = getRowKey(databaseId, rowId);

    cacheRowDocSeed(rowKey, rowDocState);
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

async function applyDiff(databaseId: string, diff: database_blob.DatabaseBlobDiffResponse) {
  const updates = [...diff.creates, ...diff.updates];

  for (let i = 0; i < updates.length; i += APPLY_CONCURRENCY) {
    const batch = updates.slice(i, i + APPLY_CONCURRENCY);

    await Promise.all(batch.map((update) => applyRowUpdate(databaseId, update)));
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

export async function prefetchDatabaseBlobDiff(workspaceId: string, databaseId: string) {
  const diff = await fetchReadyDiff(workspaceId, databaseId);
  const applyStartedAt = Date.now();

  await applyDiff(databaseId, diff);

  Log.debug('[Database] blob diff persisted to IndexedDB', {
    databaseId,
    durationMs: Date.now() - applyStartedAt,
    ...summarizeDiff(diff),
  });
  Log.debug('[Database] blob seed cache size', {
    databaseId,
    seedCount: rowDocSeedCache.size,
  });

  const maxRid = maxRidFromDiff(diff);

  if (maxRid) {
    writeCachedRid(databaseId, maxRid);
    Log.debug('[Database] blob updated rid cache', { databaseId, maxRid });
  }

  return diff;
}
