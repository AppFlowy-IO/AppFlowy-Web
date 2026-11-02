import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { saveGoTrueAuth } from '@/application/session/token';

import { getAxiosInstance, initAPIService } from '../core';

jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock('@/application/sync-outbox', () => ({ purgeAllOutbox: jest.fn(async () => undefined) }));

const request = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>();
const originalAdapter = axios.defaults.adapter;

beforeAll(() => {
  axios.defaults.adapter = request;
  initAPIService({
    baseURL: 'https://cloud.example',
    gotrueURL: 'https://auth.example',
    wsURL: 'wss://cloud.example/ws',
  });
});
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());
afterAll(() => {
  axios.defaults.adapter = originalAdapter;
});

it.each(['network', 'timeout', 429, 503])(
  'never automatically replays an opted-out search after %s',
  async (failure) => {
    request.mockImplementation(async (config) => {
      if (typeof failure === 'number') {
        throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
          config,
          data: {},
          headers: {},
          status: failure,
          statusText: String(failure),
        });
      }

      throw new AxiosError('Request interrupted', failure === 'timeout' ? 'ECONNABORTED' : 'ERR_NETWORK', config);
    });
    const promise = getAxiosInstance()!.get('/api/search/workspace/stream', { skipTransportRetry: true });
    const rejection = expect(promise).rejects.toBeInstanceOf(AxiosError);

    await jest.runAllTimersAsync();
    await rejection;
    expect(request).toHaveBeenCalledTimes(1);
  }
);

it('preserves automatic retries for existing GET callers', async () => {
  request
    .mockImplementationOnce(async (config) => {
      throw new AxiosError('Network unavailable', 'ERR_NETWORK', config);
    })
    .mockImplementation(async (config) => ({ config, data: { code: 0 }, headers: {}, status: 200, statusText: 'OK' }));
  const promise = getAxiosInstance()!.get('/api/workspace');
  const completion = expect(promise).resolves.toMatchObject({ status: 200 });

  await jest.runAllTimersAsync();
  await completion;
  expect(request).toHaveBeenCalledTimes(2);
});

it('closes a denied stream and allows one pre-header authentication recovery', async () => {
  const cancel = jest.fn(async () => undefined);
  const token = {
    access_token: 'access-a',
    refresh_token: 'refresh-a',
    expires_at: 4102444800,
    user: { id: 'account-a' },
  };

  saveGoTrueAuth(JSON.stringify(token));
  request.mockImplementation(async (config) => {
    const reply = (data: unknown) => ({ config, data, headers: {}, status: 200, statusText: 'OK' });

    if (config.baseURL === 'https://auth.example')
      return reply({ ...token, access_token: 'access-b', refresh_token: 'refresh-b' });
    if (config.headers.Authorization === 'Bearer access-a') {
      throw new AxiosError('Unauthorized', 'ERR_BAD_RESPONSE', config, undefined, {
        config,
        data: { cancel },
        headers: {},
        status: 401,
        statusText: 'Unauthorized',
      });
    }

    return reply({ code: 0 });
  });
  await expect(
    getAxiosInstance()!.get('/api/search/workspace/stream', {
      skipTransportRetry: true,
      responseType: 'stream',
    })
  ).resolves.toMatchObject({ status: 200 });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls[2][0].headers.Authorization).toBe('Bearer access-b');
});
