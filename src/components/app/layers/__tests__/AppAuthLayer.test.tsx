import { act, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';

import { UserService, WorkspaceService, AuthService } from '@/application/services/domains';
import { type UserWorkspaceInfo } from '@/application/types';
import { AuthInternalContext, type AuthInternalContextType } from '@/components/app/contexts/AuthInternalContext';
import { AppAuthLayer } from '@/components/app/layers/AppAuthLayer';
import { AFConfigContext } from '@/components/main/app.hooks';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/login' }),
  useNavigate: () => mockNavigate,
  useParams: () => ({}),
}));

jest.mock('@/application/session/token', () => ({
  invalidToken: jest.fn(),
  isTokenValid: jest.fn(() => true),
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerInfo.mockResolvedValue({
      enable_page_history: true,
      ai_enabled: true,
    } as never);
    mockOpenWorkspace.mockResolvedValue(undefined as never);
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
});
