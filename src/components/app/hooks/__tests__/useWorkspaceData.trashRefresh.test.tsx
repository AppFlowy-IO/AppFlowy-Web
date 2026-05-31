import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

import { APP_EVENTS } from '@/application/constants';
import { AccessService, ViewService } from '@/application/services/domains';
import { Role, View, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';

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
    (ViewService.getDatabaseRelations as jest.Mock).mockResolvedValue({});
    (ViewService.getMultiple as jest.Mock).mockResolvedValue([]);
    (ViewService.getOutline as jest.Mock).mockResolvedValue({
      outline: [],
      folderRid: '1-1',
    });
  });

  it('refreshes stale trash state when a remote restore adds the view back to the folder', async () => {
    const eventEmitter = new EventEmitter();
    const restoredView = createView(restoredViewId);
    let trashResponse: View[] = [restoredView];

    (ViewService.getTrash as jest.Mock).mockImplementation(async () => trashResponse);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.trashList?.map((view) => view.view_id)).toEqual([restoredViewId]);
    });

    const initialTrashRequestCount = (ViewService.getTrash as jest.Mock).mock.calls.length;

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
      expect(ViewService.getTrash).toHaveBeenCalledTimes(initialTrashRequestCount + 1);
      expect(result.current.trashList).toEqual([]);
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

    (ViewService.getTrash as jest.Mock).mockImplementation(async () => trashResponse);

    const { result } = renderHook(() => useWorkspaceData(), {
      wrapper: createWrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current.trashList?.map((view) => view.view_id)).toEqual([restoredViewId]);
    });

    const initialTrashRequestCount = (ViewService.getTrash as jest.Mock).mock.calls.length;

    trashResponse = [];

    let revalidationResult: string | undefined;

    await act(async () => {
      revalidationResult = await result.current.revalidateSidebarOutline?.([]);
    });

    expect(revalidationResult).toBe('changed');

    await waitFor(() => {
      expect(ViewService.getTrash).toHaveBeenCalledTimes(initialTrashRequestCount + 1);
      expect(result.current.trashList).toEqual([]);
    });
  });

  it('ignores stale trash refresh responses from overlapping folder notifications', async () => {
    const eventEmitter = new EventEmitter();
    const restoredView = createView(restoredViewId);
    const trashRequests: Array<ReturnType<typeof createDeferred<View[]>>> = [];

    (ViewService.getTrash as jest.Mock).mockImplementation(() => {
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
      eventEmitter.emit(APP_EVENTS.FOLDER_VIEW_CHANGED, {
        changeType: 1,
        folderRid: '2-1',
        parentViewId: 'space-id',
        viewJson: JSON.stringify(restoredView),
      });
      eventEmitter.emit(APP_EVENTS.FOLDER_OUTLINE_CHANGED, {
        folderRid: '3-1',
        outlineDiffJson: JSON.stringify([{ op: 'replace', path: '/outline', value: [] }]),
      });
    });

    await waitFor(() => {
      expect(trashRequests).toHaveLength(3);
    });

    await act(async () => {
      trashRequests[2].resolve([]);
    });

    await waitFor(() => {
      expect(result.current.trashList).toEqual([]);
    });

    await act(async () => {
      trashRequests[1].resolve([restoredView]);
    });

    await waitFor(() => {
      expect(result.current.trashList).toEqual([]);
    });
  });
});
