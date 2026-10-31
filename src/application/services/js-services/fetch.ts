import {
  getCollab,
  getPublishView as getPublishViewAPI,
  getPageCollab,
  getPublishInfoWithViewId,
  getPublishViewMeta as getPublishViewMetaAPI,
} from '@/application/services/js-services/http';
import { RowDocumentSourcePayload, Types } from '@/application/types';
import { createSharedRequest, SharedRequest, throwIfAborted } from '@/application/utils/shared-request';

const pendingRequests = new Map();

type CollabData = Awaited<ReturnType<typeof getCollab>>;
const cancellableRequests = new Map<string, SharedRequest<CollabData>>();

function fetchCancellable<T extends CollabData>(
  key: string,
  fetch: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  try {
    throwIfAborted(signal);
  } catch (error) {
    return Promise.reject(error);
  }

  let request = cancellableRequests.get(key) as SharedRequest<T> | undefined;

  if (!request || request.signal.aborted) {
    request = createSharedRequest(fetch);
    cancellableRequests.set(key, request);
    const owned = request;

    void request.promise.catch(() => undefined).finally(() => {
      if (cancellableRequests.get(key) === owned) cancellableRequests.delete(key);
    });
  }

  return request.join(signal);
}

function generateRequestKey<T> (url: string, params: T) {
  if (!params) return url;

  try {
    return `${url}_${JSON.stringify(params)}`;
  } catch (_e) {
    return `${url}_${params}`;
  }
}

// Deduplication fetch requests
// When multiple requests are made to the same URL with the same params, only one request is made
// and the result is shared with all the requests
function fetchWithDeduplication<Req, Res> (url: string, params: Req, fetchFunction: () => Promise<Res>): Promise<Res> {
  const requestKey = generateRequestKey<Req>(url, params);

  if (pendingRequests.has(requestKey)) {
    return pendingRequests.get(requestKey);
  }

  const fetchPromise = fetchFunction().finally(() => {
    pendingRequests.delete(requestKey);
  });

  pendingRequests.set(requestKey, fetchPromise);
  return fetchPromise;
}

export function fetchPublishView (namespace: string, publishName: string) {
  const fetchFunction = () => getPublishViewAPI(namespace, publishName);

  return fetchWithDeduplication(`fetchPublishView_${namespace}`, { publishName }, fetchFunction);
}

export function fetchPageCollab (workspaceId: string, viewId: string, signal?: AbortSignal) {
  return fetchCancellable(
    `page:${workspaceId}:${viewId}`,
    (sharedSignal) => getPageCollab(workspaceId, viewId, sharedSignal),
    signal
  );
}

export function fetchDatabaseCollab (workspaceId: string, databaseId: string, signal?: AbortSignal) {
  return fetchCancellable(
    `database:${workspaceId}:${databaseId}`,
    (sharedSignal) => getCollab(workspaceId, databaseId, Types.Database, undefined, sharedSignal),
    signal
  );
}

export function fetchRowDocumentCollab (workspaceId: string, documentId: string, source?: RowDocumentSourcePayload) {
  const fetchFunction = () => getCollab(workspaceId, documentId, Types.Document, source);

  return fetchWithDeduplication(`fetchRowDocumentCollab_${workspaceId}`, { documentId, source }, fetchFunction);
}

export function fetchViewInfo (viewId: string) {
  const fetchFunction = () => getPublishInfoWithViewId(viewId);

  return fetchWithDeduplication(`fetchViewInfo`, { viewId }, fetchFunction);
}

export function fetchPublishViewMeta (namespace: string, publishName: string) {
  const fetchFunction = () => getPublishViewMetaAPI(namespace, publishName);

  return fetchWithDeduplication(`fetchPublishViewMeta_${namespace}`, { publishName }, fetchFunction);
}
