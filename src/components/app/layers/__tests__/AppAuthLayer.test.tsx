import { act, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';

import { UserService, WorkspaceService, AuthService } from '@/application/services/domains';
import { invalidToken } from '@/application/session/token';
import { type UserWorkspaceInfo } from '@/application/types';
import { AuthInternalContext, type AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { AppAuthLayer } from '@/components/app/layers/AppAuthLayer';
import { AFConfigContext } from '@/components/main/app.hooks';

const mockNavigate = jest.fn();
let mockWorkspaceId: string | undefined;
let mockPathname = '/login';

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => mockNavigate,
  useParams: () => ({ workspaceId: mockWorkspaceId }),
}));

jest.mock('@/application/session/token', () => ({
  invalidToken: jest.fn(),
}));

jest.mock('@/application/services/domains', () => ({
  AuthService: {
    getServerInfo: jest.fn(),
  },
  UserService: {
    getWorkspaceInfo: jest.fn(),
  },
  WorkspaceService: {
    open: jest.fn(),
  },
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createWorkspaceInfo(selectedWorkspaceId: string): UserWorkspaceInfo {
  return {
    selectedWorkspace: { id: selectedWorkspaceId },
    workspaces: [{ id: 'workspace-old' }, { id: 'workspace-new' }],
  } as UserWorkspaceInfo;
}

describe('AppAuthLayer workspace info loading', () => {
  const mockGetWorkspaceInfo = UserService.getWorkspaceInfo as jest.MockedFunction<typeof UserService.getWorkspaceInfo>;
  const mockOpenWorkspace = WorkspaceService.open as jest.MockedFunction<typeof WorkspaceService.open>;
  const mockGetServerInfo = AuthService.getServerInfo as jest.MockedFunction<typeof AuthService.getServerInfo>;
  const mockInvalidToken = invalidToken as jest.MockedFunction<typeof invalidToken>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceId = undefined;
    mockPathname = '/login';
    mockGetServerInfo.mockResolvedValue({
      enable_page_history: true,
      ai_enabled: true,
    } as never);
    mockOpenWorkspace.mockResolvedValue(undefined as never);
  });

  it('redirects an unauthenticated app route without timer-based polling', async () => {
    mockPathname = '/app/workspace-old';

    render(
      <AFConfigContext.Provider
        value={{
          isAuthenticated: false,
          updateCurrentUser: jest.fn(),
          openLoginModal: jest.fn(),
        }}
      >
        <AppAuthLayer>
          <div />
        </AppAuthLayer>
      </AFConfigContext.Provider>
    );

    await waitFor(() => expect(mockInvalidToken).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith(`/login?redirectTo=${encodeURIComponent(window.location.href)}`);
    expect(mockGetWorkspaceInfo).not.toHaveBeenCalled();
  });

  it('clears workspace-scoped state as soon as authentication is invalidated', async () => {
    mockGetWorkspaceInfo.mockResolvedValue(createWorkspaceInfo('workspace-old') as never);

    function CaptureAuthContext() {
      const authContext = useContext(AuthInternalContext);

      return (
        <div data-testid='selected-workspace'>{authContext?.userWorkspaceInfo?.selectedWorkspace.id ?? 'none'}</div>
      );
    }

    const view = render(
      <AFConfigContext.Provider
        value={{
          isAuthenticated: true,
          updateCurrentUser: jest.fn(),
          openLoginModal: jest.fn(),
        }}
      >
        <AppAuthLayer>
          <CaptureAuthContext />
        </AppAuthLayer>
      </AFConfigContext.Provider>
    );

    await waitFor(() => expect(screen.getByTestId('selected-workspace').textContent).toBe('workspace-old'));

    view.rerender(
      <AFConfigContext.Provider
        value={{
          isAuthenticated: false,
          updateCurrentUser: jest.fn(),
          openLoginModal: jest.fn(),
        }}
      >
        <AppAuthLayer>
          <CaptureAuthContext />
        </AppAuthLayer>
      </AFConfigContext.Provider>
    );

    await waitFor(() => expect(screen.getByTestId('selected-workspace').textContent).toBe('none'));
  });

  it('forces a fresh workspace-info request after switching workspace and ignores stale responses', async () => {
    const staleWorkspaceInfo = createDeferred<UserWorkspaceInfo>();
    const freshWorkspaceInfo = createDeferred<UserWorkspaceInfo>();
    let latestAuthContext: AuthInternalContextType | null = null;

    mockGetWorkspaceInfo
      .mockReturnValueOnce(staleWorkspaceInfo.promise as never)
      .mockReturnValueOnce(freshWorkspaceInfo.promise as never);

    function CaptureAuthContext() {
      latestAuthContext = useContext(AuthInternalContext);

      return (
        <div data-testid='selected-workspace'>
          {latestAuthContext?.userWorkspaceInfo?.selectedWorkspace.id ?? 'none'}
        </div>
      );
    }

    render(
      <AFConfigContext.Provider
        value={{
          isAuthenticated: true,
          updateCurrentUser: jest.fn(),
          openLoginModal: jest.fn(),
        }}
      >
        <AppAuthLayer>
          <CaptureAuthContext />
        </AppAuthLayer>
      </AFConfigContext.Provider>
    );

    await waitFor(() => expect(mockGetWorkspaceInfo).toHaveBeenCalledTimes(1));

    let switchPromise!: Promise<void>;

    act(() => {
      switchPromise = latestAuthContext!.onChangeWorkspace('workspace-new');
    });

    await waitFor(() => expect(mockOpenWorkspace).toHaveBeenCalledWith('workspace-new'));
    await waitFor(() => expect(mockGetWorkspaceInfo).toHaveBeenCalledTimes(2));

    await act(async () => {
      freshWorkspaceInfo.resolve(createWorkspaceInfo('workspace-new'));
      await switchPromise;
    });

    expect(screen.getByTestId('selected-workspace').textContent).toBe('workspace-new');
    expect(mockNavigate).toHaveBeenCalledWith('/app/workspace-new');

    await act(async () => {
      staleWorkspaceInfo.resolve(createWorkspaceInfo('workspace-old'));
      await staleWorkspaceInfo.promise;
    });

    expect(screen.getByTestId('selected-workspace').textContent).toBe('workspace-new');
  });

  it('does not reopen the previous URL workspace while a manual switch settles', async () => {
    const callOrder: string[] = [];
    let latestAuthContext: AuthInternalContextType | null = null;

    mockWorkspaceId = 'workspace-old';
    mockNavigate.mockImplementation((path: string) => {
      callOrder.push(`navigate:${path}`);
      mockWorkspaceId = path.split('/')[2];
    });
    mockOpenWorkspace.mockImplementation(async (workspaceId: string) => {
      callOrder.push(`open:${workspaceId}`);
      return undefined as never;
    });
    mockGetWorkspaceInfo
      .mockResolvedValueOnce(createWorkspaceInfo('workspace-old') as never)
      .mockImplementationOnce(async () => {
        callOrder.push('refresh-workspace-info');
        return createWorkspaceInfo('workspace-new') as never;
      });

    function CaptureAuthContext() {
      latestAuthContext = useContext(AuthInternalContext);

      return (
        <div data-testid='selected-workspace'>
          {latestAuthContext?.userWorkspaceInfo?.selectedWorkspace.id ?? 'none'}
        </div>
      );
    }

    render(
      <AFConfigContext.Provider
        value={{
          isAuthenticated: true,
          updateCurrentUser: jest.fn(),
          openLoginModal: jest.fn(),
        }}
      >
        <AppAuthLayer>
          <CaptureAuthContext />
        </AppAuthLayer>
      </AFConfigContext.Provider>
    );

    await waitFor(() => expect(screen.getByTestId('selected-workspace').textContent).toBe('workspace-old'));

    await act(async () => {
      await latestAuthContext!.onChangeWorkspace('workspace-new');
    });

    expect(callOrder).toEqual(['open:workspace-new', 'refresh-workspace-info', 'navigate:/app/workspace-new']);
    expect(mockOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('selected-workspace').textContent).toBe('workspace-new');
  });

  it('keeps sync limits unresolved and retries after a transient server-info failure', async () => {
    jest.useFakeTimers();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let latestAuthContext: AuthInternalContextType | null = null;

    mockGetWorkspaceInfo.mockResolvedValue(createWorkspaceInfo('workspace-old') as never);
    mockGetServerInfo
      .mockReset()
      .mockRejectedValueOnce(new Error('server unavailable'))
      .mockResolvedValueOnce({
        enable_page_history: true,
        ai_enabled: true,
        max_update_bytes: 8_000_000,
        max_slow_sync_update_bytes: 64_000_000,
      } as never);

    function CaptureAuthContext() {
      latestAuthContext = useContext(AuthInternalContext);
      return null;
    }

    const view = render(
      <AFConfigContext.Provider
        value={{
          isAuthenticated: true,
          updateCurrentUser: jest.fn(),
          openLoginModal: jest.fn(),
        }}
      >
        <AppAuthLayer>
          <CaptureAuthContext />
        </AppAuthLayer>
      </AFConfigContext.Provider>
    );

    try {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mockGetServerInfo).toHaveBeenCalledTimes(1);
      expect(latestAuthContext?.syncLimitsLoaded).toBe(false);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(1_000);
      });

      expect(mockGetServerInfo).toHaveBeenCalledTimes(2);
      expect(latestAuthContext?.syncLimitsLoaded).toBe(true);
      expect(latestAuthContext?.maxUpdateBytes).toBe(8_000_000);
      expect(latestAuthContext?.maxSlowSyncUpdateBytes).toBe(64_000_000);
    } finally {
      view.unmount();
      errorSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('aborts an in-flight server-info request when the auth layer unmounts', async () => {
    const serverInfo = createDeferred<Awaited<ReturnType<typeof AuthService.getServerInfo>>>();

    mockGetWorkspaceInfo.mockResolvedValue(createWorkspaceInfo('workspace-old') as never);
    mockGetServerInfo.mockReset().mockReturnValue(serverInfo.promise);

    const view = render(
      <AFConfigContext.Provider
        value={{
          isAuthenticated: true,
          updateCurrentUser: jest.fn(),
          openLoginModal: jest.fn(),
        }}
      >
        <AppAuthLayer>
          <div />
        </AppAuthLayer>
      </AFConfigContext.Provider>
    );

    await waitFor(() => expect(mockGetServerInfo).toHaveBeenCalledTimes(1));

    const signal = mockGetServerInfo.mock.calls[0][0];

    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
