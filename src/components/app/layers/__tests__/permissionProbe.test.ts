import { AccessLevel, type CollabObjectPermission, Types, type View, ViewLayout } from '@/application/types';
import {
  bumpPermissionProbeRevision,
  clearPermissionProbeCacheForScope,
  createPermissionProbeCacheKey,
  findPermissionProbeView,
  getPermissionProbePurgeObjectIds,
  isCollabObjectPermissionForTarget,
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

function createPermission(overrides: Partial<CollabObjectPermission> = {}): CollabObjectPermission {
  return {
    object_id: 'document-id',
    collab_type: Types.Document,
    governing_view_id: 'document-id',
    access_level: AccessLevel.ReadAndWrite,
    can_read: true,
    can_write: true,
    can_comment: true,
    can_share: false,
    ...overrides,
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
    ViewLayout.Form,
  ])('uses the canonical database collab id for database layout %s', (layout) => {
    expect(
      resolvePermissionProbeTarget('database-view-id', createView('database-view-id', layout, 'database-id'))
    ).toEqual({
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

  it('keeps a database container on its document permission target', () => {
    const container = createView('container-id', ViewLayout.Grid, 'database-id');

    container.extra = {
      ...container.extra,
      is_database_container: true,
    };

    expect(resolvePermissionProbeTarget('container-id', container)).toEqual({
      collabObjectId: 'container-id',
      collabType: Types.Document,
    });
  });

  it('uses the database target for an embedded childless view with the web container marker', () => {
    const linkedView = createView('linked-view-id', ViewLayout.Grid, 'database-id');

    linkedView.extra = {
      ...linkedView.extra,
      embedded: true,
      is_database_container: true,
    };

    expect(resolvePermissionProbeTarget('linked-view-id', linkedView)).toEqual({
      collabObjectId: 'database-id',
      collabType: Types.Database,
    });
  });

  it('keeps an embedded lazy-loaded container on its document permission target', () => {
    const container = createView('container-id', ViewLayout.Grid, 'database-id');

    container.extra = {
      ...container.extra,
      embedded: true,
      is_database_container: true,
    };
    container.has_children = true;

    expect(resolvePermissionProbeTarget('container-id', container)).toEqual({
      collabObjectId: 'container-id',
      collabType: Types.Document,
    });
  });

  it('accepts a complete object-permission response for the requested target', () => {
    expect(
      isCollabObjectPermissionForTarget(createPermission(), {
        collabObjectId: 'document-id',
        collabType: Types.Document,
      })
    ).toBe(true);
  });

  it.each([
    [{ ...createPermission(), can_write: undefined }],
    [{ ...createPermission(), object_id: 'different-id' }],
    [{ ...createPermission(), collab_type: Types.Database }],
  ])('rejects incomplete or mismatched object-permission responses', (permission) => {
    expect(
      isCollabObjectPermissionForTarget(permission, {
        collabObjectId: 'document-id',
        collabType: Types.Document,
      })
    ).toBe(false);
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
