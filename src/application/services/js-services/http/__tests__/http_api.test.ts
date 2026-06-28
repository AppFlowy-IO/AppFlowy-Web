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
    mockAxiosInstance.interceptors.request.use.mockReset();
    mockAxiosInstance.interceptors.response.use.mockReset();
    mockAxiosInstance.get.mockReset();
    mockAxiosInstance.post.mockReset();
    mockAxiosInstance.put.mockReset();
    mockAxiosInstance.delete.mockReset();
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
