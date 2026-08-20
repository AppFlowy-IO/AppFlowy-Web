import { getWorkspaceDatabaseCatalog, refreshWorkspaceDatabaseCatalog } from '@/application/services/domains/view';
import { WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { View, ViewLayout } from '@/application/types';

import { buildRelationDatabaseCandidates, loadRelationDatabaseCandidates } from './relationDatabaseCandidates';

jest.mock('@/application/services/domains/view', () => ({
  databaseCatalogViewToView: (databaseId: string, view: WorkspaceDatabaseWithViews['views'][number]) => ({
    view_id: view.view_id,
    name: view.name,
    icon: view.icon,
    layout: view.layout,
    extra: {
      database_id: databaseId,
      embedded: view.embedded,
      is_database_container: view.is_container,
      is_space: false,
    },
    children: [],
    is_published: false,
    is_private: false,
    parent_view_id: view.parent_view_id ?? undefined,
  }),
  getDatabaseContainerEntries: (databases: WorkspaceDatabaseWithViews[]) =>
    databases.flatMap((database) => {
      const container = database.views.find((view) => view.is_container);
      const primaryView =
        database.views.find((view) => !view.is_container && !view.embedded) ??
        database.views.find((view) => !view.is_container);

      return container && primaryView ? [{ databaseId: database.database_id, container, primaryView }] : [];
    }),
  getWorkspaceDatabaseCatalog: jest.fn(),
  refreshWorkspaceDatabaseCatalog: jest.fn(),
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

function remoteDatabase(databaseId: string, name: string): WorkspaceDatabaseWithViews {
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
  });

  it('shows one server database under its container name', async () => {
    const database = remoteDatabase('database-1', 'Projects');
    const grid = makeView({
      viewId: 'database-1-grid',
      name: 'Grid',
      databaseId: 'database-1',
      parentViewId: 'database-1-container',
    });
    const container = makeView({
      viewId: 'database-1-container',
      name: 'Projects',
      databaseId: 'database-1',
      parentViewId: 'space-1',
      isContainer: true,
      children: [grid],
    });
    const space = makeView({ viewId: 'space-1', name: 'General', children: [container] });

    jest.mocked(getWorkspaceDatabaseCatalog).mockResolvedValue([database]);

    const result = await loadRelationDatabaseCandidates({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([space]),
    });

    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledWith('workspace-1');
    expect(result.candidates).toEqual([
      expect.objectContaining({
        databaseId: 'database-1',
        viewId: 'database-1-grid',
        displayView: expect.objectContaining({
          view_id: 'database-1-container',
          name: 'Projects',
          extra: expect.objectContaining({ is_database_container: true }),
        }),
        path: ['General', 'Projects'],
      }),
    ]);
    expect(result.relations).toEqual({ 'database-1': 'database-1-grid' });
  });

  it('uses fresh outline metadata when the catalog still has the previous database name', () => {
    const database = remoteDatabase('database-1', 'Projects');
    const grid = makeView({
      viewId: 'database-1-grid',
      name: 'Grid',
      databaseId: 'database-1',
      parentViewId: 'database-1-container',
    });
    const container = makeView({
      viewId: 'database-1-container',
      name: 'Renamed Projects',
      databaseId: 'database-1',
      parentViewId: 'space-1',
      isContainer: true,
      children: [grid],
    });
    const space = makeView({ viewId: 'space-1', name: 'General', children: [container] });

    const result = buildRelationDatabaseCandidates([database], [space]);

    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        displayView: expect.objectContaining({
          view_id: 'database-1-container',
          name: 'Renamed Projects',
          extra: expect.objectContaining({
            database_id: 'database-1',
            is_database_container: true,
          }),
        }),
        path: ['General', 'Renamed Projects'],
      })
    );
  });

  it('uses an explicit authoritative refresh for a user-opened picker', async () => {
    const database = remoteDatabase('database-1', 'Projects');

    jest.mocked(refreshWorkspaceDatabaseCatalog).mockResolvedValue([database]);

    await loadRelationDatabaseCandidates({ workspaceId: 'workspace-1', refreshCatalog: true });

    expect(refreshWorkspaceDatabaseCatalog).toHaveBeenCalledWith('workspace-1');
    expect(getWorkspaceDatabaseCatalog).not.toHaveBeenCalled();
  });

  it('does not expose databases without a container', async () => {
    const database = remoteDatabase('database-1', 'Projects');

    database.views = database.views.filter((view) => !view.is_container);
    jest.mocked(getWorkspaceDatabaseCatalog).mockResolvedValue([database]);

    const result = await loadRelationDatabaseCandidates({ workspaceId: 'workspace-1' });

    expect(result.candidates).toEqual([]);
    expect(result.relations).toEqual({});
  });

  it('does not merge outline-only databases into the web catalog', async () => {
    const localContainer = makeView({
      viewId: 'local-container',
      name: 'Local database',
      databaseId: 'local-database',
      isContainer: true,
    });

    jest.mocked(getWorkspaceDatabaseCatalog).mockResolvedValue([]);

    const result = await loadRelationDatabaseCandidates({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([localContainer]),
    });

    expect(result.candidates).toEqual([]);
  });

  it('does not substitute folder data when the server catalog request fails', async () => {
    jest.mocked(getWorkspaceDatabaseCatalog).mockRejectedValue(new Error('Unavailable'));

    await expect(
      loadRelationDatabaseCandidates({
        workspaceId: 'workspace-1',
        loadViews: jest.fn().mockResolvedValue([]),
      })
    ).rejects.toThrow('Unavailable');
  });
});
