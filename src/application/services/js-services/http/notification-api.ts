import { AFNotificationListResponse, AFUnreadCountResponse } from '@/components/notifications/types';

import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';

export async function listNotifications(
  workspaceId: string,
  options?: {
    unreadOnly?: boolean;
    archived?: boolean;
    offset?: number;
    limit?: number;
  }
): Promise<AFNotificationListResponse> {
  const params = new URLSearchParams();

  if (options?.unreadOnly) params.set('unread_only', 'true');
  if (options?.archived) params.set('archived', 'true');
  if (options?.offset !== undefined) params.set('offset', String(options.offset));
  if (options?.limit !== undefined) params.set('limit', String(options.limit));

  const query = params.toString();
  const url = `/api/workspace/${workspaceId}/notifications${query ? `?${query}` : ''}`;

  return executeAPIRequest<AFNotificationListResponse>(() =>
    getAxios()?.get<APIResponse<AFNotificationListResponse>>(url)
  );
}

export async function getUnreadCount(workspaceId: string): Promise<AFUnreadCountResponse> {
  const url = `/api/workspace/${workspaceId}/notifications/unread-count`;

  return executeAPIRequest<AFUnreadCountResponse>(() =>
    getAxios()?.get<APIResponse<AFUnreadCountResponse>>(url)
  );
}

export async function markNotificationsRead(workspaceId: string, ids: string[]): Promise<void> {
  const url = `/api/workspace/${workspaceId}/notifications/read`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { ids })
  );
}

export async function markAllNotificationsRead(workspaceId: string): Promise<void> {
  const url = `/api/workspace/${workspaceId}/notifications/read-all`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {})
  );
}

export async function archiveNotifications(workspaceId: string, ids: string[]): Promise<void> {
  const url = `/api/workspace/${workspaceId}/notifications/archive`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, { ids })
  );
}

export async function archiveAllNotifications(workspaceId: string): Promise<void> {
  const url = `/api/workspace/${workspaceId}/notifications/archive-all`;

  return executeAPIVoidRequest(() =>
    getAxios()?.post<APIResponse>(url, {})
  );
}
