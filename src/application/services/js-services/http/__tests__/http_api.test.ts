import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  AccessLevel,
  AuthProvider,
  SpaceInvitePolicy,
  SpaceMemberRole,
  SpaceSidebarEditPolicy,
  SpaceVisibility,
} from '@/application/types';

const mockAxiosInstance = {
  interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  get: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  patch: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  post: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  put: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  delete: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockAxiosCreate = jest.fn(() => mockAxiosInstance);
const mockVerifyAndRefreshGoTrueToken = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetTokenParsed = jest.fn(() => null as { user?: { id?: string } } | null);

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: mockAxiosCreate,
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
  },
  create: mockAxiosCreate,
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
}));

jest.mock('@/application/services/js-services/http/gotrue', () => ({
  initGrantService: jest.fn(),
  refreshToken: jest.fn(),
  verifyAndRefreshGoTrueToken: mockVerifyAndRefreshGoTrueToken,
}));

jest.mock('@/application/session/token', () => ({
  getTokenParsed: () => mockGetTokenParsed(),
  invalidToken: jest.fn(),
}));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: jest.fn((_: string, defaultValue: string | undefined) => defaultValue),
}));

jest.mock('@/assets/icons/check_circle.svg', () => ({}), { virtual: true });
jest.mock('@/assets/icons/close.svg', () => ({}), { virtual: true });
jest.mock('@/assets/icons/error.svg', () => ({}), { virtual: true });
jest.mock('@/assets/icons/warning.svg', () => ({}), { virtual: true });

const baseConfig = {
  baseURL: 'https://api.example.com',
  gotrueURL: 'https://auth.example.com',
  wsURL: 'wss://ws.example.com',
};

describe('http_api client (unit)', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    mockAxiosCreate.mockClear();
    mockAxiosInstance.interceptors.request.use.mockReset();
    mockAxiosInstance.interceptors.response.use.mockReset();
    mockAxiosInstance.get.mockReset();
    mockAxiosInstance.patch.mockReset();
    mockAxiosInstance.post.mockReset();
    mockVerifyAndRefreshGoTrueToken.mockReset();
    mockAxiosInstance.put.mockReset();
    mockAxiosInstance.delete.mockReset();
    mockGetTokenParsed.mockReset();
    mockGetTokenParsed.mockReturnValue(null);
  });

  it('initializes axios instance once with provided config', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    expect(mockAxiosCreate).toHaveBeenCalledTimes(1);
    expect(mockAxiosCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: baseConfig.baseURL,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(module.getAxiosInstance()).toBe(mockAxiosInstance);

    // Subsequent init calls should no-op
    module.initAPIService({ ...baseConfig, baseURL: 'https://ignored.example.com' });
    expect(mockAxiosCreate).toHaveBeenCalledTimes(1);
  });

  it('re-exports space-group ACL update and revoke clients', async () => {
    const module = await import('../http_api');

    module.initAPIService(baseConfig);
    const payload = {
      role: SpaceMemberRole.Owner,
      access_level: AccessLevel.FullAccess,
    };
    const updatedGroup = {
      group_id: 'group-1',
      name: 'Engineering',
      role: SpaceMemberRole.Owner,
      access_level: AccessLevel.FullAccess,
      member_count: 2,
      source: 'manual',
    };

    mockAxiosInstance.patch.mockResolvedValueOnce({
      data: { code: 0, data: updatedGroup },
    });
    mockAxiosInstance.delete.mockResolvedValueOnce({
      status: 200,
      data: { code: 0 },
    });

    await expect(module.updateSpaceGroupPermission('workspace-1', 'space-1', 'group-1', payload)).resolves.toEqual(
      updatedGroup
    );
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
      '/api/workspace/workspace-1/spaces/space-1/group/group-1',
      payload
    );

    await expect(module.removeSpaceGroupPermission('workspace-1', 'space-1', 'group-1')).resolves.toBeUndefined();
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/api/workspace/workspace-1/spaces/space-1/group/group-1');
  });

  it('re-exports the atomic structured space update client', async () => {
    const module = await import('../http_api');

    module.initAPIService(baseConfig);
    const payload = {
      name: 'Closed space',
      space_icon: 'lock',
      space_icon_color: '#123456',
      permission: {
        visibility: SpaceVisibility.Closed,
        owner_access_level: AccessLevel.FullAccess,
        member_default_access_level: AccessLevel.ReadAndWrite,
        everyone_else_access_level: null,
        invite_policy: SpaceInvitePolicy.OwnersOnly,
        sidebar_edit_policy: SpaceSidebarEditPolicy.OwnersOnly,
        invite_link_enabled: false,
        security: {
          disable_guests: false,
          disable_public_links: false,
          disable_export: false,
        },
      },
    };

    mockAxiosInstance.patch.mockResolvedValueOnce({
      data: { code: 0, data: { view_id: 'space-1' } },
    });

    await expect(module.updateStructuredSpace('workspace-1', 'space-1', payload)).resolves.toEqual({
      view_id: 'space-1',
    });
    expect(mockAxiosInstance.patch).toHaveBeenCalledTimes(1);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/api/workspace/workspace-1/spaces/space-1', payload);
    expect(mockAxiosInstance.patch.mock.calls[0][0]).not.toBe('/api/workspace/workspace-1/space/space-1');
    expect(mockAxiosInstance.patch.mock.calls[0][1]).not.toHaveProperty('space_permission');
  });

  it('maps auth providers from API response', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          count: 3,
          providers: ['google', 'apple', 'ldap'],
          signup_disabled: false,
          mailer_autoconfirm: true,
          ldap_providers: [
            { id: 'corp-directory-id', name: '  Corporate Directory  ' },
            { id: 'partner-directory-id', name: 'Partners' },
            // Duplicate ids cannot become duplicate React keys or choices.
            { id: 'corp-directory-id', name: 'Duplicate' },
            { id: '   ', name: 'Missing id' },
          ],
        },
      },
    });

    const { providers, ldapProviders } = await module.getAuthProviders();
    expect(providers).toEqual([AuthProvider.GOOGLE, AuthProvider.APPLE, AuthProvider.LDAP]);
    expect(ldapProviders).toEqual([
      { id: 'corp-directory-id', name: 'Corporate Directory' },
      { id: 'partner-directory-id', name: 'Partners' },
    ]);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/server-info/auth-providers');
  });

  it('passes custom providers through and leaves a blank name blank', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          count: 3,
          providers: ['google', 'custom:okta-prod', 'custom:keycloak'],
          signup_disabled: false,
          mailer_autoconfirm: true,
          custom_providers: [
            { identifier: 'custom:okta-prod', name: '  Okta Production  ' },
            // A blank name must not be backfilled with the identifier — the
            // caller derives a nicer label from it than "custom:keycloak".
            { identifier: 'custom:keycloak', name: '   ' },
            // Not advertised in `providers`, so it is carried but unused.
            { identifier: 'not-custom', name: 'Ignored' },
          ],
        },
      },
    });

    const { providers, customProviders, ldapProviders } = await module.getAuthProviders();

    expect(providers).toEqual([AuthProvider.GOOGLE, 'custom:okta-prod', 'custom:keycloak']);
    expect(customProviders).toEqual([
      { identifier: 'custom:okta-prod', name: 'Okta Production' },
      { identifier: 'custom:keycloak', name: '' },
    ]);
    expect(ldapProviders).toEqual([]);
  });

  it('drops a bare custom prefix and deduplicates repeated providers', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          count: 5,
          // `custom:` names no provider, and the repeats would collide as React
          // keys once each entry becomes a login button.
          providers: ['google', 'custom:', 'custom:okta', 'google', 'custom:okta'],
          signup_disabled: false,
          mailer_autoconfirm: true,
          custom_providers: [
            { identifier: 'custom:', name: 'Nameless' },
            { identifier: 'custom:okta', name: 'Okta' },
          ],
        },
      },
    });

    const { providers, customProviders } = await module.getAuthProviders();

    expect(providers).toEqual([AuthProvider.GOOGLE, 'custom:okta']);
    expect(customProviders).toEqual([{ identifier: 'custom:okta', name: 'Okta' }]);
    expect(warnSpy).toHaveBeenCalledWith('Unknown auth provider from server: custom:');
    warnSpy.mockRestore();
  });

  it('bounds and cancels server-info requests while identifying the web platform', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);
    const abortController = new AbortController();

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          enable_page_history: true,
          ai_enabled: true,
        },
      },
    });

    await expect(module.getServerInfo(abortController.signal)).resolves.toEqual({
      enable_page_history: true,
      ai_enabled: true,
    });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/server-info', {
      headers: {
        'x-platform': 'web',
      },
      signal: abortController.signal,
      timeout: 10_000,
    });
  });

  it('does not log LDAP session tokens from the response envelope', async () => {
    const module = await import('../http_api');
    const auth = await import('../auth-api');
    module.initAPIService(baseConfig);

    const tokens = {
      access_token: 'secret-access-token',
      refresh_token: 'secret-refresh-token',
    };
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        code: 0,
        message: 'OK',
        data: tokens,
      },
      config: {
        baseURL: baseConfig.baseURL,
        method: 'post',
        url: '/api/auth/ldap/login',
      },
    });
    mockVerifyAndRefreshGoTrueToken.mockResolvedValueOnce(undefined);

    await auth.signInWithLdap('alice', 'alice-secret-pw');

    const requestLog = debugSpy.mock.calls.find(([message]) => message === '[executeAPIRequest]');

    expect(requestLog?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        url: `${baseConfig.baseURL}/api/auth/ldap/login`,
        response_code: 0,
        response_message: 'OK',
      })
    );
    expect(requestLog?.[1]).not.toHaveProperty('response_data');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain(tokens.access_token);
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain(tokens.refresh_token);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/auth/ldap/login', {
      username: 'alice',
      password: 'alice-secret-pw',
    });
    expect(mockVerifyAndRefreshGoTrueToken).toHaveBeenCalledWith({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      logContext: 'signInWithLdap',
    });

    debugSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('routes LDAP credentials to the selected connection', async () => {
    const module = await import('../http_api');
    const auth = await import('../auth-api');
    module.initAPIService(baseConfig);

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        },
      },
    });
    mockVerifyAndRefreshGoTrueToken.mockResolvedValueOnce(undefined);

    await auth.signInWithLdap('alice@example.com', 'alice-secret-pw', 'corp-directory-id');

    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/auth/ldap/login', {
      username: 'alice@example.com',
      password: 'alice-secret-pw',
      connection_id: 'corp-directory-id',
    });
  });

  it('does not log LDAP credentials when a response has no body', async () => {
    const module = await import('../http_api');
    const auth = await import('../auth-api');
    module.initAPIService(baseConfig);

    const credentials = {
      username: 'alice',
      password: 'alice-secret-pw',
    };
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: undefined,
      status: 204,
      statusText: 'No Content',
      config: {
        baseURL: baseConfig.baseURL,
        data: JSON.stringify(credentials),
        method: 'post',
        url: '/api/auth/ldap/login',
      },
    });

    await expect(auth.signInWithLdap(credentials.username, credentials.password)).rejects.toEqual({
      code: -1,
      message: 'No response data received',
    });

    const serializedLogs = JSON.stringify([...debugSpy.mock.calls, ...errorSpy.mock.calls]);

    expect(serializedLogs).not.toContain(credentials.username);
    expect(serializedLogs).not.toContain(credentials.password);
    expect(errorSpy).toHaveBeenCalledWith('[executeAPIRequest] No response data received', {
      method: 'POST',
      url: `${baseConfig.baseURL}/api/auth/ldap/login`,
      status: 204,
      statusText: 'No Content',
    });
    expect(mockVerifyAndRefreshGoTrueToken).not.toHaveBeenCalled();

    debugSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('falls back to password provider when API responds with error', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        code: 400,
        message: 'Invalid request',
      },
    });

    await expect(module.getAuthProviders()).resolves.toEqual({
      providers: [AuthProvider.PASSWORD],
      customProviders: [],
      ldapProviders: [],
    });
    expect(warnSpy).toHaveBeenCalledWith('Auth providers API returned error:', 'Invalid request');
    warnSpy.mockRestore();
  });

  it('returns default provider when transport fails', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockAxiosInstance.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        data: { code: 401, message: 'Unauthorized' },
      },
    });

    await expect(module.getAuthProviders()).resolves.toEqual({
      providers: [AuthProvider.PASSWORD],
      customProviders: [],
      ldapProviders: [],
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not call the legacy access-details endpoint after a v2 permission error', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        code: 1012,
        message: 'Not enough permissions',
      },
    });

    await expect(module.getShareDetail('workspace-1', 'page-1', [])).rejects.toMatchObject({
      code: 1012,
    });
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('does not retry AppFlowy permission codes as HTTP server errors', async () => {
    const { withRetry } = await import('../core');
    const request = jest.fn().mockRejectedValue({ code: 1012, message: 'Not enough permissions' });

    await expect(withRetry(request, { delays: [0, 0, 0] })).rejects.toMatchObject({ code: 1012 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('still retries an HTTP 429 carrying an AppFlowy application code', async () => {
    const { withRetry } = await import('../core');
    const request = jest
      .fn()
      .mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Busy',
        response: {
          status: 429,
          data: { code: 1079, message: 'Busy' },
          headers: {},
        },
      })
      .mockResolvedValueOnce('ok');

    await expect(withRetry(request, { delays: [0] })).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('falls back to legacy access details when v2 is unsupported', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);
    const legacyDetails = { shared_with: [{ email: 'guest@appflowy.io' }] };

    mockAxiosInstance.get.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Not found',
      response: {
        status: 404,
        data: { message: 'Not found' },
        headers: {},
      },
    });
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { code: 0, data: legacyDetails } });

    await expect(module.getShareDetail('workspace-1', 'page-1', ['parent-1'])).resolves.toEqual(legacyDetails);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/api/sharing/workspace/workspace-1/view/page-1/access-details',
      { ancestor_view_ids: ['parent-1'] }
    );
  });

  it('fetches fresh access details after workspace cache invalidation', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);
    const staleDetails = {
      shared_with: [{ email: 'removed@appflowy.io' }],
    };
    const freshDetails = { shared_with: [] };

    mockAxiosInstance.get
      .mockResolvedValueOnce({ data: { code: 0, data: staleDetails } })
      .mockResolvedValueOnce({ data: { code: 0, data: freshDetails } });

    await expect(module.getShareDetail('workspace-1', 'page-1', [])).resolves.toEqual(staleDetails);
    await expect(module.getShareDetail('workspace-1', 'page-1', [])).resolves.toEqual(staleDetails);
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);

    module.invalidateShareDetailCache('workspace-1');

    await expect(module.getShareDetail('workspace-1', 'page-1', [])).resolves.toEqual(freshDetails);
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
  });

  it('does not reuse access details across an in-app account switch', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);
    const firstUserDetails = { shared_with: [{ email: 'first-user@appflowy.io' }] };
    const secondUserDetails = { shared_with: [{ email: 'second-user@appflowy.io' }] };

    mockAxiosInstance.get
      .mockResolvedValueOnce({ data: { code: 0, data: firstUserDetails } })
      .mockResolvedValueOnce({ data: { code: 0, data: secondUserDetails } });

    mockGetTokenParsed.mockReturnValueOnce({ user: { id: 'user-1' } });
    await expect(module.getShareDetail('workspace-1', 'page-1', [])).resolves.toEqual(firstUserDetails);

    mockGetTokenParsed.mockReturnValueOnce({ user: { id: 'user-2' } });
    await expect(module.getShareDetail('workspace-1', 'page-1', [])).resolves.toEqual(secondUserDetails);
    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
  });

  it('preserves the server retry hint on access-details errors', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        code: 1079,
        message: 'Access details are refreshing',
        retry_after_secs: 3,
      },
    });

    await expect(module.getShareDetail('workspace-1', 'page-1', [])).rejects.toMatchObject({
      code: 1079,
      retryAfterSecs: 3,
    });
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('uses params-scoped ETag caching for access-details v2 GET requests', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    const requestInterceptor = mockAxiosInstance.interceptors.request.use.mock.calls[1][0] as (config: any) => any;
    const etagResponseInterceptor = mockAxiosInstance.interceptors.response.use.mock.calls[1];
    const responseSuccess = etagResponseInterceptor[0] as (response: any) => any;
    const responseError = etagResponseInterceptor[1] as (error: any) => any;
    const url = '/api/sharing/workspace/workspace-1/access-details/v2';
    const params = {
      page_id: 'page-1',
      type: 'page',
    };
    const cachedData = {
      code: 0,
      data: {
        shared_with: [],
      },
      message: 'ok',
    };

    responseSuccess({
      headers: {
        etag: 'W/"access-details-v2:test"',
      },
      config: {
        method: 'get',
        url,
        params,
      },
      data: cachedData,
    });

    const headers = {
      set: jest.fn(),
    };

    requestInterceptor({
      method: 'get',
      url,
      params,
      headers,
    });

    expect(headers.set).toHaveBeenCalledWith('If-None-Match', 'W/"access-details-v2:test"');

    const cachedResponse = await responseError({
      isAxiosError: true,
      config: {
        method: 'get',
        url,
        params,
      },
      response: {
        status: 304,
        data: undefined,
      },
    });

    expect(cachedResponse.status).toBe(200);
    expect(cachedResponse.data).toEqual(cachedData);
  });

  it('does not attach ETags to mutation POST requests', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    const requestInterceptor = mockAxiosInstance.interceptors.request.use.mock.calls[1][0] as (config: any) => any;
    const headers = {
      set: jest.fn(),
    };

    requestInterceptor({
      method: 'post',
      url: '/api/sharing/workspace/workspace-1/view/page-1',
      data: {
        emails: ['user@appflowy.io'],
      },
      headers,
    });

    expect(headers.set).not.toHaveBeenCalled();
  });
});
