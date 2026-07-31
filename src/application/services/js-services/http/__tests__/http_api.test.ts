import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AuthProvider } from '@/application/types';

const mockAxiosInstance = {
  interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
};

const mockAxiosCreate = jest.fn(() => mockAxiosInstance);
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
    mockAxiosInstance.post.mockReset();
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

  it('maps auth providers from API response', async () => {
    const module = await import('../http_api');
    module.initAPIService(baseConfig);

    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          count: 2,
          providers: ['google', 'apple'],
          signup_disabled: false,
          mailer_autoconfirm: true,
        },
      },
    });

    const providers = await module.getAuthProviders();
    expect(providers).toEqual([AuthProvider.GOOGLE, AuthProvider.APPLE]);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/server-info/auth-providers');
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

    await expect(module.getAuthProviders()).resolves.toEqual([AuthProvider.PASSWORD]);
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

    await expect(module.getAuthProviders()).resolves.toEqual([AuthProvider.PASSWORD]);
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
