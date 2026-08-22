import { AccessLevel, type CollabObjectPermission, Types, type View, ViewLayout } from '@/application/types';
import { getDatabaseIdFromExtra, isDatabaseContainer } from '@/application/view-utils';
import { findView } from '@/components/_shared/outline/utils';

const DATABASE_VIEW_LAYOUTS = new Set<ViewLayout>([
  ViewLayout.Grid,
  ViewLayout.Board,
  ViewLayout.Calendar,
  ViewLayout.Chart,
  ViewLayout.List,
  ViewLayout.Gallery,
]);

export interface PermissionProbeTarget {
  collabObjectId: string;
  collabType: Types;
}

const OBJECT_PERMISSION_ACCESS_LEVELS = new Set<AccessLevel>([
  AccessLevel.ReadOnly,
  AccessLevel.ReadAndComment,
  AccessLevel.ReadAndWrite,
  AccessLevel.FullAccess,
]);

/** Reject malformed or mismatched responses before they can grant UI access. */
export function isCollabObjectPermissionForTarget(
  value: unknown,
  target: PermissionProbeTarget
): value is CollabObjectPermission {
  if (!value || typeof value !== 'object') return false;

  const permission = value as Partial<CollabObjectPermission>;

  return (
    permission.object_id === target.collabObjectId &&
    permission.collab_type === target.collabType &&
    typeof permission.governing_view_id === 'string' &&
    permission.governing_view_id.length > 0 &&
    (permission.access_level === null ||
      (permission.access_level !== undefined && OBJECT_PERMISSION_ACCESS_LEVELS.has(permission.access_level))) &&
    typeof permission.can_read === 'boolean' &&
    typeof permission.can_write === 'boolean' &&
    typeof permission.can_comment === 'boolean' &&
    typeof permission.can_share === 'boolean'
  );
}

/**
 * Resolve the server/cache identity represented by a routed folder view.
 *
 * Database routes use a folder/database-view id for navigation, while their
 * collab is stored and permissioned by `extra.database_id`. Documents use the
 * routed view id for both identities.
 */
export function resolvePermissionProbeTarget(viewId: string, view?: View | null): PermissionProbeTarget {
  if (view && DATABASE_VIEW_LAYOUTS.has(view.layout) && !isDatabaseContainer(view)) {
    return {
      collabObjectId: getDatabaseIdFromExtra(view) ?? viewId,
      collabType: Types.Database,
    };
  }

  return {
    collabObjectId: viewId,
    collabType: Types.Document,
  };
}

export function findPermissionProbeView(viewId: string, responseRoot?: View | null): View | null {
  return responseRoot ? findView([responseRoot], viewId) : null;
}

export function createPermissionProbeCacheKey(requesterId: string, workspaceId: string, viewId: string): string {
  return `${requesterId}:${workspaceId}:${viewId}`;
}

export function clearPermissionProbeCacheForScope<T>(
  cache: Map<string, T>,
  requesterId: string,
  workspaceId: string
): void {
  const prefix = `${requesterId}:${workspaceId}:`;

  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function getPermissionProbePurgeObjectIds(routeViewId: string, target: PermissionProbeTarget): string[] {
  return Array.from(new Set([routeViewId, target.collabObjectId]));
}

export function bumpPermissionProbeRevision(revisions: Map<string, number>, cacheKey: string): number {
  const nextRevision = (revisions.get(cacheKey) ?? 0) + 1;

  revisions.set(cacheKey, nextRevision);
  return nextRevision;
}
