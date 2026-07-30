import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AuthProvider } from '@/application/types';

const mockAxiosInstance = {
  interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  get: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  post: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  put: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  delete: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};

const mockAxiosCreate = jest.fn(() => mockAxiosInstance);
const mockVerifyAndRefreshGoTrueToken = jest.fn<(...args: unknown[]) => Promise<unknown>>();

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
  getTokenParsed: jest.fn(() => null),
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
    mockAxiosCreate.mockClear();
    mockAxiosInstance.get.mockReset();
    mockAxiosInstance.post.mockReset();
    mockVerifyAndRefreshGoTrueToken.mockReset();
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

  it('identifies server-info requests as web so page history is not hidden by native client gates', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          enable_page_history: true,
          ai_enabled: true,
        },
      },
    });

    await expect(module.getServerInfo()).resolves.toEqual({
      enable_page_history: true,
      ai_enabled: true,
    });
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/server-info', {
      headers: {
        'x-platform': 'web',
      },
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
        url: '/web-api/ldap-login',
      },
    });
    mockVerifyAndRefreshGoTrueToken.mockResolvedValueOnce(undefined);

    await auth.signInWithLdap('alice', 'alice-secret-pw');

    const requestLog = debugSpy.mock.calls.find(([message]) => message === '[executeAPIRequest]');

    expect(requestLog?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        url: `${baseConfig.baseURL}/web-api/ldap-login`,
        response_code: 0,
        response_message: 'OK',
      })
    );
    expect(requestLog?.[1]).not.toHaveProperty('response_data');
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain(tokens.access_token);
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain(tokens.refresh_token);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/web-api/ldap-login', {
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

    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/web-api/ldap-login', {
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
        url: '/web-api/ldap-login',
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
      url: `${baseConfig.baseURL}/web-api/ldap-login`,
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
});
