import { captureTokenSession, getTokenParsed, invalidTokenForSession } from '@/application/session/token';
import { Log } from '@/utils/log';
import { SERVER_INFO_LOADING, updateServerInfo } from '@/utils/server-info';

import { isAuthRefreshFailure } from '../auth-refresh-error';
import { refreshToken } from '../gotrue';
import {
  approveMcpClient,
  createMcpAccessRequest,
  createMcpAuthorizationCode,
  denyMcpAuthorization,
  disconnectAllMcpWorkspaceConnections,
  disconnectMcpWorkspaceConnections,
  disconnectMyMcpConnection,
  dismissMcpAccessRequest,
  getMcpBaseUrl,
  getMcpBaseUrlOverride,
  getMcpClientInfo,
  getMcpConfiguration,
  getMcpMemberStatus,
  getMcpServerUrl,
  getMcpWorkspaceSettings,
  isMcpAbortError,
  isMcpAppApprovalKey,
  isMcpDisabledError,
  isMcpServiceUnavailable,
  listMcpAccessRequests,
  listMcpWorkspaceConnections,
  listMyMcpConnections,
  listMyMcpConnectionsAcrossWorkspaces,
  MCP_APPROVAL_MODES,
  McpApiError,
  mcpApprovalKey,
  McpAuthorizationCodeRequest,
  mcpTimestampToDate,
  resetMcpConfigurationForTests,
  revokeMcpClientApproval,
  updateMcpWorkspaceSettings,
} from '../mcp-api';

let mockConfig: Record<string, string> = {};

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (key: string, fallback: string) => mockConfig[key] ?? fallback,
}));
jest.mock('@/application/session/token', () => ({
  getTokenParsed: jest.fn(),
  captureTokenSession: jest.fn(() => ({ generation: 1, userId: 'user-1' })),
  invalidTokenForSession: jest.fn(),
}));
jest.mock('../gotrue', () => ({ refreshToken: jest.fn() }));
jest.mock('../auth-refresh-error', () => ({ isAuthRefreshFailure: jest.fn(() => false) }));

const BASE = 'https://mcp.example.com';
const WS = '11111111-2222-3333-4444-555555555555';
const CIMD_CLIENT = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const ENCODED_CIMD_CLIENT = 'https%3A%2F%2Fclaude.ai%2Foauth%2Fmcp-oauth-client-metadata';

type StoredToken = NonNullable<ReturnType<typeof getTokenParsed>>;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const makeToken = (overrides: Partial<StoredToken> = {}): StoredToken => ({
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_at: nowSeconds() + 3600,
  user: { id: 'user-1' },
  ...overrides,
});

function response(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => text,
  } as unknown as Response;
}

/** A client as the MCP service serializes it (`McpClientSummary`: every field, nulls included). */
function clientSummary(overrides: Record<string, unknown> = {}) {
  return {
    client_id: 'dcr-client-1',
    client_name: null,
    client_uri: null,
    logo_uri: null,
    client_kind: 'dcr',
    client_host: 'localhost',
    redirect_hosts: ['localhost'],
    loopback_only: true,
    app_id: null,
    app_name: null,
    verified_app: false,
    identity_verified: false,
    ...overrides,
  };
}

/** A member status as the MCP service serializes it (`MemberStatusResponse`). */
function memberStatus(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: WS,
    enabled: true,
    endpoint: `${BASE}/mcp`,
    role: 'member',
    eligible: true,
    ineligible_reason: null,
    requires_approval: true,
    approval_mode: 'verified_and_approved',
    client: null,
    approved_apps: [],
    ...overrides,
  };
}

/** Workspace settings as the MCP service serializes them (`WorkspaceSettingsView`). */
function workspaceSettings(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: WS,
    allow_unapproved_clients: false,
    approval_mode: 'verified_and_approved',
    updated_by: null,
    updated_at: null,
    approved_clients: [],
    ...overrides,
  };
}

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
const mockedGetToken = jest.mocked(getTokenParsed);
const mockedRefresh = jest.mocked(refreshToken);
const mockedIsAuthRefreshFailure = jest.mocked(isAuthRefreshFailure);
let storedToken: StoredToken | null;
// Every failed request is logged; quiet here, asserted in "MCP failure log".
let logWarn: jest.SpyInstance;

function call(index = 0) {
  const [url, init] = fetchMock.mock.calls[index];

  return {
    url: new URL(url),
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    rawBody: init.body as string | undefined,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMcpConfigurationForTests();
  updateServerInfo('https://cloud.example.com', SERVER_INFO_LOADING);
  mockConfig = { APPFLOWY_BASE_URL: 'https://cloud.example.com', APPFLOWY_MCP_BASE_URL: `${BASE}/` };
  storedToken = makeToken();
  mockedGetToken.mockImplementation(() => storedToken);
  mockedIsAuthRefreshFailure.mockReturnValue(false);
  mockedRefresh.mockImplementation(async () => {
    storedToken = makeToken({ access_token: 'access-2', refresh_token: 'refresh-2' });
    return storedToken;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  logWarn = jest.spyOn(Log, 'warn').mockImplementation(() => undefined);
});

describe('MCP configuration', () => {
  it('normalizes the base URL and derives the server URL', () => {
    expect(getMcpBaseUrl()).toBe(BASE);
    expect(getMcpServerUrl()).toBe(`${BASE}/mcp`);
    expect(getMcpConfiguration()).toEqual({ status: 'configured', baseUrl: BASE, source: 'config' });
  });

  it('never falls back to APPFLOWY_BASE_URL', async () => {
    mockConfig = { APPFLOWY_BASE_URL: 'https://cloud.example.com' };

    expect(getMcpConfiguration()).toEqual({ status: 'loading' });
    expect(getMcpServerUrl()).toBe('');
    await expect(getMcpMemberStatus(WS)).rejects.toMatchObject({ status: 0, error: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a value that is not an absolute http(s) URL as not configured', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockConfig = { APPFLOWY_MCP_BASE_URL: 'mcp.example.com' };
    expect(getMcpBaseUrlOverride()).toBe('');
    mockConfig = { APPFLOWY_MCP_BASE_URL: '   ' };
    expect(getMcpBaseUrlOverride()).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it.each([
    ['the MCP server URL', `${BASE}/mcp`],
    ['a path', `${BASE}/appflowy/`],
    ['credentials', 'https://user:secret@mcp.example.com'],
    ['a query', `${BASE}/?tenant=a`],
    ['an empty query', `${BASE}?`],
    ['a fragment', `${BASE}#mcp`],
  ])('ignores a URL with %s, as Cloud does, and warns once without echoing it', (_case, value) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockConfig = { APPFLOWY_MCP_BASE_URL: value };

    expect(getMcpBaseUrlOverride()).toBe('');
    expect(getMcpServerUrl()).toBe('');
    expect(getMcpBaseUrlOverride()).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(value.replace(/\/$/, ''));
    warn.mockRestore();
  });

  it('accepts an origin with a port and a trailing slash', () => {
    mockConfig = { APPFLOWY_MCP_BASE_URL: ' http://localhost:8002/ ' };

    expect(getMcpBaseUrlOverride()).toBe('http://localhost:8002');
  });
});

describe('MCP configuration discovery', () => {
  const CLOUD = 'https://cloud.example.com';
  const available = (mcpUrl?: string | null) =>
    ({ status: 'available', info: { enable_page_history: true, mcp_url: mcpUrl } } as const);

  beforeEach(() => {
    // No override: the URL comes from Cloud server-info.
    mockConfig = { APPFLOWY_BASE_URL: CLOUD };
  });

  it('is loading until server-info answers, then uses its mcp_url', async () => {
    expect(getMcpConfiguration()).toEqual({ status: 'loading' });
    await expect(getMcpMemberStatus(WS)).rejects.toMatchObject({ status: 0, error: 'not_configured' });

    updateServerInfo(CLOUD, available('https://mcp.discovered.example.com/'));

    expect(getMcpConfiguration()).toEqual({
      status: 'configured',
      baseUrl: 'https://mcp.discovered.example.com',
      source: 'server_info',
    });
    expect(getMcpServerUrl()).toBe('https://mcp.discovered.example.com/mcp');

    fetchMock.mockResolvedValueOnce(response(200, memberStatus()));
    await getMcpMemberStatus(WS);
    expect(call().url.origin).toBe('https://mcp.discovered.example.com');
  });

  it('prefers the APPFLOWY_MCP_BASE_URL override without waiting for server-info', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockConfig = { APPFLOWY_BASE_URL: CLOUD, APPFLOWY_MCP_BASE_URL: `${BASE}/` };

    expect(getMcpConfiguration()).toEqual({ status: 'configured', baseUrl: BASE, source: 'config' });
    // Cloud may leave mcp_url out (before its MCP policy loads, or an older server while MCP is off): not a mismatch.
    updateServerInfo(CLOUD, available());
    expect(getMcpBaseUrl()).toBe(BASE);
    // The same origin, spelled differently.
    updateServerInfo(CLOUD, available('HTTPS://MCP.example.com:443/'));
    expect(getMcpBaseUrl()).toBe(BASE);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the override but warns once when server-info advertises another origin', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockConfig = { APPFLOWY_BASE_URL: CLOUD, APPFLOWY_MCP_BASE_URL: BASE };
    updateServerInfo(CLOUD, available('https://mcp.moved.example.com'));

    expect(getMcpConfiguration()).toEqual({ status: 'configured', baseUrl: BASE, source: 'config' });
    // The periodic refresh brings the same answer again.
    updateServerInfo(CLOUD, available('https://mcp.moved.example.com'));
    expect(getMcpBaseUrl()).toBe(BASE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(BASE);
    expect(warn.mock.calls[0][0]).toContain('https://mcp.moved.example.com');
    warn.mockRestore();
  });

  it.each([
    ['server-info without mcp_url', available()],
    ['server-info with a null mcp_url', available(null)],
    ['a server without /api/server-info', { status: 'unsupported' } as const],
  ])('is not configured for %s', (_case, state) => {
    updateServerInfo(CLOUD, state);

    expect(getMcpConfiguration()).toEqual({ status: 'not_configured' });
  });

  it.each([
    ['not an absolute http(s) URL', 'mcp.example.com'],
    ['not an origin', 'https://mcp.discovered.example.com/mcp'],
  ])('ignores an mcp_url that is %s', (_case, mcpUrl) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    updateServerInfo(CLOUD, available(mcpUrl));
    expect(getMcpConfiguration()).toEqual({ status: 'not_configured' });
    updateServerInfo(CLOUD, available(mcpUrl));
    expect(getMcpConfiguration()).toEqual({ status: 'not_configured' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('says it is retrying while server-info fails before it ever answered', () => {
    updateServerInfo(CLOUD, { status: 'unavailable' });
    const retrying = getMcpConfiguration();

    expect(retrying).toEqual({ status: 'loading', retrying: true });
    // The loop's next failure gives the same answer.
    updateServerInfo(CLOUD, { status: 'unavailable' });
    expect(getMcpConfiguration()).toBe(retrying);

    updateServerInfo(CLOUD, available('https://mcp.discovered.example.com'));
    expect(getMcpConfiguration()).toEqual({
      status: 'configured',
      baseUrl: 'https://mcp.discovered.example.com',
      source: 'server_info',
    });
  });

  it('keeps the last answer while a refresh is failing or pending', () => {
    updateServerInfo(CLOUD, available('https://mcp.discovered.example.com'));
    const configured = getMcpConfiguration();

    updateServerInfo(CLOUD, { status: 'unavailable' });
    expect(getMcpConfiguration()).toBe(configured);
    updateServerInfo(CLOUD, SERVER_INFO_LOADING);
    expect(getMcpConfiguration()).toBe(configured);

    updateServerInfo(CLOUD, available());
    expect(getMcpConfiguration()).toEqual({ status: 'not_configured' });
    updateServerInfo(CLOUD, { status: 'unavailable' });
    expect(getMcpConfiguration()).toEqual({ status: 'not_configured' });
  });

  it('returns the same object until the answer changes', () => {
    updateServerInfo(CLOUD, available('https://mcp.discovered.example.com'));
    const first = getMcpConfiguration();

    expect(getMcpConfiguration()).toBe(first);
    // The periodic refresh replaces the snapshot with an equal one.
    updateServerInfo(CLOUD, available('https://mcp.discovered.example.com/'));
    expect(getMcpConfiguration()).toBe(first);
    updateServerInfo(CLOUD, available('https://mcp.moved.example.com'));
    expect(getMcpConfiguration()).not.toBe(first);
  });
});

describe('MCP requests', () => {
  it('sends the current access token as a bearer and the client id as a query parameter', async () => {
    fetchMock.mockResolvedValueOnce(response(200, memberStatus()));

    await expect(getMcpMemberStatus(WS, CIMD_CLIENT)).resolves.toMatchObject({ role: 'member' });

    const request = call();

    expect(request.url.href).toBe(`${BASE}/api/mcp/me/workspaces/${WS}?client_id=${ENCODED_CIMD_CLIENT}`);
    expect(request.method).toBe('GET');
    expect(request.headers.Authorization).toBe('Bearer access-1');
    expect(fetchMock.mock.calls[0][1].credentials).toBe('omit');
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('omits client_id from the member status when none is given', async () => {
    fetchMock.mockResolvedValueOnce(response(200, memberStatus()));

    await getMcpMemberStatus(WS);
    expect(call().url.href).toBe(`${BASE}/api/mcp/me/workspaces/${WS}`);
  });

  it('reads the member status as the server sends it', async () => {
    const body = memberStatus({ approval_mode: 'approved_only', enabled: false });

    fetchMock.mockResolvedValueOnce(response(200, body));

    await expect(getMcpMemberStatus(WS)).resolves.toEqual(body);
  });

  // A newer server's policy reads as unknown, never as a known one, in both places.
  it('reads an approval policy this Web does not know as undefined in the member status and the settings', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, memberStatus({ approval_mode: 'everyone' })))
      .mockResolvedValueOnce(
        response(200, workspaceSettings({ approval_mode: 'everyone', allow_unapproved_clients: true }))
      );

    expect((await getMcpMemberStatus(WS)).approval_mode).toBeUndefined();
    expect((await getMcpWorkspaceSettings(WS)).approval_mode).toBeUndefined();
  });

  it('looks clients up publicly with the query form and no credentials', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { client_id: CIMD_CLIENT, client_kind: 'cimd' }));

    await expect(getMcpClientInfo(CIMD_CLIENT)).resolves.toMatchObject({ client_kind: 'cimd' });
    expect(call().url.href).toBe(`${BASE}/api/mcp/clients?client_id=${ENCODED_CIMD_CLIENT}`);
    expect(call().headers.Authorization).toBeUndefined();
    expect(mockedGetToken).not.toHaveBeenCalled();
  });

  it.each([
    ['approve', () => approveMcpClient(WS, CIMD_CLIENT), 'PUT', `/api/mcp/admin/workspaces/${WS}/approvals`],
    ['revoke', () => revokeMcpClientApproval(WS, CIMD_CLIENT), 'DELETE', `/api/mcp/admin/workspaces/${WS}/approvals`],
    [
      'dismiss request',
      () => dismissMcpAccessRequest(WS, CIMD_CLIENT),
      'DELETE',
      `/api/mcp/admin/workspaces/${WS}/access-requests`,
    ],
    [
      'disconnect mine',
      () => disconnectMyMcpConnection(WS, CIMD_CLIENT),
      'DELETE',
      `/api/mcp/me/workspaces/${WS}/connections`,
    ],
  ])('%s keeps the CIMD client id out of the path', async (_name, run, method, path) => {
    fetchMock.mockResolvedValueOnce(response(200, { approved: true, disconnected: 1, dismissed: true }));

    await run();

    const request = call();

    expect(request.method).toBe(method);
    expect(request.url.pathname).toBe(path);
    expect(request.url.searchParams.get('client_id')).toBe(CIMD_CLIENT);
    expect(request.url.search).toBe(`?client_id=${ENCODED_CIMD_CLIENT}`);
    expect(request.headers.Authorization).toBe('Bearer access-1');
    expect(request.rawBody).toBeUndefined();
  });

  it('creates access requests with only the client id in the body', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { requested: true, request: { client_id: CIMD_CLIENT } }));

    await createMcpAccessRequest(WS, CIMD_CLIENT);
    expect(call().url.pathname).toBe(`/api/mcp/me/workspaces/${WS}/access-requests`);
    expect(call().method).toBe('POST');
    expect(call().body).toEqual({ client_id: CIMD_CLIENT });
    expect(call().headers['Content-Type']).toBe('application/json');
  });

  it('posts only the consent fields to authorize/code, never a refresh token', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { redirect_url: 'https://claude.ai/cb?code=c&state=s&iss=x' }));
    const request = {
      client_id: CIMD_CLIENT,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      workspace_id: WS,
      state: 'state-1',
      scope: ' read write ',
      resource: `${BASE}/mcp`,
      appflowy_refresh_token: 'refresh-1',
      appflowy_expires_at: 123,
    } as McpAuthorizationCodeRequest;

    await expect(createMcpAuthorizationCode(request)).resolves.toEqual({
      redirect_url: 'https://claude.ai/cb?code=c&state=s&iss=x',
    });
    expect(call().url.href).toBe(`${BASE}/api/mcp/authorize/code`);
    expect(call().headers.Authorization).toBe('Bearer access-1');
    expect(call().body).toEqual({
      client_id: CIMD_CLIENT,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      workspace_id: WS,
      state: 'state-1',
      scope: 'read write',
      resource: `${BASE}/mcp`,
    });
  });

  it('drops empty optional consent fields', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { redirect_url: 'http://localhost:3118/callback?code=c' }));

    await createMcpAuthorizationCode({
      client_id: 'dcr-client',
      redirect_uri: 'http://localhost:3118/callback',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      workspace_id: WS,
      scope: '  ',
      resource: '',
    });
    expect(Object.keys(call().body).sort()).toEqual(
      ['client_id', 'code_challenge', 'code_challenge_method', 'redirect_uri', 'workspace_id'].sort()
    );
  });

  it('never sends the refresh token in any request body or header', async () => {
    fetchMock.mockImplementation(async () =>
      response(200, {
        ...workspaceSettings({ auto_approved_clients: [] }),
        redirect_url: 'https://claude.ai/cb',
        requested: true,
        connections: [],
      })
    );
    storedToken = makeToken({ expires_at: nowSeconds() - 10 });

    await createMcpAuthorizationCode({
      client_id: 'c',
      redirect_uri: 'https://claude.ai/cb',
      code_challenge: 'x',
      code_challenge_method: 'S256',
      workspace_id: WS,
    });
    await denyMcpAuthorization({ client_id: 'c', redirect_uri: 'https://claude.ai/cb', state: 's' });
    await createMcpAccessRequest(WS, 'c');
    await updateMcpWorkspaceSettings(WS, 'approved_only');
    await listMyMcpConnections(WS);

    expect(mockedRefresh).toHaveBeenCalledWith('refresh-1');
    fetchMock.mock.calls.forEach(([, init]) => {
      const sent = `${init.body ?? ''} ${JSON.stringify(init.headers)}`;

      expect(sent).not.toContain('refresh-1');
      expect(sent).not.toContain('refresh-2');
      expect(sent).not.toContain('appflowy_refresh_token');
      expect(sent).not.toContain('appflowy_expires_at');
    });
  });

  it('denies through the server without credentials and returns its redirect', async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { redirect_url: 'https://claude.ai/cb?error=access_denied&state=s&iss=https%3A%2F%2Fmcp' })
    );

    await expect(
      denyMcpAuthorization({ client_id: CIMD_CLIENT, redirect_uri: 'https://claude.ai/cb', state: 's' })
    ).resolves.toEqual({ redirect_url: 'https://claude.ai/cb?error=access_denied&state=s&iss=https%3A%2F%2Fmcp' });
    expect(call().url.href).toBe(`${BASE}/api/mcp/authorize/deny`);
    expect(call().method).toBe('POST');
    expect(call().headers.Authorization).toBeUndefined();
    expect(call().body).toEqual({ client_id: CIMD_CLIENT, redirect_uri: 'https://claude.ai/cb', state: 's' });
  });

  it.each(['javascript:alert(document.cookie)', 'data:text/html,<script>alert(1)</script>'])(
    'refuses to hand back an unsafe redirect URL (%s)',
    async (redirectUrl) => {
      fetchMock.mockResolvedValueOnce(response(200, { redirect_url: redirectUrl }));

      await expect(denyMcpAuthorization({ client_id: 'c', redirect_uri: 'https://x/cb' })).rejects.toMatchObject({
        reason: 'invalid_redirect_uri',
      });
    }
  );

  it('rejects a success response without a redirect URL', async () => {
    fetchMock.mockResolvedValueOnce(response(200, {}));

    await expect(denyMcpAuthorization({ client_id: 'c', redirect_uri: 'https://x/cb' })).rejects.toMatchObject({
      reason: 'server_error',
      error: 'invalid_response',
    });
  });
});

describe('MCP owner disconnect', () => {
  it('refuses to disconnect without a filter', async () => {
    await expect(disconnectMcpWorkspaceConnections(WS, {})).rejects.toMatchObject({
      status: 0,
      reason: 'invalid_request',
    });
    await expect(disconnectMcpWorkspaceConnections(WS, { clientId: ' ', userUuid: '' })).rejects.toBeInstanceOf(
      McpApiError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the filters as query parameters', async () => {
    fetchMock.mockResolvedValue(response(200, { disconnected: 2 }));

    await expect(disconnectMcpWorkspaceConnections(WS, { clientId: CIMD_CLIENT, userUuid: 'user-9' })).resolves.toEqual({
      disconnected: 2,
    });
    expect(call().method).toBe('DELETE');
    expect(call().url.pathname).toBe(`/api/mcp/admin/workspaces/${WS}/connections`);
    expect(call().url.searchParams.get('client_id')).toBe(CIMD_CLIENT);
    expect(call().url.searchParams.get('user_uuid')).toBe('user-9');
    expect(call().rawBody).toBeUndefined();

    await disconnectMcpWorkspaceConnections(WS, { userUuid: 'user-9' });
    expect(call(1).url.search).toBe('?user_uuid=user-9');
  });

  it('refuses an empty client id before sending', async () => {
    const error = await approveMcpClient(WS, '  ').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 0, reason: 'invalid_request' });
    expect(isMcpServiceUnavailable(error)).toBe(false);
    await expect(getMcpClientInfo('')).rejects.toMatchObject({ reason: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MCP owner reads', () => {
  it('unwraps lists', async () => {
    const connection = { ...clientSummary(), user_uuid: 'u', workspace_id: WS, connected_at: 1, family_id: null };
    const request = { ...clientSummary({ client_id: 'b' }), approval_key: 'b', requesters: [] };

    fetchMock
      .mockResolvedValueOnce(response(200, { connections: [connection] }))
      .mockResolvedValueOnce(response(200, { requests: [request] }))
      .mockResolvedValueOnce(response(200, workspaceSettings()))
      .mockResolvedValueOnce(response(200, { connections: [] }));

    await expect(listMcpWorkspaceConnections(WS)).resolves.toEqual([connection]);
    await expect(listMcpAccessRequests(WS)).resolves.toEqual([request]);
    await expect(getMcpWorkspaceSettings(WS)).resolves.toEqual(workspaceSettings());
    await expect(listMyMcpConnections(WS)).resolves.toEqual([]);
    expect(call(0).url.pathname).toBe(`/api/mcp/admin/workspaces/${WS}/connections`);
    expect(call(1).url.pathname).toBe(`/api/mcp/admin/workspaces/${WS}/access-requests`);
    expect(call(2).url.pathname).toBe(`/api/mcp/admin/workspaces/${WS}/settings`);
    expect(call(3).url.pathname).toBe(`/api/mcp/me/workspaces/${WS}/connections`);
  });

  // A proxy answering 200 {} must not read as "no connections" in the owner's revocation list.
  it.each([
    ['member connections', () => listMcpWorkspaceConnections(WS), {}],
    ['access requests', () => listMcpAccessRequests(WS), { requests: null }],
    ['my connections', () => listMyMcpConnections(WS), { connections: 'none' }],
    ['my connections everywhere', () => listMyMcpConnectionsAcrossWorkspaces(), {}],
    ['settings', () => getMcpWorkspaceSettings(WS), workspaceSettings({ approved_clients: undefined })],
    ['member status', () => getMcpMemberStatus(WS), memberStatus({ approved_apps: undefined })],
  ])('rejects %s without their list as an invalid response', async (_name, run, body) => {
    fetchMock.mockResolvedValueOnce(response(200, body));

    const error = await run().catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 200, error: 'invalid_response', reason: 'server_error' });
    expect(isMcpServiceUnavailable(error)).toBe(false);
  });

  it.each(MCP_APPROVAL_MODES)('sets the approval policy %s with approval_mode alone', async (mode) => {
    fetchMock.mockResolvedValueOnce(
      response(200, workspaceSettings({ approval_mode: mode, auto_approved_clients: [] }))
    );

    await expect(updateMcpWorkspaceSettings(WS, mode)).resolves.toMatchObject({
      approval_mode: mode,
      auto_approved_clients: [],
    });
    expect(call().method).toBe('PUT');
    expect(call().body).toEqual({ approval_mode: mode });
  });

  it('returns the apps approved because the policy became stricter', async () => {
    const claude = {
      ...clientSummary({ client_id: 'https://claude.ai/meta', client_name: 'Claude', client_kind: 'cimd' }),
      approval_key: 'https://claude.ai/meta',
    };
    const approval = { ...claude, approved_by: 'owner-1', approved_at: '2026-10-01T10:00:00Z' };

    fetchMock.mockResolvedValueOnce(
      response(
        200,
        workspaceSettings({
          approval_mode: 'approved_only',
          approved_clients: [approval],
          auto_approved_clients: [claude],
        })
      )
    );

    await expect(updateMcpWorkspaceSettings(WS, 'approved_only')).resolves.toMatchObject({
      approval_mode: 'approved_only',
      approved_clients: [approval],
      auto_approved_clients: [claude],
    });
  });

  it('rejects a settings update without its auto-approved list', async () => {
    fetchMock.mockResolvedValueOnce(response(200, workspaceSettings()));

    await expect(updateMcpWorkspaceSettings(WS, 'approved_only')).rejects.toMatchObject({ error: 'invalid_response' });
  });

  it('reads the approval policy and app-level approval keys', async () => {
    const cursor = clientSummary({
      client_id: 'dcr-cursor-1',
      app_id: 'cursor',
      app_name: 'Cursor',
      verified_app: true,
    });

    fetchMock.mockResolvedValueOnce(
      response(
        200,
        workspaceSettings({
          approval_mode: 'verified_and_approved',
          approved_clients: [{ ...cursor, approval_key: 'app:cursor', approved_by: 'owner-1', approved_at: '' }],
        })
      )
    );

    await expect(getMcpWorkspaceSettings(WS)).resolves.toMatchObject({
      approval_mode: 'verified_and_approved',
      approved_clients: [{ client_id: 'dcr-cursor-1', approval_key: 'app:cursor' }],
    });
  });
});

describe('MCP connections per device', () => {
  it('disconnects one of my devices by token family', async () => {
    fetchMock.mockResolvedValue(response(200, { disconnected: 1 }));

    await disconnectMyMcpConnection(WS, CIMD_CLIENT, { familyId: 'family-1' });
    expect(call().method).toBe('DELETE');
    expect(call().url.pathname).toBe(`/api/mcp/me/workspaces/${WS}/connections`);
    expect(call().url.searchParams.get('client_id')).toBe(CIMD_CLIENT);
    expect(call().url.searchParams.get('family_id')).toBe('family-1');

    // A legacy record without a family disconnects every connection with the client.
    await disconnectMyMcpConnection(WS, CIMD_CLIENT, { familyId: null });
    expect(call(1).url.search).toBe(`?client_id=${ENCODED_CIMD_CLIENT}`);
  });

  it('disconnects one member device with all three filters', async () => {
    fetchMock.mockResolvedValue(response(200, { disconnected: 1 }));

    await disconnectMcpWorkspaceConnections(WS, { clientId: 'dcr-1', userUuid: 'user-9', familyId: 'family-2' });
    expect(Object.fromEntries(call().url.searchParams)).toEqual({
      client_id: 'dcr-1',
      user_uuid: 'user-9',
      family_id: 'family-2',
    });
    // A family alone is not a filter.
    await expect(disconnectMcpWorkspaceConnections(WS, { familyId: 'family-2' })).rejects.toMatchObject({
      reason: 'invalid_request',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('disconnects every member with an explicit all=true', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { disconnected: 7 }));

    await expect(disconnectAllMcpWorkspaceConnections(WS)).resolves.toEqual({ disconnected: 7 });
    expect(call().method).toBe('DELETE');
    expect(call().url.pathname).toBe(`/api/mcp/admin/workspaces/${WS}/connections`);
    expect(call().url.search).toBe('?all=true');
    expect(call().rawBody).toBeUndefined();
  });

  it('approves, revokes and dismisses app-level keys as given', async () => {
    fetchMock.mockResolvedValue(response(200, { approved: true, disconnected: 3, dismissed: true }));

    await revokeMcpClientApproval(WS, 'app:cursor');
    await dismissMcpAccessRequest(WS, 'app:cursor');
    await approveMcpClient(WS, 'app:cursor');
    expect(call(0).url.search).toBe('?client_id=app%3Acursor');
    expect(call(1).url.pathname).toBe(`/api/mcp/admin/workspaces/${WS}/access-requests`);
    expect(call(1).url.searchParams.get('client_id')).toBe('app:cursor');
    // A merged request is approved by its app key; the server approves every registration of the app.
    expect(call(2).method).toBe('PUT');
    expect(call(2).url.pathname).toBe(`/api/mcp/admin/workspaces/${WS}/approvals`);
    expect(call(2).url.search).toBe('?client_id=app%3Acursor');
  });

  it('lists my connections across workspaces with their counts', async () => {
    const connection = {
      ...clientSummary({ client_id: 'a' }),
      workspace_id: WS,
      family_id: 'f1',
      device_label: 'Cursor · macOS',
      connected_at: 1,
      last_used_at: null,
    };

    fetchMock.mockResolvedValueOnce(
      response(200, { connections: [connection], workspace_count: 1, connection_count: 1 })
    );

    await expect(listMyMcpConnectionsAcrossWorkspaces()).resolves.toEqual({
      connections: [connection],
      workspace_count: 1,
      connection_count: 1,
    });
    expect(call().method).toBe('GET');
    expect(call().url.href).toBe(`${BASE}/api/mcp/me/connections`);
    expect(call().headers.Authorization).toBe('Bearer access-1');
  });

  it('reads the approved apps with their approval keys', async () => {
    const approvedApps = [
      {
        ...clientSummary({ client_id: 'dcr-cursor', app_id: 'cursor', app_name: 'Cursor', verified_app: true }),
        approval_key: 'app:cursor',
      },
      { ...clientSummary({ client_id: 'dcr-tool' }), approval_key: 'dcr-tool' },
    ];

    fetchMock.mockResolvedValueOnce(response(200, memberStatus({ approved_apps: approvedApps })));

    expect((await getMcpMemberStatus(WS)).approved_apps).toEqual(approvedApps);
  });
});

describe('mcpApprovalKey', () => {
  it('keys a recognized app by its catalog id and anything else by its client id', () => {
    expect(mcpApprovalKey({ client_id: 'dcr-1', app_id: 'cursor', verified_app: true })).toBe('app:cursor');
    expect(mcpApprovalKey({ client_id: 'dcr-1', app_id: null, verified_app: false })).toBe('dcr-1');
    // Never from an app id the catalog did not vouch for.
    expect(mcpApprovalKey({ client_id: 'dcr-1', app_id: 'cursor', verified_app: false })).toBe('dcr-1');
    expect(isMcpAppApprovalKey('app:cursor')).toBe(true);
    expect(isMcpAppApprovalKey('https://app.example.com/client.json')).toBe(false);
    expect(isMcpAppApprovalKey(undefined)).toBe(false);
  });
});

describe('MCP errors', () => {
  it('maps the error body and reason', async () => {
    fetchMock.mockResolvedValueOnce(
      response(403, { error: 'forbidden', error_description: 'Only owners', reason: 'not_workspace_owner' })
    );

    const error = await getMcpWorkspaceSettings(WS).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(McpApiError);
    expect(error).toMatchObject({
      status: 403,
      error: 'forbidden',
      reason: 'not_workspace_owner',
      description: 'Only owners',
      message: 'Only owners',
    });
    expect(isMcpServiceUnavailable(error)).toBe(false);
  });

  it('implies rate_limited for a 429 without a reason', async () => {
    fetchMock.mockResolvedValueOnce(response(429, { error: 'slow_down' }, { 'Retry-After': '30' }));

    const error = await getMcpClientInfo('client').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 429, reason: 'rate_limited' });
    expect(isMcpServiceUnavailable(error)).toBe(false);
  });

  it.each([
    [502, 'temporarily_unavailable'],
    [503, 'temporarily_unavailable'],
    [500, 'server_error'],
  ])('maps a %s HTML error page to %s', async (status, reason) => {
    fetchMock.mockResolvedValueOnce(response(status, '<html>Bad gateway</html>'));

    const error = await listMyMcpConnections(WS).catch((e: unknown) => e);

    expect(error).toMatchObject({ status, reason, error: undefined });
    expect(isMcpServiceUnavailable(error)).toBe(true);
  });

  it('drops unknown reasons and reports a missing route as unavailable', async () => {
    fetchMock.mockResolvedValueOnce(response(404, { error: 'not_found', reason: 'brand_new_reason' }));

    const error = await getMcpMemberStatus(WS).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 404, reason: undefined, error: 'not_found' });
    expect(isMcpServiceUnavailable(error)).toBe(true);
  });

  it('tells AI app connections turned off for the server apart from an outage', async () => {
    fetchMock.mockResolvedValueOnce(
      response(503, {
        error: 'mcp_disabled',
        error_description: 'AI app connections are turned off on this AppFlowy server.',
        reason: 'mcp_disabled',
      })
    );

    const error = await getMcpClientInfo('client').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 503, error: 'mcp_disabled', reason: 'mcp_disabled' });
    expect(isMcpDisabledError(error)).toBe(true);
    // The service answered on purpose: no "unavailable" state.
    expect(isMcpServiceUnavailable(error)).toBe(false);
  });

  it('reads mcp_disabled from the error code when the body has no reason', async () => {
    fetchMock
      .mockResolvedValueOnce(response(503, { error: 'mcp_disabled' }))
      .mockResolvedValueOnce(response(503, { error: 'unavailable' }));

    const disabled = await listMyMcpConnections(WS).catch((e: unknown) => e);
    const outage = await listMyMcpConnections(WS).catch((e: unknown) => e);

    expect(disabled).toMatchObject({ status: 503, reason: 'mcp_disabled' });
    expect(isMcpDisabledError(disabled)).toBe(true);
    expect(outage).toMatchObject({ status: 503, reason: 'temporarily_unavailable' });
    expect(isMcpDisabledError(outage)).toBe(false);
    expect(isMcpServiceUnavailable(outage)).toBe(true);
    expect(isMcpDisabledError(new Error('mcp_disabled'))).toBe(false);
  });

  it('keeps an unknown client distinct from a missing route', async () => {
    fetchMock.mockResolvedValueOnce(response(404, { error: 'invalid_client', reason: 'unknown_client' }));

    const error = await getMcpClientInfo('client').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 404, reason: 'unknown_client' });
    expect(isMcpServiceUnavailable(error)).toBe(false);
  });

  it('reports network failures with status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await getMcpMemberStatus(WS).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 0, error: 'network_error', reason: undefined });
    expect(isMcpServiceUnavailable(error)).toBe(true);
  });

  it('gives up on a request after 30 seconds and reports a timeout', async () => {
    jest.useFakeTimers();

    try {
      let fetchStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        fetchStarted = resolve;
      });

      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            fetchStarted();
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          })
      );

      const pending = getMcpMemberStatus(WS).catch((e: unknown) => e);

      await started;
      jest.advanceTimersByTime(29_999);
      expect(call().url.pathname).toBe(`/api/mcp/me/workspaces/${WS}`);
      expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(false);
      jest.advanceTimersByTime(1);

      const error = await pending;

      expect(error).toMatchObject({ status: 0, error: 'timeout', reason: undefined });
      expect(isMcpServiceUnavailable(error)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['network_error', true],
    ['timeout', true],
    ['not_configured', true],
    // The AppFlowy session refresh failed, or the call was refused before sending: the MCP service
    // was never asked.
    ['session_refresh_failed', false],
    ['invalid_request', false],
  ])('%s, without a response, means the MCP service is unavailable: %s', (error, unavailable) => {
    expect(isMcpServiceUnavailable(new McpApiError({ status: 0, error }))).toBe(unavailable);
  });

  it('rethrows the abort error when the caller aborts during the request', async () => {
    const controller = new AbortController();
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });

    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          fetchStarted();
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })
    );

    const pending = listMyMcpConnections(WS, { signal: controller.signal });

    await started;
    controller.abort();

    const error = await pending.catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(McpApiError);
    expect(isMcpAbortError(error)).toBe(true);
  });

  it('does not send a request the caller already aborted', async () => {
    const controller = new AbortController();
    const pending = listMyMcpConnections(WS, { signal: controller.signal });

    controller.abort();

    expect(isMcpAbortError(await pending.catch((e: unknown) => e))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MCP failure log', () => {
  it('logs a refusal once with the raw reason and description, but no request secrets', async () => {
    fetchMock.mockResolvedValueOnce(
      response(400, {
        error: 'invalid_request',
        error_description: 'redirect_uri is not registered for this client',
        reason: 'brand_new_reason',
      })
    );

    const error = await createMcpAuthorizationCode({
      client_id: CIMD_CLIENT,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'challenge-secret',
      code_challenge_method: 'S256',
      workspace_id: WS,
      state: 'state-secret',
    }).catch((e: unknown) => e);

    // The error drops a reason this Web does not know; the log keeps it.
    expect(error).toMatchObject({ status: 400, reason: undefined });
    expect(logWarn).toHaveBeenCalledTimes(1);
    expect(logWarn).toHaveBeenCalledWith('[MCP] POST /api/mcp/authorize/code failed', {
      status: 400,
      error: 'invalid_request',
      reason: 'brand_new_reason',
      description: 'redirect_uri is not registered for this client',
    });

    const logged = JSON.stringify(logWarn.mock.calls);

    ['state-secret', 'challenge-secret', 'auth_callback', CIMD_CLIENT, 'access-1'].forEach((secret) =>
      expect(logged).not.toContain(secret)
    );
  });

  it('logs the path without its query', async () => {
    fetchMock.mockResolvedValueOnce(response(404, { error: 'invalid_client', reason: 'unknown_client' }));

    await getMcpClientInfo(CIMD_CLIENT).catch(() => undefined);

    expect(logWarn).toHaveBeenCalledWith('[MCP] GET /api/mcp/clients failed', {
      status: 404,
      error: 'invalid_client',
      reason: 'unknown_client',
      description: undefined,
    });
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain('claude.ai');
  });

  it('logs an unreadable success answer and a request that got no answer', async () => {
    fetchMock.mockResolvedValueOnce(response(200, {})).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await listMyMcpConnections(WS).catch(() => undefined);
    await listMyMcpConnections(WS).catch(() => undefined);

    expect(logWarn).toHaveBeenCalledTimes(2);
    expect(logWarn.mock.calls[0][1]).toMatchObject({ status: 200, error: 'invalid_response', reason: 'server_error' });
    expect(logWarn.mock.calls[1][1]).toEqual({
      status: 0,
      error: 'network_error',
      description: 'Could not reach the MCP service',
    });
  });

  it('logs nothing for a success or a request the caller aborted', async () => {
    const controller = new AbortController();

    fetchMock
      .mockResolvedValueOnce(response(200, { connections: [] }))
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          })
      );

    await listMyMcpConnections(WS);

    const pending = listMyMcpConnections(WS, { signal: controller.signal }).catch((e: unknown) => e);

    await Promise.resolve();
    controller.abort();

    expect(isMcpAbortError(await pending)).toBe(true);
    expect(logWarn).not.toHaveBeenCalled();
  });
});

describe('MCP session handling', () => {
  it('refreshes once and retries once on 401 invalid_session', async () => {
    fetchMock
      .mockResolvedValueOnce(response(401, { error: 'unauthorized', reason: 'invalid_session' }))
      .mockResolvedValueOnce(response(200, { connections: [] }));

    await expect(listMyMcpConnections(WS)).resolves.toEqual([]);
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mockedRefresh).toHaveBeenCalledWith('refresh-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(0).headers.Authorization).toBe('Bearer access-1');
    expect(call(1).headers.Authorization).toBe('Bearer access-2');
  });

  it('gives up after the single retry', async () => {
    fetchMock.mockResolvedValue(response(401, { error: 'unauthorized', reason: 'invalid_session' }));

    await expect(listMyMcpConnections(WS)).rejects.toMatchObject({ status: 401, reason: 'invalid_session' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(invalidTokenForSession).not.toHaveBeenCalled();
  });

  it('does not retry a 401 without the invalid_session reason', async () => {
    fetchMock.mockResolvedValueOnce(response(401, { error: 'unauthorized' }));

    await expect(listMyMcpConnections(WS)).rejects.toMatchObject({ status: 401, reason: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('reuses a token another request already rotated instead of refreshing again', async () => {
    fetchMock.mockImplementationOnce(async () => {
      storedToken = makeToken({ access_token: 'access-3', refresh_token: 'refresh-3' });
      return response(401, { reason: 'invalid_session' });
    });
    fetchMock.mockResolvedValueOnce(response(200, { connections: [] }));

    await listMyMcpConnections(WS);
    expect(mockedRefresh).not.toHaveBeenCalled();
    expect(call(1).headers.Authorization).toBe('Bearer access-3');
  });

  it('does not retry as another user who signed in meanwhile', async () => {
    fetchMock.mockImplementationOnce(async () => {
      // Another tab signed out and in as someone else; the token store is shared.
      storedToken = makeToken({ access_token: 'access-b', refresh_token: 'refresh-b', user: { id: 'user-2' } });
      return response(401, { reason: 'invalid_session' });
    });

    await expect(approveMcpClient(WS, CIMD_CLIENT)).rejects.toMatchObject({ status: 401, reason: 'invalid_session' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it('does not send as another user whose session a refresh found', async () => {
    storedToken = makeToken({ expires_at: nowSeconds() + 10 });
    mockedRefresh.mockImplementationOnce(async () => {
      storedToken = makeToken({ access_token: 'access-b', refresh_token: 'refresh-b', user: { id: 'user-2' } });
      return storedToken;
    });

    await expect(listMyMcpConnections(WS)).rejects.toMatchObject({ status: 401, reason: 'invalid_session' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes a token that expires within 30 seconds before sending', async () => {
    storedToken = makeToken({ expires_at: nowSeconds() + 10 });
    fetchMock.mockResolvedValueOnce(response(200, { connections: [] }));

    await listMyMcpConnections(WS);
    expect(mockedRefresh).toHaveBeenCalledWith('refresh-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(call().headers.Authorization).toBe('Bearer access-2');
  });

  it('ends the session when GoTrue rejects the refresh token', async () => {
    const rejection = Object.assign(new Error('Invalid Refresh Token'), { status: 400 });

    storedToken = makeToken({ expires_at: nowSeconds() - 1 });
    mockedRefresh.mockRejectedValueOnce(rejection);
    mockedIsAuthRefreshFailure.mockReturnValueOnce(true);

    await expect(listMyMcpConnections(WS)).rejects.toMatchObject({ status: 401, reason: 'invalid_session' });
    expect(captureTokenSession).toHaveBeenCalled();
    expect(invalidTokenForSession).toHaveBeenCalledWith({ generation: 1, userId: 'user-1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the session when the refresh fails for a temporary reason', async () => {
    storedToken = makeToken({ expires_at: nowSeconds() - 1 });
    mockedRefresh.mockRejectedValueOnce(new Error('Network Error'));

    const error = await listMyMcpConnections(WS).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 0, reason: 'temporarily_unavailable', error: 'session_refresh_failed' });
    // GoTrue failed, not the MCP service: Settings shows the error, not "MCP service not configured".
    expect(isMcpServiceUnavailable(error)).toBe(false);
    expect(invalidTokenForSession).not.toHaveBeenCalled();
  });

  it('fails fast without a session', async () => {
    storedToken = null;

    await expect(getMcpMemberStatus(WS)).rejects.toMatchObject({ status: 401, reason: 'invalid_session' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('mcpTimestampToDate', () => {
  it.each([
    // Unix seconds (connections, access requests).
    [1_767_225_600, '2026-01-01T00:00:00.000Z'],
    // RFC 3339 (approvals, settings).
    ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z'],
  ])('converts %p', (value, iso) => {
    expect(mcpTimestampToDate(value)?.toISOString()).toBe(iso);
  });

  it.each([undefined, null, '', 'not a date', 1e20, Number.NaN])('returns null for %p', (value) => {
    expect(mcpTimestampToDate(value)).toBeNull();
  });
});
