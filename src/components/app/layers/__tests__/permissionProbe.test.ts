import { Types, type View, ViewLayout } from '@/application/types';
import {
  bumpPermissionProbeRevision,
  clearPermissionProbeCacheForScope,
  createPermissionProbeCacheKey,
  findPermissionProbeView,
  getPermissionProbePurgeObjectIds,
  resolvePermissionProbeTarget,
} from '@/components/app/layers/permissionProbe';

function createView(viewId: string, layout: ViewLayout, databaseId?: string): View {
  return {
    view_id: viewId,
    name: 'Test view',
    icon: null,
    layout,
    extra: {
      is_space: false,
      database_id: databaseId,
    },
    children: [],
    is_published: false,
    is_private: false,
  };
}

describe('permission probe identity', () => {
  it.each([
    ViewLayout.Grid,
    ViewLayout.Board,
    ViewLayout.Calendar,
    ViewLayout.Chart,
    ViewLayout.List,
    ViewLayout.Gallery,
  ])('uses the canonical database collab id for database layout %s', (layout) => {
    expect(resolvePermissionProbeTarget('database-view-id', createView('database-view-id', layout, 'database-id')))
      .toEqual({
        collabObjectId: 'database-id',
        collabType: Types.Database,
      });
  });

  it('uses the routed view id for documents', () => {
    expect(resolvePermissionProbeTarget('document-id', createView('document-id', ViewLayout.Document))).toEqual({
      collabObjectId: 'document-id',
      collabType: Types.Document,
    });
  });

  it('finds the routed child when cached metadata is returned as a navigation root', () => {
    const routeView = createView('database-view-id', ViewLayout.Grid, 'database-id');
    const responseRoot = createView('space-id', ViewLayout.Document);

    responseRoot.children = [routeView];

    expect(findPermissionProbeView('database-view-id', responseRoot)).toBe(routeView);
  });

  it('keeps permission cache entries separate for different requesters', () => {
    const firstRequesterKey = createPermissionProbeCacheKey('user-1', 'workspace-id', 'view-id');
    const secondRequesterKey = createPermissionProbeCacheKey('user-2', 'workspace-id', 'view-id');

    expect(firstRequesterKey).not.toBe(secondRequesterKey);
  });

  it('clears only the requester and workspace scope across auth sessions', () => {
    const matchingKey = createPermissionProbeCacheKey('user-1', 'workspace-1', 'view-1');
    const otherRequesterKey = createPermissionProbeCacheKey('user-2', 'workspace-1', 'view-1');
    const otherWorkspaceKey = createPermissionProbeCacheKey('user-1', 'workspace-2', 'view-1');
    const cache = new Map([
      [matchingKey, 'allowed'],
      [otherRequesterKey, 'allowed'],
      [otherWorkspaceKey, 'allowed'],
    ]);

    clearPermissionProbeCacheForScope(cache, 'user-1', 'workspace-1');

    expect(cache.has(matchingKey)).toBe(false);
    expect(cache.has(otherRequesterKey)).toBe(true);
    expect(cache.has(otherWorkspaceKey)).toBe(true);
  });

  it('purges both canonical and legacy database cache identities', () => {
    expect(
      getPermissionProbePurgeObjectIds('database-view-id', {
        collabObjectId: 'database-id',
        collabType: Types.Database,
      })
    ).toEqual(['database-view-id', 'database-id']);
  });

  it('bumps a route revision so an in-flight verdict can be recognized as stale', () => {
    const cacheKey = createPermissionProbeCacheKey('user-1', 'workspace-id', 'view-id');
    const revisions = new Map<string, number>();
    const capturedRevision = revisions.get(cacheKey) ?? 0;

    expect(bumpPermissionProbeRevision(revisions, cacheKey)).toBe(1);
    expect(revisions.get(cacheKey)).not.toBe(capturedRevision);
  });
});
