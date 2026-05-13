import { validate as uuidValidate } from 'uuid';
import * as Y from 'yjs';

import {
  collabIndexedDBExists,
  db,
  deleteCollabDB,
  listCollabIndexedDBNames,
  openCollabDBWithProvider,
  openRowCollabDBWithProvider,
} from '@/application/db';
import {
  LocalCollabRecoveryRecord,
  LocalCollabRecoveryStatus,
} from '@/application/db/tables/local_collab_recovery';
import { getRowKey } from '@/application/database-yjs/row_meta';
import { mergeLegacyRowDocIfExists } from '@/application/services/js-services/cache';
import { withRetry } from '@/application/services/js-services/http/core';
import { collabFullSyncBatchStrict } from '@/application/services/js-services/http/http_api';
import { DatabaseRelations, Types, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { Log } from '@/utils/log';

const LEGACY_ROW_DELIMITER = '_rows_';
const RECOVERY_LOCK_TTL_MS = 120_000;
const RECOVERY_MERGE_CONCURRENCY = 12;
const RECOVERY_UPLOAD_BATCH_SIZE = 50;
const RECOVERY_RETRY_DELAYS = [30_000, 30_000, 30_000];
const RECOVERY_LOCK_PREFIX = 'af_local_collab_recovery_lock:';

const retryableStatuses = new Set<LocalCollabRecoveryStatus>([
  'discovered',
  'merged',
  'uploading',
  'synced',
  'failed',
]);
const runningWorkspaces = new Set<string>();

type LegacyRowCandidate = {
  databaseId: string;
  databaseIdAliases?: string[];
  rowId: string;
  rowKey: string;
};

type DatabasePrefixMatch = {
  databaseId: string;
  aliases: string[];
};

type RecoveryLock = {
  ownerId: string;
  refresh: () => boolean;
  release: () => void;
};

type RecoveryUpload = {
  record: LocalCollabRecoveryRecord;
  legacyCacheDeletedDuringPrepare?: boolean;
  item: {
    objectId: string;
    collabType: Types;
    stateVector: Uint8Array;
    docState: Uint8Array;
  };
};

export type LocalCollabRecoverySummary = {
  discovered: number;
  prepared: number;
  uploaded: number;
  deleted: number;
  skipped: number;
  failed: number;
  lockSkipped: boolean;
};

function now() {
  return Date.now();
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function lockKey(workspaceId: string) {
  return `${RECOVERY_LOCK_PREFIX}${workspaceId}`;
}

function createOwnerId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function tryAcquireRecoveryLock(workspaceId: string): RecoveryLock | null {
  if (typeof localStorage === 'undefined') {
    const ownerId = createOwnerId();

    return {
      ownerId,
      refresh: () => true,
      release: () => undefined,
    };
  }

  const key = lockKey(workspaceId);
  const ownerId = createOwnerId();

  const writeLock = () => {
    localStorage.setItem(
      key,
      JSON.stringify({
        ownerId,
        expiresAt: now() + RECOVERY_LOCK_TTL_MS,
      })
    );
  };

  try {
    const raw = localStorage.getItem(key);
    const existing = raw ? JSON.parse(raw) as { ownerId?: string; expiresAt?: number } : null;

    if (existing?.expiresAt && existing.expiresAt > now() && existing.ownerId !== ownerId) {
      return null;
    }

    writeLock();
    const confirmed = JSON.parse(localStorage.getItem(key) || '{}') as { ownerId?: string };

    if (confirmed.ownerId !== ownerId) return null;

    return {
      ownerId,
      refresh: () => {
        try {
          const current = JSON.parse(localStorage.getItem(key) || '{}') as { ownerId?: string };

          if (current.ownerId !== ownerId) return false;
          writeLock();
          return true;
        } catch {
          return false;
        }
      },
      release: () => {
        try {
          const current = JSON.parse(localStorage.getItem(key) || '{}') as { ownerId?: string };

          if (current.ownerId === ownerId) {
            localStorage.removeItem(key);
          }
        } catch {
          // Ignore lock cleanup failures.
        }
      },
    };
  } catch (error) {
    Log.warn('[Recovery] failed to acquire local collab recovery lock', { workspaceId, error });
    return null;
  }
}

export function parseLegacyRowDatabaseName(name: string): LegacyRowCandidate | null {
  const delimiterIndex = name.indexOf(LEGACY_ROW_DELIMITER);

  if (delimiterIndex <= 0) return null;

  const databaseId = name.slice(0, delimiterIndex);
  const rowId = name.slice(delimiterIndex + LEGACY_ROW_DELIMITER.length);

  if (!uuidValidate(databaseId) || !uuidValidate(rowId)) return null;

  return {
    databaseId,
    rowId,
    rowKey: name,
  };
}

function uniqueValidIds(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id && uuidValidate(id)))));
}

function buildDatabasePrefixMap(databaseRelations: DatabaseRelations | undefined) {
  const databaseAliases = new Map<string, Set<string>>();

  Object.entries(databaseRelations ?? {}).forEach(([databaseId, viewId]) => {
    if (!uuidValidate(databaseId)) return;

    const aliases = databaseAliases.get(databaseId) ?? new Set<string>();

    aliases.add(databaseId);

    if (uuidValidate(viewId)) {
      aliases.add(viewId);
    }

    databaseAliases.set(databaseId, aliases);
  });

  const prefixMap = new Map<string, DatabasePrefixMatch>();

  databaseAliases.forEach((aliases, databaseId) => {
    const match = {
      databaseId,
      aliases: Array.from(aliases),
    };

    match.aliases.forEach((alias) => prefixMap.set(alias, match));
  });

  return prefixMap;
}

function getDistinctDatabaseMatches(prefixMap: Map<string, DatabasePrefixMatch>) {
  const matches = new Map<string, DatabasePrefixMatch>();

  prefixMap.forEach((match) => {
    matches.set(match.databaseId, match);
  });

  return Array.from(matches.values());
}

function getDatabaseRow(doc: YDoc) {
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);

  return sharedRoot.get(YjsEditorKey.database_row) as Y.Map<unknown> | undefined;
}

function normalizeDatabaseRowIdentity(doc: YDoc, databaseId: string, acceptedDatabaseIds: string[], rowId: string) {
  const row = getDatabaseRow(doc);

  if (!(row instanceof Y.Map)) return false;
  if (row.get(YjsDatabaseKey.id) !== rowId) return false;

  const rowDatabaseId = row.get(YjsDatabaseKey.database_id);

  if (rowDatabaseId === databaseId) return true;

  if (typeof rowDatabaseId === 'string' && acceptedDatabaseIds.includes(rowDatabaseId)) {
    row.set(YjsDatabaseKey.database_id, databaseId);
    return true;
  }

  return false;
}

function collectRowIdsFromDatabaseDoc(databaseDoc: YDoc): string[] {
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);
  const rowIds = new Set<string>();

  views?.forEach((view) => {
    const rowOrders = view?.get(YjsDatabaseKey.row_orders);

    if (!rowOrders) return;

    for (let i = 0; i < rowOrders.length; i += 1) {
      const row = rowOrders.get(i) as { id?: string } | undefined;

      if (row?.id && uuidValidate(row.id)) {
        rowIds.add(row.id);
      }
    }
  });

  return Array.from(rowIds);
}

async function discoverLegacyRowsFromDatabaseDocs(prefixMap: Map<string, DatabasePrefixMatch>) {
  const candidates: LegacyRowCandidate[] = [];

  for (const match of getDistinctDatabaseMatches(prefixMap)) {
    const rowIds = new Set<string>();

    for (const databaseDocKey of match.aliases) {
      if (!(await collabIndexedDBExists(databaseDocKey))) continue;

      const { doc, provider } = await openCollabDBWithProvider(databaseDocKey, { skipCache: true });

      try {
        collectRowIdsFromDatabaseDoc(doc).forEach((rowId) => rowIds.add(rowId));
      } finally {
        await provider.destroy();
        doc.destroy();
      }
    }

    for (const rowId of rowIds) {
      for (const prefix of match.aliases) {
        const rowKey = getRowKey(prefix, rowId);

        if (await collabIndexedDBExists(rowKey)) {
          candidates.push({
            databaseId: match.databaseId,
            databaseIdAliases: match.aliases,
            rowId,
            rowKey,
          });
        }
      }
    }
  }

  return candidates;
}

export async function discoverLegacyRowDatabases(databaseRelations: DatabaseRelations | undefined) {
  const prefixMap = buildDatabasePrefixMap(databaseRelations);
  const candidates = new Map<string, LegacyRowCandidate>();
  const indexedDbNames = await listCollabIndexedDBNames();

  indexedDbNames.forEach((name) => {
    const parsed = parseLegacyRowDatabaseName(name);
    const match = parsed ? prefixMap.get(parsed.databaseId) : null;

    if (!parsed || !match) return;
    candidates.set(parsed.rowKey, {
      databaseId: match.databaseId,
      databaseIdAliases: match.aliases,
      rowId: parsed.rowId,
      rowKey: parsed.rowKey,
    });
  });

  if (indexedDbNames.size === 0) {
    const probedCandidates = await discoverLegacyRowsFromDatabaseDocs(prefixMap);

    probedCandidates.forEach((candidate) => {
      candidates.set(candidate.rowKey, candidate);
    });
  }

  return Array.from(candidates.values());
}

async function upsertDiscoveredCandidate(workspaceId: string, candidate: LegacyRowCandidate) {
  const key: [string, string] = [workspaceId, candidate.rowId];
  const existing = await db.local_collab_recovery.get(key);

  if (existing?.status === 'legacy_deleted' || existing?.status === 'skipped') {
    return existing;
  }

  const timestamp = now();
  const status = existing?.status && existing.status !== 'uploading' ? existing.status : 'discovered';
  const record: LocalCollabRecoveryRecord = {
    workspaceId,
    objectId: candidate.rowId,
    databaseId: candidate.databaseId,
    databaseIdAliases: candidate.databaseIdAliases,
    legacyDbName: candidate.rowKey,
    legacyCacheDeleted: existing?.legacyCacheDeleted ?? false,
    collabType: Types.DatabaseRow,
    source: 'legacy',
    status,
    attempts: existing?.attempts ?? 0,
    discoveredAt: existing?.discoveredAt ?? timestamp,
    updatedAt: timestamp,
    lastLocalAt: timestamp,
    lastSyncedAt: existing?.lastSyncedAt,
    error: existing?.error,
  };

  await db.local_collab_recovery.put(record);
  return record;
}

async function updateRecoveryRecord(
  record: LocalCollabRecoveryRecord,
  updates: Partial<LocalCollabRecoveryRecord>
) {
  const nextRecord = {
    ...record,
    ...updates,
    updatedAt: now(),
  };

  await db.local_collab_recovery.put(nextRecord);
  return nextRecord;
}

async function loadRetryableRecords(workspaceId: string) {
  return db.local_collab_recovery
    .where('workspaceId')
    .equals(workspaceId)
    .filter((record) => retryableStatuses.has(record.status))
    .toArray();
}

async function deleteMergedLegacyCache(record: LocalCollabRecoveryRecord) {
  if (record.legacyCacheDeleted) {
    return { record, deleted: false };
  }

  const deleted = await deleteCollabDB(record.legacyDbName);

  if (!deleted) {
    const nextRecord = await updateRecoveryRecord(record, {
      error: 'Merged row into shared cache, but failed to delete legacy IndexedDB cache',
    });

    return { record: nextRecord, deleted: false };
  }

  const nextRecord = await updateRecoveryRecord(record, {
    legacyCacheDeleted: true,
    error: undefined,
  });

  return { record: nextRecord, deleted: true };
}

async function prepareRecoveryUpload(record: LocalCollabRecoveryRecord): Promise<RecoveryUpload | null> {
  const { doc, provider } = await openRowCollabDBWithProvider(record.objectId, { skipCache: true });
  let updatedRecord: LocalCollabRecoveryRecord | null = null;
  let item: RecoveryUpload['item'] | null = null;

  try {
    if (record.status !== 'merged' && record.status !== 'uploading' && record.status !== 'synced') {
      await mergeLegacyRowDocIfExists(record.legacyDbName, record.objectId, doc, {
        legacyExists: true,
        deleteLegacyCache: false,
      });
    }

    const legacyPrefix = parseLegacyRowDatabaseName(record.legacyDbName)?.databaseId;
    const acceptedDatabaseIds = uniqueValidIds([
      record.databaseId,
      legacyPrefix,
      ...(record.databaseIdAliases ?? []),
    ]);

    if (!normalizeDatabaseRowIdentity(doc, record.databaseId, acceptedDatabaseIds, record.objectId)) {
      await updateRecoveryRecord(record, {
        status: 'skipped',
        error: 'Legacy row does not contain matching database_row data',
      });
      return null;
    }

    item = {
      objectId: record.objectId,
      collabType: Types.DatabaseRow,
      stateVector: Y.encodeStateVector(doc),
      docState: Y.encodeStateAsUpdate(doc),
    };

    updatedRecord = record.status === 'merged' || record.status === 'uploading' || record.status === 'synced'
      ? record
      : await updateRecoveryRecord(record, { status: 'merged', error: undefined });
  } finally {
    await provider.destroy();
    doc.destroy();
  }

  if (!updatedRecord || !item) return null;

  const { record: recordAfterDelete, deleted } = await deleteMergedLegacyCache(updatedRecord);

  return {
    record: recordAfterDelete,
    legacyCacheDeletedDuringPrepare: deleted,
    item,
  };
}

async function markBatchFailed(records: LocalCollabRecoveryRecord[], error: unknown) {
  await Promise.all(
    records.map((record) =>
      updateRecoveryRecord(record, {
        status: 'failed',
        attempts: record.attempts + 1,
        error: normalizeError(error),
      })
    )
  );
}

async function deleteUploadedLegacyCache(record: LocalCollabRecoveryRecord) {
  if (record.legacyCacheDeleted) {
    await updateRecoveryRecord(record, {
      status: 'legacy_deleted',
      lastSyncedAt: record.lastSyncedAt ?? now(),
      error: undefined,
    });
    return false;
  }

  const deleted = await deleteCollabDB(record.legacyDbName);

  if (!deleted) {
    await updateRecoveryRecord(record, {
      status: 'synced',
      error: 'Uploaded row, but failed to delete legacy IndexedDB cache',
    });
    return false;
  }

  await updateRecoveryRecord(record, {
    status: 'legacy_deleted',
    legacyCacheDeleted: true,
    lastSyncedAt: record.lastSyncedAt ?? now(),
    error: undefined,
  });
  return true;
}

async function uploadRecoveryBatch(workspaceId: string, uploads: RecoveryUpload[]) {
  const uploadingRecords = await Promise.all(
    uploads.map((upload) =>
      updateRecoveryRecord(upload.record, {
        status: 'uploading',
        attempts: upload.record.attempts + 1,
        error: undefined,
      })
    )
  );

  try {
    await withRetry(() => collabFullSyncBatchStrict(workspaceId, uploads.map((upload) => upload.item)), {
      delays: RECOVERY_RETRY_DELAYS,
    });
  } catch (error) {
    await markBatchFailed(uploadingRecords, error);
    throw error;
  }

  const syncedAt = now();
  const syncedRecords = await Promise.all(
    uploadingRecords.map((record) =>
      updateRecoveryRecord(record, {
        status: 'synced',
        lastSyncedAt: syncedAt,
        error: undefined,
      })
    )
  );

  let deleted = 0;

  for (const record of syncedRecords) {
    if (await deleteUploadedLegacyCache(record)) {
      deleted += 1;
    }
  }

  return deleted;
}

export async function recoverLegacyDatabaseRowsForWorkspace(options: {
  workspaceId: string;
  databaseRelations: DatabaseRelations | undefined;
}): Promise<LocalCollabRecoverySummary> {
  const summary: LocalCollabRecoverySummary = {
    discovered: 0,
    prepared: 0,
    uploaded: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    lockSkipped: false,
  };
  const { workspaceId, databaseRelations } = options;
  const hasDatabases = Object.keys(databaseRelations ?? {}).some((databaseId) => uuidValidate(databaseId));

  if (!workspaceId || !hasDatabases) return summary;
  if (runningWorkspaces.has(workspaceId)) {
    return { ...summary, lockSkipped: true };
  }

  const lock = tryAcquireRecoveryLock(workspaceId);

  if (!lock) {
    return { ...summary, lockSkipped: true };
  }

  runningWorkspaces.add(workspaceId);

  try {
    const candidates = await discoverLegacyRowDatabases(databaseRelations);

    summary.discovered = candidates.length;
    await Promise.all(candidates.map((candidate) => upsertDiscoveredCandidate(workspaceId, candidate)));

    const records = await loadRetryableRecords(workspaceId);
    const uploads: RecoveryUpload[] = [];

    for (const recordsChunk of chunk(records, RECOVERY_MERGE_CONCURRENCY)) {
      if (!lock.refresh()) {
        summary.lockSkipped = true;
        return summary;
      }

      const prepared = await Promise.all(
        recordsChunk.map(async (record) => {
          try {
            if (record.status === 'synced') {
              if (await deleteUploadedLegacyCache(record)) {
                summary.deleted += 1;
              }

              return null;
            }

            return await prepareRecoveryUpload(record);
          } catch (error) {
            summary.failed += 1;
            await updateRecoveryRecord(record, {
              status: 'failed',
              attempts: record.attempts + 1,
              error: normalizeError(error),
            });
            return null;
          }
        })
      );

      prepared.forEach((upload) => {
        if (!upload) return;

        if (upload.legacyCacheDeletedDuringPrepare) {
          summary.deleted += 1;
        }

        uploads.push(upload);
      });
    }

    summary.prepared = uploads.length;

    for (const uploadsChunk of chunk(uploads, RECOVERY_UPLOAD_BATCH_SIZE)) {
      if (!lock.refresh()) {
        summary.lockSkipped = true;
        return summary;
      }

      try {
        summary.deleted += await uploadRecoveryBatch(workspaceId, uploadsChunk);
        summary.uploaded += uploadsChunk.length;
      } catch (error) {
        summary.failed += uploadsChunk.length;
        Log.warn('[Recovery] failed to upload recovered legacy rows', {
          workspaceId,
          count: uploadsChunk.length,
          error,
        });
      }
    }

    summary.skipped = Math.max(0, records.length - uploads.length - summary.failed - summary.deleted);

    if (
      summary.discovered > 0 ||
      summary.prepared > 0 ||
      summary.uploaded > 0 ||
      summary.deleted > 0 ||
      summary.skipped > 0 ||
      summary.failed > 0
    ) {
      Log.info('[Recovery] legacy database row recovery completed', {
        workspaceId,
        ...summary,
      });
    }

    return summary;
  } finally {
    runningWorkspaces.delete(workspaceId);
    lock.release();
  }
}
