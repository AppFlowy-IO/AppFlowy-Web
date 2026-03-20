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
    mockAxiosInstance.get.mockReset();
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
});
