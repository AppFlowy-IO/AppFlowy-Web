import { AppOutlineResponse } from '@/application/services/services.type';
import { View } from '@/application/types';

import { APIResponse, executeAPIRequest, getAxios } from './core';

export async function getAppOutline(workspaceId: string): Promise<AppOutlineResponse> {
  const url = `/api/workspace/${workspaceId}/view/${workspaceId}?depth=2`;

  return executeAPIRequest<View>(() =>
    getAxios()?.get<APIResponse<View>>(url)
  ).then((data) => ({
    outline: Array.isArray(data.children) ? data.children : [],
    folderRid: data.folder_rid,
  }));
}

export async function getView(workspaceId: string, viewId: string, depth: number = 1) {
  const url = `/api/workspace/${workspaceId}/view/${viewId}?depth=${depth}`;

  return executeAPIRequest<View>(() =>
    getAxios()?.get<APIResponse<View>>(url)
  );
}

export async function getViews(workspaceId: string, viewIds: string[], depth: number = 2) {
  if (viewIds.length === 0) return [];

  const query = new URLSearchParams({
    depth: String(depth),
    view_ids: viewIds.join(','),
  });
  const url = `/api/workspace/${workspaceId}/views?${query.toString()}`;

  return executeAPIRequest<{ views: View[] }>(() =>
    getAxios()?.get<APIResponse<{ views: View[] }>>(url)
  ).then((data) => data.views ?? []);
}

export async function getAppFavorites(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/favorite`;

  return executeAPIRequest<{ views: View[] }>(() =>
    getAxios()?.get<APIResponse<{ views: View[] }>>(url)
  ).then((data) => data.views);
}

export async function getAppRecent(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/recent`;

  return executeAPIRequest<{ views: View[] }>(() =>
    getAxios()?.get<APIResponse<{ views: View[] }>>(url)
  ).then((data) => data.views);
}

export async function getAppTrash(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/trash`;

  return executeAPIRequest<{ views: View[] }>(() =>
    getAxios()?.get<APIResponse<{ views: View[] }>>(url)
  ).then((data) => data.views);
}

export async function createOrphanedView(workspaceId: string, payload: { document_id: string }): Promise<Uint8Array> {
  const url = `/api/workspace/${workspaceId}/orphaned-view`;

  // Server returns doc_state as Vec<u8> which is JSON encoded as number[]
  const docStateArray = await executeAPIRequest<number[] | null>(() =>
    getAxios()?.post<APIResponse<number[] | null>>(url, payload)
  );

  // Validate the response - server must return a valid doc_state array
  if (!docStateArray || !Array.isArray(docStateArray)) {
    throw new Error('Server returned invalid doc_state');
  }

  return new Uint8Array(docStateArray);
}

export async function checkIfCollabExists(workspaceId: string, objectId: string) {
  const url = `/api/workspace/${workspaceId}/collab/${objectId}/collab-exists`;

  const payload = await executeAPIRequest<{ exists: boolean }>(() =>
    getAxios()?.get<APIResponse<{ exists: boolean }>>(url)
  );

  return payload.exists;
}
