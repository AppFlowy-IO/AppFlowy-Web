import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { APP_EVENTS } from '@/application/constants';
import { AccessService, ViewService } from '@/application/services/domains';
import { Role, View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';
import { MAX_SIDEBAR_OUTLINE_REVALIDATION_EXPANDED_IDS } from '@/components/app/outline/sidebarRevalidation';

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

jest.mock('@/application/services/domains', () => ({
  AccessService: {
    getShareWithMe: jest.fn(),
  },
  ViewService: {
    get: jest.fn(),
    getDatabaseRelations: jest.fn(),
    getMultiple: jest.fn(),
    getOutline: jest.fn(),
    getTrash: jest.fn(),
    invalidateCache: jest.fn(),
  },
  WorkspaceService: {
    getMentionableUsers: jest.fn(),
  },
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

function createWrapper(eventEmitter: EventEmitter, getWorkspaceId = () => workspaceId) {
  const authContext: AuthInternalContextType = {
    currentWorkspaceId: getWorkspaceId(),
    isAuthenticated: true,
    onChangeWorkspace: jest.fn(),
    userWorkspaceInfo: {
      userId: 'user-id',
      selectedWorkspace: {
        id: getWorkspaceId(),
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
    const activeWorkspaceId = getWorkspaceId();
    const activeAuthContext = {
      ...authContext,
      currentWorkspaceId: activeWorkspaceId,
      userWorkspaceInfo: authContext.userWorkspaceInfo
        ? {
            ...authContext.userWorkspaceInfo,
            selectedWorkspace: {
              ...authContext.userWorkspaceInfo.selectedWorkspace,
              id: activeWorkspaceId,
            },
          }
        : authContext.userWorkspaceInfo,
    };

    return (
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <AuthInternalContext.Provider value={activeAuthContext}>
          <SyncInternalContext.Provider value={syncContext}>{children}</SyncInternalContext.Provider>
        </AuthInternalContext.Provider>
      </MemoryRouter>
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
    (ViewService.getDatabaseRelations as jest.Mock).mockResolvedValue({});
    (ViewService.getMultiple as jest.Mock).mockResolvedValue([]);
    (ViewService.getTrash as jest.Mock).mockResolvedValue([]);
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
            name: workspaceBOutlineCalls < 3 ? 'workspace b old' : 'workspace b new',
          }),
        ],
        folderRid: workspaceBOutlineCalls < 3 ? '1-1' : '2-1',
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
