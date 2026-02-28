import { toBase64 } from 'lib0/buffer';

import { getOrCreateDeviceId } from '@/application/services/js-services/device-id';
import {
  RowId,
  Types,
  User,
  View,
} from '@/application/types';
import { database_blob } from '@/proto/database_blob';
import { Log } from '@/utils/log';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

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
  }>
): Promise<void> {
  const url = `/api/workspace/v1/${workspaceId}/collab/full-sync/batch`;

  // Import the collab proto types
  const { collab } = await import('@/proto/messages');

  // Build the protobuf request
  const request = collab.CollabBatchSyncRequest.create({
    items: items.map((item) => ({
      objectId: item.objectId,
      collabType: item.collabType,
      compression: collab.PayloadCompressionType.COMPRESSION_NONE,
      sv: item.stateVector,
      docState: item.docState,
    })),
    responseCompression: collab.PayloadCompressionType.COMPRESSION_NONE,
  });

  // Encode the request to binary
  const encoded = collab.CollabBatchSyncRequest.encode(request).finish();

  const deviceId = getOrCreateDeviceId();
  const axiosInstance = getAxios();

  // Send the request with protobuf content type
  const response = await axiosInstance?.post(url, encoded, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'client-version': 'web',
      'device-id': deviceId,
    },
    responseType: 'arraybuffer',
  });

  if (!response || response.status !== 200) {
    throw new Error(`Failed to sync collabs: ${response?.status}`);
  }

  // Decode and check the response for errors
  const responseData = new Uint8Array(response.data);
  const batchResponse = collab.CollabBatchSyncResponse.decode(responseData);

  // Check for any errors in the results
  for (const result of batchResponse.results) {
    if (result.error) {
      Log.warn('Collab sync error', {
        objectId: result.objectId,
        collabType: result.collabType,
        error: result.error,
      });
    }
  }
}

export async function getCollab(workspaceId: string, objectId: string, collabType: Types) {
  const url = `/api/workspace/v1/${workspaceId}/collab/${objectId}`;

  const data = await executeAPIRequest<{
    doc_state: number[];
    object_id: string;
  }>(() =>
    getAxios()?.get<APIResponse<{
      doc_state: number[];
      object_id: string;
    }>>(url, {
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
    getAxios()?.get<APIResponse<{
      view: View;
      data: {
        encoded_collab: number[];
        row_data: Record<RowId, number[]>;
        owner?: User;
        last_editor?: User;
      };
    }>>(url)
  );

  const { encoded_collab, row_data, owner, last_editor } = response.data;

  return {
    data: new Uint8Array(encoded_collab),
    rows: row_data,
    owner,
    lastEditor: last_editor,
  };
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
  const data = await executeAPIRequest<Array<{
    version: string;
    parent: string | null;
    name: string | null;
    created_at: string;
    created_by: number | null;
    deleted_at?: string | null;
    // Backward compatibility for older server payloads.
    is_deleted?: boolean;
    editors: number[];
  }>>(() =>
    getAxios()?.get<APIResponse<Array<{
      version: string;
      parent: string | null;
      name: string | null;
      created_at: string;
      created_by: number | null;
      deleted_at?: string | null;
      // Backward compatibility for older server payloads.
      is_deleted?: boolean;
      editors: number[];
    }>>>(url, {
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
      deletedAt: data.deleted_at ? new Date(data.deleted_at) : (data.is_deleted ? new Date(0) : null),
      editors: data.editors,
    };
  });
}

export async function previewCollabVersion(workspaceId: string, objectId: string, version: string, collabType: Types) {
  const url = `/api/workspace/${workspaceId}/collab/${objectId}/history/${version}?collab_type=${collabType}`;

  const response = await getAxios()?.get(url, {
    responseType: 'arraybuffer'
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
    getAxios()?.post<APIResponse<{
      state_vector: number[];
      doc_state: number[];
      collab_version: string | null;
      version: number;
    }>>(url, {
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
