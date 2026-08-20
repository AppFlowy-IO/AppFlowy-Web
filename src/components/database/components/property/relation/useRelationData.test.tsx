import { EventEmitter } from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { parseRelationTypeOption, useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import { getWorkspaceDatabaseCatalog } from '@/application/services/domains/view';
import { WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { ViewLayout } from '@/application/types';

import { clearRelationViewsCache, useRelationData } from './useRelationData';

const updateTypeOption = jest.fn();

jest.mock('@/application/database-yjs', () => ({
  parseRelationTypeOption: jest.fn(),
  useDatabaseContext: jest.fn(),
  useFieldSelector: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch/relation', () => ({
  useUpdateRelationTypeOption: () => updateTypeOption,
}));

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
}));

describe('useRelationData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRelationViewsCache();
    jest.mocked(useFieldSelector).mockReturnValue({ field: {} } as never);
    jest.mocked(parseRelationTypeOption).mockReturnValue({ database_id: 'database-1' } as never);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
    } as never);
    jest.mocked(getWorkspaceDatabaseCatalog).mockResolvedValue([
      {
        database_id: 'database-1',
        views: [
          {
            view_id: 'container-1',
            layout: ViewLayout.Grid,
            is_container: true,
            embedded: false,
            name: 'Projects',
            icon: null,
            parent_view_id: null,
          },
          {
            view_id: 'grid-1',
            layout: ViewLayout.Grid,
            is_container: false,
            embedded: false,
            name: 'Grid',
            icon: null,
            parent_view_id: 'container-1',
          },
        ],
      },
    ]);
  });

  it('loads relation configuration choices from the new database-list API', async () => {
    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledWith('workspace-1');
    expect(result.current.databaseCandidates).toEqual([
      expect.objectContaining({
        databaseId: 'database-1',
        viewId: 'grid-1',
        displayView: expect.objectContaining({ name: 'Projects' }),
      }),
    ]);
    expect(result.current.selectedView?.name).toBe('Projects');
  });

  it('uses the shared catalog getter when a user-opened picker becomes enabled', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRelationData('field-1', { enabled }),
      { initialProps: { enabled: false } }
    );

    expect(getWorkspaceDatabaseCatalog).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledWith('workspace-1');
  });

  it('rebuilds candidate metadata from the outline event payload without refetching the catalog', async () => {
    const eventEmitter = new EventEmitter();

    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      eventEmitter,
    } as never);

    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(result.current.databaseCandidates[0]?.path).toEqual(['Projects']);

    const outline = [
      {
        view_id: 'space-1',
        name: 'Space',
        children: [
          {
            view_id: 'container-1',
            name: 'Renamed Projects',
            children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
          },
        ],
      },
    ];

    act(() => {
      eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, outline);
    });

    await waitFor(() => {
      expect(result.current.databaseCandidates[0]?.path).toEqual(['Space', 'Renamed Projects']);
      expect(result.current.databaseCandidates[0]?.displayView.name).toBe('Renamed Projects');
      expect(result.current.selectedView?.name).toBe('Renamed Projects');
    });
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
  });

  it('never commits a selected view from the previous related database', async () => {
    jest.mocked(getWorkspaceDatabaseCatalog).mockResolvedValue([
      {
        database_id: 'database-1',
        views: [
          {
            view_id: 'container-1',
            layout: ViewLayout.Grid,
            is_container: true,
            embedded: false,
            name: 'Projects',
            icon: null,
            parent_view_id: null,
          },
          {
            view_id: 'grid-1',
            layout: ViewLayout.Grid,
            is_container: false,
            embedded: false,
            name: 'Grid',
            icon: null,
            parent_view_id: 'container-1',
          },
        ],
      },
      {
        database_id: 'database-2',
        views: [
          {
            view_id: 'container-2',
            layout: ViewLayout.Grid,
            is_container: true,
            embedded: false,
            name: 'Customers',
            icon: null,
            parent_view_id: null,
          },
          {
            view_id: 'grid-2',
            layout: ViewLayout.Grid,
            is_container: false,
            embedded: false,
            name: 'Grid',
            icon: null,
            parent_view_id: 'container-2',
          },
        ],
      },
    ]);

    const committedSelections: Array<{ databaseId: string | null; viewName?: string }> = [];
    const { result, rerender } = renderHook(() => {
      const relationData = useRelationData('field-1');

      useLayoutEffect(() => {
        committedSelections.push({
          databaseId: relationData.relatedDatabaseId,
          viewName: relationData.selectedView?.name,
        });
      }, [relationData.relatedDatabaseId, relationData.selectedView]);

      return relationData;
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Projects'));
    committedSelections.length = 0;
    jest.mocked(parseRelationTypeOption).mockReturnValue({ database_id: 'database-2' } as never);

    rerender();

    expect(result.current.relatedDatabaseId).toBe('database-2');
    expect(result.current.selectedView?.name).toBe('Customers');
    expect(committedSelections).not.toContainEqual({ databaseId: 'database-2', viewName: 'Projects' });
  });
});
