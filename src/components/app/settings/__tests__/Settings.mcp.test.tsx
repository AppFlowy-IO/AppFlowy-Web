import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import {
  getMcpMemberStatus,
  listMcpAccessRequests,
  type McpAccessRequest,
  McpApiError,
  type McpMemberStatus,
} from '@/application/services/domains/mcp';
import { resetMcpConfigurationForTests } from '@/application/services/js-services/http/mcp-api';
import { Role, type UserWorkspaceInfo } from '@/application/types';
import {
  publishMcpPendingRequestCount,
  resetMcpPendingRequestCountsForTests,
  useMcpPendingRequestCount,
} from '@/components/app/settings/mcp/pendingRequestCount';
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
  getMcpMemberStatus: jest.fn(),
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

  it('lists MCP on a self-hosted server whose license does not include it, to ask for an upgrade', () => {
    setServerInfo({ status: 'available', info: { enable_page_history: true, mcp_status: 'license_required' } });
    renderSettings();

    expect(screen.getByTestId('settings-menu-ai_apps')).toBeTruthy();
  });

  it('ignores an mcp_status it does not know, as an older Web would', () => {
    setServerInfo({ status: 'available', info: { enable_page_history: true, mcp_status: 'something_newer' } });
    renderSettings();

    expect(screen.queryByTestId('settings-menu-ai_apps')).toBeNull();
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

interface Settle {
  resolve: (requests: Awaited<ReturnType<typeof listMcpAccessRequests>>) => void;
  reject: (error: unknown) => void;
}

describe('Settings AI apps badge', () => {
  const status = jest.mocked(getMcpMemberStatus);
  const requests = jest.mocked(listMcpAccessRequests);
  const signal = { signal: expect.any(AbortSignal) };
  const request: McpAccessRequest = {
    client_id: 'dcr-1',
    client_kind: 'dcr',
    redirect_hosts: [],
    loopback_only: true,
    app_id: null,
    app_name: null,
    verified_app: false,
    identity_verified: false,
    approval_key: 'dcr-1',
    requesters: [],
    first_requested_at: 0,
    last_requested_at: 0,
  };

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

  /** The MCP member status of a workspace owner with AI apps on. */
  function ownerStatus(overrides: Partial<McpMemberStatus> = {}): McpMemberStatus {
    return {
      workspace_id: 'workspace-1',
      endpoint: 'https://mcp.example.com/mcp',
      role: 'owner',
      eligible: true,
      ineligible_reason: null,
      requires_approval: true,
      approval_mode: 'verified_and_approved',
      client: null,
      approved_apps: [],
      enabled: true,
      ...overrides,
    };
  }

  /** Lets every settled MCP call reach its handlers. */
  function settleAnswers() {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  function pending(count: number): McpAccessRequest[] {
    return Array.from({ length: count }, (_, index) => ({
      ...request,
      client_id: `dcr-${index}`,
      approval_key: `dcr-${index}`,
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
    status.mockResolvedValue(ownerStatus());
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
    expect(status).toHaveBeenCalledWith('workspace-1', undefined, signal);
    expect(requests).toHaveBeenCalledWith('workspace-1', signal);
  });

  it('shows no badge without pending requests or when the list cannot be loaded', async () => {
    mockWorkspaceInfo = workspaceInfo(Role.Owner);
    requests.mockResolvedValueOnce([]);
    const { unmount } = renderSettings();

    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('settings-menu-ai_apps-badge')).toBeNull();
    unmount();

    requests.mockRejectedValueOnce(new McpApiError({ status: 503, reason: 'temporarily_unavailable' }));
    renderSettings();
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('settings-menu-ai_apps-badge')).toBeNull();
  });

  // The list answers any Cloud owner, and requests outlive AI apps being turned off by 30 days.
  it.each([
    ['AI apps are turned off', () => status.mockResolvedValue(ownerStatus({ enabled: false }))],
    [
      'the email gate excludes the owner',
      () => status.mockResolvedValue(ownerStatus({ eligible: false, ineligible_reason: 'email_not_allowed' })),
    ],
    [
      'the status is refused with mcp_disabled',
      () => status.mockRejectedValue(new McpApiError({ status: 503, error: 'mcp_disabled', reason: 'mcp_disabled' })),
    ],
    // The workspace list still says Owner, but the MCP service decides.
    ['the MCP service lists the caller as a member', () => status.mockResolvedValue(ownerStatus({ role: 'member' }))],
  ])('shows no badge for leftover requests the panel would not show when %s', async (_case, arrange) => {
    mockWorkspaceInfo = workspaceInfo(Role.Owner);
    arrange();
    requests.mockResolvedValue(pending(3));
    renderSettings();

    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
    await act(settleAnswers);
    expect(screen.queryByTestId('settings-menu-ai_apps-badge')).toBeNull();
  });

  it.each([
    ['answers', (settle: Settle) => settle.resolve(pending(3))],
    ['fails', (settle: Settle) => settle.reject(new McpApiError({ status: 0, error: 'timeout' }))],
  ])('keeps the panel’s count when the menu’s load %s after it', async (_case, finish) => {
    mockWorkspaceInfo = workspaceInfo(Role.Owner);
    let settle!: Settle;

    requests.mockReturnValue(
      new Promise((resolve, reject) => {
        settle = { resolve, reject };
      })
    );
    renderSettings();
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));

    // The panel loaded the list (or the owner approved one) while the menu's request was in flight.
    act(() => publishMcpPendingRequestCount('workspace-1', 2));
    expect(screen.getByTestId('settings-menu-ai_apps-badge').textContent).toBe('2');

    await act(async () => {
      finish(settle);
      await settleAnswers();
    });
    expect(screen.getByTestId('settings-menu-ai_apps-badge').textContent).toBe('2');
  });

  // Another reader of the badge starts a load while the menu's is in flight: the load started
  // last wins, whichever answers first.
  it.each([['first'], ['last']])('keeps the newer load’s count when the older one answers %s', async (order) => {
    mockWorkspaceInfo = workspaceInfo(Role.Owner);
    const settles: Settle[] = [];

    requests.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          settles.push({ resolve, reject });
        })
    );
    renderSettings();
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
    renderHook(() => useMcpPendingRequestCount('workspace-1', true));
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));

    const [older, newer] = settles;
    const answer = async (settle: Settle, count: number) => {
      await act(async () => {
        settle.resolve(pending(count));
        await settleAnswers();
      });
    };

    if (order === 'first') {
      await answer(older, 3);
      expect(screen.queryByTestId('settings-menu-ai_apps-badge')).toBeNull();
      await answer(newer, 1);
    } else {
      await answer(newer, 1);
      await answer(older, 3);
    }

    expect(screen.getByTestId('settings-menu-ai_apps-badge').textContent).toBe('1');
  });

  it('never asks for members', () => {
    mockWorkspaceInfo = workspaceInfo(Role.Member);
    renderSettings();

    expect(screen.getByTestId('settings-menu-ai_apps')).toBeTruthy();
    expect(status).not.toHaveBeenCalled();
    expect(requests).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-menu-ai_apps-badge')).toBeNull();
  });
});
