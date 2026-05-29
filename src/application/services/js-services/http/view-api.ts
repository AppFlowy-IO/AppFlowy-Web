import { AppOutlineResponse } from '@/application/services/services.type';
import { View } from '@/application/types';

import { APIResponse, executeAPIRequest, getAxios } from './core';

const MAX_WORKSPACE_VIEW_SUBTREES_GET_URL_BYTES = 4096;
const WORKSPACE_VIEW_SUBTREES_BATCH_CHUNK_SIZE = 50;

export async function getAppOutline(workspaceId: string): Promise<AppOutlineResponse> {
  const url = `/api/workspace/${workspaceId}/view/${workspaceId}?depth=2`;

  return executeAPIRequest<View>(() => getAxios()?.get<APIResponse<View>>(url)).then((data) => ({
    outline: Array.isArray(data.children) ? data.children : [],
    folderRid: data.folder_rid,
  }));
}

export async function getView(workspaceId: string, viewId: string, depth: number = 1) {
  const url = `/api/workspace/${workspaceId}/view/${viewId}?depth=${depth}`;

  return executeAPIRequest<View>(() => getAxios()?.get<APIResponse<View>>(url));
}

export async function getViews(workspaceId: string, viewIds: string[], depth: number = 2) {
  if (viewIds.length === 0) return [];

  const url = `/api/workspace/${workspaceId}/views`;
  const viewChunks = await Promise.all(
    chunkViewIds(viewIds, WORKSPACE_VIEW_SUBTREES_BATCH_CHUNK_SIZE).map((chunk) => getViewsChunk(url, chunk, depth))
  );

  return viewChunks.flat();
}

async function getViewsChunk(url: string, viewIds: string[], depth: number): Promise<View[]> {
  if (workspaceViewSubtreesQueryFitsGet(url, viewIds, depth)) {
    return getViewsByGet(url, viewIds, depth);
  }

  try {
    return await getViewsByPost(url, viewIds, depth);
  } catch (error) {
    if (!isUnsupportedPostRouteError(error)) {
      throw error;
    }

    const viewChunks = await Promise.all(
      workspaceViewSubtreesGetChunks(url, viewIds, depth).map((chunk) => getViewsByGet(url, chunk, depth))
    );

    return viewChunks.flat();
  }
}

async function getViewsByGet(url: string, viewIds: string[], depth: number): Promise<View[]> {
  const query = workspaceViewSubtreesQuery(viewIds, depth);

  return executeAPIRequest<{ views: View[] }>(() =>
    getAxios()?.get<APIResponse<{ views: View[] }>>(`${url}?${query}`)
  ).then((data) => data.views ?? []);
}

async function getViewsByPost(url: string, viewIds: string[], depth: number): Promise<View[]> {
  return executeAPIRequest<{ views: View[] }>(() =>
    getAxios()?.post<APIResponse<{ views: View[] }>>(url, {
      depth,
      view_ids: viewIds,
    })
  ).then((data) => data.views ?? []);
}

function workspaceViewSubtreesQuery(viewIds: string[], depth: number): string {
  const params = new URLSearchParams();

  params.set('depth', String(depth));
  params.set('view_ids', viewIds.join(','));

  return params.toString();
}

function workspaceViewSubtreesQueryFitsGet(url: string, viewIds: string[], depth: number): boolean {
  return `${url}?${workspaceViewSubtreesQuery(viewIds, depth)}`.length <= MAX_WORKSPACE_VIEW_SUBTREES_GET_URL_BYTES;
}

function workspaceViewSubtreesGetChunks(url: string, viewIds: string[], depth: number): string[][] {
  const chunks: string[][] = [];
  let start = 0;

  while (start < viewIds.length) {
    let end = Math.min(viewIds.length, start + WORKSPACE_VIEW_SUBTREES_BATCH_CHUNK_SIZE);

    while (end > start + 1 && !workspaceViewSubtreesQueryFitsGet(url, viewIds.slice(start, end), depth)) {
      end = start + Math.floor((end - start) / 2);
    }

    chunks.push(viewIds.slice(start, end));
    start = end;
  }

  return chunks;
}

function chunkViewIds(viewIds: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < viewIds.length; index += chunkSize) {
    chunks.push(viewIds.slice(index, index + chunkSize));
  }

  return chunks;
}

function isUnsupportedPostRouteError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code: unknown }).code === 404 || (error as { code: unknown }).code === 405)
  );
}

export async function getAppFavorites(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/favorite`;

  return executeAPIRequest<{ views: View[] }>(() => getAxios()?.get<APIResponse<{ views: View[] }>>(url)).then(
    (data) => data.views
  );
}

export async function getAppRecent(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/recent`;

  return executeAPIRequest<{ views: View[] }>(() => getAxios()?.get<APIResponse<{ views: View[] }>>(url)).then(
    (data) => data.views
  );
}

export async function getAppTrash(workspaceId: string) {
  const url = `/api/workspace/${workspaceId}/trash`;

  return executeAPIRequest<{ views: View[] }>(() => getAxios()?.get<APIResponse<{ views: View[] }>>(url)).then(
    (data) => data.views
  );
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
