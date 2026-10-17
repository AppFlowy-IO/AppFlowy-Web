import { act, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';

import { AuthService, UserService, WorkspaceService } from '@/application/services/domains';
import { type UserWorkspaceInfo } from '@/application/types';
import { AppProvider } from '@/components/app/AppProvider';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { AFConfigContext } from '@/components/main/app.hooks';

const mockNavigate = jest.fn();
let mockWorkspaceId: string | undefined;
// `<instance>:<routed workspace>` for every workspace an AppSyncLayer instance
// commits with. A remount starts a new instance number.
const mockSyncLayerRuns: string[] = [];
let mockSyncLayerInstances = 0;

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: `/app/${mockWorkspaceId}` }),
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

jest.mock('@/components/app/workspaces/NoWorkspace', () => ({ NoWorkspace: () => null }));

jest.mock('@/components/app/layers/AppSyncLayer', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { AuthInternalContext } = jest.requireActual<typeof import('@/components/app/contexts/AuthInternalContext')>(
    '@/components/app/contexts/AuthInternalContext'
  );

  return {
    AppSyncLayer: ({ children }: { children: React.ReactNode }) => {
      const [instance] = React.useState(() => ++mockSyncLayerInstances);
      const workspaceId = React.useContext(AuthInternalContext)?.currentWorkspaceId;

      React.useEffect(() => {
        mockSyncLayerRuns.push(`${instance}:${workspaceId}`);
      }, [instance, workspaceId]);

      return <>{children}</>;
    },
  };
});

jest.mock('@/components/app/layers/AppBusinessLayer', () => ({
  AppBusinessLayer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function createWorkspaceInfo(selectedWorkspaceId: string): UserWorkspaceInfo {
  return {
    userId: 'user-1',
    selectedWorkspace: { id: selectedWorkspaceId },
    workspaces: [{ id: 'workspace-a' }, { id: 'workspace-b' }, { id: 'workspace-c' }],
  } as UserWorkspaceInfo;
}

function SelectedWorkspace() {
  const selectedWorkspaceId = useContext(AuthInternalContext)?.userWorkspaceInfo?.selectedWorkspace?.id;

  return <output data-testid='selected-workspace'>{selectedWorkspaceId}</output>;
}

const config = {
  isAuthenticated: true,
  authenticatedUserId: 'user-1',
  updateCurrentUser: jest.fn(),
  openLoginModal: jest.fn(),
};

// A fresh element per render so a rerender re-reads the mocked route params.
const renderApp = () => (
  <AFConfigContext.Provider value={config}>
    <AppProvider>
      <SelectedWorkspace />
    </AppProvider>
  </AFConfigContext.Provider>
);

describe('AppProvider sync layer identity', () => {
  const mockGetWorkspaceInfo = UserService.getWorkspaceInfo as jest.MockedFunction<typeof UserService.getWorkspaceInfo>;
  const mockOpenWorkspace = WorkspaceService.open as jest.MockedFunction<typeof WorkspaceService.open>;
  const mockGetServerInfo = AuthService.getServerInfo as jest.MockedFunction<typeof AuthService.getServerInfo>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceId = undefined;
    mockSyncLayerRuns.length = 0;
    mockSyncLayerInstances = 0;
    mockGetWorkspaceInfo.mockReset();
    mockGetServerInfo.mockResolvedValue({ enable_page_history: true, ai_enabled: true } as never);
    mockOpenWorkspace.mockResolvedValue(undefined as never);
  });

  it('keeps one sync layer while the server-side visiting workspace moves under an unchanged route', async () => {
    const realNow = Date.now;
    const now = jest.spyOn(Date, 'now');

    // A deep link into a workspace other than the account's visiting one.
    mockWorkspaceId = 'workspace-a';
    mockGetWorkspaceInfo
      .mockResolvedValueOnce(createWorkspaceInfo('workspace-b'))
      // The auto-switch opens the routed workspace.
      .mockResolvedValueOnce(createWorkspaceInfo('workspace-a'))
      // Another tab then opens a third workspace, which this tab's focus
      // revalidation reads back as the visiting workspace.
      .mockResolvedValueOnce(createWorkspaceInfo('workspace-c'));

    const view = render(renderApp());

    try {
      await waitFor(() => expect(screen.getByTestId('selected-workspace').textContent).toBe('workspace-a'));
      expect(mockOpenWorkspace).toHaveBeenCalledWith('workspace-a');

      // Revalidation is throttled until the loaded info is 30 s old.
      now.mockImplementation(() => realNow() + 60_000);
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });

      await waitFor(() => expect(screen.getByTestId('selected-workspace').textContent).toBe('workspace-c'));
      expect(mockGetWorkspaceInfo).toHaveBeenCalledTimes(3);
      expect(mockSyncLayerRuns).toEqual(['1:workspace-a']);
    } finally {
      view.unmount();
      now.mockRestore();
    }
  });

  it('remounts the sync layer when the routed workspace changes, not in place', async () => {
    mockWorkspaceId = 'workspace-a';
    mockGetWorkspaceInfo
      .mockResolvedValueOnce(createWorkspaceInfo('workspace-a'))
      .mockResolvedValueOnce(createWorkspaceInfo('workspace-b'));

    const view = render(renderApp());

    await waitFor(() => expect(mockSyncLayerRuns).toEqual(['1:workspace-a']));

    // Following a link into another workspace changes the route first; the
    // auto-switch moves the server's visiting workspace after it.
    mockWorkspaceId = 'workspace-b';
    view.rerender(renderApp());

    await waitFor(() => expect(screen.getByTestId('selected-workspace').textContent).toBe('workspace-b'));
    expect(mockOpenWorkspace).toHaveBeenCalledWith('workspace-b');
    expect(mockSyncLayerRuns).toEqual(['1:workspace-a', '2:workspace-b']);
    view.unmount();
  });
});
