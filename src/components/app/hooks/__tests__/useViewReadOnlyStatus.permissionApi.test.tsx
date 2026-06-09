import EventEmitter from 'events';

import { act, renderHook, waitFor } from '@testing-library/react';

import { ERROR_CODE } from '@/application/constants';
import { AccessLevel, ObjectPermission, Types, View, ViewExtra, ViewLayout } from '@/application/types';
import { AuthInternalContext, AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { SyncInternalContext, SyncInternalContextType } from '@/components/app/contexts/SyncInternalContext';
import { getPlatform } from '@/utils/platform';

import { useViewReadOnlyStatus } from '../useViewOperations';

const getObjectPermission = jest.fn();

jest.mock('@/application/services/domains', () => ({
  CollabService: {
    getObjectPermission: (...args: unknown[]) => getObjectPermission(...args),
  },
  ViewService: {},
  WorkspaceService: {},
}));
jest.mock('@/application/view-loader', () => ({ openView: jest.fn() }));
jest.mock('@/utils/platform', () => ({ getPlatform: jest.fn(() => ({ isMobile: false })) }));

const mockGetPlatform = getPlatform as jest.MockedFunction<typeof getPlatform>;

function createPermission(overrides: Partial<ObjectPermission> = {}): ObjectPermission {
  return {
    object_id: 'view-id',
    collab_type: Types.Document,
    governing_view_id: 'view-id',
    access_level: AccessLevel.ReadAndWrite,
    can_read: true,
    can_write: true,
    can_comment: true,
    can_share: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createView(overrides: Partial<View>): View {
  return {
    view_id: 'view-id',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

function shareWithMeOutline(...children: View[]): View[] {
  return [
    createView({
      view_id: 'share-with-me-space',
      extra: { is_space: true, is_hidden_space: true } as ViewExtra,
      children,
    }),
  ];
}

function wrapper(eventEmitter = new EventEmitter()) {
  const authContextValue: AuthInternalContextType = {
    currentWorkspaceId: 'workspace-id',
    isAuthenticated: true,
    onChangeWorkspace: () => Promise.resolve(),
  };
  const syncContextValue: SyncInternalContextType = {
    registerSyncContext: () => ({ doc: {} as never }),
    eventEmitter,
    awarenessMap: {},
  } as unknown as SyncInternalContextType;

  return ({ children }: { children: React.ReactNode }) => (
    <AuthInternalContext.Provider value={authContextValue}>
      <SyncInternalContext.Provider value={syncContextValue}>{children}</SyncInternalContext.Provider>
    </AuthInternalContext.Provider>
  );
}

describe('useViewReadOnlyStatus permission API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPlatform.mockReturnValue({ isMobile: false } as ReturnType<typeof getPlatform>);
  });

  it('uses server write permission instead of the old outline fallback', async () => {
    getObjectPermission.mockResolvedValue(createPermission());
    const outline = shareWithMeOutline(createView({ view_id: 'view-id', access_level: AccessLevel.ReadOnly }));

    const { result } = renderHook(() => useViewReadOnlyStatus('view-id', outline), {
      wrapper: wrapper(),
    });

    expect(result.current).toBe(true);

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
    expect(getObjectPermission).toHaveBeenCalledWith('workspace-id', 'view-id', 0, expect.any(AbortSignal));
  });

  it('queries database views by folder view permission identity', async () => {
    getObjectPermission.mockResolvedValue(
      createPermission({
        object_id: 'database-view-id',
        collab_type: Types.Document,
        governing_view_id: 'database-view-id',
      })
    );
    const databaseView = createView({
      view_id: 'database-view-id',
      layout: ViewLayout.Grid,
      extra: { database_id: 'database-id' } as ViewExtra,
    });

    renderHook(() => useViewReadOnlyStatus('database-view-id', [], databaseView), {
      wrapper: wrapper(),
    });

    await waitFor(() => {
      expect(getObjectPermission).toHaveBeenCalledWith(
        'workspace-id',
        'database-view-id',
        Types.Document,
        expect.any(AbortSignal)
      );
    });
  });

  it('refetches when permission change notification targets the view', async () => {
    const eventEmitter = new EventEmitter();

    getObjectPermission.mockResolvedValueOnce(createPermission()).mockResolvedValueOnce(
      createPermission({
        access_level: AccessLevel.ReadOnly,
        can_write: false,
        can_comment: false,
      })
    );

    const { result } = renderHook(() => useViewReadOnlyStatus('view-id', []), {
      wrapper: wrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    act(() => {
      eventEmitter.emit('permission-changed', { objectId: 'view-id' });
    });

    expect(result.current).toBe(true);

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    expect(getObjectPermission).toHaveBeenCalledTimes(2);
  });

  it('refetches database view permission when notification targets the folder view', async () => {
    const eventEmitter = new EventEmitter();
    const databaseView = createView({
      view_id: 'database-view-id',
      layout: ViewLayout.Grid,
      extra: { database_id: 'database-id' } as ViewExtra,
    });

    getObjectPermission
      .mockResolvedValueOnce(
        createPermission({
          object_id: 'database-view-id',
          collab_type: Types.Document,
          governing_view_id: 'database-view-id',
        })
      )
      .mockResolvedValueOnce(
        createPermission({
          object_id: 'database-view-id',
          collab_type: Types.Document,
          governing_view_id: 'database-view-id',
          access_level: AccessLevel.ReadOnly,
          can_write: false,
          can_comment: false,
        })
      );

    const { result } = renderHook(() => useViewReadOnlyStatus('database-view-id', [], databaseView), {
      wrapper: wrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    act(() => {
      eventEmitter.emit('permission-changed', { objectId: 'database-view-id' });
    });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    await waitFor(() => {
      expect(getObjectPermission).toHaveBeenCalledTimes(2);
    });
    expect(getObjectPermission).toHaveBeenLastCalledWith(
      'workspace-id',
      'database-view-id',
      Types.Document,
      expect.any(AbortSignal)
    );
    expect(result.current).toBe(true);
  });

  it('stays read-only when a notification-triggered permission refresh fails', async () => {
    const eventEmitter = new EventEmitter();

    getObjectPermission.mockResolvedValueOnce(createPermission()).mockRejectedValueOnce(new Error('network'));

    const { result } = renderHook(() => useViewReadOnlyStatus('view-id', []), {
      wrapper: wrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    act(() => {
      eventEmitter.emit('permission-changed', { objectId: 'view-id' });
    });

    expect(result.current).toBe(true);

    await waitFor(() => {
      expect(getObjectPermission).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('retries a permission refresh after the server returns too many requests', async () => {
    const eventEmitter = new EventEmitter();

    getObjectPermission
      .mockResolvedValueOnce(createPermission())
      .mockRejectedValueOnce({
        code: ERROR_CODE.TOO_MANY_REQUESTS,
        message: 'permission resolver is busy',
        retryAfterSecs: 1,
      })
      .mockResolvedValueOnce(createPermission());

    const { result } = renderHook(() => useViewReadOnlyStatus('view-id', []), {
      wrapper: wrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    jest.useFakeTimers();
    try {
      act(() => {
        eventEmitter.emit('permission-changed', { objectId: 'view-id' });
      });

      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
      expect(getObjectPermission).toHaveBeenCalledTimes(2);

      act(() => {
        jest.advanceTimersByTime(999);
      });
      expect(getObjectPermission).toHaveBeenCalledTimes(2);

      await act(async () => {
        jest.advanceTimersByTime(1);
        await Promise.resolve();
      });

      expect(getObjectPermission).toHaveBeenCalledTimes(3);
      expect(result.current).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores older permission responses after a newer refresh resolves', async () => {
    const eventEmitter = new EventEmitter();
    const first = deferred<ObjectPermission>();
    const second = deferred<ObjectPermission>();

    getObjectPermission.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useViewReadOnlyStatus('view-id', []), {
      wrapper: wrapper(eventEmitter),
    });

    act(() => {
      eventEmitter.emit('permission-changed', { objectId: 'view-id' });
    });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    await act(async () => {
      second.resolve(
        createPermission({
          access_level: AccessLevel.ReadOnly,
          can_write: false,
          can_comment: false,
        })
      );
      await second.promise;
    });

    expect(result.current).toBe(true);

    await act(async () => {
      first.resolve(createPermission());
      await first.promise;
    });

    expect(result.current).toBe(true);
  });

  it('refetches when a permission change targets the governing view', async () => {
    const eventEmitter = new EventEmitter();

    getObjectPermission
      .mockResolvedValueOnce(createPermission({ governing_view_id: 'parent-view-id' }))
      .mockResolvedValueOnce(
        createPermission({
          governing_view_id: 'parent-view-id',
          access_level: AccessLevel.ReadOnly,
          can_write: false,
          can_comment: false,
        })
      );

    const { result } = renderHook(() => useViewReadOnlyStatus('view-id', []), {
      wrapper: wrapper(eventEmitter),
    });

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    act(() => {
      eventEmitter.emit('permission-changed', { objectId: 'parent-view-id' });
    });

    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    await waitFor(() => {
      expect(getObjectPermission).toHaveBeenCalledTimes(2);
    });
    expect(result.current).toBe(true);
  });
});
