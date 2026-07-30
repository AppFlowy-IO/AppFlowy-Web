import { toBase64 } from 'lib0/buffer';

import { getOrCreateDeviceId } from '@/application/services/js-services/device-id';
import { RowId, Types, User, View } from '@/application/types';
import { database_blob } from '@/proto/database_blob';
import { collab } from '@/proto/messages';
import { Log } from '@/utils/log';

import { APIResponse, APIError, executeAPIRequest, executeAPIVoidRequest, getAxios, parseRetryAfterSecs } from './core';

export interface CollabFullSyncBatchResult {
  objectId: string;
  collabType: Types;
  missingUpdate: Uint8Array;
  serverStateVector: Uint8Array;
  collabVersion?: string;
  messageId?: collab.IRid;
  error?: string;
}

export interface CollabFullSyncBatchOptions {
  /**
   * Marks a single oversized item for the server's bounded slow-sync lane.
   * Ordinary batch requests intentionally omit this header.
   */
  syncLane?: 'slow';
  /** Cancels an in-flight request when its owning workspace/session changes. */
  signal?: AbortSignal;
  /** Bounds ordinary requests that participate in a serialized workflow. */
  timeoutMs?: number;
}

export const SLOW_SYNC_PROBE_TIMEOUT_MS = 120_000;
const SLOW_SYNC_SERVER_PROCESSING_BUDGET_MS = 60_000;
const SLOW_SYNC_NETWORK_HEADROOM_MS = 30_000;
const SLOW_SYNC_MIN_UPLOAD_BITS_PER_SECOND = 1_500_000;
const SLOW_SYNC_PROTOBUF_HEADROOM_BYTES = 64 * 1024;

/**
 * Budget upload time at 1.5 Mbps, then leave the server's full processing
 * window plus transport/metadata headroom. The probe keeps its smaller fixed
 * timeout because it carries no document state.
 */
export function getSlowSyncUploadTimeoutMs(payloadBytes: number): number {
  const boundedPayloadBytes = Math.max(0, Number.isFinite(payloadBytes) ? payloadBytes : 0);
  const uploadMs = Math.ceil(
    ((boundedPayloadBytes + SLOW_SYNC_PROTOBUF_HEADROOM_BYTES) * 8 * 1_000) / SLOW_SYNC_MIN_UPLOAD_BITS_PER_SECOND
  );

  return Math.max(
    SLOW_SYNC_PROBE_TIMEOUT_MS,
    uploadMs + SLOW_SYNC_SERVER_PROCESSING_BUDGET_MS + SLOW_SYNC_NETWORK_HEADROOM_MS
  );
}

function canUseStreamingGzip(): boolean {
  return typeof globalThis.CompressionStream === 'function' && typeof globalThis.DecompressionStream === 'function';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;

  const reason = (signal as AbortSignal & { reason?: unknown }).reason;

  if (reason !== undefined) throw reason;

  const error = new Error('The operation was aborted');

  error.name = 'AbortError';
  throw error;
}

async function transformGzip(
  payload: Uint8Array,
  mode: 'compress' | 'decompress',
  signal?: AbortSignal
): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (payload.byteLength === 0) return payload;

  const transformer = mode === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip');
  // Copy into a plain ArrayBuffer so TypeScript and Blob do not have to account
  // for a SharedArrayBuffer-backed Uint8Array.
  const input = new Blob([payload.slice().buffer]).stream();
  const output = input.pipeThrough(transformer);
  const reader = output.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const cancelReader = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };

  signal?.addEventListener('abort', cancelReader, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();

      throwIfAborted(signal);
      if (done) break;
      chunks.push(value);
      totalBytes += value.byteLength;
    }

    const result = new Uint8Array(totalBytes);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    throwIfAborted(signal);
    return result;
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }
}

async function decodeFullSyncResultPayload(
  payload: Uint8Array,
  compression: collab.PayloadCompressionType,
  signal?: AbortSignal
): Promise<Uint8Array> {
  throwIfAborted(signal);

  switch (compression) {
    case collab.PayloadCompressionType.COMPRESSION_NONE:
      return payload;
    case collab.PayloadCompressionType.COMPRESSION_GZIP:
      if (!canUseStreamingGzip()) {
        throw new Error('Server returned a gzip full-sync result, but this browser cannot decompress gzip streams');
      }

      return transformGzip(payload, 'decompress', signal);
    case collab.PayloadCompressionType.COMPRESSION_ZSTD:
      throw new Error('Server returned a zstd full-sync result, but the Web client has no zstd decoder');
    default:
      throw new Error(`Unsupported full-sync result compression: ${compression}`);
  }
}

export async function updateCollab(
  workspaceId: string,
  objectId: string,
  collabType: Types,
  docState: Uint8Array,
  context: {
    version_vector: number;
  }
) {
  const url = `/api/workspace/v1/${workspaceId}/collab/${objectId}/web-update`;
  const deviceId = getOrCreateDeviceId();

  await executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(
      url,
      {
        doc_state: Array.from(docState),
        collab_type: collabType,
      },
      {
        headers: {
          'client-version': 'web',
          'device-id': deviceId,
        },
      }
    )
  );

  return context;
}

/**
 * Batch sync multiple collab documents to the server.
 * This is the same API that desktop uses before duplicating to ensure
 * the server has the latest state of all documents.
 *
 * @param workspaceId - The workspace ID
 * @param items - Array of collab items to sync, each containing objectId, collabType, stateVector, and docState
 * @returns The batch sync response containing results for each collab
 */
export async function collabFullSyncBatch(
  workspaceId: string,
  items: Array<{
    objectId: string;
    collabType: Types;
    stateVector: Uint8Array;
    docState: Uint8Array;
    collabVersion?: string | null;
  }>,
  options?: CollabFullSyncBatchOptions
): Promise<CollabFullSyncBatchResult[]> {
  const url = `/api/workspace/v1/${workspaceId}/collab/full-sync/batch`;
  const streamingGzipAvailable = canUseStreamingGzip();
  const slowSyncPayloadBytes = items.reduce(
    (total, item) => total + item.stateVector.byteLength + item.docState.byteLength,
    0
  );

  if (options?.syncLane === 'slow' && !streamingGzipAvailable) {
    throw new Error('HTTP slow-sync requires browser gzip compression support');
  }

  if (options?.syncLane === 'slow' && items.length !== 1) {
    throw new Error('HTTP slow-sync requires exactly one collab item');
  }

  const compression =
    options?.syncLane === 'slow'
      ? collab.PayloadCompressionType.COMPRESSION_GZIP
      : collab.PayloadCompressionType.COMPRESSION_NONE;
  const preparedItems = await Promise.all(
    items.map(async (item) => {
      if (compression !== collab.PayloadCompressionType.COMPRESSION_GZIP) {
        return { ...item, compression };
      }

      const [stateVector, docState] = await Promise.all([
        transformGzip(item.stateVector, 'compress', options?.signal),
        transformGzip(item.docState, 'compress', options?.signal),
      ]);

      return { ...item, stateVector, docState, compression };
    })
  );

  // Build the protobuf request
  const request = collab.CollabBatchSyncRequest.create({
    items: preparedItems.map((item) => ({
      objectId: item.objectId,
      collabType: item.collabType,
      compression: item.compression,
      sv: item.stateVector,
      docState: item.docState,
      collabVersion: item.collabVersion ?? undefined,
    })),
    responseCompression: collab.PayloadCompressionType.COMPRESSION_NONE,
  });

  // Encode the request to binary
  const encoded = collab.CollabBatchSyncRequest.encode(request).finish();

  const deviceId = getOrCreateDeviceId();
  const axiosInstance = getAxios();
  const timeoutMs =
    options?.timeoutMs ?? (options?.syncLane === 'slow' ? getSlowSyncUploadTimeoutMs(slowSyncPayloadBytes) : undefined);

  // Send the request with protobuf content type.
  // Use validateStatus to prevent axios from throwing on 429/503 so we can
  // extract the Retry-After header and surface it to callers.
  const response = await axiosInstance?.post(url, encoded, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'client-version': 'web',
      'device-id': deviceId,
      ...(options?.syncLane ? { 'x-appflowy-sync-lane': options.syncLane } : {}),
    },
    responseType: 'arraybuffer',
    signal: options?.signal,
    // A slow upload or its lightweight probe must not hold the serialized
    // workspace lane forever.
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    // Axios' default transform sends typed-array `.buffer`, which can include
    // protobufjs' pooled zero padding beyond this Uint8Array view.
    transformRequest: [(data: Uint8Array) => data],
    validateStatus: (status) => status === 200 || status === 429 || status === 503,
  });

  if (!response) {
    const err = new Error('No response received from server');

    Object.assign(err, { code: -1 } satisfies Partial<APIError>);
    throw err;
  }

  if (response.status === 429 || response.status === 503) {
    const retryAfterSecs = parseRetryAfterSecs(response.headers);
    const err = new Error(`Batch sync rate-limited (${response.status})`);

    Object.assign(err, { code: response.status, retryAfterSecs } satisfies Partial<APIError>);
    throw err;
  }

  // Decode and check the response for errors
  const responseData = new Uint8Array(response.data);
  const batchResponse = collab.CollabBatchSyncResponse.decode(responseData);
  const results: CollabFullSyncBatchResult[] = [];

  // Check for any errors in the results
  for (const result of batchResponse.results) {
    if (result.error) {
      Log.warn('Collab sync error', {
        objectId: result.objectId,
        collabType: result.collabType,
        error: result.error,
      });
    }

    // Error results can use the request compression enum while carrying raw
    // default vectors. Preserve the explicit server error instead of masking
    // it with a decompression exception.
    const resultCompression = result.error
      ? collab.PayloadCompressionType.COMPRESSION_NONE
      : result.compression ?? collab.PayloadCompressionType.COMPRESSION_NONE;
    const [missingUpdate, serverStateVector] = await Promise.all([
      decodeFullSyncResultPayload(result.missingUpdate ?? new Uint8Array(), resultCompression, options?.signal),
      decodeFullSyncResultPayload(result.serverStateVector ?? new Uint8Array(), resultCompression, options?.signal),
    ]);

    results.push({
      objectId: result.objectId ?? '',
      collabType: result.collabType as Types,
      missingUpdate,
      serverStateVector,
      collabVersion: result.collabVersion || undefined,
      messageId: result.messageId ?? undefined,
      error: result.error || undefined,
    });
  }

  return results;
}

export async function getCollab(workspaceId: string, objectId: string, collabType: Types) {
  const url = `/api/workspace/v1/${workspaceId}/collab/${objectId}`;

  const data = await executeAPIRequest<{
    doc_state: number[];
    object_id: string;
  }>(() =>
    getAxios()?.get<
      APIResponse<{
        doc_state: number[];
        object_id: string;
      }>
    >(url, {
      params: {
        collab_type: collabType,
      },
    })
  );

  return {
    data: new Uint8Array(data.doc_state),
  };
}

export async function getPageCollab(workspaceId: string, viewId: string) {
  const url = `/api/workspace/${workspaceId}/page-view/${viewId}`;

  const response = await executeAPIRequest<{
    view: View;
    data: {
      encoded_collab: number[];
      row_data: Record<RowId, number[]>;
      owner?: User;
      last_editor?: User;
    };
  }>(() =>
    getAxios()?.get<
      APIResponse<{
        view: View;
        data: {
          encoded_collab: number[];
          row_data: Record<RowId, number[]>;
          owner?: User;
          last_editor?: User;
        };
      }>
    >(url)
  );

  const { encoded_collab, row_data, owner, last_editor } = response.data;

  return {
    data: new Uint8Array(encoded_collab),
    rows: row_data,
    owner,
    lastEditor: last_editor,
  };
}

export async function duplicateRowDocument(
  workspaceId: string,
  databaseId: string,
  sourceRowId: string,
  newRowId: string,
  clientDocStateB64?: string
): Promise<void> {
  const url = `/api/workspace/${workspaceId}/database/${databaseId}/row/${sourceRowId}/duplicate-document`;

  await executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      new_row_id: newRowId,
      client_doc_state_b64: clientDocStateB64,
    })
  );
}

export async function databaseBlobDiff(
  workspaceId: string,
  databaseId: string,
  request: database_blob.IDatabaseBlobDiffRequest
) {
  const axiosInstance = getAxios();

  if (!axiosInstance) {
    return Promise.reject({
      code: -1,
      message: 'API service not initialized',
    });
  }

  const url = `/api/workspace/${workspaceId}/database/${databaseId}/blob/diff`;
  const payload = database_blob.DatabaseBlobDiffRequest.encode(request).finish();

  const response = await axiosInstance.post<ArrayBuffer>(url, payload, {
    responseType: 'arraybuffer',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    transformRequest: [(data) => data],
    validateStatus: (status) => status === 200 || status === 202,
  });

  const bytes = new Uint8Array(response.data);

  return database_blob.DatabaseBlobDiffResponse.decode(bytes);
}

export async function getCollabVersions(workspaceId: string, objectId: string, since?: Date) {
  const url = `/api/workspace/${workspaceId}/collab/${objectId}/history`;
  const from = since?.getTime() || null;
  const data = await executeAPIRequest<
    Array<{
      version: string;
      parent: string | null;
      name: string | null;
      created_at: string;
      created_by: number | null;
      deleted_at?: string | null;
      // Backward compatibility for older server payloads.
      is_deleted?: boolean;
      editors: number[];
    }>
  >(() =>
    getAxios()?.get<
      APIResponse<
        Array<{
          version: string;
          parent: string | null;
          name: string | null;
          created_at: string;
          created_by: number | null;
          deleted_at?: string | null;
          // Backward compatibility for older server payloads.
          is_deleted?: boolean;
          editors: number[];
        }>
      >
    >(url, {
      params: {
        since: from,
      },
    })
  );

  return data.map((data) => {
    return {
      versionId: data.version,
      parentId: data.parent,
      name: data.name,
      createdAt: new Date(data.created_at),
      deletedAt: data.deleted_at ? new Date(data.deleted_at) : data.is_deleted ? new Date(0) : null,
      editors: data.editors,
    };
  });
}

export async function previewCollabVersion(workspaceId: string, objectId: string, version: string, collabType: Types) {
  const url = `/api/workspace/${workspaceId}/collab/${objectId}/history/${version}?collab_type=${collabType}`;

  const response = await getAxios()?.get(url, {
    responseType: 'arraybuffer',
  });

  if (!response) {
    throw new Error('No response');
  }

  return new Uint8Array(response.data);
}

export async function createCollabVersion(
  workspaceId: string,
  objectId: string,
  collabType: Types,
  name: string,
  ySnapshot: Uint8Array
) {
  const snapshot = toBase64(ySnapshot);
  const url = `/api/workspace/${workspaceId}/collab/${objectId}/history`;

  return executeAPIRequest<string>(() =>
    getAxios()?.post<APIResponse<string>>(url, {
      snapshot,
      name,
      collab_type: collabType,
    })
  );
}

export async function deleteCollabVersion(workspaceId: string, objectId: string, version: string) {
  const url = `/api/workspace/${workspaceId}/collab/${objectId}/history`;

  return executeAPIVoidRequest(() =>
    getAxios()?.delete<APIResponse>(url, {
      data: JSON.stringify(version),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  );
}

export async function revertCollabVersion(workspaceId: string, objectId: string, collabType: Types, version: string) {
  const url = `/api/workspace/${workspaceId}/collab/${objectId}/revert`;
  const data = await executeAPIRequest<{
    state_vector: number[];
    doc_state: number[];
    collab_version: string | null;
    version: number; // this is encoder version (lib0 v1 encoding is 0, while lib0 v2 encoding is 1, we only use 0 atm.)
  }>(() =>
    getAxios()?.post<
      APIResponse<{
        state_vector: number[];
        doc_state: number[];
        collab_version: string | null;
        version: number;
      }>
    >(url, {
      version,
      collab_type: collabType,
    })
  );

  return {
    stateVector: new Uint8Array(data.state_vector),
    docState: new Uint8Array(data.doc_state),
    version: data.collab_version,
  };
}
