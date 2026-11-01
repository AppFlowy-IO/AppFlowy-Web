import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { listMcpAccessRequests, McpApiError, resetMcpConfigurationForTests } from '@/application/services/domains/mcp';
import { Role, type UserWorkspaceInfo } from '@/application/types';
import { resetMcpPendingRequestCountsForTests } from '@/components/app/settings/mcp/pendingRequestCount';
import { SERVER_INFO_LOADING, type ServerInfoState, updateServerInfo } from '@/utils/server-info';

import { SettingsDialog } from '../Settings';

let mockWorkspaceId = 'workspace-1';
let mockWorkspaceInfo: UserWorkspaceInfo | undefined;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// Modules read the runtime config while they load, so it lives inside the mock.
jest.mock('@/utils/runtime-config', () => {
  const config: Record<string, string> = {};

  return {
    mockRuntimeConfig: config,
    getConfigValue: (key: string, fallback: string) => config[key] ?? fallback,
    isDevelopmentOrTestEnvironment: () => true,
    isLocalDevelopment: () => false,
  };
});
// Inside the app the auth layer refreshes server-info; Settings only reads the snapshot.
jest.mock('@/components/app/hooks/useServerInfo', () => ({ useServerInfo: jest.fn() }));
jest.mock('@/components/app/app.hooks', () => ({
  useCurrentWorkspaceId: () => mockWorkspaceId,
  useUserWorkspaceInfo: () => mockWorkspaceInfo,
  useIsOfficialHosted: () => false,
}));
jest.mock('@/application/services/domains/mcp', () => ({
  ...jest.requireActual('@/application/services/domains/mcp'),
  listMcpAccessRequests: jest.fn(),
}));
jest.mock('@/components/app/settings/AccountAppPanel', () => ({
  AccountAppPanel: () => <div data-testid='account-panel' />,
}));
jest.mock('@/components/app/settings/ProfilePanel', () => ({ ProfilePanel: () => null }));
jest.mock('@/components/app/settings/MembersPanel', () => ({ MembersPanel: () => null }));
jest.mock('@/components/app/settings/ManageDataPanel', () => ({ ManageDataPanel: () => null }));
// Settings only owns the menu entry and the lazy slot; the panel has its own tests.
jest.mock('@/components/app/settings/mcp/McpPanel', () => ({
  __esModule: true,
  default: ({ workspaceId }: { workspaceId: string }) => <div data-testid='mcp-panel' data-workspace-id={workspaceId} />,
}));

const mockConfig = jest.requireMock<{ mockRuntimeConfig: Record<string, string> }>(
  '@/utils/runtime-config'
).mockRuntimeConfig;

// Without APPFLOWY_BASE_URL in the config, the snapshot belongs to the default Cloud URL.
const CLOUD = 'https://test.appflowy.cloud';

function serverInfo(mcpUrl?: string): ServerInfoState {
  return { status: 'available', info: { enable_page_history: true, mcp_url: mcpUrl } };
}

function setServerInfo(state: ServerInfoState) {
  act(() => updateServerInfo(CLOUD, state));
}

function renderSettings({ search = '', onRequestOpen = jest.fn() } = {}) {
  return render(
    <MemoryRouter initialEntries={[`/${search}`]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <SettingsDialog open onClose={jest.fn()} onRequestOpen={onRequestOpen} />
    </MemoryRouter>
  );
}

describe('Settings AI apps entry', () => {
  beforeEach(() => {
    mockWorkspaceId = 'workspace-1';
    Object.keys(mockConfig).forEach((key) => delete mockConfig[key]);
    resetMcpConfigurationForTests();
    updateServerInfo(CLOUD, SERVER_INFO_LOADING);
  });

  it('lists AI apps after Connections when Cloud server-info names the MCP service', () => {
    setServerInfo(serverInfo('https://mcp.example.com'));
    renderSettings();

    const items = screen.getAllByTestId(/^settings-menu-/).map((item) => item.getAttribute('data-testid'));

    expect(screen.getByTestId('settings-menu-ai_apps').textContent).toBe('settings.mcp.menuLabel');
    expect(items.indexOf('settings-menu-ai_apps')).toBe(items.indexOf('settings-menu-connections') + 1);
  });

  it('lists AI apps for the Web’s APPFLOWY_MCP_BASE_URL without waiting for server-info', () => {
    mockConfig.APPFLOWY_MCP_BASE_URL = 'https://mcp.example.com';
    renderSettings();

    expect(screen.getByTestId('settings-menu-ai_apps')).toBeTruthy();
  });

  it('adds AI apps once server-info resolves', () => {
    renderSettings();

    expect(screen.queryByTestId('settings-menu-ai_apps')).toBeNull();
    setServerInfo(serverInfo('https://mcp.example.com'));
    expect(screen.getByTestId('settings-menu-ai_apps')).toBeTruthy();
  });

  it('hides AI apps when the MCP service is not configured', () => {
    setServerInfo(serverInfo());
    renderSettings();

    expect(screen.queryByTestId('settings-menu-ai_apps')).toBeNull();
    expect(screen.getByTestId('settings-menu-connections')).toBeTruthy();
  });

  it('lazily opens the panel for the current workspace', async () => {
    setServerInfo(serverInfo('https://mcp.example.com'));
    renderSettings();

    expect(screen.queryByTestId('mcp-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-menu-ai_apps'));

    const panel = await screen.findByTestId('mcp-panel');

    expect(panel.getAttribute('data-workspace-id')).toBe('workspace-1');
    expect(screen.queryByTestId('account-panel')).toBeNull();
  });

  it('opens AI apps from the ?setting=AI_APPS deep link', async () => {
    setServerInfo(serverInfo('https://mcp.example.com'));
    const onRequestOpen = jest.fn();

    renderSettings({ search: '?setting=AI_APPS', onRequestOpen });

    expect(await screen.findByTestId('mcp-panel')).toBeTruthy();
    expect(onRequestOpen).toHaveBeenCalled();
  });

  it('keeps a deep link waiting while server-info loads, then opens the panel', async () => {
    renderSettings({ search: '?setting=AI_APPS' });

    expect(screen.getByRole('status', { name: 'settings.mcp.loading' })).toBeTruthy();
    expect(screen.queryByTestId('account-panel')).toBeNull();

    setServerInfo(serverInfo('https://mcp.example.com'));
    expect(await screen.findByTestId('mcp-panel')).toBeTruthy();
  });

  it('falls back to Account when a deep link names AI apps on a server without MCP', () => {
    renderSettings({ search: '?setting=AI_APPS' });
    setServerInfo({ status: 'unsupported' });

    expect(screen.queryByTestId('mcp-panel')).toBeNull();
    expect(screen.getByTestId('account-panel')).toBeTruthy();
  });
});

describe('Settings AI apps badge', () => {
  const requests = jest.mocked(listMcpAccessRequests);
  const request = { client_id: 'dcr-1', client_kind: 'dcr' as const, redirect_hosts: [], loopback_only: true };

  function workspaceInfo(role: Role): UserWorkspaceInfo {
    const workspace = {
      id: 'workspace-1',
      name: 'Engineering',
      role,
      icon: '',
      memberCount: 2,
      databaseStorageId: '',
      createdAt: '',
    };

    return { userId: 'user-1', selectedWorkspace: workspace, workspaces: [workspace] };
  }

  function pending(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      ...request,
      client_id: `dcr-${index}`,
      requesters: [],
      first_requested_at: 0,
      last_requested_at: 0,
    }));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockWorkspaceId = 'workspace-1';
    Object.keys(mockConfig).forEach((key) => delete mockConfig[key]);
    resetMcpConfigurationForTests();
    resetMcpPendingRequestCountsForTests();
    updateServerInfo(CLOUD, SERVER_INFO_LOADING);
    setServerInfo(serverInfo('https://mcp.example.com'));
  });

  afterAll(() => {
    mockWorkspaceInfo = undefined;
  });

  it('shows owners how many approval requests are waiting', async () => {
    mockWorkspaceInfo = workspaceInfo(Role.Owner);
    requests.mockResolvedValue(pending(3));
    renderSettings();

    const badge = await screen.findByTestId('settings-menu-ai_apps-badge');

    expect(badge.textContent).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe('settings.mcp.pendingRequestsBadge');
    expect(requests).toHaveBeenCalledWith('workspace-1', { signal: expect.any(AbortSignal) });
  });

  it('shows no badge without pending requests or when the list cannot be loaded', async () => {
    mockWorkspaceInfo = workspaceInfo(Role.Owner);
    requests.mockResolvedValueOnce([]);
    const { unmount } = renderSettings();

    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('settings-menu-ai_apps-badge')).toBeNull();
    unmount();

    requests.mockRejectedValueOnce(new McpApiError({ status: 403, reason: 'email_not_allowed' }));
    renderSettings();
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('settings-menu-ai_apps-badge')).toBeNull();
  });

  it('never asks for members', () => {
    mockWorkspaceInfo = workspaceInfo(Role.Member);
    renderSettings();

    expect(screen.getByTestId('settings-menu-ai_apps')).toBeTruthy();
    expect(requests).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-menu-ai_apps-badge')).toBeNull();
  });
});
