import { AFNotification, Notification, NotificationType } from './types';

const KNOWN_TYPES: Set<string> = new Set([
  'mention',
  'comment_reply',
  'comment_on_page',
  'reminder',
  'access_request',
  'access_request_approved',
  'access_request_rejected',
  'page_shared',
  'page_permission_changed',
  'page_access_revoked',
  'person_property_assigned',
  'workspace_invite',
  'workspace_role_changed',
]);

/**
 * Extract a string value from a metadata object, trying multiple keys in order.
 */
export function pickText(metadata: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = metadata[key];

    if (typeof val === 'string' && val.length > 0) return val;
  }

  return '';
}

/**
 * Convert a raw notification type string into a human-readable label.
 * e.g. "comment_on_page" → "Comment On Page"
 */
export function humanizeType(rawType: string): string {
  return rawType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format a notification timestamp matching desktop behavior:
 * - Today: HH:mm (24-hour)
 * - Other days: M/D
 */
export function formatTimestamp(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const today =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (today) {
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');

    return `${hour}:${minute}`;
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * Transform a raw API notification into the client-side model.
 */
export function toNotification(raw: AFNotification): Notification {
  // metadata is already a JSON object from the cloud API
  const metadata: Record<string, unknown> = raw.metadata || {};

  const type: NotificationType = KNOWN_TYPES.has(raw.type)
    ? (raw.type as NotificationType)
    : 'unknown';

  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    type,
    viewId: raw.view_id,
    actorUid: raw.actor_uid,
    metadata,
    isRead: raw.is_read,
    isArchived: raw.is_archived,
    createdAt: raw.created_at,
    readAt: raw.read_at,
  };
}

/**
 * Deduplicate notifications by id, keeping the latest version, sorted by createdAt desc.
 */
export function mergeNotifications(items: Notification[]): Notification[] {
  const map = new Map<string, Notification>();

  for (const item of items) {
    map.set(item.id, item);
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Build secondary text for notification content: "actor . page"
 */
export function buildSecondary(actor: string, page: string): string {
  if (actor && page) return `${actor} \u00B7 ${page}`;
  if (actor) return actor;
  if (page) return page;

  return '';
}

/**
 * Check if a date is today.
 */
export function isToday(isoDate: string): boolean {
  const date = new Date(isoDate);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}
