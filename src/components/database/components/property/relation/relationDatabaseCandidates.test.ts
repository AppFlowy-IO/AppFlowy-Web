import { getMultiple as getViews, listDatabases } from '@/application/services/domains/view';
import { View, ViewLayout } from '@/application/types';

import { loadRelationDatabaseCandidates } from './relationDatabaseCandidates';

jest.mock('@/application/services/domains/view', () => ({
  getMultiple: jest.fn(),
  listDatabases: jest.fn(),
}));

function makeView({
  viewId,
  name,
  databaseId,
  parentViewId,
  isContainer = false,
  children = [],
}: {
  viewId: string;
  name: string;
  databaseId?: string;
  parentViewId?: string;
  isContainer?: boolean;
  children?: View[];
}): View {
  return {
    view_id: viewId,
    parent_view_id: parentViewId,
    name,
    layout: ViewLayout.Grid,
    children,
    icon: null,
    extra: databaseId
      ? {
          database_id: databaseId,
          is_database_container: isContainer,
          is_space: false,
        }
      : null,
    is_published: false,
    is_private: false,
  };
}

function remoteDatabase(databaseId: string, name: string) {
  return {
    database_id: databaseId,
    views: [
      {
        view_id: `${databaseId}-container`,
        layout: ViewLayout.Grid,
        is_container: true,
        embedded: false,
        name,
        icon: null,
        parent_view_id: 'space-1',
      },
      {
        view_id: `${databaseId}-grid`,
        layout: ViewLayout.Grid,
        is_container: false,
        embedded: false,
        name: 'Grid',
        icon: null,
        parent_view_id: `${databaseId}-container`,
      },
    ],
  };
}

describe('loadRelationDatabaseCandidates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getViews).mockResolvedValue([]);
  });

  it('uses database metadata from the new workspace database-list API', async () => {
    jest.mocked(listDatabases).mockResolvedValue([remoteDatabase('remote-database', 'Remote database')]);

    const result = await loadRelationDatabaseCandidates({
      workspaceId: 'workspace-1',
      loadDatabaseRelations: jest.fn().mockResolvedValue({}),
      loadViews: jest.fn().mockResolvedValue([]),
    });

    expect(listDatabases).toHaveBeenCalledWith('workspace-1');
    expect(result.candidates).toEqual([
      expect.objectContaining({
        databaseId: 'remote-database',
        viewId: 'remote-database-grid',
        displayView: expect.objectContaining({
          view_id: 'remote-database-container',
          name: 'Remote database',
        }),
      }),
    ]);
    expect(result.relations).toEqual({ 'remote-database': 'remote-database-grid' });
  });

  it('keeps a locally created database when the remote list is stale', async () => {
    jest.mocked(listDatabases).mockResolvedValue([remoteDatabase('remote-database', 'Stale server name')]);
    const remoteGrid = makeView({
      viewId: 'remote-database-grid',
      name: 'Grid',
      databaseId: 'remote-database',
      parentViewId: 'remote-database-container',
    });
    const remoteContainer = makeView({
      viewId: 'remote-database-container',
      name: 'Fresh local name',
      databaseId: 'remote-database',
      isContainer: true,
      children: [remoteGrid],
    });
    const offlineGrid = makeView({
      viewId: 'offline-grid',
      name: 'Grid',
      databaseId: 'offline-database',
      parentViewId: 'offline-container',
    });
    const offlineContainer = makeView({
      viewId: 'offline-container',
      name: 'Offline database',
      databaseId: 'offline-database',
      isContainer: true,
      children: [offlineGrid],
    });
    const space = makeView({
      viewId: 'space-1',
      name: 'General',
      children: [remoteContainer, offlineContainer],
    });

    const result = await loadRelationDatabaseCandidates({
      workspaceId: 'workspace-1',
      loadDatabaseRelations: jest.fn().mockResolvedValue({
        'remote-database': 'remote-database-grid',
        'offline-database': 'offline-grid',
      }),
      loadViews: jest.fn().mockResolvedValue([space]),
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find(({ databaseId }) => databaseId === 'remote-database')?.displayView.name).toBe(
      'Fresh local name'
    );
    expect(result.candidates.find(({ databaseId }) => databaseId === 'offline-database')).toEqual(
      expect.objectContaining({
        viewId: 'offline-grid',
        displayView: expect.objectContaining({ name: 'Offline database' }),
        path: ['General', 'Offline database'],
      })
    );
  });

  it('keeps a local database container while its first view is still syncing', async () => {
    jest.mocked(listDatabases).mockResolvedValue([]);
    const localContainer = makeView({
      viewId: 'local-container',
      name: 'Just created',
      databaseId: 'local-database',
      isContainer: true,
    });

    const result = await loadRelationDatabaseCandidates({
      workspaceId: 'workspace-1',
      loadDatabaseRelations: jest.fn().mockResolvedValue({}),
      loadViews: jest.fn().mockResolvedValue([localContainer]),
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        databaseId: 'local-database',
        viewId: 'local-container',
        displayView: expect.objectContaining({ name: 'Just created' }),
      }),
    ]);
  });

  it('does not restore legacy-only databases filtered by a successful server list', async () => {
    jest.mocked(listDatabases).mockResolvedValue([]);

    const result = await loadRelationDatabaseCandidates({
      workspaceId: 'workspace-1',
      loadDatabaseRelations: jest.fn().mockResolvedValue({ 'trashed-database': 'trashed-grid' }),
      loadViews: jest.fn().mockResolvedValue([]),
    });

    expect(getViews).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
  });

  it('falls back to legacy relation metadata when the new endpoint is unavailable', async () => {
    jest.mocked(listDatabases).mockRejectedValue(new Error('Not supported'));
    const legacyGrid = makeView({
      viewId: 'legacy-grid',
      name: 'Grid',
      databaseId: 'legacy-database',
      parentViewId: 'legacy-container',
    });
    const legacyContainer = makeView({
      viewId: 'legacy-container',
      name: 'Legacy database',
      databaseId: 'legacy-database',
      isContainer: true,
    });

    jest.mocked(getViews).mockResolvedValueOnce([legacyGrid]).mockResolvedValueOnce([legacyContainer]);

    const result = await loadRelationDatabaseCandidates({
      workspaceId: 'workspace-1',
      loadDatabaseRelations: jest.fn().mockResolvedValue({ 'legacy-database': 'legacy-grid' }),
      loadViews: jest.fn().mockResolvedValue([]),
    });

    expect(getViews).toHaveBeenNthCalledWith(1, 'workspace-1', ['legacy-grid'], 0);
    expect(getViews).toHaveBeenNthCalledWith(2, 'workspace-1', ['legacy-container'], 0);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        databaseId: 'legacy-database',
        displayView: expect.objectContaining({ name: 'Legacy database' }),
      })
    );
  });
});
