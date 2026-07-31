import { Types, type View, ViewLayout } from '@/application/types';
import { getDatabaseIdFromExtra } from '@/application/view-utils';
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

/**
 * Resolve the server/cache identity represented by a routed folder view.
 *
 * Database routes use a folder/database-view id for navigation, while their
 * collab is stored and permissioned by `extra.database_id`. Documents use the
 * routed view id for both identities.
 */
export function resolvePermissionProbeTarget(viewId: string, view?: View | null): PermissionProbeTarget {
  if (view && DATABASE_VIEW_LAYOUTS.has(view.layout)) {
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
