import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { APP_EVENTS, ERROR_CODE } from '@/application/constants';
import { deleteCollabDB } from '@/application/db';
import { AccessService, ViewService } from '@/application/services/domains';
import {
  invalidateWorkspaceViewMetadata,
  markWorkspaceViewMetadataOutlineUntrusted,
} from '@/application/services/js-services/workspace-view-metadata';
import { Role, User, View, ViewLayout } from '@/application/types';
import { findView } from '@/components/_shared/outline/utils';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';
import { MAX_SIDEBAR_OUTLINE_REVALIDATION_EXPANDED_IDS } from '@/components/app/outline/sidebarRevalidation';
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

describe('useWorkspaceData sidebar outline revalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (AccessService.getShareWithMe as jest.Mock).mockResolvedValue(null);
    (ViewService.getCached as jest.Mock).mockReturnValue(undefined);
    (ViewService.getCachedFromDisk as jest.Mock).mockResolvedValue(undefined);
    (ViewService.getDatabaseRelations as jest.Mock).mockResolvedValue({});
    (ViewService.getFavorites as jest.Mock).mockResolvedValue([]);
    (ViewService.getMultiple as jest.Mock).mockResolvedValue([]);
    (ViewService.getNavigation as jest.Mock).mockResolvedValue(createView('navigation-root'));
    (ViewService.invalidateWorkspaceMemoryCache as jest.Mock).mockImplementation(() => undefined);
    (ViewService.refresh as jest.Mock).mockImplementation((activeWorkspaceId: string, viewId: string) =>
      ViewService.get(activeWorkspaceId, viewId)
    );
    (ViewService.getTrashCached as jest.Mock).mockResolvedValue([]);
    (ViewService.refreshTrash as jest.Mock).mockResolvedValue([]);
    (deleteCollabDB as jest.Mock).mockResolvedValue(undefined);
  });

  it('invalidates cached access details for every remote share change', async () => {
    const eventEmitter = new EventEmitter();
    const initialOutline = [createView('space-id')];

    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: initialOutline, folderRid: '1-1' });
    const { result, unmount } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(initialOutline));
    (AccessService.invalidateShareDetailCache as jest.Mock).mockClear();
    (markWorkspaceViewMetadataOutlineUntrusted as jest.Mock).mockClear();

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: 'shared-view-id',
        emails: ['other-user@appflowy.io'],
      });
    });

    expect(AccessService.invalidateShareDetailCache).toHaveBeenCalledWith(workspaceId);
    expect(markWorkspaceViewMetadataOutlineUntrusted).not.toHaveBeenCalled();
    unmount();
  });

  it('refreshes permission-derived state when the share panel is closed', async () => {
    const eventEmitter = new EventEmitter();
    const initialOutline = [createView('initial-space-id')];
    const refreshedOutline = [createView('refreshed-space-id')];

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: initialOutline, folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: refreshedOutline, folderRid: '1-2' });

    const { result, unmount } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(initialOutline));
    (AccessService.invalidateShareDetailCache as jest.Mock).mockClear();
    (markWorkspaceViewMetadataOutlineUntrusted as jest.Mock).mockClear();

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    expect(AccessService.invalidateShareDetailCache).toHaveBeenCalledWith(workspaceId);
    expect(markWorkspaceViewMetadataOutlineUntrusted).toHaveBeenCalledWith(workspaceId);
    await waitFor(() => expect(result.current.outline).toEqual(refreshedOutline));
    expect(ViewService.getOutline).toHaveBeenCalledTimes(2);

    unmount();
    expect(eventEmitter.listenerCount(APP_EVENTS.PERMISSION_CHANGED)).toBe(0);
  });

  it('refreshes only the changed space subtree and preserves expanded sibling spaces', async () => {
    const eventEmitter = new EventEmitter();
    const changedSpaceId = 'changed-space-id';
    const siblingSpaceId = 'sibling-space-id';
    const staleChangedChildId = 'stale-changed-child-id';
    const freshChangedChildId = 'fresh-changed-child-id';
    const siblingChildId = 'sibling-child-id';
    const shallowRoot = [
      createView(changedSpaceId, {
        extra: { is_space: true },
        has_children: true,
      }),
      createView(siblingSpaceId, {
        extra: { is_space: true },
        has_children: true,
      }),
    ];

    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: shallowRoot, folderRid: '1-1' });
    (ViewService.getMultiple as jest.Mock).mockResolvedValue([
      createView(changedSpaceId, {
        children: [createView(staleChangedChildId)],
        extra: { is_space: true },
        has_children: true,
      }),
      createView(siblingSpaceId, {
        children: [createView(siblingChildId)],
        extra: { is_space: true },
        has_children: true,
      }),
    ]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(shallowRoot));
    await act(async () => {
      await result.current.loadViewChildrenBatch?.([changedSpaceId, siblingSpaceId]);
    });
    expect(findView(result.current.outline ?? [], staleChangedChildId)).not.toBeNull();
    expect(findView(result.current.outline ?? [], siblingChildId)).not.toBeNull();

    (ViewService.invalidateCache as jest.Mock).mockClear();
    (ViewService.getMultiple as jest.Mock).mockClear();
    (ViewService.getMultiple as jest.Mock).mockResolvedValueOnce([
      createView(changedSpaceId, {
        children: [createView(freshChangedChildId)],
        extra: { is_space: true },
        has_children: true,
      }),
    ]);
    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: changedSpaceId });
    });

    await waitFor(() => expect(findView(result.current.outline ?? [], freshChangedChildId)).not.toBeNull());
    expect(findView(result.current.outline ?? [], staleChangedChildId)).toBeNull();
    expect(findView(result.current.outline ?? [], siblingChildId)).not.toBeNull();
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, changedSpaceId);
    expect(ViewService.invalidateCache).not.toHaveBeenCalledWith(workspaceId, siblingSpaceId);
    expect(ViewService.getMultiple).toHaveBeenCalledTimes(1);
    expect(ViewService.getMultiple).toHaveBeenCalledWith(workspaceId, [changedSpaceId], 1);
    expect(ViewService.getOutline).toHaveBeenCalledTimes(2);
    expect(result.current.loadedViewIds?.has(siblingSpaceId)).toBe(true);
  });

  it('drops a loaded deep subtree that a permission refresh omits from the shallow root', async () => {
    const eventEmitter = new EventEmitter();
    const boundaryId = 'depth-six-boundary-id';
    const revokedViewId = 'revoked-deep-view-id';
    const shallowRoot = [
      createView('space-id', {
        children: [
          createView('level-two-id', {
            children: [
              createView('level-three-id', {
                children: [
                  createView('level-four-id', {
                    children: [
                      createView('level-five-id', {
                        children: [createView(boundaryId, { has_children: true })],
                        has_children: true,
                      }),
                    ],
                    has_children: true,
                  }),
                ],
                has_children: true,
              }),
            ],
            has_children: true,
          }),
        ],
        has_children: true,
      }),
    ];

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: shallowRoot, folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: shallowRoot, folderRid: '1-2' });
    (ViewService.getMultiple as jest.Mock).mockResolvedValueOnce([
      createView(boundaryId, {
        children: [createView(revokedViewId)],
        has_children: true,
      }),
    ]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(shallowRoot));
    await act(async () => {
      await result.current.loadViewChildrenBatch?.([boundaryId]);
    });
    expect(result.current.loadedViewIds?.has(boundaryId)).toBe(true);
    expect(findView(result.current.outline ?? [], revokedViewId)).not.toBeNull();

    (ViewService.invalidateCache as jest.Mock).mockClear();
    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => expect(findView(result.current.outline ?? [], revokedViewId)).toBeNull());
    expect(result.current.loadedViewIds?.has(boundaryId)).toBe(false);
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, boundaryId);
  });

  it('authoritatively restores unaffected expanded roots when a revoked sibling rejects', async () => {
    const eventEmitter = new EventEmitter();
    const revokedBoundaryId = 'revoked-boundary-id';
    const unaffectedBoundaryId = 'unaffected-boundary-id';
    const revokedChildId = 'revoked-child-id';
    const oldUnaffectedChildId = 'old-unaffected-child-id';
    const freshUnaffectedChildId = 'fresh-unaffected-child-id';
    const shallowRoot = [
      createView('space-id', {
        children: [
          createView(revokedBoundaryId, { has_children: true }),
          createView(unaffectedBoundaryId, { has_children: true }),
        ],
        has_children: true,
      }),
    ];
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: shallowRoot, folderRid: '1-1' });
    (ViewService.getMultiple as jest.Mock)
      .mockResolvedValueOnce([
        createView(revokedBoundaryId, {
          children: [createView(revokedChildId)],
          has_children: true,
        }),
        createView(unaffectedBoundaryId, {
          children: [createView(oldUnaffectedChildId)],
          has_children: true,
        }),
      ])
      .mockRejectedValueOnce({ code: ERROR_CODE.NOT_HAS_PERMISSION, message: 'revoked' })
      .mockResolvedValueOnce([
        createView(unaffectedBoundaryId, {
          children: [createView(freshUnaffectedChildId)],
          has_children: true,
        }),
      ]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(shallowRoot));
    await act(async () => {
      await result.current.loadViewChildrenBatch?.([revokedBoundaryId, unaffectedBoundaryId]);
    });
    expect(findView(result.current.outline ?? [], revokedChildId)).not.toBeNull();
    expect(findView(result.current.outline ?? [], oldUnaffectedChildId)).not.toBeNull();

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => expect(findView(result.current.outline ?? [], freshUnaffectedChildId)).not.toBeNull());
    expect(findView(result.current.outline ?? [], revokedChildId)).toBeNull();
    expect(findView(result.current.outline ?? [], oldUnaffectedChildId)).toBeNull();
    expect(result.current.loadedViewIds?.has(unaffectedBoundaryId)).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it('retries a transient expanded-root failure after a permission refresh', async () => {
    const eventEmitter = new EventEmitter();
    const boundaryId = 'transient-boundary-id';
    const oldChildId = 'old-transient-child-id';
    const freshChildId = 'fresh-transient-child-id';
    const shallowRoot = [
      createView('space-id', {
        children: [createView(boundaryId, { has_children: true })],
        has_children: true,
      }),
    ];
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: shallowRoot, folderRid: '1-1' });
    (ViewService.getMultiple as jest.Mock)
      .mockResolvedValueOnce([
        createView(boundaryId, {
          children: [createView(oldChildId)],
          has_children: true,
        }),
      ])
      .mockRejectedValueOnce({ code: ERROR_CODE.REQUEST_TIMEOUT, message: 'try again' })
      .mockResolvedValueOnce([
        createView(boundaryId, {
          children: [createView(freshChildId)],
          has_children: true,
        }),
      ]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(shallowRoot));
    await act(async () => {
      await result.current.loadViewChildrenBatch?.([boundaryId]);
    });
    expect(findView(result.current.outline ?? [], oldChildId)).not.toBeNull();

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => expect(findView(result.current.outline ?? [], freshChildId)).not.toBeNull());
    expect(findView(result.current.outline ?? [], oldChildId)).toBeNull();
    expect(ViewService.getMultiple).toHaveBeenCalledTimes(3);
    consoleErrorSpy.mockRestore();
  });

  it('refreshes an already-loaded favorites list after a permission change', async () => {
    const eventEmitter = new EventEmitter();
    const revokedFavorite = createView('revoked-favorite-id', { is_favorite: true });

    (ViewService.getOutline as jest.Mock).mockResolvedValue({
      outline: [createView('space-id')],
      folderRid: '1-1',
    });
    (ViewService.getFavorites as jest.Mock)
      .mockResolvedValueOnce([revokedFavorite])
      .mockResolvedValueOnce([]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await act(async () => {
      await result.current.loadFavoriteViews?.();
    });
    expect(result.current.favoriteViews).toEqual([revokedFavorite]);

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });

    await waitFor(() => expect(result.current.favoriteViews).toEqual([]));
    expect(ViewService.getFavorites).toHaveBeenCalledTimes(2);
  });

  it('ignores an older favorites response after a newer permission refresh', async () => {
    const eventEmitter = new EventEmitter();
    const initialFavorite = createView('initial-favorite-id', { is_favorite: true });
    const staleFavorite = createView('stale-favorite-id', { is_favorite: true });
    const olderRefresh = createDeferred<View[]>();
    const newerRefresh = createDeferred<View[]>();

    (ViewService.getOutline as jest.Mock).mockResolvedValue({
      outline: [createView('space-id')],
      folderRid: '1-1',
    });
    (ViewService.getFavorites as jest.Mock)
      .mockResolvedValueOnce([initialFavorite])
      .mockReturnValueOnce(olderRefresh.promise)
      .mockReturnValueOnce(newerRefresh.promise);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await act(async () => {
      await result.current.loadFavoriteViews?.();
    });
    expect(result.current.favoriteViews).toEqual([initialFavorite]);

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });
    await waitFor(() => expect(ViewService.getFavorites).toHaveBeenCalledTimes(2));

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });
    await waitFor(() => expect(ViewService.getFavorites).toHaveBeenCalledTimes(3));

    await act(async () => {
      newerRefresh.resolve([]);
      await newerRefresh.promise;
    });
    await waitFor(() => expect(result.current.favoriteViews).toEqual([]));

    await act(async () => {
      olderRefresh.resolve([staleFavorite]);
      await olderRefresh.promise;
    });
    expect(result.current.favoriteViews).toEqual([]);
  });

  it('restarts an in-flight initial favorites load after a permission change', async () => {
    const eventEmitter = new EventEmitter();
    const staleFavorite = createView('stale-initial-favorite-id', { is_favorite: true });
    const initialLoad = createDeferred<View[]>();
    const permissionRefresh = createDeferred<View[]>();

    (ViewService.getOutline as jest.Mock).mockResolvedValue({
      outline: [createView('space-id')],
      folderRid: '1-1',
    });
    (ViewService.getFavorites as jest.Mock)
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(permissionRefresh.promise);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    let initialLoadPromise: Promise<View[] | undefined> | undefined;

    act(() => {
      initialLoadPromise = result.current.loadFavoriteViews?.();
    });
    await waitFor(() => expect(ViewService.getFavorites).toHaveBeenCalledTimes(1));

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });
    await waitFor(() => expect(ViewService.getFavorites).toHaveBeenCalledTimes(2));

    await act(async () => {
      permissionRefresh.resolve([]);
      await permissionRefresh.promise;
    });
    await waitFor(() => expect(result.current.favoriteViews).toEqual([]));

    await act(async () => {
      initialLoad.resolve([staleFavorite]);
      await initialLoadPromise;
    });
    expect(result.current.favoriteViews).toEqual([]);
  });

  it('rejects a pre-permission root response when the fresh permission refresh fails', async () => {
    const eventEmitter = new EventEmitter();
    const initialOutline = [createView('initial-space-id')];
    const staleOutline = [createView('stale-revoked-space-id')];
    const prePermissionResponse = createDeferred<{ outline: View[]; folderRid: string }>();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: initialOutline, folderRid: '1-1' })
      .mockReturnValueOnce(prePermissionResponse.promise)
      .mockRejectedValueOnce(new Error('permission refresh failed'));

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(initialOutline));

    let prePermissionLoad: Promise<void> | undefined;

    act(() => {
      prePermissionLoad = result.current.loadOutline?.(workspaceId, false);
    });
    await waitFor(() => expect(ViewService.getOutline).toHaveBeenCalledTimes(2));

    act(() => {
      eventEmitter.emit(APP_EVENTS.PERMISSION_CHANGED, { objectId: 'workspace-group-id' });
    });
    await waitFor(() => expect(ViewService.getOutline).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());

    await act(async () => {
      prePermissionResponse.resolve({ outline: staleOutline, folderRid: '2-1' });
      await prePermissionLoad;
    });

    expect(result.current.outline).toEqual(initialOutline);
    expect(findView(result.current.outline ?? [], staleOutline[0].view_id)).toBeNull();
    consoleErrorSpy.mockRestore();
  });

  it('rejects a pre-share root response when the fresh share refresh fails', async () => {
    const eventEmitter = new EventEmitter();
    const initialOutline = [createView('initial-space-id')];
    const staleOutline = [createView('stale-revoked-space-id')];
    const preShareResponse = createDeferred<{ outline: View[]; folderRid: string }>();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: initialOutline, folderRid: '1-1' })
      .mockReturnValueOnce(preShareResponse.promise)
      .mockRejectedValueOnce(new Error('share refresh failed'));

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(initialOutline));

    let preShareLoad: Promise<void> | undefined;

    act(() => {
      preShareLoad = result.current.loadOutline?.(workspaceId, false);
    });
    await waitFor(() => expect(ViewService.getOutline).toHaveBeenCalledTimes(2));

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: 'ancestor-space-id',
        emails: ['current-user@appflowy.io'],
      });
    });
    await waitFor(() => expect(ViewService.getOutline).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());

    await act(async () => {
      preShareResponse.resolve({ outline: staleOutline, folderRid: '2-1' });
      await preShareLoad;
    });

    expect(result.current.outline).toEqual(initialOutline);
    expect(findView(result.current.outline ?? [], staleOutline[0].view_id)).toBeNull();
    consoleErrorSpy.mockRestore();
  });

  it('clears a pre-share lazy marker so the next expansion refetches and ignores the old response', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', { has_children: true });
    const oldChild = createView('old-revoked-child-id');
    const freshChild = createView('fresh-child-id');
    const staleRefresh = createDeferred<View>();
    const currentRefresh = createDeferred<View>();

    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [root], folderRid: '1-1' });
    (ViewService.refresh as jest.Mock)
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(currentRefresh.promise);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual([root]));

    let staleLoad: Promise<View[]> | undefined;

    act(() => {
      staleLoad = result.current.loadViewChildren?.(root.view_id);
    });
    await waitFor(() => expect(ViewService.refresh).toHaveBeenCalledTimes(1));

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: 'ancestor-space-id',
        emails: ['current-user@appflowy.io'],
      });
    });
    await waitFor(() => expect(ViewService.getOutline).toHaveBeenCalledTimes(2));

    let currentLoad: Promise<View[]> | undefined;

    act(() => {
      currentLoad = result.current.loadViewChildren?.(root.view_id);
    });
    await waitFor(() => expect(ViewService.refresh).toHaveBeenCalledTimes(2));

    await act(async () => {
      staleRefresh.resolve({ ...root, children: [oldChild] });
      await staleLoad;
    });
    expect(findView(result.current.outline ?? [], oldChild.view_id)).toBeNull();

    // The old finally handler must not clear the replacement request's marker.
    await act(async () => {
      await result.current.loadViewChildren?.(root.view_id);
    });
    expect(ViewService.refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      currentRefresh.resolve({ ...root, children: [freshChild] });
      await currentLoad;
    });
    expect(findView(result.current.outline ?? [], freshChild.view_id)).not.toBeNull();
  });

  it('evicts a disk-only canonical database collab when the current user loses access', async () => {
    const eventEmitter = new EventEmitter();
    const databaseView = createView('database-view-id', {
      layout: ViewLayout.Grid,
      extra: {
        database_id: 'database-collab-id',
        is_database_container: true,
        is_space: false,
      },
    });
    const shallowOutline = [createView('space-id', { extra: { is_space: true } })];
    const revokedListener = jest.fn();

    eventEmitter.on(APP_EVENTS.VIEW_ACCESS_REVOKED, revokedListener);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: shallowOutline, folderRid: '1-1' });
    (ViewService.getCachedFromDisk as jest.Mock).mockResolvedValueOnce(databaseView);
    (ViewService.getNavigation as jest.Mock).mockRejectedValueOnce({
      code: ERROR_CODE.NOT_HAS_PERMISSION,
      message: 'no permission',
    });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(shallowOutline));

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: databaseView.view_id,
        emails: ['CURRENT-USER@appflowy.io'],
      });
    });

    await waitFor(() => {
      expect(deleteCollabDB).toHaveBeenCalledWith(databaseView.view_id, { destroyDoc: true });
      expect(deleteCollabDB).toHaveBeenCalledWith('database-collab-id', { destroyDoc: true });
    });
    expect(ViewService.getCachedFromDisk).toHaveBeenCalledWith(workspaceId, databaseView.view_id);
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, databaseView.view_id);
    expect(revokedListener).toHaveBeenCalledWith({ viewId: databaseView.view_id });
  });

  it('captures an off-outline database identity before share invalidation clears memory', async () => {
    const eventEmitter = new EventEmitter();
    const databaseView = createView('memory-only-database-view-id', {
      layout: ViewLayout.Grid,
      extra: {
        database_id: 'memory-only-database-collab-id',
        is_database_container: true,
        is_space: false,
      },
    });
    const shallowOutline = [createView('space-id', { extra: { is_space: true } })];
    let memoryNavigation: View | undefined = databaseView;

    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: shallowOutline, folderRid: '1-1' });
    (ViewService.getCached as jest.Mock).mockImplementation(
      (_activeWorkspaceId: string, viewId: string) =>
        (viewId === databaseView.view_id ? memoryNavigation : undefined)
    );
    (ViewService.invalidateWorkspaceMemoryCache as jest.Mock).mockImplementation(() => {
      memoryNavigation = undefined;
    });
    (ViewService.getNavigation as jest.Mock).mockRejectedValueOnce({
      code: ERROR_CODE.NOT_HAS_PERMISSION,
      message: 'no permission',
    });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual(shallowOutline));

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: databaseView.view_id,
        emails: ['current-user@appflowy.io'],
      });
    });

    await waitFor(() => {
      expect(deleteCollabDB).toHaveBeenCalledWith(databaseView.view_id, { destroyDoc: true });
      expect(deleteCollabDB).toHaveBeenCalledWith('memory-only-database-collab-id', { destroyDoc: true });
    });
    expect(ViewService.invalidateWorkspaceMemoryCache).toHaveBeenCalledWith(workspaceId);
    expect(ViewService.getCachedFromDisk).not.toHaveBeenCalled();
  });

  it('announces restored access after a successful share-change probe', async () => {
    const eventEmitter = new EventEmitter();
    const sharedView = createView('shared-view-id');
    const restoredListener = jest.fn();

    eventEmitter.on(APP_EVENTS.VIEW_ACCESS_RESTORED, restoredListener);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [sharedView], folderRid: '1-1' });
    (ViewService.getNavigation as jest.Mock).mockResolvedValueOnce(sharedView);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual([sharedView]));

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: sharedView.view_id,
        emails: ['current-user@appflowy.io'],
      });
    });

    await waitFor(() => {
      expect(restoredListener).toHaveBeenCalledWith({ viewId: sharedView.view_id });
    });
    expect(deleteCollabDB).not.toHaveBeenCalled();
  });

  it('ignores an older grant response after a newer revocation', async () => {
    const eventEmitter = new EventEmitter();
    const sharedView = createView('shared-view-id');
    const olderGrant = createDeferred<View>();
    const restoredListener = jest.fn();
    const revokedListener = jest.fn();

    eventEmitter.on(APP_EVENTS.VIEW_ACCESS_RESTORED, restoredListener);
    eventEmitter.on(APP_EVENTS.VIEW_ACCESS_REVOKED, revokedListener);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [sharedView], folderRid: '1-1' });
    (ViewService.getNavigation as jest.Mock)
      .mockReturnValueOnce(olderGrant.promise)
      .mockRejectedValueOnce({ code: ERROR_CODE.NOT_HAS_PERMISSION, message: 'no permission' });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual([sharedView]));

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: sharedView.view_id,
        emails: ['current-user@appflowy.io'],
      });
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: sharedView.view_id,
        emails: ['current-user@appflowy.io'],
      });
    });

    await waitFor(() => expect(revokedListener).toHaveBeenCalledWith({ viewId: sharedView.view_id }));

    await act(async () => {
      olderGrant.resolve(sharedView);
      await olderGrant.promise;
    });

    expect(restoredListener).not.toHaveBeenCalled();
  });

  it('ignores an older revoke response after a newer grant', async () => {
    const eventEmitter = new EventEmitter();
    const sharedView = createView('shared-view-id');
    const olderRevoke = createDeferred<View>();
    const restoredListener = jest.fn();
    const revokedListener = jest.fn();

    eventEmitter.on(APP_EVENTS.VIEW_ACCESS_RESTORED, restoredListener);
    eventEmitter.on(APP_EVENTS.VIEW_ACCESS_REVOKED, revokedListener);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({ outline: [sharedView], folderRid: '1-1' });
    (ViewService.getNavigation as jest.Mock)
      .mockReturnValueOnce(olderRevoke.promise)
      .mockResolvedValueOnce(sharedView);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => expect(result.current.outline).toEqual([sharedView]));

    act(() => {
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: sharedView.view_id,
        emails: ['current-user@appflowy.io'],
      });
      eventEmitter.emit(APP_EVENTS.SHARE_VIEWS_CHANGED, {
        viewId: sharedView.view_id,
        emails: ['current-user@appflowy.io'],
      });
    });

    await waitFor(() => expect(restoredListener).toHaveBeenCalledWith({ viewId: sharedView.view_id }));

    await act(async () => {
      olderRevoke.reject({ code: ERROR_CODE.NOT_HAS_PERMISSION, message: 'no permission' });
      await olderRevoke.promise.catch(() => undefined);
    });

    expect(revokedListener).not.toHaveBeenCalled();
    expect(deleteCollabDB).not.toHaveBeenCalled();
  });

  it('hydrates missing selected view path from navigation context', async () => {
    const eventEmitter = new EventEmitter();
    const spaceId = 'space-id';
    const rootId = 'root-id';
    const parentId = 'parent-id';
    const targetId = 'target-id';
    const targetSiblingId = 'target-sibling-id';
    const rootSiblingId = 'root-sibling-id';

    const initialSpace = createView(spaceId, {
      extra: { is_space: true },
      children: [],
      has_children: true,
    });
    const navigationTree = createView(spaceId, {
      extra: { is_space: true },
      children: [
        createView(rootId, {
          children: [
            createView(parentId, {
              children: [createView(targetId), createView(targetSiblingId)],
              has_children: true,
            }),
          ],
          has_children: true,
        }),
        createView(rootSiblingId, { has_children: true }),
      ],
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock).mockResolvedValue({
      outline: [initialSpace],
      folderRid: '1-1',
    });
    (ViewService.getNavigation as jest.Mock).mockResolvedValue(navigationTree);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual([spaceId]);
    });

    let ancestors: string[] = [];

    await act(async () => {
      ancestors = (await result.current.ensureViewVisibleInOutline?.(targetId)) ?? [];
    });

    expect(ViewService.getNavigation).toHaveBeenCalledWith(workspaceId, targetId, 0);
    expect(ancestors).toEqual([spaceId, rootId, parentId]);
    expect(result.current.loadedViewIds?.has(spaceId)).toBe(true);
    expect(result.current.loadedViewIds?.has(rootId)).toBe(true);
    expect(result.current.loadedViewIds?.has(parentId)).toBe(true);

    const space = result.current.outline?.[0];
    const root = space?.children.find((view) => view.view_id === rootId);
    const parent = root?.children.find((view) => view.view_id === parentId);

    expect(space?.children.map((view) => view.view_id)).toEqual([rootId, rootSiblingId]);
    expect(parent?.children.map((view) => view.view_id)).toEqual([targetId, targetSiblingId]);
  });

  it('skips revalidation when the root folder rid is unchanged', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.(['space-id']);
    });

    expect(revalidationResult).toBe('unchanged');
    expect(ViewService.getMultiple).not.toHaveBeenCalled();
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
  });

  it('skips revalidation when folder rid is missing and the root outline is unchanged', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root] })
      .mockResolvedValueOnce({ outline: [createView('space-id', { has_children: true })] });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.(['space-id']);
    });

    expect(revalidationResult).toBe('unchanged');
    expect(ViewService.getMultiple).not.toHaveBeenCalled();
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
  });

  it('marks cached subtrees stale and refreshes only 20 expanded roots', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: [root], folderRid: '2-1' });

    (ViewService.getMultiple as jest.Mock)
      .mockResolvedValueOnce([
        createView('space-id', {
          children: [createView('child-id')],
          has_children: true,
        }),
      ])
      .mockResolvedValueOnce([]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    await act(async () => {
      await result.current.loadViewChildrenBatch?.(['space-id']);
    });

    await waitFor(() => {
      expect(result.current.loadedViewIds?.has('space-id')).toBe(true);
    });

    const expandedViewIds = [...Array.from({ length: 25 }, (_, index) => `view-${index}`), '', 'view-0'];

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.(expandedViewIds);
    });

    expect(revalidationResult).toBe('changed');
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, 'space-id');
    expect(ViewService.getMultiple).toHaveBeenLastCalledWith(
      workspaceId,
      Array.from({ length: MAX_SIDEBAR_OUTLINE_REVALIDATION_EXPANDED_IDS }, (_, index) => `view-${index}`),
      1
    );
  });

  it('shows cached children immediately while refreshing a manually expanded view', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
    });
    const cachedRoot = createView('space-id', {
      children: [createView('cached-child-id')],
      has_children: true,
    });
    const refreshedRoot = createView('space-id', {
      children: [createView('refreshed-child-id')],
      has_children: true,
    });
    const refresh = createDeferred<View>();

    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({ outline: [root], folderRid: '1-1' });
    (ViewService.getCached as jest.Mock).mockReturnValue(cachedRoot);
    (ViewService.refresh as jest.Mock).mockReturnValue(refresh.promise);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    let loadPromise!: Promise<View[]>;

    await act(async () => {
      loadPromise = result.current.loadViewChildren?.('space-id') ?? Promise.resolve([]);
      await Promise.resolve();
    });

    expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['cached-child-id']);
    expect(ViewService.refresh).toHaveBeenCalledWith(workspaceId, 'space-id');
    expect(ViewService.get).not.toHaveBeenCalled();

    await act(async () => {
      refresh.resolve(refreshedRoot);
      await loadPromise;
    });

    expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['refreshed-child-id']);
  });

  it('keeps the active nested view when a parent refresh returns only direct children', async () => {
    const eventEmitter = new EventEmitter();
    const activeView = createView('active-view-id');
    const databaseContainer = createView('database-container-id', {
      children: [activeView],
      has_children: true,
      name: 'Original database name',
    });
    const root = createView('space-id', {
      children: [databaseContainer],
      has_children: true,
    });
    const refreshedRoot = createView('space-id', {
      children: [
        createView('database-container-id', {
          children: [],
          has_children: true,
          name: 'Updated database name',
        }),
      ],
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({ outline: [root], folderRid: '1-1' });
    (ViewService.refresh as jest.Mock).mockResolvedValueOnce(refreshedRoot);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(findView(result.current.outline ?? [], activeView.view_id)).not.toBeNull();
    });

    await act(async () => {
      await result.current.loadViewChildren?.(root.view_id);
    });

    const refreshedContainer = findView(result.current.outline ?? [], databaseContainer.view_id);

    expect(refreshedContainer?.name).toBe('Updated database name');
    expect(findView(result.current.outline ?? [], activeView.view_id)).not.toBeNull();
  });

  it('starts refresh immediately and shows disk cached children while the server request is pending', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
    });
    const diskCachedRoot = createView('space-id', {
      children: [createView('disk-child-id')],
      has_children: true,
    });
    const refreshedRoot = createView('space-id', {
      children: [createView('refreshed-child-id')],
      has_children: true,
    });
    const diskCache = createDeferred<View | undefined>();
    const refresh = createDeferred<View>();

    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({ outline: [root], folderRid: '1-1' });
    (ViewService.getCachedFromDisk as jest.Mock).mockReturnValue(diskCache.promise);
    (ViewService.refresh as jest.Mock).mockReturnValue(refresh.promise);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    let loadPromise!: Promise<View[]>;

    await act(async () => {
      loadPromise = result.current.loadViewChildren?.('space-id') ?? Promise.resolve([]);
      await Promise.resolve();
    });

    expect(ViewService.refresh).toHaveBeenCalledWith(workspaceId, 'space-id');
    expect(result.current.outline?.[0]?.children).toEqual([]);

    await act(async () => {
      diskCache.resolve(diskCachedRoot);
      await Promise.resolve();
    });

    expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['disk-child-id']);

    await act(async () => {
      refresh.resolve(refreshedRoot);
      await loadPromise;
    });

    expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['refreshed-child-id']);
  });

  it('marks manually collapsed children stale without evicting the cached view payload', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
    });
    const loadedRoot = createView('space-id', {
      children: [createView('child-id')],
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({ outline: [root], folderRid: '1-1' });
    (ViewService.get as jest.Mock).mockResolvedValueOnce(loadedRoot);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    await act(async () => {
      await result.current.loadViewChildren?.('space-id');
    });

    await waitFor(() => {
      expect(result.current.loadedViewIds?.has('space-id')).toBe(true);
    });

    (ViewService.invalidateCache as jest.Mock).mockClear();

    act(() => {
      result.current.markViewChildrenStale?.('space-id');
    });

    expect(result.current.loadedViewIds?.has('space-id')).toBe(false);
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
  });

  it('does not let stale cached children replace current outline children while refreshing', async () => {
    const eventEmitter = new EventEmitter();
    const childA = createView('child-a');
    const childB = createView('child-b');
    const childC = createView('child-c');
    const root = createView('space-id', {
      children: [childA, childB],
      has_children: true,
    });
    const staleCachedRoot = createView('space-id', {
      children: [childA],
      has_children: true,
    });
    const refreshedRoot = createView('space-id', {
      children: [childA, childB, childC],
      has_children: true,
    });
    const refresh = createDeferred<View>();

    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({ outline: [root], folderRid: '1-1' });
    (ViewService.getCached as jest.Mock).mockReturnValue(staleCachedRoot);
    (ViewService.refresh as jest.Mock).mockReturnValue(refresh.promise);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['child-a', 'child-b']);
    });

    let loadPromise!: Promise<View[]>;

    await act(async () => {
      loadPromise = result.current.loadViewChildren?.('space-id') ?? Promise.resolve([]);
      await Promise.resolve();
    });

    expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['child-a', 'child-b']);

    await act(async () => {
      refresh.resolve(refreshedRoot);
      await loadPromise;
    });

    expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['child-a', 'child-b', 'child-c']);
  });

  it('keeps transient fallback children visible without marking the subtree loaded', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
    });
    const cachedRoot = createView('space-id', {
      children: [createView('cached-child-id')],
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({ outline: [root], folderRid: '1-1' });
    (ViewService.getCached as jest.Mock).mockReturnValue(cachedRoot);
    (ViewService.refresh as jest.Mock).mockRejectedValueOnce({ code: -1, message: 'network unavailable' });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    let children: View[] = [];

    await act(async () => {
      children = (await result.current.loadViewChildren?.('space-id')) ?? [];
    });

    expect(children.map((view) => view.view_id)).toEqual(['cached-child-id']);
    expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['cached-child-id']);
    expect(result.current.loadedViewIds?.has('space-id')).toBe(false);
    expect(ViewService.invalidateCache).not.toHaveBeenCalled();
  });

  it('clears cached fallback children when refresh returns an authoritative error', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
    });
    const cachedRoot = createView('space-id', {
      children: [createView('cached-child-id')],
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({ outline: [root], folderRid: '1-1' });
    (ViewService.getCached as jest.Mock).mockReturnValue(cachedRoot);
    (ViewService.refresh as jest.Mock).mockRejectedValueOnce({
      code: ERROR_CODE.NOT_HAS_PERMISSION,
      message: 'no permission',
    });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    let children: View[] = [createView('placeholder')];

    await act(async () => {
      children = (await result.current.loadViewChildren?.('space-id')) ?? [];
    });

    expect(children).toEqual([]);
    expect(result.current.outline?.[0]?.children).toEqual([]);
    expect(result.current.outline?.[0]?.has_children).toBe(false);
    expect(result.current.loadedViewIds?.has('space-id')).toBe(false);
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, 'space-id');
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, 'cached-child-id');
    expect(invalidateWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, 'space-id');
    expect(invalidateWorkspaceViewMetadata).toHaveBeenCalledWith(workspaceId, 'cached-child-id');
  });

  it('does not let lazy child folder rid hide unapplied root outline changes', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
      name: 'old space',
    });
    const updatedRoot = createView('space-id', {
      has_children: true,
      name: 'new space',
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: [updatedRoot], folderRid: '2-1' });

    (ViewService.getMultiple as jest.Mock).mockResolvedValueOnce([
      createView('space-id', {
        children: [createView('child-id')],
        folder_rid: '2-1',
        has_children: true,
      }),
    ]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('old space');
    });

    await act(async () => {
      await result.current.loadViewChildrenBatch?.(['space-id']);
    });

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.([]);
    });

    expect(revalidationResult).toBe('changed');
    expect(result.current.outline?.[0]?.name).toBe('new space');
  });

  it('does not let granular folder changes hide unapplied root outline changes', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
      name: 'old space',
    });
    const granularRoot = createView('space-id', {
      has_children: true,
      name: 'granular space',
    });
    const serverRoot = createView('space-id', {
      has_children: true,
      name: 'server space',
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: [serverRoot], folderRid: '2-1' });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('old space');
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 0,
        folderRid: '2-1',
        viewJson: JSON.stringify(granularRoot),
      });
    });

    expect(result.current.outline?.[0]?.name).toBe('granular space');

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.([]);
    });

    expect(revalidationResult).toBe('changed');
    expect(result.current.outline?.[0]?.name).toBe('server space');
  });

  it('does not let skipped non-visual outline diffs hide unapplied root outline changes', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
      last_edited_time: 1,
      name: 'old space',
    });
    const serverRoot = createView('space-id', {
      has_children: true,
      last_edited_time: 2,
      name: 'server space',
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: [serverRoot], folderRid: '2-1' });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('old space');
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        folderRid: '2-1',
        outlineDiffJson: JSON.stringify([
          {
            op: 'replace',
            path: '/outline/0/last_edited_time',
            value: 2,
          },
        ]),
      });
    });

    expect(result.current.outline?.[0]?.name).toBe('old space');

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.([]);
    });

    expect(revalidationResult).toBe('changed');
    expect(result.current.outline?.[0]?.name).toBe('server space');
  });

  it('applies a granular folder change after its complementary outline change at the same revision', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      last_edited_time: 1,
      name: 'old space',
    });
    const updatedRoot = createView('space-id', {
      last_edited_time: 2,
      name: 'renamed space',
    });

    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({
      outline: [root],
      folderRid: '1-1',
    });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('old space');
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        folderRid: '2-1',
        outlineDiffJson: JSON.stringify([
          {
            op: 'replace',
            path: '/outline/0/last_edited_time',
            value: 2,
          },
        ]),
      });
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 0,
        folderRid: '2-1',
        viewJson: JSON.stringify(updatedRoot),
      });
    });

    expect(result.current.outline?.[0]?.name).toBe('renamed space');

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 0,
        folderRid: '2-1',
        viewJson: JSON.stringify({ ...updatedRoot, name: 'duplicate should be ignored' }),
      });
    });

    expect(result.current.outline?.[0]?.name).toBe('renamed space');
  });

  it('publishes metadata updates for views outside the loaded outline', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id');
    const nestedView = createView('nested-view-id', { name: 'renamed nested view' });
    const handleViewMetaChanged = jest.fn();

    eventEmitter.on(APP_EVENTS.VIEW_META_CHANGED, handleViewMetaChanged);
    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({
      outline: [root],
      folderRid: '1-1',
    });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.view_id).toBe(root.view_id);
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 0,
        folderRid: '2-1',
        viewJson: JSON.stringify(nestedView),
      });
    });

    expect(handleViewMetaChanged).toHaveBeenCalledWith(nestedView);
    expect(result.current.outline).toEqual([root]);
  });

  it('preserves a granular view update when a stale full outline arrives afterward', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', { name: 'old space' });
    const renamedRoot = createView('space-id', { name: 'renamed space' });

    (ViewService.getOutline as jest.Mock).mockResolvedValueOnce({
      outline: [root],
      folderRid: '1-1',
    });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('old space');
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 0,
        viewJson: JSON.stringify(renamedRoot),
      });
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        outlineDiffJson: JSON.stringify([
          {
            op: 'replace',
            path: '/outline',
            value: [root],
          },
        ]),
      });
    });

    expect(result.current.outline?.[0]?.name).toBe('renamed space');

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        outlineDiffJson: JSON.stringify([
          {
            op: 'replace',
            path: '/outline',
            value: [renamedRoot],
          },
        ]),
      });
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        outlineDiffJson: JSON.stringify([
          {
            op: 'replace',
            path: '/outline',
            value: [{ ...renamedRoot, name: 'later server rename' }],
          },
        ]),
      });
    });

    expect(result.current.outline?.[0]?.name).toBe('later server rename');
  });

  it('preserves a granular update across an older in-flight outline response', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', { name: 'old space' });
    const renamedRoot = createView('space-id', { name: 'renamed space' });
    const olderOutlineResponse = createDeferred<{ outline: View[]; folderRid: string }>();

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' })
      .mockReturnValueOnce(olderOutlineResponse.promise)
      .mockResolvedValueOnce({
        outline: [createView('space-id', { name: 'newer server name' })],
        folderRid: '4-1',
      });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('old space');
    });

    let olderLoadPromise: Promise<void> = Promise.resolve();

    act(() => {
      olderLoadPromise = result.current.loadOutline?.(workspaceId, false) ?? Promise.resolve();
    });

    await waitFor(() => {
      expect(ViewService.getOutline).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 0,
        folderRid: '3-1',
        viewJson: JSON.stringify(renamedRoot),
      });
    });

    expect(result.current.outline?.[0]?.name).toBe('renamed space');

    await act(async () => {
      olderOutlineResponse.resolve({
        outline: [root],
        folderRid: '2-1',
      });
      await olderLoadPromise;
    });

    expect(result.current.outline?.[0]?.name).toBe('renamed space');

    await act(async () => {
      await result.current.loadOutline?.(workspaceId, false);
    });

    expect(result.current.outline?.[0]?.name).toBe('newer server name');
  });

  it('repairs relaxed outline patches with same-rid root revalidation', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      children: [],
      has_children: true,
    });
    const childA = createView('child-a');
    const childB = createView('child-b');
    const serverRoot = createView('space-id', {
      children: [childA, childB],
      has_children: true,
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: [serverRoot], folderRid: '2-1' });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.view_id).toBe('space-id');
    });

    await act(async () => {
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        folderRid: '2-1',
        outlineDiffJson: JSON.stringify([
          {
            op: 'add',
            path: '/outline/0/children/1',
            value: childB,
          },
        ]),
      });
    });

    expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['child-b']);

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.([]);
    });

    expect(revalidationResult).toBe('changed');
    expect(result.current.outline?.[0]?.children.map((view) => view.view_id)).toEqual(['child-a', 'child-b']);
  });

  it('resets root folder rid state when the workspace changes', async () => {
    const eventEmitter = new EventEmitter();
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';
    let activeWorkspaceId = workspaceA;
    let workspaceBOutlineCalls = 0;

    (ViewService.getOutline as jest.Mock).mockImplementation(async (requestedWorkspaceId: string) => {
      if (requestedWorkspaceId === workspaceA) {
        return {
          outline: [createView('space-a', { name: 'workspace a' })],
          folderRid: '9-1',
        };
      }

      workspaceBOutlineCalls += 1;

      return {
        outline: [
          createView('space-b', {
            name: workspaceBOutlineCalls < 2 ? 'workspace b old' : 'workspace b new',
          }),
        ],
        folderRid: workspaceBOutlineCalls < 2 ? '1-1' : '2-1',
      };
    });

    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter, () => activeWorkspaceId),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace a');
    });

    activeWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace b old');
    });

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.([]);
    });

    expect(revalidationResult).toBe('changed');
    expect(result.current.outline?.[0]?.name).toBe('workspace b new');
  });

  it('ignores a delayed root outline response after the workspace changes', async () => {
    const eventEmitter = new EventEmitter();
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';
    const delayedWorkspaceAResponse = createDeferred<{ outline: View[]; folderRid: string }>();
    let activeWorkspaceId = workspaceA;

    (ViewService.getOutline as jest.Mock).mockImplementation((requestedWorkspaceId: string) => {
      if (requestedWorkspaceId === workspaceA) {
        return delayedWorkspaceAResponse.promise;
      }

      return Promise.resolve({
        outline: [createView('space-b', { name: 'workspace b' })],
        folderRid: '1-1',
      });
    });

    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter, () => activeWorkspaceId),
    });

    await waitFor(() => {
      expect(ViewService.getOutline).toHaveBeenCalledWith(workspaceA);
    });

    activeWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace b');
    });

    await act(async () => {
      delayedWorkspaceAResponse.resolve({
        outline: [createView('space-a', { name: 'stale workspace a' })],
        folderRid: '2-1',
      });
      await delayedWorkspaceAResponse.promise;
    });

    expect(result.current.outline?.[0]?.name).toBe('workspace b');
    expect(result.current.outline?.[0]?.view_id).toBe('space-b');
  });

  it('does not expose the previous outline while rendering a workspace change', async () => {
    const eventEmitter = new EventEmitter();
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';
    const observedRenders: Array<{ workspaceId: string; outlineNames: string[] }> = [];
    let activeWorkspaceId = workspaceA;

    (ViewService.getOutline as jest.Mock).mockImplementation(async (requestedWorkspaceId: string) => ({
      outline: [
        createView(`space-${requestedWorkspaceId}`, {
          name: requestedWorkspaceId === workspaceA ? 'workspace a' : 'workspace b',
        }),
      ],
      folderRid: '1-1',
    }));

    const { result, rerender } = renderHook(
      () => {
        const workspaceData = useWorkspaceData();

        observedRenders.push({
          workspaceId: activeWorkspaceId,
          outlineNames: workspaceData.outline?.map((view) => view.name) ?? [],
        });
        return workspaceData;
      },
      {
        wrapper: createWrapper(eventEmitter, () => activeWorkspaceId),
      }
    );

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace a');
    });

    observedRenders.length = 0;
    activeWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace b');
    });

    expect(
      observedRenders.some(
        ({ workspaceId: renderedWorkspaceId, outlineNames }) =>
          renderedWorkspaceId === workspaceB && outlineNames.includes('workspace a')
      )
    ).toBe(false);
  });

  it('waits for the selected workspace and URL workspace to agree before reloading the outline', async () => {
    const eventEmitter = new EventEmitter();
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';
    let activeWorkspaceId = workspaceA;
    let selectedWorkspaceId = workspaceA;

    (ViewService.getOutline as jest.Mock).mockResolvedValue({
      outline: [createView('space-a', { name: 'workspace a' })],
      folderRid: '1-1',
    });

    const { rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(
        eventEmitter,
        () => activeWorkspaceId,
        () => selectedWorkspaceId
      ),
    });

    await waitFor(() => {
      expect(ViewService.getOutline).toHaveBeenCalledWith(workspaceA);
    });
    (ViewService.getOutline as jest.Mock).mockClear();

    selectedWorkspaceId = workspaceB;
    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(ViewService.getOutline).not.toHaveBeenCalled();

    activeWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(ViewService.getOutline).toHaveBeenCalledWith(workspaceB);
    });
    expect(ViewService.getOutline).toHaveBeenCalledTimes(1);
  });

  it('reloads the outline after a URL workspace selection catches up on the server', async () => {
    const eventEmitter = new EventEmitter();
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';
    let activeWorkspaceId = workspaceA;
    let selectedWorkspaceId = workspaceA;

    (ViewService.getOutline as jest.Mock).mockImplementation(async (requestedWorkspaceId: string) => ({
      outline: [createView(`space-${requestedWorkspaceId}`)],
      folderRid: '1-1',
    }));

    const { rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(
        eventEmitter,
        () => activeWorkspaceId,
        () => selectedWorkspaceId
      ),
    });

    await waitFor(() => {
      expect(ViewService.getOutline).toHaveBeenCalledWith(workspaceA);
    });
    (ViewService.getOutline as jest.Mock).mockClear();

    activeWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(ViewService.getOutline).toHaveBeenCalledWith(workspaceB);
    });
    (ViewService.getOutline as jest.Mock).mockClear();

    selectedWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(ViewService.getOutline).toHaveBeenCalledWith(workspaceB);
    });
    expect(ViewService.getOutline).toHaveBeenCalledTimes(1);
  });

  it('keeps the latest same-workspace outline when the catch-up response resolves first', async () => {
    const eventEmitter = new EventEmitter();
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';
    const initialWorkspaceBResponse = createDeferred<{ outline: View[]; folderRid: string }>();
    const catchUpWorkspaceBResponse = createDeferred<{ outline: View[]; folderRid: string }>();
    let activeWorkspaceId = workspaceA;
    let selectedWorkspaceId = workspaceA;
    let workspaceBOutlineCalls = 0;

    (ViewService.getOutline as jest.Mock).mockImplementation((requestedWorkspaceId: string) => {
      if (requestedWorkspaceId === workspaceA) {
        return Promise.resolve({
          outline: [createView('space-a', { name: 'workspace a' })],
          folderRid: '1-1',
        });
      }

      workspaceBOutlineCalls += 1;
      return workspaceBOutlineCalls === 1 ? initialWorkspaceBResponse.promise : catchUpWorkspaceBResponse.promise;
    });

    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(
        eventEmitter,
        () => activeWorkspaceId,
        () => selectedWorkspaceId
      ),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace a');
    });

    activeWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(workspaceBOutlineCalls).toBe(1);
    });

    selectedWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(workspaceBOutlineCalls).toBe(2);
    });

    await act(async () => {
      catchUpWorkspaceBResponse.resolve({
        outline: [createView('space-b-new', { name: 'workspace b new' })],
        folderRid: '2-1',
      });
      await catchUpWorkspaceBResponse.promise;
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace b new');
    });

    await act(async () => {
      initialWorkspaceBResponse.resolve({
        outline: [createView('space-b-old', { name: 'workspace b old' })],
        folderRid: '1-1',
      });
      await initialWorkspaceBResponse.promise;
      await Promise.resolve();
    });

    expect(result.current.outline?.[0]?.name).toBe('workspace b new');
    expect(result.current.outline?.[0]?.view_id).toBe('space-b-new');
  });

  it('keeps an older successful outline while a newer same-workspace request is pending or fails', async () => {
    const eventEmitter = new EventEmitter();
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';
    const initialWorkspaceBResponse = createDeferred<{ outline: View[]; folderRid: string }>();
    const catchUpWorkspaceBResponse = createDeferred<{ outline: View[]; folderRid: string }>();
    let activeWorkspaceId = workspaceA;
    let selectedWorkspaceId = workspaceA;
    let workspaceBOutlineCalls = 0;

    (ViewService.getOutline as jest.Mock).mockImplementation((requestedWorkspaceId: string) => {
      if (requestedWorkspaceId === workspaceA) {
        return Promise.resolve({
          outline: [createView('space-a', { name: 'workspace a' })],
          folderRid: '1-1',
        });
      }

      workspaceBOutlineCalls += 1;
      return workspaceBOutlineCalls === 1 ? initialWorkspaceBResponse.promise : catchUpWorkspaceBResponse.promise;
    });

    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(
        eventEmitter,
        () => activeWorkspaceId,
        () => selectedWorkspaceId
      ),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace a');
    });

    activeWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(workspaceBOutlineCalls).toBe(1);
    });

    selectedWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(workspaceBOutlineCalls).toBe(2);
    });

    await act(async () => {
      initialWorkspaceBResponse.resolve({
        outline: [createView('space-b-fallback', { name: 'workspace b fallback' })],
        folderRid: '1-1',
      });
      await initialWorkspaceBResponse.promise;
      await Promise.resolve();
    });

    expect(result.current.outline?.[0]?.name).toBe('workspace b fallback');

    await act(async () => {
      catchUpWorkspaceBResponse.reject(new Error('catch-up failed'));
      await catchUpWorkspaceBResponse.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(result.current.outline?.[0]?.name).toBe('workspace b fallback');
    expect(result.current.outline?.[0]?.view_id).toBe('space-b-fallback');
  });

  it('keeps forced navigation active when a newer background outline request starts', async () => {
    const eventEmitter = new EventEmitter();
    const initialForcedResponse = createDeferred<{ outline: View[]; folderRid: string }>();
    let outlineCalls = 0;

    localStorage.clear();
    (ViewService.getOutline as jest.Mock).mockImplementation(() => {
      outlineCalls += 1;

      if (outlineCalls === 1) {
        return initialForcedResponse.promise;
      }

      return Promise.resolve({
        outline: [createView('background-view', { name: 'background outline' })],
        folderRid: '2-1',
      });
    });

    const { result } = renderHook(
      () => {
        const workspaceData = useWorkspaceData();
        const location = useLocation();

        return {
          ...workspaceData,
          pathname: location.pathname,
        };
      },
      {
        wrapper: createWrapper(eventEmitter),
      }
    );

    await waitFor(() => {
      expect(outlineCalls).toBe(1);
    });

    await act(async () => {
      await result.current.loadOutline?.(workspaceId, false);
    });

    expect(result.current.outline?.[0]?.name).toBe('background outline');

    await act(async () => {
      initialForcedResponse.resolve({
        outline: [createView('forced-view', { name: 'forced outline' })],
        folderRid: '1-1',
      });
      await initialForcedResponse.promise;
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.pathname).toBe(`/app/${workspaceId}/forced-view`);
    });
    expect(result.current.outline?.[0]?.name).toBe('background outline');
  });

  it('ignores an older same-workspace revalidation after a newer outline load', async () => {
    const eventEmitter = new EventEmitter();
    const delayedRevalidationResponse = createDeferred<{ outline: View[] }>();
    let outlineCalls = 0;

    (ViewService.getOutline as jest.Mock).mockImplementation(() => {
      outlineCalls += 1;

      if (outlineCalls === 1) {
        return Promise.resolve({
          outline: [createView('initial-view', { name: 'initial outline' })],
          folderRid: '1-1',
        });
      }

      if (outlineCalls === 2) {
        return delayedRevalidationResponse.promise;
      }

      return Promise.resolve({
        outline: [createView('latest-view', { name: 'latest outline' })],
        folderRid: '2-1',
      });
    });

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('initial outline');
    });

    let revalidationPromise: Promise<string | undefined> = Promise.resolve(undefined);

    act(() => {
      revalidationPromise = result.current.revalidateSidebarOutline?.([]) ?? Promise.resolve(undefined);
    });

    await waitFor(() => {
      expect(outlineCalls).toBe(2);
    });

    await act(async () => {
      await result.current.loadOutline?.(workspaceId, false);
    });

    expect(result.current.outline?.[0]?.name).toBe('latest outline');

    let revalidationResult: string | undefined;

    await act(async () => {
      delayedRevalidationResponse.resolve({
        outline: [createView('older-view', { name: 'older outline' })],
      });
      revalidationResult = await revalidationPromise;
    });

    expect(revalidationResult).toBe('unchanged');
    expect(result.current.outline?.[0]?.name).toBe('latest outline');
  });

  it('does not apply an expanded child batch after a newer root response is accepted', async () => {
    const eventEmitter = new EventEmitter();
    const delayedChildResponse = createDeferred<View[]>();
    const initialRoot = createView('space-id', {
      children: [],
      has_children: true,
      name: 'initial root',
    });
    const revalidatedRoot = createView('space-id', {
      children: [],
      has_children: true,
      name: 'revalidated root',
    });
    const latestRoot = createView('space-id', {
      children: [],
      has_children: true,
      name: 'latest root',
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [initialRoot], folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: [revalidatedRoot], folderRid: '2-1' })
      .mockResolvedValueOnce({ outline: [latestRoot], folderRid: '3-1' });
    (ViewService.getMultiple as jest.Mock).mockReturnValueOnce(delayedChildResponse.promise);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('initial root');
    });

    let revalidationPromise: Promise<string | undefined> = Promise.resolve(undefined);

    act(() => {
      revalidationPromise = result.current.revalidateSidebarOutline?.(['space-id']) ?? Promise.resolve(undefined);
    });

    await waitFor(() => {
      expect(ViewService.getMultiple).toHaveBeenCalledWith(workspaceId, ['space-id'], 1);
    });

    await act(async () => {
      await result.current.loadOutline?.(workspaceId, false);
    });

    expect(result.current.outline?.[0]?.name).toBe('latest root');

    let revalidationResult: string | undefined;

    await act(async () => {
      delayedChildResponse.resolve([
        createView('space-id', {
          children: [createView('stale-child')],
          folder_rid: '2-1',
          has_children: true,
        }),
      ]);
      revalidationResult = await revalidationPromise;
    });

    expect(revalidationResult).toBe('unchanged');
    expect(result.current.outline?.[0]?.name).toBe('latest root');
    expect(result.current.outline?.[0]?.children).toEqual([]);
    expect(result.current.loadedViewIds?.has('space-id')).toBe(false);
  });

  it('ignores stale revalidation results after the workspace changes', async () => {
    const eventEmitter = new EventEmitter();
    const workspaceA = 'workspace-a';
    const workspaceB = 'workspace-b';
    const staleWorkspaceAResponse = createDeferred<{ outline: View[]; folderRid: string }>();
    let activeWorkspaceId = workspaceA;
    let workspaceAOutlineCalls = 0;

    (ViewService.getOutline as jest.Mock).mockImplementation(async (requestedWorkspaceId: string) => {
      if (requestedWorkspaceId === workspaceA) {
        workspaceAOutlineCalls += 1;

        if (workspaceAOutlineCalls === 1) {
          return {
            outline: [createView('space-a', { name: 'workspace a' })],
            folderRid: '1-1',
          };
        }

        return staleWorkspaceAResponse.promise;
      }

      return {
        outline: [createView('space-b', { name: 'workspace b' })],
        folderRid: '1-1',
      };
    });

    const { result, rerender } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter, () => activeWorkspaceId),
    });

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace a');
    });

    let revalidationPromise: Promise<string | undefined> = Promise.resolve(undefined);

    act(() => {
      revalidationPromise = result.current.revalidateSidebarOutline?.([]) ?? Promise.resolve(undefined);
    });

    activeWorkspaceId = workspaceB;
    rerender();

    await waitFor(() => {
      expect(result.current.outline?.[0]?.name).toBe('workspace b');
    });

    let revalidationResult: string | undefined;

    await act(async () => {
      staleWorkspaceAResponse.resolve({
        outline: [createView('space-a', { name: 'stale workspace a' })],
        folderRid: '2-1',
      });
      revalidationResult = await revalidationPromise;
    });

    expect(revalidationResult).toBe('unchanged');
    expect(result.current.outline?.[0]?.name).toBe('workspace b');
    expect(result.current.outline?.[0]?.view_id).toBe('space-b');
  });

  it('invalidates loaded subtree caches that are dropped by a changed root outline', async () => {
    const eventEmitter = new EventEmitter();
    const root = createView('space-id', {
      has_children: true,
    });
    const emptyRoot = createView('space-id', {
      has_children: false,
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: [emptyRoot], folderRid: '2-1' });

    (ViewService.getMultiple as jest.Mock)
      .mockResolvedValueOnce([
        createView('space-id', {
          children: [
            createView('child-id', {
              has_children: true,
            }),
          ],
          has_children: true,
        }),
      ])
      .mockResolvedValueOnce([
        createView('child-id', {
          children: [createView('grandchild-id')],
          has_children: true,
        }),
      ]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    await act(async () => {
      await result.current.loadViewChildrenBatch?.(['space-id']);
    });

    await act(async () => {
      await result.current.loadViewChildrenBatch?.(['child-id']);
    });

    await waitFor(() => {
      expect(result.current.loadedViewIds?.has('space-id')).toBe(true);
      expect(result.current.loadedViewIds?.has('child-id')).toBe(true);
    });

    (ViewService.invalidateCache as jest.Mock).mockClear();

    await act(async () => {
      await result.current.revalidateSidebarOutline?.([]);
    });

    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, 'space-id');
    expect(ViewService.invalidateCache).toHaveBeenCalledWith(workspaceId, 'child-id');
  });

  it('keeps root revalidation retryable when expanded refresh fails', async () => {
    const eventEmitter = new EventEmitter();
    const refreshError = new Error('subtree refresh failed');
    const root = createView('space-id', {
      has_children: true,
    });
    const updatedRoot = createView('space-id', {
      has_children: true,
      name: 'new space',
    });

    (ViewService.getOutline as jest.Mock)
      .mockResolvedValueOnce({ outline: [root], folderRid: '1-1' })
      .mockResolvedValueOnce({ outline: [updatedRoot], folderRid: '2-1' })
      .mockResolvedValueOnce({ outline: [updatedRoot], folderRid: '2-1' });

    (ViewService.getMultiple as jest.Mock).mockRejectedValueOnce(refreshError).mockResolvedValueOnce([
      createView('space-id', {
        children: [createView('child-id')],
        folder_rid: '2-1',
        has_children: true,
      }),
    ]);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.outline?.map((view) => view.view_id)).toEqual(['space-id']);
    });

    let thrown: unknown;

    await act(async () => {
      try {
        await result.current.revalidateSidebarOutline?.(['space-id']);
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBe(refreshError);

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.(['space-id']);
    });

    expect(revalidationResult).toBe('changed');
    expect(ViewService.getMultiple).toHaveBeenCalledTimes(2);
    expect(ViewService.getMultiple).toHaveBeenLastCalledWith(workspaceId, ['space-id'], 1);
  });
});
