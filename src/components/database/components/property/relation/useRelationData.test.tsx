import { EventEmitter } from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { parseRelationTypeOption, useDatabaseContext, useFieldSelector } from '@/application/database-yjs';
import {
  getCachedWorkspaceDatabaseCatalog,
  getDatabaseContainerEntries,
  getWorkspaceDatabaseCatalog,
} from '@/application/services/domains/view';
import { WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { getTokenParsed } from '@/application/session/token';
import { View, ViewLayout } from '@/application/types';

import { clearRelationViewsCache, useRelationData } from './useRelationData';

const updateTypeOption = jest.fn();
const mockCatalogListeners = new Set<() => void>();
let mockCatalogRevision = 0;
const workspaceCatalog: WorkspaceDatabaseWithViews[] = [
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
];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

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
  getCachedWorkspaceDatabaseCatalog: jest.fn(),
  getDatabaseContainerEntries: jest.fn((databases: WorkspaceDatabaseWithViews[]) =>
    databases.flatMap((database) => {
      const container = database.views.find((view) => view.is_container);
      const primaryView =
        database.views.find((view) => !view.is_container && !view.embedded) ??
        database.views.find((view) => !view.is_container);

      return container && primaryView ? [{ databaseId: database.database_id, container, primaryView }] : [];
    })
  ),
  getDatabasePrimaryView: jest.fn(
    (database: WorkspaceDatabaseWithViews) =>
      database.views.find((view) => !view.is_container && !view.embedded) ??
      database.views.find((view) => !view.is_container)
  ),
  getWorkspaceDatabaseCatalogRevision: jest.fn(() => String(mockCatalogRevision)),
  getWorkspaceDatabaseCatalog: jest.fn(),
  subscribeWorkspaceDatabaseCatalog: jest.fn((listener: () => void) => {
    mockCatalogListeners.add(listener);
    return () => mockCatalogListeners.delete(listener);
  }),
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
}));

function mockWorkspaceCatalog(catalog: WorkspaceDatabaseWithViews[]): void {
  jest.mocked(getCachedWorkspaceDatabaseCatalog).mockReturnValue(catalog);
  jest.mocked(getWorkspaceDatabaseCatalog).mockResolvedValue(catalog);
}

function publishMockWorkspaceCatalog(catalog: WorkspaceDatabaseWithViews[] | undefined): void {
  jest.mocked(getCachedWorkspaceDatabaseCatalog).mockReturnValue(catalog);
  mockCatalogRevision += 1;
  Array.from(mockCatalogListeners).forEach((listener) => listener());
}

describe('useRelationData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCatalogListeners.clear();
    mockCatalogRevision = 0;
    clearRelationViewsCache();
    jest.mocked(useFieldSelector).mockReturnValue({ field: {} } as never);
    jest.mocked(parseRelationTypeOption).mockReturnValue({ database_id: 'database-1' } as never);
    jest.mocked(getTokenParsed).mockReturnValue({
      user: { email: 'current-user@appflowy.io', id: 'user-id' },
    } as never);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
    } as never);
    mockWorkspaceCatalog(workspaceCatalog);
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

  it('waits for the catalog before skipping fallback metadata for a catalogued target', async () => {
    const catalog = deferred<WorkspaceDatabaseWithViews[]>();
    const getViewIdFromDatabaseId = jest.fn().mockResolvedValue('grid-1');
    const loadViewMeta = jest.fn();

    jest.mocked(getWorkspaceDatabaseCatalog).mockReturnValue(catalog.promise);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId,
      loadViewMeta,
    } as never);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRelationData('field-1', { enabled }),
      { initialProps: { enabled: false } }
    );

    expect(getWorkspaceDatabaseCatalog).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(true);
    expect(getViewIdFromDatabaseId).not.toHaveBeenCalled();
    expect(loadViewMeta).not.toHaveBeenCalled();

    await act(async () => {
      catalog.resolve(workspaceCatalog);
      await catalog.promise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledWith('workspace-1');
    expect(result.current.selectedView?.name).toBe('Projects');
    expect(getViewIdFromDatabaseId).not.toHaveBeenCalled();
    expect(loadViewMeta).not.toHaveBeenCalled();
  });

  it('waits for the catalog before loading legacy fallback metadata once', async () => {
    const catalog = deferred<WorkspaceDatabaseWithViews[]>();
    const emptyCatalog: WorkspaceDatabaseWithViews[] = [];
    const primaryView: View = {
      view_id: 'grid-1',
      name: 'Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
    };
    const getViewIdFromDatabaseId = jest.fn().mockResolvedValue(primaryView.view_id);
    const loadViewMeta = jest.fn().mockResolvedValue(primaryView);

    jest.mocked(getCachedWorkspaceDatabaseCatalog).mockReturnValue(emptyCatalog);
    jest.mocked(getWorkspaceDatabaseCatalog).mockReturnValue(catalog.promise);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId,
      loadViewMeta,
    } as never);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRelationData('field-1', { enabled }),
      { initialProps: { enabled: false } }
    );

    rerender({ enabled: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(true);
    expect(getViewIdFromDatabaseId).not.toHaveBeenCalled();
    expect(loadViewMeta).not.toHaveBeenCalled();

    await act(async () => {
      catalog.resolve(emptyCatalog);
      await catalog.promise;
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Tasks'));

    expect(result.current.loading).toBe(false);
    expect(getViewIdFromDatabaseId).toHaveBeenCalledTimes(1);
    expect(loadViewMeta).toHaveBeenCalledTimes(1);
    expect(loadViewMeta).toHaveBeenCalledWith(primaryView.view_id, undefined, { metadataOnly: true });
  });

  it('uses a catalog primary-view mapping without requesting the missing container mapping', async () => {
    const incompleteCatalog: WorkspaceDatabaseWithViews[] = [
      {
        ...workspaceCatalog[0],
        views: workspaceCatalog[0].views.filter((view) => !view.is_container),
      },
    ];
    const primaryView: View = {
      view_id: 'grid-1',
      name: 'Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
    };
    const getViewIdFromDatabaseId = jest.fn().mockResolvedValue(primaryView.view_id);
    const loadViewMeta = jest.fn().mockResolvedValue(primaryView);

    mockWorkspaceCatalog(incompleteCatalog);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId,
      loadViewMeta,
    } as never);

    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Tasks'));

    expect(result.current.databaseCandidates).toEqual([]);
    expect(result.current.relations).toEqual({ 'database-1': primaryView.view_id });
    expect(result.current.relatedViewId).toBe(primaryView.view_id);
    expect(getViewIdFromDatabaseId).not.toHaveBeenCalled();
    expect(loadViewMeta).toHaveBeenCalledWith(primaryView.view_id, undefined, { metadataOnly: true });
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

  it('publishes the latest outline from a replacement loadViews closure while the catalog is pending', async () => {
    const eventEmitter = new EventEmitter();
    const catalog = deferred<WorkspaceDatabaseWithViews[]>();
    const initialOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Old Projects',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];
    const latestOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Current Projects',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];
    const loadInitialViews = jest.fn().mockResolvedValue(initialOutline);
    const loadLatestViews = jest.fn().mockResolvedValue(latestOutline);

    jest.mocked(getCachedWorkspaceDatabaseCatalog).mockReturnValue(undefined);
    jest.mocked(getWorkspaceDatabaseCatalog).mockReturnValue(catalog.promise);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: loadInitialViews,
      eventEmitter,
    } as never);

    const { result, rerender } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(loadInitialViews).toHaveBeenCalledTimes(1));

    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: loadLatestViews,
      eventEmitter,
    } as never);
    rerender();

    act(() => {
      eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, latestOutline);
    });

    await act(async () => {
      publishMockWorkspaceCatalog(workspaceCatalog);
      catalog.resolve(workspaceCatalog);
      await catalog.promise;
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Current Projects'));

    expect(loadInitialViews).toHaveBeenCalledTimes(1);
    expect(loadLatestViews).toHaveBeenCalledTimes(1);
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(getDatabaseContainerEntries).toHaveBeenCalledTimes(2);
  });

  it('uses a new header loader after the request creator unmounts', async () => {
    const eventEmitter = new EventEmitter();
    const catalog = deferred<WorkspaceDatabaseWithViews[]>();
    const creatorOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Creator Projects',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];
    const replacementOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Replacement Projects',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];
    const creatorLoader = jest.fn().mockResolvedValue(creatorOutline);
    const replacementLoader = jest.fn().mockResolvedValue(replacementOutline);

    jest.mocked(getCachedWorkspaceDatabaseCatalog).mockReturnValue(undefined);
    jest.mocked(getWorkspaceDatabaseCatalog).mockReturnValue(catalog.promise);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: creatorLoader,
      eventEmitter,
    } as never);

    const creator = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(creatorLoader).toHaveBeenCalledTimes(1));
    creator.unmount();

    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: replacementLoader,
      eventEmitter,
    } as never);
    const replacement = renderHook(() => useRelationData('field-1'));

    await act(async () => {
      publishMockWorkspaceCatalog(workspaceCatalog);
      catalog.resolve(workspaceCatalog);
      await catalog.promise;
    });

    await waitFor(() => expect(replacement.result.current.selectedView?.name).toBe('Replacement Projects'));
    expect(creatorLoader).toHaveBeenCalledTimes(1);
    expect(replacementLoader).toHaveBeenCalledTimes(1);
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
  });

  it('commits an outline event that lands after the final loader result but before candidate publish', async () => {
    const eventEmitter = new EventEmitter();
    const catalog = deferred<WorkspaceDatabaseWithViews[]>();
    const initialOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Initial Projects',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];
    const loaderOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Loader Projects',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];
    const eventOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Event Projects',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];
    const initialLoader = jest.fn().mockResolvedValue(initialOutline);
    const replacementLoader = jest.fn(
      () =>
        ({
          then: (resolve: (outline: View[]) => void) => {
            // Promise assimilation schedules the loader consumer first. The
            // event then lands after loadLatestCandidateOutline accepts B but
            // before the request continuation publishes B.
            resolve(loaderOutline);
            queueMicrotask(() => eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, eventOutline));
          },
        }) as Promise<View[]>
    );

    jest.mocked(getCachedWorkspaceDatabaseCatalog).mockReturnValue(undefined);
    jest.mocked(getWorkspaceDatabaseCatalog).mockReturnValue(catalog.promise);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: initialLoader,
      eventEmitter,
    } as never);

    const { result, rerender } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(initialLoader).toHaveBeenCalledTimes(1));
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: replacementLoader,
      eventEmitter,
    } as never);
    rerender();

    await act(async () => {
      publishMockWorkspaceCatalog(workspaceCatalog);
      catalog.resolve(workspaceCatalog);
      await catalog.promise;
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Event Projects'));
    expect(replacementLoader).toHaveBeenCalledTimes(1);
  });

  it('retries once against a replacement catalog when the pending snapshot becomes stale', async () => {
    const staleCatalog = deferred<WorkspaceDatabaseWithViews[]>();
    const staleOutline = deferred<View[]>();
    const outline: View[] = [];
    const replacementCatalog = workspaceCatalog.map((database) => ({
      ...database,
      views: database.views.map((view) => (view.is_container ? { ...view, name: 'Current Projects' } : view)),
    }));
    const loadViews = jest
      .fn<Promise<View[]>, []>()
      .mockReturnValueOnce(staleOutline.promise)
      .mockResolvedValue(outline);

    jest.mocked(getWorkspaceDatabaseCatalog).mockReturnValueOnce(staleCatalog.promise).mockResolvedValue(replacementCatalog);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews,
    } as never);

    const committedNames: string[] = [];
    const { result } = renderHook(() => {
      const relationData = useRelationData('field-1');

      useLayoutEffect(() => {
        if (relationData.selectedView?.name) committedNames.push(relationData.selectedView.name);
      }, [relationData.selectedView]);

      return relationData;
    });

    await waitFor(() => {
      expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
      expect(loadViews).toHaveBeenCalledTimes(1);
    });

    act(() => {
      publishMockWorkspaceCatalog(replacementCatalog);
    });

    await act(async () => {
      staleOutline.resolve(outline);
      staleCatalog.resolve(workspaceCatalog);
      await Promise.all([staleOutline.promise, staleCatalog.promise]);
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Current Projects'));

    expect(committedNames).toEqual(['Current Projects']);
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(2);
    expect(loadViews).toHaveBeenCalledTimes(2);
    expect(getDatabaseContainerEntries).toHaveBeenCalledTimes(2);
  });

  it('starts a replacement request when invalidation leaves no catalog snapshot while the outline is pending', async () => {
    const initialCatalog = deferred<WorkspaceDatabaseWithViews[]>();
    const initialOutline = deferred<View[]>();
    const replacementCatalog = deferred<WorkspaceDatabaseWithViews[]>();
    const replacement = workspaceCatalog.map((database) => ({
      ...database,
      views: database.views.map((view) =>
        view.is_container ? { ...view, name: 'Replacement Projects' } : view
      ),
    }));
    const loadViews = jest.fn<Promise<View[]>, []>().mockReturnValueOnce(initialOutline.promise).mockResolvedValue([]);

    jest.mocked(getCachedWorkspaceDatabaseCatalog).mockReturnValue(undefined);
    jest
      .mocked(getWorkspaceDatabaseCatalog)
      .mockReturnValueOnce(initialCatalog.promise)
      .mockReturnValueOnce(replacementCatalog.promise);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews,
    } as never);

    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => {
      expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
      expect(loadViews).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      publishMockWorkspaceCatalog(workspaceCatalog);
      initialCatalog.resolve(workspaceCatalog);
      await initialCatalog.promise;
    });

    act(() => {
      publishMockWorkspaceCatalog(undefined);
    });

    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);

    await act(async () => {
      initialOutline.resolve([]);
      await initialOutline.promise;
    });

    await waitFor(() => expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(2));
    expect(result.current.loading).toBe(true);

    await act(async () => {
      publishMockWorkspaceCatalog(replacement);
      replacementCatalog.resolve(replacement);
      await replacementCatalog.promise;
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Replacement Projects'));
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(2);
  });

  it('checks the current outline once when cached headers remount after a listener gap', async () => {
    const eventEmitter = new EventEmitter();
    const initialOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Projects',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];
    const renamedOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Renamed Projects',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];
    let currentOutline = initialOutline;
    const loadViews = jest.fn(async () => currentOutline);

    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews,
      eventEmitter,
    } as never);

    const mountHeaders = () =>
      renderHook(() => ({
        normalHeader: useRelationData('field-1'),
        stickyHeader: useRelationData('field-1'),
      }));
    const initialHeaders = mountHeaders();

    await waitFor(() => expect(initialHeaders.result.current.normalHeader.selectedView?.name).toBe('Projects'));
    expect(loadViews).toHaveBeenCalledTimes(2);
    initialHeaders.unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(0);

    currentOutline = renamedOutline;
    const remountedHeaders = mountHeaders();

    await waitFor(() => {
      expect(remountedHeaders.result.current.normalHeader.selectedView?.name).toBe('Renamed Projects');
      expect(remountedHeaders.result.current.stickyHeader.selectedView?.name).toBe('Renamed Projects');
    });

    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(loadViews).toHaveBeenCalledTimes(3);
    expect(getDatabaseContainerEntries).toHaveBeenCalledTimes(2);
    expect(eventEmitter.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_REVOKED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_RESTORED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.PERMISSION_CHANGED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.SHARE_VIEWS_CHANGED)).toBe(1);

    remountedHeaders.unmount();
  });

  it('shares one candidate request and one physical event binding across concurrent headers', async () => {
    const eventEmitter = new EventEmitter();
    const catalog = deferred<WorkspaceDatabaseWithViews[]>();
    const outline: View[] = [];
    const loadViews = jest.fn().mockResolvedValue(outline);

    jest.mocked(getCachedWorkspaceDatabaseCatalog).mockReturnValue(undefined);
    jest.mocked(getWorkspaceDatabaseCatalog).mockReturnValue(catalog.promise);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews,
      eventEmitter,
    } as never);

    const headers = Array.from({ length: 12 }, () => renderHook(() => useRelationData('field-1')));

    expect(eventEmitter.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_REVOKED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_RESTORED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.PERMISSION_CHANGED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.SHARE_VIEWS_CHANGED)).toBe(1);
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(loadViews).toHaveBeenCalledTimes(1);

    await act(async () => {
      publishMockWorkspaceCatalog(workspaceCatalog);
      catalog.resolve(workspaceCatalog);
      await catalog.promise;
    });

    await waitFor(() => {
      headers.forEach((header) => expect(header.result.current.selectedView?.name).toBe('Projects'));
    });

    expect(loadViews).toHaveBeenCalledTimes(2);
    expect(getDatabaseContainerEntries).toHaveBeenCalledTimes(1);

    const updatedOutline: View[] = [
      {
        view_id: 'container-1',
        name: 'Projects from event',
        children: [{ view_id: 'grid-1', name: 'Grid', children: [] }],
      } as View,
    ];

    act(() => {
      eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, updatedOutline);
    });

    await waitFor(() => {
      headers.forEach((header) => expect(header.result.current.selectedView?.name).toBe('Projects from event'));
    });
    expect(getDatabaseContainerEntries).toHaveBeenCalledTimes(2);

    headers.forEach((header) => header.unmount());
    expect(eventEmitter.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(0);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(0);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_REVOKED)).toBe(0);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_RESTORED)).toBe(0);
    expect(eventEmitter.listenerCount(APP_EVENTS.PERMISSION_CHANGED)).toBe(0);
    expect(eventEmitter.listenerCount(APP_EVENTS.SHARE_VIEWS_CHANGED)).toBe(0);
  });

  it('coordinates one rebuild when a mounted catalog snapshot is invalidated and replaced', async () => {
    const eventEmitter = new EventEmitter();
    const outline: View[] = [];
    const loadViews = jest.fn().mockResolvedValue(outline);

    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews,
      eventEmitter,
    } as never);

    const headers = renderHook(() => ({
      normalHeader: useRelationData('field-1'),
      stickyHeader: useRelationData('field-1'),
    }));

    await waitFor(() => expect(headers.result.current.normalHeader.selectedView?.name).toBe('Projects'));

    const replacementCatalog = workspaceCatalog.map((database) => ({
      ...database,
      views: database.views.map((view) => (view.is_container ? { ...view, name: 'Renamed Projects' } : view)),
    }));
    const replacement = deferred<WorkspaceDatabaseWithViews[]>();

    jest.mocked(getWorkspaceDatabaseCatalog).mockReturnValue(replacement.promise);

    act(() => {
      publishMockWorkspaceCatalog(undefined);
    });

    await waitFor(() => {
      expect(headers.result.current.normalHeader.loading).toBe(true);
      expect(headers.result.current.stickyHeader.loading).toBe(true);
      expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      publishMockWorkspaceCatalog(replacementCatalog);
      replacement.resolve(replacementCatalog);
      await replacement.promise;
    });

    await waitFor(() => {
      expect(headers.result.current.normalHeader.selectedView?.name).toBe('Renamed Projects');
      expect(headers.result.current.stickyHeader.selectedView?.name).toBe('Renamed Projects');
    });

    expect(loadViews).toHaveBeenCalledTimes(5);
    expect(getDatabaseContainerEntries).toHaveBeenCalledTimes(2);
    expect(eventEmitter.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(1);

    headers.unmount();
  });

  it('retries an initial catalog failure after an undefined-to-undefined invalidation revision', async () => {
    const eventEmitter = new EventEmitter();

    jest.mocked(getCachedWorkspaceDatabaseCatalog).mockReturnValue(undefined);
    jest
      .mocked(getWorkspaceDatabaseCatalog)
      .mockRejectedValueOnce(new Error('Temporary catalog failure'))
      .mockImplementationOnce(async () => {
        publishMockWorkspaceCatalog(workspaceCatalog);
        return workspaceCatalog;
      });
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      eventEmitter,
    } as never);

    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
    });
    expect(result.current.selectedView).toBeUndefined();

    act(() => {
      // The data snapshot is still undefined. Only the external-store revision
      // distinguishes this invalidation from the failed initial read.
      publishMockWorkspaceCatalog(undefined);
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Projects'));
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(2);
  });

  it('keeps uncatalogued child metadata when an inaccessible parent is retried across header remounts', async () => {
    const eventEmitter = new EventEmitter();
    const loadViews = jest.fn().mockResolvedValue([]);
    const primaryView: View = {
      view_id: 'grid-1',
      name: 'Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
      parent_view_id: 'missing-container-1',
    };
    const getViewIdFromDatabaseId = jest.fn().mockResolvedValue(primaryView.view_id);
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === primaryView.view_id) return primaryView;
      if (viewId === primaryView.parent_view_id) throw new Error('Parent is inaccessible');
      return null;
    });

    // Legacy relation metadata can resolve a primary view even when the
    // server database list does not contain the database or its inaccessible
    // container. Every virtualized header must retain that valid child even
    // when the optional parent lookup fails.
    mockWorkspaceCatalog([]);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews,
      getViewIdFromDatabaseId,
      loadViewMeta,
      eventEmitter,
    } as never);

    const mountHeaders = () =>
      renderHook(() => ({
        normalHeader: useRelationData('field-1'),
        stickyHeader: useRelationData('field-1'),
      }));
    const firstMount = mountHeaders();

    await waitFor(() => {
      expect(firstMount.result.current.normalHeader.selectedView?.name).toBe('Tasks');
      expect(firstMount.result.current.stickyHeader.selectedView?.name).toBe('Tasks');
    });
    expect(eventEmitter.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(1);

    firstMount.unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(0);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(0);

    const remountedHeaders = mountHeaders();

    await waitFor(() => {
      expect(remountedHeaders.result.current.normalHeader.selectedView?.name).toBe('Tasks');
      expect(remountedHeaders.result.current.stickyHeader.selectedView?.name).toBe('Tasks');
    });

    expect(loadViewMeta).toHaveBeenCalledWith(primaryView.view_id, undefined, { metadataOnly: true });
    expect(loadViewMeta).toHaveBeenCalledWith(primaryView.parent_view_id, undefined, { metadataOnly: true });
    expect(getWorkspaceDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(loadViews).toHaveBeenCalledTimes(3);
    expect(getDatabaseContainerEntries).toHaveBeenCalledTimes(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(1);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(1);

    remountedHeaders.unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.OUTLINE_LOADED)).toBe(0);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_META_CHANGED)).toBe(0);
  });

  it('shows uncatalogued child metadata while the optional parent lookup is pending', async () => {
    const primaryView: View = {
      view_id: 'grid-1',
      name: 'Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
      parent_view_id: 'container-1',
    };
    const parentView: View = {
      ...primaryView,
      view_id: 'container-1',
      name: 'Projects',
      parent_view_id: undefined,
    };
    const parent = deferred<View | null>();
    const loadViewMeta = jest.fn((viewId: string) => {
      if (viewId === primaryView.view_id) return Promise.resolve(primaryView);
      if (viewId === parentView.view_id) return parent.promise;
      return Promise.resolve(null);
    });

    mockWorkspaceCatalog([]);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId: jest.fn().mockResolvedValue(primaryView.view_id),
      loadViewMeta,
    } as never);

    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Tasks'));

    await act(async () => {
      parent.resolve(parentView);
      await parent.promise;
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Projects'));
  });

  it('refreshes a mounted uncatalogued header only for matching child or parent metadata changes', async () => {
    const eventEmitter = new EventEmitter();
    let childView: View = {
      view_id: 'grid-1',
      name: 'Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
      parent_view_id: 'container-1',
    };
    let parentView: View = {
      ...childView,
      view_id: 'container-1',
      name: 'Projects',
      parent_view_id: undefined,
    };
    let parentAccessible = true;
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === childView.view_id) return childView;
      if (viewId === parentView.view_id) {
        if (!parentAccessible) throw new Error('Parent is inaccessible');
        return parentView;
      }

      return null;
    });

    mockWorkspaceCatalog([]);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId: jest.fn().mockResolvedValue(childView.view_id),
      loadViewMeta,
      eventEmitter,
    } as never);

    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Projects'));

    const callsBeforeUnrelatedChange = loadViewMeta.mock.calls.length;

    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, {
        ...childView,
        view_id: 'unrelated-view',
        name: 'Unrelated',
      });
    });

    expect(loadViewMeta).toHaveBeenCalledTimes(callsBeforeUnrelatedChange);

    parentView = { ...parentView, name: 'Renamed Projects' };
    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, parentView);
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Renamed Projects'));

    childView = { ...childView, name: 'Renamed Tasks' };
    parentAccessible = false;
    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, childView);
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Renamed Tasks'));
  });

  it('authoritatively revalidates an off-outline fallback after an ancestor share refresh', async () => {
    const eventEmitter = new EventEmitter();
    const staleView: View = {
      view_id: 'grid-1',
      name: 'Stale Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
    };
    const freshView = { ...staleView, name: 'Fresh Tasks' };
    const loadViewMeta = jest.fn(
      async (_viewId: string, _callback?: unknown, options?: { authoritative?: boolean }) =>
        options?.authoritative ? freshView : staleView
    );

    mockWorkspaceCatalog([]);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId: jest.fn().mockResolvedValue(staleView.view_id),
      loadViewMeta,
      eventEmitter,
    } as never);

    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Stale Tasks'));

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, { viewId: 'grandparent-space' });
    });

    expect(result.current.selectedView).toBeUndefined();
    expect(loadViewMeta).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, []);
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Fresh Tasks'));
    expect(loadViewMeta).toHaveBeenCalledTimes(2);
    expect(loadViewMeta).toHaveBeenLastCalledWith(staleView.view_id, undefined, {
      authoritative: true,
      metadataOnly: true,
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group' });
    });
    expect(result.current.selectedView).toBeUndefined();

    await act(async () => {
      await Promise.resolve();
      eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, []);
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Fresh Tasks'));
    expect(loadViewMeta).toHaveBeenCalledTimes(3);
    expect(loadViewMeta).toHaveBeenLastCalledWith(staleView.view_id, undefined, {
      authoritative: true,
      metadataOnly: true,
    });
  });

  it('keeps an off-outline fallback mounted for a share proven unrelated to the current user', async () => {
    const eventEmitter = new EventEmitter();
    const fallbackView: View = {
      view_id: 'grid-1',
      name: 'Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
    };
    const loadViewMeta = jest.fn().mockResolvedValue(fallbackView);

    mockWorkspaceCatalog([]);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId: jest.fn().mockResolvedValue(fallbackView.view_id),
      loadViewMeta,
      eventEmitter,
    } as never);

    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Tasks'));

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: 'ancestor-space',
        emails: ['other-user@appflowy.io'],
      });
    });

    expect(result.current.selectedView?.name).toBe('Tasks');
    expect(loadViewMeta).toHaveBeenCalledTimes(1);
  });

  it('clears mounted fallback metadata on revoke and waits for a matching restore before reloading', async () => {
    const eventEmitter = new EventEmitter();
    const primaryView: View = {
      view_id: 'grid-1',
      name: 'Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
    };
    let revoked = false;
    const loadViewMeta = jest.fn(async () => {
      if (revoked) throw new Error('Access revoked');
      return primaryView;
    });

    mockWorkspaceCatalog([]);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId: jest.fn().mockResolvedValue(primaryView.view_id),
      loadViewMeta,
      eventEmitter,
    } as never);

    const { result, unmount } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Tasks'));
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_REVOKED)).toBe(1);

    revoked = true;
    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: primaryView.view_id });
    });

    expect(result.current.selectedView).toBeUndefined();
    expect(loadViewMeta).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
    });
    expect(loadViewMeta).toHaveBeenCalledTimes(1);

    act(() => {
      eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, [primaryView]);
    });
    expect(loadViewMeta).toHaveBeenCalledTimes(1);

    revoked = false;
    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: primaryView.view_id });
    });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Tasks'));
    expect(loadViewMeta).toHaveBeenCalledTimes(2);
    expect(loadViewMeta).toHaveBeenLastCalledWith(primaryView.view_id, undefined, { metadataOnly: true });

    unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_REVOKED)).toBe(0);
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_RESTORED)).toBe(0);
  });

  it('retires fallback metadata while disabled before reopening after an unobserved revoke', async () => {
    const eventEmitter = new EventEmitter();
    const primaryView: View = {
      view_id: 'grid-1',
      name: 'Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
    };
    let revoked = false;
    const loadViewMeta = jest.fn(async () => {
      if (revoked) throw new Error('Access revoked while the relation menu was closed');
      return primaryView;
    });

    mockWorkspaceCatalog([]);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId: jest.fn().mockResolvedValue(primaryView.view_id),
      loadViewMeta,
      eventEmitter,
    } as never);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRelationData('field-1', { enabled }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Tasks'));

    rerender({ enabled: false });

    await waitFor(() => {
      expect(result.current.selectedView).toBeUndefined();
      expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_REVOKED)).toBe(0);
    });

    revoked = true;
    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: primaryView.view_id });
    });

    rerender({ enabled: true });

    await waitFor(() => expect(loadViewMeta).toHaveBeenCalledTimes(2));
    expect(result.current.selectedView).toBeUndefined();
  });

  it('revalidates after a suspended fallback misses its restore event while disabled', async () => {
    const eventEmitter = new EventEmitter();
    const primaryView: View = {
      view_id: 'grid-1',
      name: 'Tasks',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-1',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
    };
    let revoked = false;
    const loadViewMeta = jest.fn(async () => {
      if (revoked) throw new Error('Access revoked');
      return primaryView;
    });

    mockWorkspaceCatalog([]);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId: jest.fn().mockResolvedValue(primaryView.view_id),
      loadViewMeta,
      eventEmitter,
    } as never);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRelationData('field-1', { enabled }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Tasks'));

    revoked = true;
    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_REVOKED, { viewId: primaryView.view_id });
    });
    expect(result.current.selectedView).toBeUndefined();

    rerender({ enabled: false });
    expect(eventEmitter.listenerCount(APP_EVENTS.VIEW_ACCESS_RESTORED)).toBe(0);

    revoked = false;
    act(() => {
      eventEmitter.emit(APP_EVENTS.VIEW_ACCESS_RESTORED, { viewId: primaryView.view_id });
    });

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Tasks'));
    expect(loadViewMeta).toHaveBeenCalledTimes(2);
  });

  it('never commits a selected view from the previous related database', async () => {
    const catalog: WorkspaceDatabaseWithViews[] = [
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
    ];

    mockWorkspaceCatalog(catalog);

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

  it('retires an optimistic selection after the authoritative candidate is observed', async () => {
    const { result } = renderHook(() => useRelationData('field-1'));

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Projects'));

    act(() => {
      result.current.setSelectedView({
        ...result.current.databaseCandidates[0].displayView,
        name: 'Optimistic Projects',
      });
    });

    // The catalog candidate remains authoritative and the optimistic copy is
    // retired rather than retained as a future fallback.
    expect(result.current.selectedView?.name).toBe('Projects');
    await act(async () => {
      await Promise.resolve();
      clearRelationViewsCache();
    });

    expect(result.current.selectedView).toBeUndefined();
  });

  it('ignores fallback metadata that resolves after the related database changes', async () => {
    const staleView = deferred<View | null>();
    const currentView: View = {
      view_id: 'grid-2',
      name: 'Customers',
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      extra: {
        database_id: 'database-2',
        is_database_container: false,
        is_space: false,
      },
      is_published: false,
      is_private: false,
    };
    const getViewIdFromDatabaseId = jest.fn(async (databaseId: string) =>
      databaseId === 'database-1' ? 'grid-1' : 'grid-2'
    );
    const loadViewMeta = jest.fn((viewId: string) =>
      viewId === 'grid-1' ? staleView.promise : Promise.resolve(currentView)
    );

    mockWorkspaceCatalog([]);
    jest.mocked(useDatabaseContext).mockReturnValue({
      workspaceId: 'workspace-1',
      loadViews: jest.fn().mockResolvedValue([]),
      getViewIdFromDatabaseId,
      loadViewMeta,
    } as never);

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

    await waitFor(() =>
      expect(loadViewMeta).toHaveBeenCalledWith('grid-1', undefined, { metadataOnly: true })
    );
    jest.mocked(parseRelationTypeOption).mockReturnValue({ database_id: 'database-2' } as never);
    rerender();

    await waitFor(() => expect(result.current.selectedView?.name).toBe('Customers'));

    await act(async () => {
      staleView.resolve({ ...currentView, view_id: 'grid-1', name: 'Old Projects' });
      await staleView.promise;
    });

    expect(result.current.relatedDatabaseId).toBe('database-2');
    expect(result.current.selectedView?.name).toBe('Customers');
    expect(committedSelections).not.toContainEqual({ databaseId: 'database-2', viewName: 'Old Projects' });
  });
});
