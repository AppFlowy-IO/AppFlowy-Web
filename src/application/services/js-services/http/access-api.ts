import { getTokenParsed } from '@/application/session/token';
import {
  AccessLevel,
  AFWebUser,
  GetRequestAccessInfoResponse,
  Invitation,
  RequestAccessInfoStatus,
  Role,
  ShareAccessDetails,
  Types,
  View,
  Workspace,
} from '@/application/types';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios, withRetry } from './core';

interface AFWorkspace {
  workspace_id: string;
  owner_uid: number;
  owner_name: string;
  workspace_name: string;
  icon: string;
  created_at: string;
  member_count: number;
  database_storage_id: string;
  role?: Role;
}

function afWorkspace2Workspace(workspace: AFWorkspace): Workspace {
  return {
    id: workspace.workspace_id,
    owner: {
      uid: workspace.owner_uid,
      name: workspace.owner_name,
    },
    name: workspace.workspace_name,
    icon: workspace.icon,
    memberCount: workspace.member_count,
    databaseStorageId: workspace.database_storage_id,
    createdAt: workspace.created_at,
    role: workspace.role,
  };
}

export async function getInvitation(invitationId: string) {
  const url = `/api/workspace/invite/${invitationId}`;

  return executeAPIRequest<Invitation>(() =>
    getAxios()?.get<APIResponse<Invitation>>(url)
  );
}

export async function acceptInvitation(invitationId: string) {
  const url = `/api/workspace/accept-invite/${invitationId}`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url)
  );
}

export async function getRequestAccessInfo(requestId: string): Promise<GetRequestAccessInfoResponse> {
  const url = `/api/access-request/${requestId}`;

  const data = await executeAPIRequest<{
    request_id: string;
    workspace: AFWorkspace;
    requester: AFWebUser & {
      email: string;
    };
    view: View;
    status: RequestAccessInfoStatus;
  }>(() =>
    getAxios()?.get<APIResponse<{
      request_id: string;
      workspace: AFWorkspace;
      requester: AFWebUser & {
        email: string;
      };
      view: View;
      status: RequestAccessInfoStatus;
    }>>(url)
  );

  return {
    ...data,
    workspace: afWorkspace2Workspace(data.workspace),
  };
}

export async function approveRequestAccess(requestId: string) {
  const url = `/api/access-request/${requestId}/approve`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      is_approved: true,
    })
  );
}

export async function sendRequestAccess(workspaceId: string, viewId: string) {
  const url = `/api/access-request`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {
      workspace_id: workspaceId,
      view_id: viewId,
    })
  );
}

async function getLegacyShareDetail(
  workspaceId: string,
  viewId: string,
  ancestorViewIds: string[]
): Promise<ShareAccessDetails> {
  const url = `/api/sharing/workspace/${workspaceId}/view/${viewId}/access-details`;

  return withRetry(() =>
    executeAPIRequest<ShareAccessDetails>(() =>
      getAxios()?.post<APIResponse<ShareAccessDetails>>(url, {
        ancestor_view_ids: ancestorViewIds,
      })
    )
  );
}

// A server that answers 404/405 for the v2 endpoint won't start supporting it
// mid-session, so remember the outcome instead of re-failing on every call.
let shareDetailV2Unsupported = false;

const SHARE_DETAIL_CACHE_TTL_MS = 10_000;
const SHARE_DETAIL_CACHE_MAX_ENTRIES = 200;
const shareDetailCache = new Map<string, { promise: Promise<ShareAccessDetails>; cachedAt: number }>();

function pruneExpiredShareDetailCacheEntries(now: number) {
  for (const [key, cached] of shareDetailCache) {
    if (now - cached.cachedAt >= SHARE_DETAIL_CACHE_TTL_MS) {
      shareDetailCache.delete(key);
    }
  }
}

export function invalidateShareDetailCache(workspaceId: string) {
  // Sharing changes on one view can alter effective permissions of its
  // descendants, so drop every cached view in the workspace.
  for (const key of shareDetailCache.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      shareDetailCache.delete(key);
    }
  }
}

function getErrorCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;

    if (typeof code === 'number') return code;
  }

  return undefined;
}

async function fetchShareDetail(
  workspaceId: string,
  viewId: string,
  ancestorViewIds: string[]
): Promise<ShareAccessDetails> {
  if (!shareDetailV2Unsupported) {
    const params = new URLSearchParams({
      type: 'page',
      page_id: viewId,
    });
    const url = `/api/sharing/workspace/${workspaceId}/access-details/v2?${params.toString()}`;

    try {
      // No withRetry here: the shared axios interceptor already retries GETs on
      // transient failures, and stacking a second retry ladder keeps the share
      // panel blocked for many seconds before the legacy fallback below runs.
      return await executeAPIRequest<ShareAccessDetails>(() =>
        getAxios()?.get<APIResponse<ShareAccessDetails>>(url)
      );
    } catch (error) {
      const code = getErrorCode(error);

      if (code === 404 || code === 405) {
        shareDetailV2Unsupported = true;
      } else {
        throw error;
      }
    }
  }

  return getLegacyShareDetail(workspaceId, viewId, ancestorViewIds);
}

export async function getShareDetail(
  workspaceId: string,
  viewId: string,
  ancestorViewIds: string[],
  signal?: AbortSignal
) {
  if (signal?.aborted) {
    return Promise.reject({ code: -1, message: 'Request aborted' });
  }

  // Access details are requester-specific, and older legacy servers can use
  // the supplied ancestry. Keep both dimensions in the short-lived cache key
  // so an in-app account switch or a different legacy ancestry cannot reuse
  // another requester's response.
  const requesterId = getTokenParsed()?.user?.id ?? 'anonymous';
  const key = `${workspaceId}:${requesterId}:${viewId}:${ancestorViewIds.join(',')}`;
  const now = Date.now();

  pruneExpiredShareDetailCacheEntries(now);
  const cached = shareDetailCache.get(key);

  if (cached) {
    return cached.promise;
  }

  while (shareDetailCache.size >= SHARE_DETAIL_CACHE_MAX_ENTRIES) {
    const oldestKey = shareDetailCache.keys().next().value;

    if (oldestKey === undefined) break;
    shareDetailCache.delete(oldestKey);
  }

  // The in-flight promise is shared between callers (share panel, view action
  // menus), so it is not tied to any single caller's abort signal — aborted
  // callers simply ignore the settled result.
  const promise = fetchShareDetail(workspaceId, viewId, ancestorViewIds);

  shareDetailCache.set(key, { promise, cachedAt: now });
  promise.catch(() => {
    if (shareDetailCache.get(key)?.promise === promise) {
      shareDetailCache.delete(key);
    }
  });

  return promise;
}

/** Effective permission of the current user on a single collab object. */
export interface CollabObjectPermission {
  object_id?: string;
  access_level?: AccessLevel | null;
  governing_view_id?: string | null;
  can_read?: boolean;
  can_write?: boolean;
  can_comment?: boolean;
  can_share?: boolean;
}

export async function getObjectPermission(
  workspaceId: string,
  objectId: string,
  collabType: Types = Types.Document
) {
  const url = `/api/workspace/${workspaceId}/collab/${objectId}/permission`;

  return executeAPIRequest<CollabObjectPermission>(() =>
    getAxios()?.get<APIResponse<CollabObjectPermission>>(url, {
      params: { collab_type: collabType },
    })
  );
}

export async function sharePageTo(workspaceId: string, viewId: string, emails: string[], accessLevel?: AccessLevel) {
  const url = `/api/sharing/workspace/${workspaceId}/view`;

  await executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, {
      view_id: viewId,
      emails,
      access_level: accessLevel || AccessLevel.ReadOnly,
    })
  );
  invalidateShareDetailCache(workspaceId);
}

export async function revokeAccess(workspaceId: string, viewId: string, emails: string[]) {
  const url = `/api/sharing/workspace/${workspaceId}/view/${viewId}/revoke-access`;

  await executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { emails })
  );
  invalidateShareDetailCache(workspaceId);
}

export async function turnIntoMember(workspaceId: string, email: string) {
  const url = `/api/workspace/${workspaceId}/member`;

  await executeAPIVoidRequest(() =>
    getAxios()?.put<APIResponse>(url, {
      email,
      role: Role.Member,
    })
  );
  invalidateShareDetailCache(workspaceId);
}

export async function getShareWithMe(workspaceId: string): Promise<View> {
  const url = `/api/sharing/workspace/${workspaceId}/view/${workspaceId}?depth=50`;

  return executeAPIRequest<View>(() =>
    getAxios()?.get<APIResponse<View>>(url)
  );
}
