/**
 * Notification types matching the backend enum (AFNotificationType).
 */
export type NotificationType =
  | 'mention'
  | 'comment_reply'
  | 'comment_on_page'
  | 'reminder'
  | 'access_request'
  | 'access_request_approved'
  | 'access_request_rejected'
  | 'page_shared'
  | 'page_permission_changed'
  | 'page_access_revoked'
  | 'person_property_assigned'
  | 'workspace_invite'
  | 'workspace_role_changed'
  | 'unknown';

/**
 * Raw API shape returned from the backend (cloud AFNotification DTO).
 *
 * Field names match the JSON keys from the cloud API:
 * - `type` (serde rename from `notification_type`)
 * - `metadata` (JSON object, not a string)
 */
export interface AFNotification {
  id: string;
  workspace_id: string;
  type: string;
  view_id?: string | null;
  actor_uid?: number | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  is_archived: boolean;
  created_at: string;
  read_at?: string | null;
}

/**
 * Client-side model (camelCase).
 */
export interface Notification {
  id: string;
  workspaceId: string;
  type: NotificationType;
  viewId?: string | null;
  actorUid?: number | null;
  metadata: Record<string, unknown>;
  isRead: boolean;
  isArchived: boolean;
  createdAt: string;
  readAt?: string | null;
}

/**
 * API response for listing notifications.
 */
export interface AFNotificationListResponse {
  notifications: AFNotification[];
  has_more: boolean;
}

/**
 * API response for unread count (cloud: NotificationUnreadCount).
 */
export interface AFUnreadCountResponse {
  unread_count: number;
}

export enum NotificationTabType {
  Inbox = 'inbox',
  Unread = 'unread',
  Archived = 'archived',
}

export interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreInbox: boolean;
  hasMoreArchive: boolean;
}
