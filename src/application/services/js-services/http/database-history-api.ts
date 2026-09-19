import type { DatabaseHistoryCursor, DatabaseHistoryVersion, DatabaseRestoreJob } from '@/application/database-history.type';
import { database_blob } from '@/proto/database_blob';

import { APIResponse, executeAPIRequest, getAxios, handleAPIError } from './core';

const historyPath = (workspaceId: string, databaseId: string) =>
  `/api/workspace/${encodeURIComponent(workspaceId)}/database/${encodeURIComponent(databaseId)}/history`;

export const DATABASE_HISTORY_PAGE_SIZE = 30;

export function getDatabaseHistory(
  workspaceId: string,
  databaseId: string,
  options: { cursor?: DatabaseHistoryCursor; since?: number; signal?: AbortSignal } = {}
): Promise<DatabaseHistoryVersion[]> {
  return executeAPIRequest<DatabaseHistoryVersion[]>(() =>
    getAxios()?.get<APIResponse<DatabaseHistoryVersion[]>>(historyPath(workspaceId, databaseId), {
      params: { limit: DATABASE_HISTORY_PAGE_SIZE, since: options.since, ...options.cursor },
      signal: options.signal,
    })
  );
}

async function getBinary(url: string, signal?: AbortSignal, params?: Record<string, unknown>): Promise<Uint8Array> {
  const client = getAxios();

  if (!client) throw new Error('API service not initialized');
  try {
    const response = await client.get<ArrayBuffer>(url, { responseType: 'arraybuffer', signal, params });

    // Failed API envelopes must never be interpreted as historical Yjs/protobuf data.
    if (String(response.headers?.['content-type']).includes('application/json')) {
      const envelope = JSON.parse(new TextDecoder().decode(response.data)) as APIResponse;

      throw new Error(envelope.message || 'Database history is unavailable');
    }

    return new Uint8Array(response.data);
  } catch (error) {
    throw handleAPIError(error);
  }
}

export function previewDatabaseVersion(
  workspaceId: string,
  databaseId: string,
  version: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  return getBinary(`${historyPath(workspaceId, databaseId)}/${encodeURIComponent(version)}/preview`, signal);
}

export async function getDatabaseHistoryRows(
  workspaceId: string,
  databaseId: string,
  version: string,
  options: { cursor?: string; signal?: AbortSignal } = {}
): Promise<database_blob.DatabaseBlobDiffResponse> {
  const bytes = await getBinary(
    `${historyPath(workspaceId, databaseId)}/${encodeURIComponent(version)}/preview/rows`,
    options.signal,
    { cursor: options.cursor, limit: 256 }
  );
  const page = database_blob.DatabaseBlobDiffResponse.decode(bytes);

  if (page.manifestVersion !== version || page.status !== database_blob.DiffStatus.READY ||
      page.missingRowIds.length || page.page?.restartRequired || page.creates.length || page.deletes.length) {
    throw new Error(page.message || 'This database version is no longer available. Refresh history and try again.');
  }

  return page;
}

export function startDatabaseRestore(
  workspaceId: string,
  databaseId: string,
  version: string,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<DatabaseRestoreJob> {
  return executeAPIRequest<DatabaseRestoreJob>(() =>
    getAxios()?.post<APIResponse<DatabaseRestoreJob>>(
      `${historyPath(workspaceId, databaseId)}/${encodeURIComponent(version)}/restore-jobs`,
      { require_checkpoint: true },
      { headers: { 'Idempotency-Key': idempotencyKey }, signal }
    )
  );
}

export function getDatabaseRestoreJob(
  workspaceId: string,
  databaseId: string,
  jobId: string,
  signal?: AbortSignal
): Promise<DatabaseRestoreJob> {
  return executeAPIRequest<DatabaseRestoreJob>(() =>
    getAxios()?.get<APIResponse<DatabaseRestoreJob>>(
      `${historyPath(workspaceId, databaseId)}/restore-jobs/${encodeURIComponent(jobId)}`,
      { signal }
    )
  );
}

/** Authoritative committed restore marker, independent of the selected history UUID. */
export function getDatabaseRestoreState(workspaceId: string, databaseId: string, signal?: AbortSignal) {
  return executeAPIRequest<{ database_restore_id: string | null; version: string | null }>(() =>
    getAxios()?.get<APIResponse<{ database_restore_id: string | null; version: string | null }>>(
      `/api/workspace/${encodeURIComponent(workspaceId)}/database/${encodeURIComponent(databaseId)}/restore-state`,
      { signal, headers: { 'Cache-Control': 'no-cache' } }
    )
  );
}
