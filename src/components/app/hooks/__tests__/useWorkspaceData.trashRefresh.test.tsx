import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { APP_EVENTS } from '@/application/constants';
import { AccessService, ViewService } from '@/application/services/domains';
import { Role, View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';
import { Log } from '@/utils/log';

import { useWorkspaceData } from '../useWorkspaceData';

jest.mock('lodash-es', () => ({
  sortBy: (items: Record<string, unknown>[], key: string) =>
    [...items].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''))),
  uniqBy: (items: Record<string, unknown>[], key: string) => {
    const seen = new Set<unknown>();

    return items.filter((item) => {
      const value = item[key];

      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  },
}));
jest.mock('lodash-es/isEqual', () => jest.requireActual('lodash/isEqual'));

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    getShareWithMe: jest.fn(),
    invalidateShareDetailCache: jest.fn(),
  },
  ViewService: {
    get: jest.fn(),
    getDatabaseCatalog: jest.fn(),
    getDatabaseRelations: jest.fn(),
    getFavorites: jest.fn(),
    getMultiple: jest.fn(),
    getOutline: jest.fn(),
    getTrashCached: jest.fn(),
    refreshTrash: jest.fn(),
    invalidateDatabaseCatalog: jest.fn(),
    invalidateCache: jest.fn(),
  },
  WorkspaceService: {
    getMentionableUsers: jest.fn(),
  },
}));

const workspaceId = 'workspace-id';
const restoredViewId = 'restored-view-id';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const createView = (viewId: string, overrides: Partial<View> = {}): View => ({
  view_id: viewId,
  name: overrides.name ?? viewId,
  icon: overrides.icon ?? null,
  layout: overrides.layout ?? ViewLayout.Document,
  extra: overrides.extra ?? null,
  children: overrides.children ?? [],
  has_children: overrides.has_children,
  is_published: overrides.is_published ?? false,
  is_private: overrides.is_private ?? false,
  ...overrides,
});

function createWrapper(eventEmitter: EventEmitter) {
  const authContext: AuthInternalContextType = {
    currentWorkspaceId: workspaceId,
    isAuthenticated: true,
    onChangeWorkspace: jest.fn(),
    userWorkspaceInfo: {
      userId: 'user-id',
      selectedWorkspace: {
        id: workspaceId,
        databaseStorageId: 'database-storage-id',
        role: Role.Owner,
      },
    } as AuthInternalContextType['userWorkspaceInfo'],
  };

  const syncContext = {
    eventEmitter,
    awarenessMap: {},
    broadcastChannel: {},
    flushAllSync: jest.fn(),
    registerSyncContext: jest.fn(),
    revertCollabVersion: jest.fn(),
    scheduleDeferredCleanup: jest.fn(),
    syncAllToServer: jest.fn(),
    webSocket: {},
  } as unknown as SyncInternalContextType;

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AuthInternalContext.Provider value={authContext}>
          <SyncInternalContext.Provider value={syncContext}>
            {children}
          </SyncInternalContext.Provider>
        </AuthInternalContext.Provider>
      </MemoryRouter>
    );
  };
}

describe('useWorkspaceData trash refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (AccessService.getShareWithMe as jest.Mock).mockResolvedValue(null);
    (ViewService.getDatabaseCatalog as jest.Mock).mockResolvedValue([]);
    (ViewService.getDatabaseRelations as jest.Mock).mockResolvedValue({});
    (ViewService.getFavorites as jest.Mock).mockResolvedValue([]);
    (ViewService.getMultiple as jest.Mock).mockResolvedValue([]);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({
      outline: [],
      folderRid: '1-1',
    });
  });

  it('warms the shared database catalog once on workspace mount', async () => {
    const eventEmitter = new EventEmitter();

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    const { rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(ViewService.getDatabaseCatalog).toHaveBeenCalledWith(workspaceId);
    });

    rerender();
    expect(ViewService.getDatabaseCatalog).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale trash state when a remote restore adds the view back to the folder', async () => {
    const eventEmitter = new EventEmitter();
    const restoredView = createView(restoredViewId);
    let trashResponse: View[] = [restoredView];

    (ViewService.refreshTrash as jest.Mock).mockImplementation(async () => trashResponse);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.trashList?.map((view) => view.view_id)).toEqual([restoredViewId]);
    });

    const initialTrashRequestCount = (ViewService.refreshTrash as jest.Mock).mock.calls.length;

    trashResponse = [];

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 1,
        folderRid: '2-1',
        parentViewId: 'space-id',
        viewJson: JSON.stringify(restoredView),
      });
    });

    await waitFor(() => {
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(initialTrashRequestCount + 1);
      expect(result.current.trashList).toEqual([]);
    });
  });

  it('does not refresh trash when VIEW_ADDED creates a view that is not in known trash', async () => {
    const eventEmitter = new EventEmitter();

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);

    renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const initialTrashRequestCount = (ViewService.refreshTrash as jest.Mock).mock.calls.length;
    const newView = createView('new-row-document', {
      parent_view_id: 'new-row-document',
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 1,
        parentViewId: newView.view_id,
        viewJson: JSON.stringify(newView),
      });
      await Promise.resolve();
    });

    expect(ViewService.refreshTrash).toHaveBeenCalledTimes(initialTrashRequestCount);
    expect(ViewService.invalidateDatabaseCatalog).not.toHaveBeenCalled();
  });

  it('invalidates the shared catalog when a database view is added', async () => {
    const eventEmitter = new EventEmitter();
    const space = createView('space-id');

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [space], folderRid: '1-1' });
    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(ViewService.getDatabaseCatalog).toHaveBeenCalledTimes(1);
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    const databaseView = createView('database-view-id', {
      layout: ViewLayout.Grid,
      parent_view_id: 'space-id',
      extra: { database_id: 'database-id', is_space: false },
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 1,
        folderRid: '2-1',
        parentViewId: 'space-id',
        viewJson: JSON.stringify(databaseView),
      });
    });

    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledWith(workspaceId);
  });

  it('invalidates the catalog for a database VIEW_ADDED below an unloaded parent', async () => {
    const eventEmitter = new EventEmitter();

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(ViewService.getDatabaseCatalog).toHaveBeenCalledTimes(1);
    });

    const orphanDatabaseView = createView('orphan-database-view', {
      layout: ViewLayout.Grid,
      parent_view_id: 'unloaded-parent-view',
      extra: { database_id: 'orphan-database-id', is_space: false },
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 1,
        parentViewId: 'unloaded-parent-view',
        viewJson: JSON.stringify(orphanDatabaseView),
      });
    });

    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledWith(workspaceId);
  });

  it('does not invalidate the catalog for a self-parent document VIEW_ADDED notification', async () => {
    const eventEmitter = new EventEmitter();

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(ViewService.getDatabaseCatalog).toHaveBeenCalledTimes(1);
    });

    const rowDocumentView = createView('row-document-view', {
      layout: ViewLayout.Document,
      parent_view_id: 'row-document-view',
      extra: { is_space: false },
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 1,
        parentViewId: rowDocumentView.view_id,
        viewJson: JSON.stringify(rowDocumentView),
      });
    });

    expect(ViewService.invalidateDatabaseCatalog).not.toHaveBeenCalled();
  });

  it('invalidates the catalog when database display metadata changes', async () => {
    const eventEmitter = new EventEmitter();
    const databaseView = createView('database-view-id', {
      layout: ViewLayout.Grid,
      name: 'Before',
      extra: { database_id: 'database-id', is_database_container: true, is_space: false },
    });

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [databaseView], folderRid: '1-1' });
    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('Before');
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 0,
        folderRid: '2-1',
        viewJson: JSON.stringify({ ...databaseView, name: 'After' }),
      });
    });

    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledWith(workspaceId);
  });

  it('keeps the catalog snapshot for database fields that are not part of the catalog response', async () => {
    const eventEmitter = new EventEmitter();
    const databaseView = createView('database-view-id', {
      layout: ViewLayout.Grid,
      extra: { database_id: 'database-id', is_database_container: true, is_space: false },
      is_favorite: false,
    });

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [databaseView], folderRid: '1-1' });
    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.view_id).toBe(databaseView.view_id);
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 0,
        folderRid: '2-1',
        viewJson: JSON.stringify({ ...databaseView, is_favorite: true }),
      });
    });

    expect(ViewService.invalidateDatabaseCatalog).not.toHaveBeenCalled();
  });

  it('invalidates the catalog when a full outline replacement changes database metadata', async () => {
    const eventEmitter = new EventEmitter();
    const databaseView = createView('database-view-id', {
      layout: ViewLayout.Grid,
      name: 'Before',
      extra: { database_id: 'database-id', is_database_container: true, is_space: false },
    });

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [databaseView], folderRid: '1-1' });
    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('Before');
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        folderRid: '2-1',
        outlineDiffJson: JSON.stringify([
          { op: 'replace', path: '/outline', value: [{ ...databaseView, name: 'After' }] },
        ]),
      });
    });

    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledWith(workspaceId);
  });

  it('invalidates the catalog when VIEW_REMOVED targets an unloaded parent', async () => {
    const eventEmitter = new EventEmitter();

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(ViewService.getDatabaseCatalog).toHaveBeenCalledTimes(1);
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 2,
        folderRid: '2-1',
        viewId: 'unloaded-parent-id',
        childViewIds: [],
      });
    });

    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledWith(workspaceId);
  });

  it('keeps the catalog snapshot when a visible removed subtree contains only documents', async () => {
    const eventEmitter = new EventEmitter();
    const documentView = createView('document-view-id');
    const parent = createView('parent-id', {
      children: [documentView],
      has_children: true,
    });

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [parent], folderRid: '1-1' });
    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual([documentView.view_id]);
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 2,
        folderRid: '2-1',
        viewId: parent.view_id,
        childViewIds: [],
      });
    });

    expect(ViewService.invalidateDatabaseCatalog).not.toHaveBeenCalled();
  });

  it('invalidates the catalog when a removed visible document still has unloaded descendants', async () => {
    const eventEmitter = new EventEmitter();
    const lazyDocumentView = createView('lazy-document-view-id', { has_children: true });
    const parent = createView('parent-id', {
      children: [lazyDocumentView],
      has_children: true,
    });

    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [parent], folderRid: '1-1' });
    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual([lazyDocumentView.view_id]);
    });

    act(() => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 2,
        folderRid: '2-1',
        viewId: parent.view_id,
        childViewIds: [],
      });
    });

    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledTimes(1);
    expect(ViewService.invalidateDatabaseCatalog).toHaveBeenCalledWith(workspaceId);
  });

  it('bounds VIEW_ADDED retries after the initial trash request fails', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-20T00:00:00.000Z'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const eventEmitter = new EventEmitter();

      (ViewService.refreshTrash as jest.Mock)
        .mockRejectedValueOnce(new Error('trash unavailable'))
        .mockResolvedValueOnce([]);

      const { result, unmount } = renderHook(() => useWorkspaceData(), {
        wrapper: createWrapper(eventEmitter),
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.trashList).toBeUndefined();
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);

      act(() => {
        for (let index = 0; index < 20; index += 1) {
          const newView = createView(`new-row-document-${index}`, {
            parent_view_id: `new-row-document-${index}`,
          });

          eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
            changeType: 1,
            parentViewId: newView.view_id,
            viewJson: JSON.stringify(newView),
          });
        }
      });

      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(29_999);
        await Promise.resolve();
      });
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(2);
      expect(result.current.trashList).toEqual([]);
      unmount();
    } finally {
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  it('runs one trailing no-RID no-op outline refresh after the notification stream becomes quiet', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-20T00:00:00.000Z'));

    try {
      const eventEmitter = new EventEmitter();
      const debug = jest.spyOn(Log, 'debug').mockImplementation(() => undefined);
      const existingOutline = [createView('space-id', { has_children: false })];

      (ViewService.getOutline as jest.Mock).mockResolvedValue({
        outline: existingOutline,
        folderRid: '1-1',
      });
      (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);

      const { result, unmount } = renderHook(() => useWorkspaceData(), {
        wrapper: createWrapper(eventEmitter),
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.trashList).toEqual([]);
      expect(result.current.outline).toEqual(existingOutline);
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.loadFavoriteViews?.();
      });
      expect(ViewService.getFavorites).toHaveBeenCalledTimes(1);

      const outlineReference = result.current.outline;
      const outlineLoaded = jest.fn();

      eventEmitter.on(APP_EVENTS.OUTLINE_LOADED, outlineLoaded);

      const noOpReplacement = JSON.stringify([{ op: 'replace', path: '/outline', value: existingOutline }]);

      act(() => {
        for (let index = 0; index < 20; index += 1) {
          eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
            outlineDiffJson: noOpReplacement,
          });
        }
      });

      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);
      expect(ViewService.getFavorites).toHaveBeenCalledTimes(1);
      expect(result.current.outline).toBe(outlineReference);
      expect(outlineLoaded).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(29_999);
        await Promise.resolve();
      });
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(2);
      expect(ViewService.getFavorites).toHaveBeenCalledTimes(1);
      expect(result.current.outline).toBe(outlineReference);
      expect(outlineLoaded).not.toHaveBeenCalled();

      const parsedPatchLog = debug.mock.calls.find(
        ([message]) => message === '[Outline] [FolderOutlineChanged] parsed patch'
      );

      expect(parsedPatchLog?.[1]).toEqual({
        folderRid: null,
        byteLength: noOpReplacement.length,
        operationCount: 1,
        operations: [{ op: 'replace', path: '/outline' }],
        operationsTruncated: false,
      });

      unmount();
      eventEmitter.off(APP_EVENTS.OUTLINE_LOADED, outlineLoaded);
      debug.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not turn a continuous no-RID no-op outline stream into periodic trash polling', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-20T00:00:00.000Z'));

    try {
      const eventEmitter = new EventEmitter();
      const existingOutline = [createView('space-id', { has_children: false })];

      (ViewService.getOutline as jest.Mock).mockResolvedValue({
        outline: existingOutline,
        folderRid: '1-1',
      });
      (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);

      const { unmount } = renderHook(() => useWorkspaceData(), {
        wrapper: createWrapper(eventEmitter),
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);
      const noOpReplacement = JSON.stringify([{ op: 'replace', path: '/outline', value: existingOutline }]);
      const emitNoop = () => {
        eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
          outlineDiffJson: noOpReplacement,
        });
      };

      act(emitNoop);

      await act(async () => {
        jest.advanceTimersByTime(29_000);
        emitNoop();
        await Promise.resolve();
      });
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);

      // The burst gets one maximum-latency probe even though it has not gone
      // quiet, so a real permanent delete near the start is not stale forever.
      await act(async () => {
        jest.advanceTimersByTime(1_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(2);

      for (let index = 0; index < 3; index += 1) {
        await act(async () => {
          jest.advanceTimersByTime(20_000);
          emitNoop();
          await Promise.resolve();
        });
      }

      // More than two cooldown windows have elapsed. The stream receives one
      // max-latency probe, not periodic probes for as long as noise continues.
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(2);

      await act(async () => {
        jest.advanceTimersByTime(29_999);
        await Promise.resolve();
      });
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(2);

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(3);

      await act(async () => {
        jest.advanceTimersByTime(90_000);
        await Promise.resolve();
      });
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(3);
      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('refreshes a revisioned no-op VIEW_REMOVED once for a possible remote permanent delete', async () => {
    const eventEmitter = new EventEmitter();
    const child = createView('child-id', { has_children: false });
    const parent = createView('parent-id', {
      children: [child],
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock).mockResolvedValue({
      outline: [parent],
      folderRid: '1-1',
    });
    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline).toEqual([parent]);
      expect(result.current.trashList).toEqual([]);
    });

    const initialTrashRequestCount = (ViewService.refreshTrash as jest.Mock).mock.calls.length;
    const outlineReference = result.current.outline;
    const payload = {
      changeType: 2,
      folderRid: '2-1',
      viewId: parent.view_id,
      childViewIds: [child.view_id],
    };

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, payload);
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, payload);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(initialTrashRequestCount + 1);
    });
    expect(result.current.outline).toBe(outlineReference);
  });

  it('bounds unrevisioned no-op VIEW_REMOVED permanent-delete fallbacks to the 30-second cooldown', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-20T00:00:00.000Z'));

    try {
      const eventEmitter = new EventEmitter();
      const child = createView('child-id', { has_children: false });
      const parent = createView('parent-id', {
        children: [child],
        has_children: true,
      });

      (ViewService.getOutline as jest.Mock).mockResolvedValue({
        outline: [parent],
        folderRid: '1-1',
      });
      (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);

      const { result, unmount } = renderHook(() => useWorkspaceData(), {
        wrapper: createWrapper(eventEmitter),
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.outline).toEqual([parent]);
      expect(result.current.trashList).toEqual([]);
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);

      const outlineReference = result.current.outline;

      act(() => {
        for (let index = 0; index < 20; index += 1) {
          eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
            changeType: 2,
            viewId: parent.view_id,
            childViewIds: [child.view_id],
          });
        }
      });

      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(1);
      expect(result.current.outline).toBe(outlineReference);

      await act(async () => {
        jest.advanceTimersByTime(30_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(2);
      expect(result.current.outline).toBe(outlineReference);
      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('refreshes trash immediately when an outline replacement removes a view', async () => {
    const eventEmitter = new EventEmitter();
    const removedView = createView('removed-view');
    const space = createView('space-id', {
      children: [removedView],
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock).mockResolvedValue({
      outline: [space],
      folderRid: '1-1',
    });
    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual([removedView.view_id]);
    });

    const initialTrashRequestCount = (ViewService.refreshTrash as jest.Mock).mock.calls.length;
    const nextSpace = createView('space-id', {
      children: [],
      has_children: false,
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        folderRid: '2-1',
        outlineDiffJson: JSON.stringify([{ op: 'replace', path: '/outline', value: [nextSpace] }]),
      });
    });

    await waitFor(() => {
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(initialTrashRequestCount + 1);
    });
  });

  it('refreshes stale trash state when polling applies a changed outline', async () => {
    const eventEmitter = new EventEmitter();
    const restoredView = createView(restoredViewId);
    let trashResponse: View[] = [restoredView];

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({
        outline: [],
        folderRid: '1-1',
      })
      .mockResolvedValueOnce({
        outline: [createView('space-id')],
        folderRid: '2-1',
      });

    (ViewService.refreshTrash as jest.Mock).mockImplementation(async () => trashResponse);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.trashList?.map((view) => view.view_id)).toEqual([restoredViewId]);
    });

    const initialTrashRequestCount = (ViewService.refreshTrash as jest.Mock).mock.calls.length;

    trashResponse = [];

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.([]);
    });

    expect(revalidationResult).toBe('changed');

    await waitFor(() => {
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(initialTrashRequestCount + 1);
      expect(result.current.trashList).toEqual([]);
    });
  });

  it('preserves the trash state reference when a refresh returns equivalent data', async () => {
    const eventEmitter = new EventEmitter();
    let trashResponse: View[] = [createView(restoredViewId)];
    const acceptedPayloads: Array<{ workspaceId: string; trashItems: View[] }> = [];

    eventEmitter.on(APP_EVENTS.TRASH_UPDATED, (payload) => acceptedPayloads.push(payload));
    (ViewService.refreshTrash as jest.Mock).mockImplementation(async () => trashResponse);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.trashList?.map((view) => view.view_id)).toEqual([restoredViewId]);
    });

    const initialTrashList = result.current.trashList;
    const initialRequestCount = (ViewService.refreshTrash as jest.Mock).mock.calls.length;

    trashResponse = [createView(restoredViewId)];
    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, { folderRid: '2-1' });
    });

    await waitFor(() => {
      expect(ViewService.refreshTrash).toHaveBeenCalledTimes(initialRequestCount + 1);
      expect(acceptedPayloads).toHaveLength(2);
    });

    expect(result.current.trashList).toBe(initialTrashList);
    expect(acceptedPayloads[1].trashItems).toBe(initialTrashList);
  });

  it('coalesces paired folder notifications for the same revision across separate frames', async () => {
    const eventEmitter = new EventEmitter();
    const restoredView = createView(restoredViewId);
    const trashRequests: Array<ReturnType<typeof createDeferred<View[]>>> = [];

    (ViewService.refreshTrash as jest.Mock).mockImplementation(() => {
      const deferred = createDeferred<View[]>();

      trashRequests.push(deferred);
      return deferred.promise;
    });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(trashRequests).toHaveLength(1);
    });

    await act(async () => {
      trashRequests[0].resolve([restoredView]);
    });

    await waitFor(() => {
      expect(result.current.trashList?.map((view) => view.view_id)).toEqual([restoredViewId]);
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        folderRid: '2-1',
        outlineDiffJson: JSON.stringify([{ op: 'replace', path: '/outline', value: [] }]),
      });
    });

    // The full replacement is a no-op for membership, so wait for the
    // granular VIEW_ADDED payload to identify this revision as a restore.
    expect(trashRequests).toHaveLength(1);

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 1,
        folderRid: '2-1',
        parentViewId: 'space-id',
        viewJson: JSON.stringify(restoredView),
      });
    });

    await waitFor(() => {
      expect(trashRequests).toHaveLength(2);
    });

    await act(async () => {
      trashRequests[1].resolve([]);
    });

    await waitFor(() => {
      expect(result.current.trashList).toEqual([]);
    });
  });

  it('allows the same folder revision to retry after a terminal trash failure', async () => {
    const eventEmitter = new EventEmitter();
    const trashRequests: Array<ReturnType<typeof createDeferred<View[]>>> = [];

    (ViewService.refreshTrash as jest.Mock).mockImplementation(() => {
      const deferred = createDeferred<View[]>();

      trashRequests.push(deferred);
      return deferred.promise;
    });

    renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(trashRequests).toHaveLength(1);
    });

    await act(async () => {
      trashRequests[0].resolve([]);
    });

    const payload = { folderRid: '5-1' };

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, payload);
    });

    await waitFor(() => {
      expect(trashRequests).toHaveLength(2);
    });

    await act(async () => {
      trashRequests[1].reject(new Error('network unavailable'));
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        ...payload,
      });
    });

    await waitFor(() => {
      expect(trashRequests).toHaveLength(3);
    });

    await act(async () => {
      trashRequests[2].resolve([]);
    });
  });
});
