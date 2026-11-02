import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AuthService, UserService } from '@/application/services/domains';
import {
  approveMcpClient,
  createMcpAccessRequest,
  createMcpAuthorizationCode,
  denyMcpAuthorization,
  getMcpClientInfo,
  getMcpMemberStatus,
  McpApiError,
  type McpClientInfo,
  type McpMemberClientStatus,
  type McpMemberStatus,
} from '@/application/services/domains/mcp';
import { resetMcpConfigurationForTests } from '@/application/services/js-services/http/mcp-api';
import { signOutCurrentUser } from '@/application/session/sign-out';
import { getTokenParsed } from '@/application/session/token';
import { Role, type Workspace } from '@/application/types';

import McpAuthorizePage from '../McpAuthorizePage';

let mockAuthenticated = true;
let mockCurrentUser: { uid: string; email: string | null } | undefined = { uid: '42', email: 'owner@example.com' };

// Real English strings through the real i18next, so assertions read like the page and catch escaping.
jest.mock('react-i18next', () => {
  const { mcpTestT } = jest.requireActual('@/components/mcp/__tests__/mcpTestI18n');

  return { useTranslation: () => ({ t: mcpTestT }) };
});

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
jest.mock('@/application/services/domains/mcp', () => ({
  ...jest.requireActual('@/application/services/domains/mcp'),
  getMcpClientInfo: jest.fn(),
  getMcpMemberStatus: jest.fn(),
  createMcpAuthorizationCode: jest.fn(),
  approveMcpClient: jest.fn(),
  createMcpAccessRequest: jest.fn(),
  denyMcpAuthorization: jest.fn(),
}));
jest.mock('@/application/services/domains', () => ({
  AuthService: { getServerInfo: jest.fn() },
  UserService: { getWorkspaceInfo: jest.fn() },
}));
jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
  captureTokenSession: jest.fn(),
  invalidTokenForSession: jest.fn(),
}));
jest.mock('@/application/session/sign-out', () => ({ signOutCurrentUser: jest.fn() }));
jest.mock('@/components/main/app.hooks', () => ({
  useIsAuthenticatedOptional: () => mockAuthenticated,
  useCurrentUserOptional: () => mockCurrentUser,
}));

const CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const OWNER_WS = '11111111-1111-4111-8111-111111111111';
const MEMBER_WS = '22222222-2222-4222-8222-222222222222';
const GUEST_WS = '33333333-3333-4333-8333-333333333333';
const RESOURCE = 'https://mcp.test.appflowy.cloud/mcp';
const CODE_REDIRECT = `${REDIRECT_URI}?code=code-1&state=state-1&iss=https%3A%2F%2Fmcp.test.appflowy.cloud`;
const DENY_REDIRECT = `${REDIRECT_URI}?error=access_denied&state=state-1`;

const claude: McpClientInfo = {
  client_id: CLIENT_ID,
  client_name: 'Claude',
  client_uri: 'https://claude.ai',
  logo_uri: 'https://claude.ai/logo.png',
  client_kind: 'cimd',
  client_host: 'claude.ai',
  redirect_hosts: ['claude.ai'],
  loopback_only: false,
};

const localTool: McpClientInfo = {
  client_id: 'dcr-client-1',
  client_name: null,
  client_uri: null,
  logo_uri: null,
  client_kind: 'dcr',
  client_host: 'localhost',
  redirect_hosts: ['localhost'],
  loopback_only: true,
};

function workspace(id: string, name: string, role?: Role): Workspace {
  return { id, name, role, icon: '', memberCount: 2, databaseStorageId: '', createdAt: '' };
}

const ownerWorkspace = workspace(OWNER_WS, 'Engineering', Role.Owner);
const memberWorkspace = workspace(MEMBER_WS, 'Design', Role.Member);
const guestWorkspace = workspace(GUEST_WS, 'Partner', Role.Guest);

function memberStatus(
  overrides: Partial<McpMemberStatus> = {},
  client: Partial<McpMemberClientStatus> = {}
): McpMemberStatus {
  return {
    workspace_id: OWNER_WS,
    endpoint: RESOURCE,
    role: 'owner',
    eligible: true,
    ineligible_reason: null,
    requires_approval: false,
    client: {
      ...claude,
      known: true,
      blocked: false,
      approved: true,
      request_pending: false,
      connected: false,
      ...client,
    },
    ...overrides,
  };
}

function authorizePath(overrides: Record<string, string | null> = {}) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 'state-1',
    scope: 'read write',
    resource: RESOURCE,
  });

  Object.entries(overrides).forEach(([key, value]) => {
    if (value === null) params.delete(key);
    else params.set(key, value);
  });
  return `/oauth/mcp/authorize?${params.toString()}`;
}

function LocationProbe() {
  const location = useLocation();

  return <div data-testid='location'>{`${location.pathname}${location.search}`}</div>;
}

function renderPage(path = authorizePath()) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route path='/oauth/mcp/authorize' element={<McpAuthorizePage />} />
        <Route path='/login' element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The consent view with the selected workspace's status loaded. */
async function renderConsent(path?: string) {
  renderPage(path);
  await screen.findByTestId('mcp-consent-page');
  await waitFor(() => expect(screen.queryByTestId('mcp-consent-status-loading')).toBeNull());
}

function byTestId<T extends HTMLElement = HTMLElement>(testId: string) {
  return screen.getByTestId<T>(testId);
}

/**
 * The page went to sign-in: the login URL carries only an opaque flow ID, and
 * this tab's session storage keeps the request it returns to (W-B).
 */
async function loginContinuation() {
  const location = await screen.findByTestId('location');
  const url = new URL(location.textContent ?? '', 'http://localhost');

  expect(url.pathname).toBe('/login');
  expect(Array.from(url.searchParams.keys()).sort()).toEqual(['force', 'mcpAuth']);
  expect(url.searchParams.get('force')).toBe('true');
  expect(location.textContent).not.toMatch(/client_id|code_challenge|state-1|claude/);
  expect(window.localStorage.getItem('redirectTo')).toBeNull();

  const stored = JSON.parse(window.sessionStorage.getItem('mcpConsentAuthContinuation') ?? 'null');

  expect(stored?.flowId).toBe(url.searchParams.get('mcpAuth'));
  // The Web's own sign-in window (MCP_CONSENT_AUTH_CONTINUATION_TTL_MS), 10 minutes.
  expect(stored.expiresAt - Date.now()).toBeGreaterThan(9 * 60_000);
  expect(stored.expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  return stored.redirectTo as string;
}

const mockConfig = jest.requireMock<{ mockRuntimeConfig: Record<string, string> }>(
  '@/utils/runtime-config'
).mockRuntimeConfig;

const mocked = {
  serverInfo: jest.mocked(AuthService.getServerInfo),
  clientInfo: jest.mocked(getMcpClientInfo),
  status: jest.mocked(getMcpMemberStatus),
  code: jest.mocked(createMcpAuthorizationCode),
  approve: jest.mocked(approveMcpClient),
  accessRequest: jest.mocked(createMcpAccessRequest),
  deny: jest.mocked(denyMcpAuthorization),
  workspaces: jest.mocked(UserService.getWorkspaceInfo),
  token: jest.mocked(getTokenParsed),
  signOut: jest.mocked(signOutCurrentUser),
};

const assign = jest.fn();
const originalLocation = window.location;

beforeAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } });
});

afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetMcpConfigurationForTests();
  // Configured through the Web's own override unless a test removes it.
  Object.keys(mockConfig).forEach((key) => delete mockConfig[key]);
  mockConfig.APPFLOWY_MCP_BASE_URL = 'https://mcp.test.appflowy.cloud';
  mockAuthenticated = true;
  mockCurrentUser = { uid: '42', email: 'owner@example.com' };
  mocked.serverInfo.mockResolvedValue({ enable_page_history: true });
  mocked.clientInfo.mockResolvedValue(claude);
  mocked.workspaces.mockResolvedValue({
    userId: 'user-uuid',
    selectedWorkspace: ownerWorkspace,
    workspaces: [ownerWorkspace, memberWorkspace],
  });
  mocked.status.mockResolvedValue(memberStatus());
  mocked.code.mockResolvedValue({ redirect_url: CODE_REDIRECT });
  mocked.approve.mockResolvedValue({ approved: true });
  mocked.deny.mockResolvedValue({ redirect_url: DENY_REDIRECT });
  mocked.token.mockReturnValue({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-uuid', email: 'owner@example.com' },
  });
});

describe('McpAuthorizePage request checks', () => {
  it.each([
    ['a missing code_challenge', { code_challenge: null }],
    ['an empty client_id', { client_id: '' }],
    ['a client_id with surrounding whitespace', { client_id: ` ${CLIENT_ID}` }],
    ['a non-code response_type', { response_type: 'token' }],
    ['plain PKCE', { code_challenge_method: 'plain' }],
    ['a script redirect_uri', { redirect_uri: 'javascript:alert(1)' }],
    ['a redirect_uri that is not a URL', { redirect_uri: 'callback' }],
  ])('rejects %s without loading or redirecting', async (_label, overrides) => {
    mockAuthenticated = false;
    renderPage(authorizePath(overrides));

    expect(byTestId('mcp-consent-error').getAttribute('data-reason')).toBe('invalid_request');
    expect(byTestId('mcp-consent-error-message').textContent).toBe(
      'This connection link is invalid or incomplete. Start again from your AI app.'
    );
    expect(screen.queryByTestId('location')).toBeNull();
    expect(mocked.clientInfo).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('rejects a repeated parameter', () => {
    renderPage(`${authorizePath()}&client_id=other`);

    expect(byTestId('mcp-consent-error').getAttribute('data-reason')).toBe('invalid_request');
  });

  it('explains when neither the Web config nor Cloud server-info names an MCP service, even before sign-in', async () => {
    mockAuthenticated = false;
    delete mockConfig.APPFLOWY_MCP_BASE_URL;
    renderPage();

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe('not_configured');
    expect(mocked.serverInfo).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('location')).toBeNull();
    expect(mocked.clientInfo).not.toHaveBeenCalled();
  });

  it('sends signed-out users to sign in and back to this request', async () => {
    mockAuthenticated = false;
    const path = authorizePath();

    renderPage(path);

    expect(await loginContinuation()).toBe(path);
    expect(mocked.clientInfo).not.toHaveBeenCalled();
    expect(mocked.workspaces).not.toHaveBeenCalled();
    // The Web's own APPFLOWY_MCP_BASE_URL needs no server-info round trip.
    expect(mocked.serverInfo).not.toHaveBeenCalled();
  });

  it('waits for Cloud server-info to name the MCP service before sending a signed-out user to sign in', async () => {
    let resolveInfo!: (info: Awaited<ReturnType<typeof AuthService.getServerInfo>>) => void;

    mockAuthenticated = false;
    delete mockConfig.APPFLOWY_MCP_BASE_URL;
    mocked.serverInfo.mockReturnValue(
      new Promise((resolve) => {
        resolveInfo = resolve;
      })
    );
    const path = authorizePath();

    renderPage(path);

    expect(byTestId('mcp-consent-loading')).toBeTruthy();
    expect(screen.queryByTestId('mcp-consent-error')).toBeNull();
    expect(screen.queryByTestId('location')).toBeNull();

    await act(async () => {
      resolveInfo({ enable_page_history: true, mcp_url: 'https://mcp.discovered.example.com' });
    });

    expect(await loginContinuation()).toBe(path);
  });

  it('says it is retrying while Cloud server-info fails, then continues to sign-in once it answers', async () => {
    jest.useFakeTimers();
    // The server-info loop logs each failed request.
    const logError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      mockAuthenticated = false;
      delete mockConfig.APPFLOWY_MCP_BASE_URL;
      mocked.serverInfo
        .mockRejectedValueOnce(Object.assign(new Error('Bad gateway'), { code: 502 }))
        .mockResolvedValueOnce({ enable_page_history: true, mcp_url: 'https://mcp.discovered.example.com' });
      const path = authorizePath();

      renderPage(path);

      expect((await screen.findByTestId('mcp-consent-retrying')).textContent).toBe(
        "Can't reach the AppFlowy server right now. Trying again…"
      );
      expect(screen.queryByTestId('mcp-consent-error')).toBeNull();
      expect(screen.queryByTestId('location')).toBeNull();

      // The server-info loop retries after a second.
      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });

      expect(await loginContinuation()).toBe(path);
      expect(mocked.serverInfo).toHaveBeenCalledTimes(2);
    } finally {
      logError.mockRestore();
      jest.useRealTimers();
    }
  });

  it('loads the consent view with the MCP service Cloud server-info names', async () => {
    delete mockConfig.APPFLOWY_MCP_BASE_URL;
    mocked.serverInfo.mockResolvedValue({ enable_page_history: true, mcp_url: 'https://mcp.discovered.example.com' });

    await renderConsent();

    expect(mocked.serverInfo).toHaveBeenCalledTimes(1);
    expect(mocked.clientInfo).toHaveBeenCalledWith(CLIENT_ID, expect.anything());
  });

  it('renders only the framed message inside a frame', () => {
    const topDescriptor = Object.getOwnPropertyDescriptor(window, 'top') as PropertyDescriptor;

    mockAuthenticated = false;
    Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) });
    try {
      renderPage();

      expect(byTestId('mcp-consent-framed').textContent).toBe(
        "For your security, this page can't be shown inside another site."
      );
      expect(screen.queryByTestId('mcp-consent-page')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByTestId('location')).toBeNull();
      expect(mocked.clientInfo).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'top', topDescriptor);
    }
  });
});

describe('McpAuthorizePage consent view', () => {
  it('shows a verified remote client, the account and the requested permissions', async () => {
    await renderConsent();

    expect(byTestId('mcp-consent-title').textContent).toBe('Claude wants to access your AppFlowy workspace');
    expect(byTestId('mcp-consent-client-name').textContent).toBe('Claude');
    expect(byTestId('mcp-consent-publisher').textContent).toContain('claude.ai');
    expect(screen.getByTestId('mcp-client-verified-badge').textContent).toBe('Verified domain');
    expect(screen.queryByTestId('mcp-client-unverified-badge')).toBeNull();
    expect(byTestId('mcp-consent-redirect-host').textContent).toBe('claude.ai');
    expect(screen.queryByTestId('mcp-consent-local-app')).toBeNull();
    expect(screen.queryByTestId('mcp-consent-localhost-warning')).toBeNull();
    expect(byTestId('mcp-consent-signed-in').textContent).toBe('Signed in as owner@example.com');

    const read = byTestId<HTMLInputElement>('mcp-consent-scope-read');

    expect(read.checked).toBe(true);
    expect(read.disabled).toBe(true);
    expect(byTestId<HTMLInputElement>('mcp-consent-scope-write').checked).toBe(true);
    expect(byTestId<HTMLInputElement>('mcp-consent-scope-admin').checked).toBe(false);
    expect(screen.getByText(/The app can only access what you can access in this workspace/)).toBeTruthy();
    expect(mocked.clientInfo).toHaveBeenCalledWith(CLIENT_ID, expect.objectContaining({ signal: expect.anything() }));
    expect(mocked.status).toHaveBeenCalledWith(
      OWNER_WS,
      CLIENT_ID,
      expect.objectContaining({ signal: expect.anything() })
    );
    expect(byTestId<HTMLButtonElement>('mcp-consent-allow').disabled).toBe(false);
  });

  it('marks a self-registered local client as unverified and warns about the loopback redirect', async () => {
    mocked.clientInfo.mockResolvedValue(localTool);
    mocked.status.mockResolvedValue(memberStatus({}, { ...localTool }));
    await renderConsent(
      authorizePath({ client_id: 'dcr-client-1', redirect_uri: 'http://127.0.0.1:4567/callback', scope: null })
    );

    expect(byTestId('mcp-consent-client-name').textContent).toBe('localhost');
    expect(screen.getByTestId('mcp-client-unverified-badge').textContent).toBe('Not verified');
    expect(byTestId('mcp-consent-redirect-host').textContent).toBe('127.0.0.1');
    expect(byTestId('mcp-consent-local-app').textContent).toBe('Runs on your computer');
    expect(byTestId('mcp-consent-localhost-warning').textContent).toContain(
      'Only continue if you started this connection yourself.'
    );
    // Nothing requested: read only.
    expect(byTestId<HTMLInputElement>('mcp-consent-scope-write').checked).toBe(false);
    expect(byTestId<HTMLInputElement>('mcp-consent-scope-admin').checked).toBe(false);
  });

  it('falls back to "Unknown app" for a client without name or host', async () => {
    mocked.clientInfo.mockResolvedValue({ ...localTool, client_host: null, loopback_only: false });
    await renderConsent();

    expect(byTestId('mcp-consent-client-name').textContent).toBe('Unknown app');
  });

  it('disables guest workspaces and preselects the first eligible one', async () => {
    mocked.workspaces.mockResolvedValue({
      userId: 'user-uuid',
      selectedWorkspace: guestWorkspace,
      workspaces: [guestWorkspace, memberWorkspace],
    });
    mocked.status.mockResolvedValue(memberStatus({ workspace_id: MEMBER_WS, role: 'member' }));
    await renderConsent();

    const guest = byTestId<HTMLInputElement>(`mcp-consent-workspace-option-${GUEST_WS}`);

    expect(guest.disabled).toBe(true);
    expect(guest.checked).toBe(false);
    expect(document.getElementById(guest.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      "Guests can't connect AI apps"
    );
    expect(byTestId<HTMLInputElement>(`mcp-consent-workspace-option-${MEMBER_WS}`).checked).toBe(true);
    expect(mocked.status).toHaveBeenCalledTimes(1);
    expect(mocked.status).toHaveBeenCalledWith(MEMBER_WS, CLIENT_ID, expect.anything());
  });

  it('prefers the requested workspace and reloads the status when another is chosen', async () => {
    await renderConsent(authorizePath({ workspace_id: MEMBER_WS }));

    expect(byTestId<HTMLInputElement>(`mcp-consent-workspace-option-${MEMBER_WS}`).checked).toBe(true);
    expect(mocked.status).toHaveBeenLastCalledWith(MEMBER_WS, CLIENT_ID, expect.anything());

    fireEvent.click(byTestId(`mcp-consent-workspace-option-${OWNER_WS}`));
    await waitFor(() => expect(mocked.status).toHaveBeenLastCalledWith(OWNER_WS, CLIENT_ID, expect.anything()));
    expect(byTestId<HTMLInputElement>(`mcp-consent-workspace-option-${OWNER_WS}`).checked).toBe(true);
  });

  it('discloses that read access includes the member list with names and emails', async () => {
    await renderConsent();

    const read = byTestId('mcp-consent-scope-read');

    expect(document.getElementById(read.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Pages, databases and comments you can access, plus the workspace member list with names and emails'
    );
  });

  it('shows the role in each workspace so same-named workspaces can be told apart', async () => {
    const twin = workspace('44444444-4444-4444-8444-444444444444', 'Engineering', Role.Member);

    mocked.workspaces.mockResolvedValue({
      userId: 'user-uuid',
      selectedWorkspace: ownerWorkspace,
      workspaces: [ownerWorkspace, twin, guestWorkspace],
    });
    await renderConsent();

    expect(byTestId(`mcp-consent-workspace-role-${OWNER_WS}`).textContent).toBe('Owner');
    expect(byTestId(`mcp-consent-workspace-role-${twin.id}`).textContent).toBe('Member');
    // Guests see why they cannot pick the workspace instead.
    expect(screen.queryByTestId(`mcp-consent-workspace-role-${GUEST_WS}`)).toBeNull();
    expect(
      within(byTestId(`mcp-consent-workspace-option-${GUEST_WS}`).closest('label') as HTMLElement).getByText(
        "Guests can't connect AI apps"
      )
    ).toBeTruthy();
  });

  it('shows the already-connected notice', async () => {
    mocked.status.mockResolvedValue(memberStatus({}, { connected: true }));
    await renderConsent();

    // Each authorization is its own connection (one per device), so allowing again adds one.
    expect(byTestId('mcp-consent-already-connected').textContent).toBe(
      "You're already connected with Claude. Allowing again adds another connection; your existing ones keep working."
    );
  });
});

describe('McpAuthorizePage trust and scope hints', () => {
  const webAgent: McpClientInfo = {
    client_id: 'dcr-web-agent',
    client_name: 'Claude',
    client_uri: null,
    logo_uri: null,
    client_kind: 'dcr',
    client_host: 'agents.example.com',
    redirect_hosts: ['agents.example.com'],
    loopback_only: false,
    app_id: null,
    app_name: null,
    verified_app: false,
  };
  const webAgentPath = (overrides: Record<string, string | null> = {}) =>
    authorizePath({
      client_id: webAgent.client_id,
      redirect_uri: 'https://agents.example.com/oauth/callback',
      ...overrides,
    });

  it('links to the setup instructions in a new tab without a referrer', async () => {
    await renderConsent();

    const link = byTestId<HTMLAnchorElement>('mcp-consent-learn-more');

    expect(link.textContent).toBe('Learn more about AppFlowy MCP');
    expect(link.getAttribute('href')).toBe('/oauth/mcp/setup');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('says when the app asked only to read, until the user grants more', async () => {
    await renderConsent(authorizePath({ scope: null }));

    expect(byTestId('mcp-consent-read-only-hint').textContent).toBe(
      'Claude asked only to view and search. To let it make changes, tick Create and add.'
    );
    fireEvent.click(byTestId('mcp-consent-scope-write'));
    expect(screen.queryByTestId('mcp-consent-read-only-hint')).toBeNull();
    fireEvent.click(byTestId('mcp-consent-scope-write'));
    expect(byTestId('mcp-consent-read-only-hint')).toBeTruthy();
  });

  it('gives no read-only hint when the app asked to write', async () => {
    await renderConsent();

    expect(screen.queryByTestId('mcp-consent-read-only-hint')).toBeNull();
  });

  it('names a recognized web app from the catalog and marks it verified', async () => {
    const claudeApp: McpClientInfo = {
      ...webAgent,
      client_id: 'dcr-claude',
      client_name: 'claude-connector',
      client_host: 'claude.ai',
      redirect_hosts: ['claude.ai'],
      app_id: 'claude',
      app_name: 'Claude',
      verified_app: true,
      identity_verified: true,
    };

    mocked.clientInfo.mockResolvedValue(claudeApp);
    mocked.status.mockResolvedValue(memberStatus({}, { ...claudeApp }));
    await renderConsent(
      authorizePath({ client_id: 'dcr-claude', redirect_uri: 'https://claude.ai/api/mcp/auth_callback' })
    );

    expect(byTestId('mcp-consent-client-name').textContent).toBe('Claude');
    expect(byTestId('mcp-consent-publisher').textContent).toContain('claude.ai');
    expect(within(byTestId('mcp-consent-publisher')).getByTestId('mcp-client-verified-app-badge').textContent).toBe(
      'Verified app'
    );
    expect(screen.queryByTestId('mcp-client-unverified-badge')).toBeNull();
    // A recognized app needs no "I recognize this host".
    expect(screen.queryByTestId('mcp-consent-acknowledge')).toBeNull();
    expect(byTestId<HTMLButtonElement>('mcp-consent-allow').disabled).toBe(false);
  });

  it('names a recognized app that runs on the computer from the catalog without calling it verified', async () => {
    // Any program on the computer can register Cursor's callbacks, so the catalog cannot prove it.
    const cursorApp: McpClientInfo = {
      ...webAgent,
      client_id: 'dcr-cursor',
      client_name: 'cursor-mcp',
      client_host: 'www.cursor.com',
      redirect_hosts: ['www.cursor.com', 'localhost'],
      app_id: 'cursor',
      app_name: 'Cursor',
      verified_app: true,
      identity_verified: false,
    };

    mocked.clientInfo.mockResolvedValue(cursorApp);
    mocked.status.mockResolvedValue(memberStatus({}, { ...cursorApp }));
    await renderConsent(authorizePath({ client_id: 'dcr-cursor', redirect_uri: 'http://127.0.0.1:8787/callback' }));

    expect(byTestId('mcp-consent-client-name').textContent).toBe('Cursor');
    const publisher = byTestId('mcp-consent-publisher');

    expect(publisher.textContent).toContain('www.cursor.com');
    expect(within(publisher).queryByTestId('mcp-client-verified-app-badge')).toBeNull();
    expect(within(publisher).getByTestId('mcp-client-unverified-badge')).toBeTruthy();
    // It returns to this computer, and the page says so.
    expect(byTestId('mcp-consent-local-app')).toBeTruthy();
    expect(byTestId('mcp-consent-localhost-warning')).toBeTruthy();
    // The catalog still names it, so there is no host to vouch for.
    expect(screen.queryByTestId('mcp-consent-acknowledge')).toBeNull();
    expect(byTestId<HTMLButtonElement>('mcp-consent-allow').disabled).toBe(false);
  });

  it('makes the user vouch for the return host of an unrecognized self-registered app before allowing', async () => {
    mocked.clientInfo.mockResolvedValue(webAgent);
    mocked.status.mockResolvedValue(memberStatus({}, { ...webAgent }));
    await renderConsent(webAgentPath());

    const allow = byTestId<HTMLButtonElement>('mcp-consent-allow');
    const acknowledge = byTestId<HTMLInputElement>('mcp-consent-acknowledge');

    expect(screen.getByTestId('mcp-client-unverified-badge')).toBeTruthy();
    expect(byTestId('mcp-consent-acknowledge-host').textContent).toBe(
      'I recognize agents.example.com and started this connection'
    );
    expect(acknowledge.checked).toBe(false);
    expect(allow.disabled).toBe(true);

    fireEvent.click(acknowledge);
    expect(allow.disabled).toBe(false);
    fireEvent.click(allow);

    expect(await screen.findByTestId('mcp-consent-done')).toBeTruthy();
    expect(mocked.code).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: webAgent.client_id,
        redirect_uri: 'https://agents.example.com/oauth/callback',
      }),
      expect.anything()
    );
  });

  it('asks an owner to vouch for the host before approving for the whole workspace', async () => {
    mocked.clientInfo.mockResolvedValue(webAgent);
    mocked.status.mockResolvedValue(memberStatus({ requires_approval: true }, { ...webAgent, approved: false }));
    await renderConsent(webAgentPath());

    const approve = byTestId<HTMLButtonElement>('mcp-consent-approve-and-allow');

    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(mocked.approve).not.toHaveBeenCalled();

    fireEvent.click(byTestId('mcp-consent-acknowledge'));
    expect(approve.disabled).toBe(false);
  });

  it('lets a member ask for approval without vouching, since asking grants nothing', async () => {
    mocked.clientInfo.mockResolvedValue(webAgent);
    mocked.status.mockResolvedValue(
      memberStatus({ role: 'member', requires_approval: true }, { ...webAgent, approved: false })
    );
    await renderConsent(webAgentPath());

    expect(screen.queryByTestId('mcp-consent-acknowledge')).toBeNull();
    expect(byTestId<HTMLButtonElement>('mcp-consent-request-approval').disabled).toBe(false);
  });

  it.each([
    ['raycast://mcp-oauth-callback', 'raycast://mcp-oauth-callback'],
    // A client ID metadata document may list any scheme, with a host that looks like a web domain.
    ['x-app://claude.ai/cb', 'x-app://claude.ai'],
    ['com.example.app:/callback', 'com.example.app:'],
  ])('shows the private-use return address %s with its scheme, as an app on the computer', async (redirect, label) => {
    await renderConsent(authorizePath({ redirect_uri: redirect }));

    expect(byTestId('mcp-consent-redirect-host').textContent).toBe(label);
    expect(byTestId('mcp-consent-local-app').textContent).toBe('Runs on your computer');
    expect(byTestId('mcp-consent-localhost-warning').textContent).toContain(
      'Only continue if you started this connection yourself.'
    );
    expect(screen.queryByTestId('mcp-consent-acknowledge')).toBeNull();
    expect(byTestId<HTMLButtonElement>('mcp-consent-allow').disabled).toBe(false);
  });

  it('does not ask about a loopback return address, which gets its own warning', async () => {
    mocked.clientInfo.mockResolvedValue(localTool);
    mocked.status.mockResolvedValue(memberStatus({}, { ...localTool }));
    await renderConsent(authorizePath({ client_id: 'dcr-client-1', redirect_uri: 'http://127.0.0.1:4567/callback' }));

    expect(byTestId('mcp-consent-localhost-warning')).toBeTruthy();
    expect(screen.queryByTestId('mcp-consent-acknowledge')).toBeNull();
    expect(byTestId<HTMLButtonElement>('mcp-consent-allow').disabled).toBe(false);
  });
});

describe('McpAuthorizePage decisions', () => {
  it('allows with the chosen scopes and no session tokens, then returns to the app', async () => {
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-scope-write'));
    fireEvent.click(byTestId('mcp-consent-scope-admin'));
    fireEvent.click(byTestId('mcp-consent-allow'));

    expect(await screen.findByTestId('mcp-consent-done')).toBeTruthy();
    expect(screen.getByText('You can close this tab and return to Claude.')).toBeTruthy();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(CODE_REDIRECT));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(mocked.code).toHaveBeenCalledTimes(1);

    const [body] = mocked.code.mock.calls[0];

    expect(body).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      workspace_id: OWNER_WS,
      state: 'state-1',
      scope: 'read admin',
      resource: RESOURCE,
    });
    expect(JSON.stringify(body)).not.toMatch(/refresh|expires/);
  });

  it('lets an owner approve the app and allow in one step', async () => {
    mocked.status.mockResolvedValue(memberStatus({ requires_approval: true }, { approved: false }));
    await renderConsent();

    expect(byTestId('mcp-consent-owner-approval-notice').textContent).toBe(
      'Engineering requires approval for new AI apps. As an owner, you can approve Claude now.'
    );
    expect(screen.queryByTestId('mcp-consent-allow')).toBeNull();

    fireEvent.click(byTestId('mcp-consent-approve-and-allow'));

    expect(await screen.findByTestId('mcp-consent-done')).toBeTruthy();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(CODE_REDIRECT));
    expect(mocked.approve).toHaveBeenCalledWith(OWNER_WS, CLIENT_ID, expect.anything());
    expect(mocked.approve.mock.invocationCallOrder[0]).toBeLessThan(mocked.code.mock.invocationCallOrder[0]);
    expect(mocked.code.mock.calls[0][0]).toEqual(
      expect.objectContaining({ workspace_id: OWNER_WS, scope: 'read write', state: 'state-1' })
    );
  });

  it('turns a failed code request after an owner approval into a plain Allow retry', async () => {
    mocked.status.mockResolvedValue(memberStatus({ requires_approval: true }, { approved: false }));
    mocked.code.mockRejectedValueOnce(new McpApiError({ status: 503, reason: 'temporarily_unavailable' }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-approve-and-allow'));

    expect((await screen.findByTestId('mcp-consent-inline-error')).getAttribute('data-reason')).toBe(
      'temporarily_unavailable'
    );
    expect(byTestId<HTMLButtonElement>('mcp-consent-allow').disabled).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('lets a member request approval', async () => {
    mocked.status.mockResolvedValue(memberStatus({ role: 'member', requires_approval: true }, { approved: false }));
    mocked.accessRequest.mockResolvedValue({
      requested: true,
      request: {
        ...claude,
        requesters: [{ user_uuid: 'user-uuid', requested_at: 1_760_000_000 }],
        first_requested_at: 1_760_000_000,
        last_requested_at: 1_760_000_000,
      },
    });
    await renderConsent();

    expect(byTestId('mcp-consent-member-approval-notice').textContent).toBe(
      'A workspace owner needs to approve Claude before you can connect it to Engineering.'
    );
    fireEvent.click(byTestId('mcp-consent-request-approval'));

    expect(await screen.findByTestId('mcp-consent-request-sent')).toBeTruthy();
    expect(screen.getByText(/Workspace owners can approve Claude in Settings/)).toBeTruthy();
    expect(mocked.accessRequest).toHaveBeenCalledWith(OWNER_WS, CLIENT_ID, expect.anything());
    expect(mocked.code).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows a pending request with the request button disabled', async () => {
    mocked.status.mockResolvedValue(
      memberStatus({ role: 'member', requires_approval: true }, { approved: false, request_pending: true })
    );
    await renderConsent();

    expect(byTestId('mcp-consent-request-pending').textContent).toBe(
      'Approval requested. Return to Claude and connect again once an owner approves it.'
    );
    expect(byTestId<HTMLButtonElement>('mcp-consent-request-approval').disabled).toBe(true);
  });

  it('re-reads the status when the approval is already in place', async () => {
    mocked.status
      .mockResolvedValueOnce(memberStatus({ role: 'member', requires_approval: true }, { approved: false }))
      .mockResolvedValueOnce(memberStatus({ role: 'member', requires_approval: true }, { approved: true }));
    mocked.accessRequest.mockRejectedValue(new McpApiError({ status: 409, reason: 'already_approved' }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-request-approval'));

    expect(await screen.findByTestId('mcp-consent-allow')).toBeTruthy();
    expect(mocked.status).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('mcp-consent-inline-error')).toBeNull();
  });

  it('explains a full approval queue inline', async () => {
    mocked.status.mockResolvedValue(memberStatus({ role: 'member', requires_approval: true }, { approved: false }));
    mocked.accessRequest.mockRejectedValue(new McpApiError({ status: 429, reason: 'request_limit' }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-request-approval'));

    const error = await screen.findByTestId('mcp-consent-inline-error');

    expect(error.getAttribute('data-reason')).toBe('request_limit');
    expect(error.textContent).toBe(
      'This workspace has too many pending approval requests. Ask a workspace owner to review them in Settings → MCP.'
    );
    expect(screen.queryByTestId('mcp-consent-request-sent')).toBeNull();
  });

  it('tells a former owner that only owners can approve, then shows the member choice', async () => {
    mocked.status
      .mockResolvedValueOnce(memberStatus({ requires_approval: true }, { approved: false }))
      .mockResolvedValueOnce(memberStatus({ role: 'member', requires_approval: true }, { approved: false }));
    mocked.approve.mockRejectedValue(new McpApiError({ status: 403, reason: 'not_workspace_owner' }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-approve-and-allow'));

    expect(await screen.findByTestId('mcp-consent-request-approval')).toBeTruthy();
    expect(byTestId('mcp-consent-inline-error').textContent).toBe('Only workspace owners can approve AI apps.');
    expect(mocked.code).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('cancels through the server-validated deny redirect', async () => {
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-deny'));

    expect(await screen.findByTestId('mcp-consent-cancelled')).toBeTruthy();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(DENY_REDIRECT));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(mocked.deny).toHaveBeenCalledWith(
      { client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state: 'state-1' },
      expect.anything()
    );
    expect(mocked.code).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mcp-consent-page')).toBeNull();
  });

  it.each([
    ['the consent view', 'mcp-consent-deny'],
    ['an error view', 'mcp-consent-error-cancel'],
  ])('says the request was cancelled when Cancel from %s opens an app through a private-use scheme', async (_from, button) => {
    // The browser hands raycast:// to the app and keeps this tab open.
    const deniedToApp = 'raycast://mcp-oauth-callback?error=access_denied&state=state-1';

    mocked.deny.mockResolvedValue({ redirect_url: deniedToApp });
    if (button === 'mcp-consent-error-cancel') {
      mocked.status.mockResolvedValue(memberStatus({ eligible: false, ineligible_reason: 'email_not_allowed' }));
    }

    renderPage(authorizePath({ redirect_uri: 'raycast://mcp-oauth-callback' }));
    fireEvent.click(await screen.findByTestId(button));

    const cancelled = await screen.findByTestId('mcp-consent-cancelled');

    expect(cancelled.textContent).toContain('Request cancelled');
    expect(cancelled.textContent).toContain('You can close this tab and return to Claude.');
    await waitFor(() => expect(assign).toHaveBeenCalledWith(deniedToApp));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[aria-busy]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('never redirects when the server refuses the deny', async () => {
    mocked.deny.mockRejectedValue(new McpApiError({ status: 400, reason: 'invalid_redirect_uri' }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-deny'));

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe('invalid_redirect_uri');
    expect(screen.queryByTestId('mcp-consent-error-retry')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('can go back to the consent view after a transient deny failure', async () => {
    mocked.deny.mockRejectedValueOnce(new McpApiError({ status: 0, error: 'network_error' }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-deny'));
    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe('temporarily_unavailable');
    fireEvent.click(byTestId('mcp-consent-error-retry'));

    expect(await screen.findByTestId('mcp-consent-page')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('switches accounts by signing out and returning to sign-in', async () => {
    const path = authorizePath();

    await renderConsent(path);
    fireEvent.click(byTestId('mcp-consent-switch-account'));

    expect(mocked.signOut).toHaveBeenCalledWith('42');
    expect(await loginContinuation()).toBe(path);
  });
});

describe('McpAuthorizePage reasons', () => {
  it.each([
    ['email_not_allowed', memberStatus({ eligible: false, ineligible_reason: 'email_not_allowed' })],
    ['guest_not_allowed', memberStatus({ eligible: false, ineligible_reason: 'guest_not_allowed', role: 'guest' })],
    ['client_blocked', memberStatus({}, { blocked: true })],
    ['unknown_client', memberStatus({}, { known: false })],
  ])('shows the %s error view for a refusing member status', async (reason, status) => {
    mocked.status.mockResolvedValue(status);
    renderPage();

    const error = await screen.findByTestId('mcp-consent-error');

    expect(error.getAttribute('data-reason')).toBe(reason);
    expect(screen.queryByTestId('mcp-consent-page')).toBeNull();
  });

  it('offers another account when the email is not allowed', async () => {
    mocked.status.mockResolvedValue(memberStatus({ eligible: false, ineligible_reason: 'email_not_allowed' }));
    renderPage();

    expect((await screen.findByTestId('mcp-consent-error-message')).textContent).toBe(
      'Your administrator only allows certain accounts to connect AI apps.'
    );
    expect(byTestId('mcp-consent-switch-account')).toBeTruthy();
  });

  it('shows unknown_client when the client cannot be found', async () => {
    mocked.clientInfo.mockRejectedValue(new McpApiError({ status: 404, error: 'not_found', reason: 'unknown_client' }));
    renderPage();

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe('unknown_client');
    expect(screen.queryByTestId('mcp-consent-error-retry')).toBeNull();
  });

  it('shows no_workspace for an account without workspaces', async () => {
    mocked.workspaces.mockResolvedValue({ userId: 'user-uuid', selectedWorkspace: ownerWorkspace, workspaces: [] });
    renderPage();

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe('no_workspace');
    expect(mocked.status).not.toHaveBeenCalled();
  });

  it('shows guest_not_allowed when every workspace is a guest workspace', async () => {
    mocked.workspaces.mockResolvedValue({
      userId: 'user-uuid',
      selectedWorkspace: guestWorkspace,
      workspaces: [guestWorkspace],
    });
    renderPage();

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe('guest_not_allowed');
    expect(mocked.status).not.toHaveBeenCalled();
  });

  it('retries a transient load failure', async () => {
    mocked.clientInfo.mockRejectedValueOnce(new McpApiError({ status: 0, error: 'timeout' }));
    renderPage();

    const error = await screen.findByTestId('mcp-consent-error');

    expect(error.getAttribute('data-reason')).toBe('temporarily_unavailable');
    fireEvent.click(byTestId('mcp-consent-error-retry'));
    expect(await screen.findByTestId('mcp-consent-page')).toBeTruthy();
    expect(mocked.clientInfo).toHaveBeenCalledTimes(2);
  });

  it('keeps the consent view with a retry when the status fails transiently', async () => {
    mocked.status.mockRejectedValueOnce(new McpApiError({ status: 502, reason: 'temporarily_unavailable' }));
    await renderConsent();

    expect(byTestId('mcp-consent-status-error').getAttribute('data-reason')).toBe('temporarily_unavailable');
    expect(byTestId<HTMLButtonElement>('mcp-consent-allow').disabled).toBe(true);

    fireEvent.click(byTestId('mcp-consent-status-retry'));
    await waitFor(() => expect(byTestId<HTMLButtonElement>('mcp-consent-allow').disabled).toBe(false));
    expect(screen.queryByTestId('mcp-consent-status-error')).toBeNull();
  });

  it.each([
    'invalid_target',
    'invalid_scope',
    'email_not_allowed',
    'not_workspace_member',
    'invalid_redirect_uri',
  ] as const)('ends the flow with the %s error view when allowing fails', async (reason) => {
    mocked.code.mockRejectedValue(new McpApiError({ status: 400, reason }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-allow'));

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe(reason);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each(['rate_limited', 'temporarily_unavailable', 'server_error'] as const)(
    'keeps the consent view with an inline %s error',
    async (reason) => {
      mocked.code.mockRejectedValueOnce(new McpApiError({ status: 503, reason }));
      await renderConsent();

      fireEvent.click(byTestId('mcp-consent-allow'));

      expect((await screen.findByTestId('mcp-consent-inline-error')).getAttribute('data-reason')).toBe(reason);
      expect(byTestId<HTMLButtonElement>('mcp-consent-allow').disabled).toBe(false);

      fireEvent.click(byTestId('mcp-consent-allow'));
      await waitFor(() => expect(assign).toHaveBeenCalledWith(CODE_REDIRECT));
    }
  );

  it('re-reads the status when the server says the client is not approved', async () => {
    mocked.status
      .mockResolvedValueOnce(memberStatus())
      .mockResolvedValueOnce(memberStatus({ requires_approval: true }, { approved: false }));
    mocked.code.mockRejectedValueOnce(new McpApiError({ status: 403, reason: 'client_not_approved' }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-allow'));

    expect(await screen.findByTestId('mcp-consent-approve-and-allow')).toBeTruthy();
    expect(mocked.status).toHaveBeenCalledTimes(2);
  });

  it('offers approval, not a dead Allow, while the server still refuses a client the setting allows', async () => {
    // An owner just turned the approval requirement off: the setting reads false while
    // authorization still refuses the client for up to 30 seconds.
    mocked.status
      .mockResolvedValueOnce(memberStatus())
      .mockResolvedValueOnce(memberStatus({ requires_approval: false }, { approved: false }));
    mocked.code.mockRejectedValueOnce(new McpApiError({ status: 400, reason: 'client_not_approved' }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-allow'));

    expect(await screen.findByTestId('mcp-consent-approve-and-allow')).toBeTruthy();
    expect(screen.queryByTestId('mcp-consent-allow')).toBeNull();
  });

  it('sends the user to sign in when the session ended', async () => {
    const path = authorizePath();

    mocked.code.mockRejectedValue(new McpApiError({ status: 401, reason: 'invalid_session' }));
    await renderConsent(path);
    // A rejected refresh removed the stored session.
    mocked.token.mockReturnValue(null);

    fireEvent.click(byTestId('mcp-consent-allow'));

    expect(await loginContinuation()).toBe(path);
  });

  it('does not loop through sign-in when the MCP service refuses a valid session', async () => {
    mocked.status.mockRejectedValue(new McpApiError({ status: 401, reason: 'invalid_session' }));
    renderPage();

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe('invalid_session');
    expect(byTestId('mcp-consent-error-message').textContent).toBe(
      "AppFlowy couldn't verify your session for AI apps. Sign in again to continue."
    );
    expect(screen.queryByTestId('location')).toBeNull();
    expect(byTestId('mcp-consent-switch-account')).toBeTruthy();
  });
});

describe('McpAuthorizePage while AI app connections are turned off', () => {
  const TURNED_OFF = 'AI app connections are turned off on this AppFlowy server. Ask your administrator.';
  const mcpDisabled = () =>
    new McpApiError({
      status: 503,
      error: 'mcp_disabled',
      reason: 'mcp_disabled',
      description: 'AI app connections are turned off on this AppFlowy server.',
    });

  /** The turned-off view: its message, and nothing to retry, cancel or switch to. */
  async function expectTurnedOffView() {
    const error = await screen.findByTestId('mcp-consent-error');

    expect(error.getAttribute('data-reason')).toBe('mcp_disabled');
    expect(byTestId('mcp-consent-error-message').textContent).toBe(TURNED_OFF);
    expect(screen.queryByTestId('mcp-consent-page')).toBeNull();
    expect(screen.queryByTestId('mcp-consent-error-retry')).toBeNull();
    // The server refuses the deny as well while connections are off.
    expect(screen.queryByTestId('mcp-consent-error-cancel')).toBeNull();
    expect(screen.queryByTestId('mcp-consent-switch-account')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  }

  it('shows the turned-off view when the server refuses to describe the app', async () => {
    mocked.clientInfo.mockRejectedValue(mcpDisabled());
    renderPage();

    await expectTurnedOffView();
    expect(mocked.deny).not.toHaveBeenCalled();
  });

  it('shows it when the member status says AI app connections are off', async () => {
    mocked.status.mockResolvedValue(memberStatus({ enabled: false }));
    renderPage();

    await expectTurnedOffView();
    expect(mocked.code).not.toHaveBeenCalled();
  });

  it('shows it, not the eligibility error, for an account the email gate would also refuse', async () => {
    mocked.status.mockResolvedValue(
      memberStatus({ enabled: false, eligible: false, ineligible_reason: 'email_not_allowed' })
    );
    renderPage();

    await expectTurnedOffView();
  });

  it('shows it when the member status itself is refused', async () => {
    mocked.status.mockRejectedValue(mcpDisabled());
    renderPage();

    await expectTurnedOffView();
  });

  it('ends the flow when connections are turned off before allowing', async () => {
    mocked.code.mockRejectedValue(mcpDisabled());
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-allow'));

    await expectTurnedOffView();
    expect(screen.queryByTestId('mcp-consent-inline-error')).toBeNull();
  });

  it('ends the flow when connections are turned off before a member asks for approval', async () => {
    mocked.status.mockResolvedValue(memberStatus({ role: 'member', requires_approval: true }, { approved: false }));
    mocked.accessRequest.mockRejectedValue(mcpDisabled());
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-request-approval'));

    await expectTurnedOffView();
    expect(screen.queryByTestId('mcp-consent-request-sent')).toBeNull();
  });

  it('explains a refused Cancel without offering a way back to the consent view', async () => {
    mocked.deny.mockRejectedValue(mcpDisabled());
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-deny'));

    await expectTurnedOffView();
  });
});

describe('McpAuthorizePage expired request', () => {
  const expiredPath = `/oauth/mcp/authorize?expired=1&client_id=${encodeURIComponent(CLIENT_ID)}`;

  it('tells the user to start again from the app, without signing in or redirecting', async () => {
    mockAuthenticated = false;
    renderPage(expiredPath);

    expect((await screen.findByTestId('mcp-consent-expired-message')).textContent).toBe(
      'This request expired. Return to Claude and start again.'
    );
    expect(byTestId('mcp-consent-expired').textContent).toContain('Request expired');
    expect(mocked.clientInfo).toHaveBeenCalledWith(CLIENT_ID, expect.anything());
    expect(screen.queryByTestId('location')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(mocked.workspaces).not.toHaveBeenCalled();
  });

  it.each([
    ['without a client id', '/oauth/mcp/authorize?expired=1'],
    ['when the client cannot be described', expiredPath],
  ])('falls back to "your AI app" %s', async (_case, path) => {
    mocked.clientInfo.mockRejectedValue(new McpApiError({ status: 404, reason: 'unknown_client' }));
    renderPage(path);

    expect((await screen.findByTestId('mcp-consent-expired-message')).textContent).toBe(
      'This request expired. Return to your AI app and start again.'
    );
  });
});

describe('McpAuthorizePage cancel from error views', () => {
  it.each([
    ['email_not_allowed', memberStatus({ eligible: false, ineligible_reason: 'email_not_allowed' })],
    ['guest_not_allowed', memberStatus({ eligible: false, ineligible_reason: 'guest_not_allowed', role: 'guest' })],
    ['client_blocked', memberStatus({}, { blocked: true })],
  ])('returns %s to the app through the validated deny', async (reason, status) => {
    mocked.status.mockResolvedValue(status);
    renderPage();

    const error = await screen.findByTestId('mcp-consent-error');
    const cancel = within(error).getByTestId('mcp-consent-error-cancel');

    expect(error.getAttribute('data-reason')).toBe(reason);
    expect(cancel.textContent).toBe('Cancel and return to Claude');
    fireEvent.click(cancel);

    await waitFor(() => expect(assign).toHaveBeenCalledWith(DENY_REDIRECT));
    expect(mocked.deny).toHaveBeenCalledWith(
      { client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, state: 'state-1' },
      expect.anything()
    );
    expect(mocked.code).not.toHaveBeenCalled();
  });

  it('offers it when the account has no workspace, naming the app', async () => {
    mocked.workspaces.mockResolvedValue({ userId: 'user-uuid', selectedWorkspace: ownerWorkspace, workspaces: [] });
    renderPage();

    expect((await screen.findByTestId('mcp-consent-error-cancel')).textContent).toBe('Cancel and return to Claude');
    expect(byTestId('mcp-consent-error').getAttribute('data-reason')).toBe('no_workspace');
  });

  it.each(['not_workspace_member', 'invalid_scope', 'invalid_target'] as const)(
    'offers it after allowing fails with %s',
    async (reason) => {
      mocked.code.mockRejectedValue(new McpApiError({ status: 400, reason }));
      await renderConsent();

      fireEvent.click(byTestId('mcp-consent-allow'));

      expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe(reason);
      expect(byTestId('mcp-consent-error-cancel')).toBeTruthy();
    }
  );

  it('reads just "Cancel" when the app could not be described', async () => {
    mocked.clientInfo.mockRejectedValueOnce(new McpApiError({ status: 0, error: 'timeout' }));
    renderPage();

    expect((await screen.findByTestId('mcp-consent-error-cancel')).textContent).toBe('Cancel');
    expect(byTestId('mcp-consent-error-retry')).toBeTruthy();
  });

  it('hides the button and keeps the message when the server refuses the deny', async () => {
    mocked.status.mockResolvedValue(memberStatus({ eligible: false, ineligible_reason: 'email_not_allowed' }));
    mocked.deny.mockRejectedValue(new McpApiError({ status: 400, reason: 'invalid_redirect_uri' }));
    renderPage();

    fireEvent.click(await screen.findByTestId('mcp-consent-error-cancel'));

    await waitFor(() => expect(screen.queryByTestId('mcp-consent-error-cancel')).toBeNull());
    expect(byTestId('mcp-consent-error').getAttribute('data-reason')).toBe('email_not_allowed');
    expect(byTestId('mcp-consent-error-message').textContent).toBe(
      'Your administrator only allows certain accounts to connect AI apps.'
    );
    expect(byTestId('mcp-consent-switch-account')).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the button with a note when the deny fails for a transient reason, and tries again', async () => {
    mocked.status.mockResolvedValue(memberStatus({ eligible: false, ineligible_reason: 'email_not_allowed' }));
    mocked.deny.mockRejectedValueOnce(new McpApiError({ status: 0, error: 'network_error' }));
    renderPage();

    fireEvent.click(await screen.findByTestId('mcp-consent-error-cancel'));

    expect((await screen.findByTestId('mcp-consent-cancel-error')).textContent).toBe(
      'AppFlowy is temporarily unavailable. Try again.'
    );
    expect(byTestId('mcp-consent-error').getAttribute('data-reason')).toBe('email_not_allowed');
    expect(byTestId<HTMLButtonElement>('mcp-consent-error-cancel').disabled).toBe(false);
    expect(assign).not.toHaveBeenCalled();

    fireEvent.click(byTestId('mcp-consent-error-cancel'));

    expect(await screen.findByTestId('mcp-consent-cancelled')).toBeTruthy();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(DENY_REDIRECT));
    expect(mocked.deny).toHaveBeenCalledTimes(2);
  });

  it('still offers Cancel on a later error view after a transient deny failure', async () => {
    mocked.clientInfo.mockRejectedValueOnce(new McpApiError({ status: 0, error: 'timeout' }));
    mocked.deny.mockRejectedValueOnce(new McpApiError({ status: 503, reason: 'temporarily_unavailable' }));
    mocked.code.mockRejectedValue(new McpApiError({ status: 400, reason: 'invalid_scope' }));
    renderPage();

    fireEvent.click(await screen.findByTestId('mcp-consent-error-cancel'));
    expect(await screen.findByTestId('mcp-consent-cancel-error')).toBeTruthy();
    fireEvent.click(byTestId('mcp-consent-error-retry'));
    await screen.findByTestId('mcp-consent-page');
    await waitFor(() => expect(screen.queryByTestId('mcp-consent-status-loading')).toBeNull());
    fireEvent.click(byTestId('mcp-consent-allow'));

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe('invalid_scope');
    expect(byTestId('mcp-consent-error-cancel')).toBeTruthy();
    expect(screen.queryByTestId('mcp-consent-cancel-error')).toBeNull();
  });

  it.each([
    ['an unknown client', memberStatus({}, { known: false }), 'unknown_client'],
    ['an unregistered redirect', undefined, 'invalid_redirect_uri'],
  ])('is not offered for %s, which the deny would refuse', async (_case, status, reason) => {
    if (status) {
      mocked.status.mockResolvedValue(status);
      renderPage();
    } else {
      mocked.code.mockRejectedValue(new McpApiError({ status: 400, reason: 'invalid_redirect_uri' }));
      await renderConsent();
      fireEvent.click(byTestId('mcp-consent-allow'));
    }

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe(reason);
    expect(screen.queryByTestId('mcp-consent-error-cancel')).toBeNull();
  });

  it('is not offered again on the error of a refused Cancel', async () => {
    mocked.deny.mockRejectedValue(new McpApiError({ status: 429, reason: 'rate_limited' }));
    await renderConsent();

    fireEvent.click(byTestId('mcp-consent-deny'));

    expect((await screen.findByTestId('mcp-consent-error')).getAttribute('data-reason')).toBe('rate_limited');
    expect(screen.queryByTestId('mcp-consent-error-cancel')).toBeNull();
    expect(byTestId('mcp-consent-error-retry')).toBeTruthy();
  });
});
