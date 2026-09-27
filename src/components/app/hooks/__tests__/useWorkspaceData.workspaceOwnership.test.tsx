import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { deleteCollabDB } from '@/application/db';
import { AccessService, ViewService, WorkspaceService } from '@/application/services/domains';
import { Role, User, View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';
import { AFConfigContext } from '@/components/main/app.hooks';

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
    getCached: jest.fn(),
    getCachedFromDisk: jest.fn(),
    getDatabaseRelations: jest.fn(),
    getFavorites: jest.fn(),
    getRecent: jest.fn(),
    getMultiple: jest.fn(),
    getNavigation: jest.fn(),
    getOutline: jest.fn(),
    getTrashCached: jest.fn(),
    invalidateCache: jest.fn(),
    invalidateWorkspaceMemoryCache: jest.fn(),
    refresh: jest.fn(),
    refreshTrash: jest.fn(),
  },
  WorkspaceService: {
    getMentionableUsers: jest.fn(),
  },
}));

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn(),
}));

jest.mock('@/application/services/js-services/workspace-view-metadata', () => ({
  captureWorkspaceViewMetadataAccessToken: jest.fn(() => ({})),
  invalidateWorkspaceViewMetadata: jest.fn(),
  markWorkspaceViewMetadataOutlineUntrusted: jest.fn(),
  primeWorkspaceViewMetadata: jest.fn(),
  primeWorkspaceViewMetadataFields: jest.fn(),
  primeWorkspaceViewMetadataFromServer: jest.fn(() => true),
}));

const workspaceId = 'workspace-id';

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

function createWrapper(
  eventEmitter: EventEmitter,
  getWorkspaceId = () => workspaceId,
  getSelectedWorkspaceId = getWorkspaceId,
  currentUserEmail = 'current-user@appflowy.io'
) {
  const authContext: AuthInternalContextType = {
    currentWorkspaceId: getWorkspaceId(),
    isAuthenticated: true,
    onChangeWorkspace: jest.fn(),
    userWorkspaceInfo: {
      userId: 'user-id',
      selectedWorkspace: {
        id: getSelectedWorkspaceId(),
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
  const currentUser = {
    email: currentUserEmail,
    uid: 'user-id',
    uuid: 'user-uuid',
  } as User;
  const appConfigContext = {
    currentUser,
    isAuthenticated: true,
    openLoginModal: jest.fn(),
    updateCurrentUser: jest.fn(),
  };

  return function Wrapper({ children }: { children: ReactNode }) {
    const activeWorkspaceId = getWorkspaceId();
    const selectedWorkspaceId = getSelectedWorkspaceId();
    const activeAuthContext = {
      ...authContext,
      currentWorkspaceId: activeWorkspaceId,
      userWorkspaceInfo: authContext.userWorkspaceInfo
        ? {
            ...authContext.userWorkspaceInfo,
            selectedWorkspace: {
              ...authContext.userWorkspaceInfo.selectedWorkspace,
              id: selectedWorkspaceId,
            },
          }
        : authContext.userWorkspaceInfo,
    };

    return (
      <AFConfigContext.Provider value={appConfigContext}>
        <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <AuthInternalContext.Provider value={activeAuthContext}>
            <SyncInternalContext.Provider value={syncContext}>{children}</SyncInternalContext.Provider>
          </AuthInternalContext.Provider>
        </MemoryRouter>
      </AFConfigContext.Provider>
    );
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject,
    resolve,
  };
}


describe('useWorkspaceData workspace ownership', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (AccessService.getShareWithMe as jest.Mock).mockResolvedValue(null);
    (ViewService.getCached as jest.Mock).mockReturnValue(undefined);
    (ViewService.getCachedFromDisk as jest.Mock).mockResolvedValue(undefined);
    (ViewService.getDatabaseRelations as jest.Mock).mockResolvedValue({});
    (ViewService.getFavorites as jest.Mock).mockResolvedValue([]);
    (ViewService.getRecent as jest.Mock).mockResolvedValue([]);
    (ViewService.getMultiple as jest.Mock).mockResolvedValue([]);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [], folderRid: '1-1' });
    (ViewService.getTrashCached as jest.Mock).mockResolvedValue([]);
    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    (deleteCollabDB as jest.Mock).mockResolvedValue(undefined);
  });

  it('keeps workspace B relations when workspace A resolves later', async () => {
    let activeWorkspace = 'A';
    const a = createDeferred<Record<string, string>>();
    const b = createDeferred<Record<string, string>>();

    (ViewService.getDatabaseRelations as jest.Mock).mockImplementation((id: string) => id === 'A' ? a.promise : b.promise);
    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(new EventEmitter(), () => activeWorkspace),
    });

    await waitFor(() => expect(ViewService.getDatabaseRelations).toHaveBeenCalledWith('A', 'database-storage-id'));
    activeWorkspace = 'B';
    rerender();
    await waitFor(() => expect(ViewService.getDatabaseRelations).toHaveBeenCalledWith('B', 'database-storage-id'));
    await act(async () => b.resolve({ 'database-B': 'view-B' }));
    expect(result.current.workspaceDatabases).toEqual({ 'database-B': 'view-B' });
    await act(async () => a.resolve({ 'database-A': 'view-A' }));
    expect(result.current.workspaceDatabases).toEqual({ 'database-B': 'view-B' });
  });

  it('keeps workspace B recent views when workspace A resolves later', async () => {
    let activeWorkspace = 'A';
    const a = createDeferred<View[]>();

    (ViewService.getRecent as jest.Mock).mockImplementation((id: string) => id === 'A' ? a.promise : Promise.resolve([createView('view-B')]));
    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(new EventEmitter(), () => activeWorkspace),
    });

    await act(async () => undefined);
    let pendingA: ReturnType<typeof result.current.loadRecentViews>;

    act(() => { pendingA = result.current.loadRecentViews(); });
    activeWorkspace = 'B';
    rerender();
    await act(async () => { await result.current.loadRecentViews(); });
    expect(result.current.recentViews?.map(view => view.view_id)).toEqual(['view-B']);
    await act(async () => { a.resolve([createView('view-A')]); await pendingA; });
    expect(result.current.recentViews?.map(view => view.view_id)).toEqual(['view-B']);
  });

  it('loads workspace B member profile after switching from workspace A', async () => {
    let activeWorkspace = 'A';

    (WorkspaceService.getMentionableUsers as jest.Mock).mockImplementation((id: string) => Promise.resolve([
      { person_id: 'same-person', name: `Name in ${id}` },
    ]));
    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(new EventEmitter(), () => activeWorkspace),
    });

    await act(async () => { await result.current.loadMentionableUsers(); });
    activeWorkspace = 'B';
    rerender();
    let member: unknown;

    await act(async () => { member = await result.current.getMentionUser('same-person'); });
    expect(member).toEqual({ person_id: 'same-person', name: 'Name in B' });
  });

  it('ignores relation responses from an earlier visit to the same workspace', async () => {
    let activeWorkspace = 'A';
    const oldA = createDeferred<Record<string, string>>();

    (ViewService.getDatabaseRelations as jest.Mock)
      .mockReturnValueOnce(oldA.promise)
      .mockResolvedValueOnce({ 'database-B': 'view-B' })
      .mockResolvedValueOnce({ 'new-A': 'new-view-A' });
    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(new EventEmitter(), () => activeWorkspace),
    });

    await act(async () => undefined);
    activeWorkspace = 'B';
    rerender();
    await waitFor(() => expect(result.current.workspaceDatabases).toEqual({ 'database-B': 'view-B' }));
    activeWorkspace = 'A';
    rerender();
    await waitFor(() => expect(result.current.workspaceDatabases).toEqual({ 'new-A': 'new-view-A' }));
    await act(async () => oldA.resolve({ 'old-A': 'old-view-A' }));
    expect(result.current.getCachedDatabaseRelations()).toEqual({ 'new-A': 'new-view-A' });
    expect(await result.current.loadDatabaseRelations()).toEqual({ 'new-A': 'new-view-A' });
  });

  it('ignores recent responses from an earlier visit to the same workspace', async () => {
    let activeWorkspace = 'A';
    const oldA = createDeferred<View[]>();

    (ViewService.getRecent as jest.Mock)
      .mockReturnValueOnce(oldA.promise)
      .mockResolvedValueOnce([createView('new-A')]);
    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(new EventEmitter(), () => activeWorkspace),
    });
    let pendingA: ReturnType<typeof result.current.loadRecentViews>;

    act(() => { pendingA = result.current.loadRecentViews(); });
    activeWorkspace = 'B';
    rerender();
    activeWorkspace = 'A';
    rerender();
    await act(async () => { await result.current.loadRecentViews(); });
    await act(async () => { oldA.resolve([createView('old-A')]); await pendingA; });
    expect(result.current.recentViews?.map(view => view.view_id)).toEqual(['new-A']);
  });

  it('does not return or cache a member response belonging to the old workspace', async () => {
    let activeWorkspace = 'A';
    const oldA = createDeferred<{ person_id: string; name: string }[]>();

    (WorkspaceService.getMentionableUsers as jest.Mock)
      .mockReturnValueOnce(oldA.promise)
      .mockResolvedValueOnce([{ person_id: 'same-person', name: 'Name in B' }]);
    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(new EventEmitter(), () => activeWorkspace),
    });
    const pendingA = result.current.loadMentionableUsers();

    activeWorkspace = 'B';
    rerender();
    await act(async () => { await result.current.loadMentionableUsers(); });
    await act(async () => oldA.resolve([{ person_id: 'same-person', name: 'Name in A' }]));
    expect(await pendingA).toEqual([]);
    expect(await result.current.getMentionUser('same-person')).toEqual({ person_id: 'same-person', name: 'Name in B' });
  });

  it('hides old lists and cached relations in the first render after a switch', async () => {
    let activeWorkspace = 'A';
    const rendered: { workspaceId: string; recentViews?: View[]; relations?: Record<string, string> }[] = [];

    (ViewService.getDatabaseRelations as jest.Mock).mockResolvedValue({ 'database-A': 'view-A' });
    (ViewService.getRecent as jest.Mock).mockResolvedValue([createView('recent-A')]);
    const { result, rerender } = renderHook(() => {
      const data = useWorkspaceData();

      rendered.push({ workspaceId: activeWorkspace, recentViews: data.recentViews, relations: data.getCachedDatabaseRelations() });
      return data;
    }, { wrapper: createWrapper(new EventEmitter(), () => activeWorkspace) });

    await act(async () => { await result.current.loadRecentViews(); });
    expect(result.current.getCachedDatabaseRelations()).toEqual({ 'database-A': 'view-A' });
    activeWorkspace = 'B';
    rerender();
    expect(rendered.find((entry) => entry.workspaceId === 'B')).toEqual({
      workspaceId: 'B', recentViews: undefined, relations: undefined,
    });
    await act(async () => undefined);
  });

  it('waits for the selected workspace before using its database storage ID', async () => {
    let selectedWorkspace = 'A';
    const { rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(new EventEmitter(), () => 'B', () => selectedWorkspace),
    });

    await act(async () => undefined);
    expect(ViewService.getDatabaseRelations).not.toHaveBeenCalled();
    selectedWorkspace = 'B';
    rerender();
    await waitFor(() => expect(ViewService.getDatabaseRelations).toHaveBeenCalledWith('B', 'database-storage-id'));
  });
});
