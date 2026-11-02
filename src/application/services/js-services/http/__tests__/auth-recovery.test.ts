import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { initAPIService, getAxiosInstance } from '../core';
import { isAuthRefreshFailure } from '../auth-refresh-error';
import { EventType, on } from '@/application/session/event';
import { getTokenParsed, saveGoTrueAuth } from '@/application/session/token';
import { purgeAllOutbox } from '@/application/sync-outbox';

jest.mock('@/application/sync-outbox', () => ({ purgeAllOutbox: jest.fn(async () => undefined) }));
jest.mock('@/utils/log', () => ({
  Log: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const cloudRequest = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>();
const grantRequest = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>();
const sessionInvalid = jest.fn();
const baseURL = 'https://cloud.example';
const gotrueURL = 'https://auth.example';
const originalAdapter = axios.defaults.adapter;
let unsubscribe: () => void;

function token(access = 'access-a', refresh = 'refresh-a', expires_at = 4102444800, userId = 'account-a') {
  return { access_token: access, refresh_token: refresh, expires_at, user: { id: userId } };
}

function reply(config: InternalAxiosRequestConfig, status = 200, data: unknown = { code: 0 }) {
  const response = { config, data, headers: {}, status, statusText: String(status) };

  if (status >= 400) throw new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, undefined, response);
  return response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });

  return { promise, resolve };
}

beforeAll(() => {
  // Exercise the real Axios interceptor chain and GoTrue token persistence,
  // while keeping all requests inside a test-owned adapter.
  axios.defaults.adapter = (config) =>
    config.baseURL === gotrueURL ? grantRequest(config) : cloudRequest(config);
  initAPIService({ baseURL, gotrueURL, wsURL: 'wss://cloud.example/ws' });
  unsubscribe = on(EventType.SESSION_INVALID, sessionInvalid);
});

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  cloudRequest.mockReset().mockImplementation(async (config) => reply(config));
  grantRequest.mockReset().mockImplementation(async (config) => reply(config, 200, token('access-b', 'refresh-b')));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => { unsubscribe(); axios.defaults.adapter = originalAdapter; });

describe('HTTP authentication recovery', () => {
  it('leaves anonymous 401s outside the signed-in session lifecycle', async () => {
    cloudRequest.mockImplementation(async (config) => reply(config, 401, 'No Authorization header'));

    await expect(getAxiosInstance()!.get('/api/workspace/publish/database')).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(grantRequest).not.toHaveBeenCalled();
    expect(sessionInvalid).not.toHaveBeenCalled();
    expect(purgeAllOutbox).not.toHaveBeenCalled();
  });

  it.each(['network', 'timeout', 429, 503])('retains expired credentials after a temporary refresh failure: %s', async (failure) => {
    const stored = token('access-a', 'refresh-a', 1);

    saveGoTrueAuth(JSON.stringify(stored));
    grantRequest.mockImplementation(async (config) => {
      if (typeof failure === 'number') return reply(config, failure, { error: 'invalid_grant' });
      throw new AxiosError('Refresh unavailable', failure === 'timeout' ? 'ECONNABORTED' : 'ERR_NETWORK', config);
    });

    await expect(getAxiosInstance()!.get('/api/workspace/ws/database')).rejects.toBeInstanceOf(AxiosError);

    expect(getTokenParsed()).toEqual(stored);
    expect(sessionInvalid).not.toHaveBeenCalled();
    expect(purgeAllOutbox).not.toHaveBeenCalled();
    expect(cloudRequest).not.toHaveBeenCalled();
    expect(grantRequest).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401])('invalidates credentials when GoTrue confirms an invalid refresh token (%s)', async (status) => {
    saveGoTrueAuth(JSON.stringify(token('access-a', 'refresh-a', 1)));
    grantRequest.mockImplementation(async (config) => reply(config, status, {
      error: 'invalid_grant', error_code: 'refresh_token_not_found',
      error_description: 'Invalid Refresh Token: Refresh Token Not Found',
    }));

    await expect(getAxiosInstance()!.get('/api/workspace/ws/database')).rejects.toBeInstanceOf(AxiosError);

    expect(getTokenParsed()).toBeNull();
    expect(sessionInvalid).toHaveBeenCalledTimes(1);
  });

  it('refreshes and retries a safe read once after HTTP 401', async () => {
    saveGoTrueAuth(JSON.stringify(token()));
    cloudRequest.mockImplementation(async (config) =>
      config.headers.Authorization === 'Bearer access-a' ? reply(config, 401) : reply(config));

    await expect(getAxiosInstance()!.get('/api/workspace/ws/database')).resolves.toMatchObject({ status: 200 });

    expect(grantRequest).toHaveBeenCalledTimes(1);
    expect(cloudRequest).toHaveBeenCalledTimes(2);
    expect(getTokenParsed()?.access_token).toBe('access-b');
    expect(sessionInvalid).not.toHaveBeenCalled();
  });

  it('shares refresh work across concurrent 401s and retries both reads', async () => {
    saveGoTrueAuth(JSON.stringify(token()));
    cloudRequest.mockImplementation(async (config) =>
      config.headers.Authorization === 'Bearer access-a' ? reply(config, 401) : reply(config));

    await expect(Promise.all([
      getAxiosInstance()!.get('/api/workspace/ws/database'),
      getAxiosInstance()!.get('/api/workspace/ws/views'),
    ])).resolves.toHaveLength(2);

    expect(grantRequest).toHaveBeenCalledTimes(1);
    expect(cloudRequest).toHaveBeenCalledTimes(4);
  });

  it('reuses an already rotated token when an older request returns 401 late', async () => {
    saveGoTrueAuth(JSON.stringify(token()));
    const started = deferred<void>();
    const release = deferred<void>();

    cloudRequest.mockImplementationOnce(async (config) => {
      started.resolve();
      await release.promise;
      return reply(config, 401);
    });
    const request = getAxiosInstance()!.get('/api/workspace/ws/database');

    await started.promise;
    const { captureTokenSession } = await import('@/application/session/token');

    saveGoTrueAuth(JSON.stringify(token('access-b', 'refresh-b')), captureTokenSession());
    release.resolve();

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(grantRequest).not.toHaveBeenCalled();
    expect(cloudRequest.mock.calls[1][0].headers.Authorization).toBe('Bearer access-b');
  });

  it('stops after one refresh and one read retry when the server keeps returning 401', async () => {
    saveGoTrueAuth(JSON.stringify(token()));
    cloudRequest.mockImplementation(async (config) => reply(config, 401));

    await expect(getAxiosInstance()!.get('/api/workspace/ws/database')).rejects.toMatchObject({ response: { status: 401 } });

    expect(grantRequest).toHaveBeenCalledTimes(1);
    expect(cloudRequest).toHaveBeenCalledTimes(2);
  });

  it('propagates a temporary refresh error instead of the obsolete request 401', async () => {
    saveGoTrueAuth(JSON.stringify(token()));
    cloudRequest.mockImplementation(async (config) => reply(config, 401));
    grantRequest.mockImplementation(async (config) => reply(config, 503, { error: 'temporarily_unavailable' }));

    await expect(getAxiosInstance()!.get('/api/workspace/ws/database')).rejects.toMatchObject({ response: { status: 503 } });

    expect(getTokenParsed()?.access_token).toBe('access-a');
    expect(sessionInvalid).not.toHaveBeenCalled();
  });

  it.each(['post', 'patch', 'delete'])('does not automatically replay a %s mutation', async (method) => {
    saveGoTrueAuth(JSON.stringify(token()));
    cloudRequest.mockImplementation(async (config) => reply(config, 401));

    await expect(getAxiosInstance()!.request({ method, url: '/api/workspace/ws/page-view' }))
      .rejects.toMatchObject({ response: { status: 401 } });

    expect(cloudRequest).toHaveBeenCalledTimes(1);
    expect(grantRequest).toHaveBeenCalledTimes(1);
  });

  it('does not refresh or replay a request after its account was replaced', async () => {
    saveGoTrueAuth(JSON.stringify(token()));
    cloudRequest.mockImplementation(async (config) => {
      saveGoTrueAuth(JSON.stringify(token('other-access', 'other-refresh', 4102444800, 'account-b')));
      return reply(config, 401);
    });

    await expect(getAxiosInstance()!.get('/api/workspace/ws/database')).rejects.toMatchObject({ response: { status: 401 } });

    expect(cloudRequest).toHaveBeenCalledTimes(1);
    expect(grantRequest).not.toHaveBeenCalled();
    expect(getTokenParsed()?.user.id).toBe('account-b');
    expect(sessionInvalid).not.toHaveBeenCalled();
  });

  it('does not overwrite another account while a refresh is in flight', async () => {
    saveGoTrueAuth(JSON.stringify(token('access-a', 'refresh-a', 1)));
    const started = deferred<void>();
    const release = deferred<void>();

    grantRequest.mockImplementation(async (config) => {
      started.resolve();
      await release.promise;
      return reply(config, 200, token('access-b', 'refresh-b'));
    });
    const request = getAxiosInstance()!.get('/api/workspace/ws/database');

    await started.promise;
    saveGoTrueAuth(JSON.stringify(token('other-access', 'other-refresh', 4102444800, 'account-b')));
    release.resolve();

    await expect(request).rejects.toThrow('Failed to persist refreshed token');
    expect(getTokenParsed()?.user.id).toBe('account-b');
    expect(cloudRequest).not.toHaveBeenCalled();
    expect(sessionInvalid).not.toHaveBeenCalled();
  });

  it('leaves atomic creation reads under their command-owned retry policy', async () => {
    saveGoTrueAuth(JSON.stringify(token()));
    cloudRequest.mockImplementation(async (config) => reply(config, 401));

    await expect(getAxiosInstance()!.get('/api/workspace/ws/page-view/view', {
      atomicCreationOwner: { assertCurrent: jest.fn() },
    })).rejects.toMatchObject({ response: { status: 401 } });

    expect(cloudRequest).toHaveBeenCalledTimes(1);
    expect(grantRequest).toHaveBeenCalledTimes(1);
  });
});

describe('confirmed refresh rejection classification', () => {
  it.each([400, 401, 403])('recognizes GoTrue session rejection on HTTP %s', (status) => {
    expect(isAuthRefreshFailure({ response: { status, data: { error_code: 'session_not_found' } } })).toBe(true);
  });

  it.each([429, 500, 502, 503, 504])('preserves credentials despite OAuth-shaped HTTP %s errors', (status) => {
    expect(isAuthRefreshFailure({ response: { status, data: {
      error_code: 'refresh_token_not_found', error_description: 'Invalid refresh token',
    } } })).toBe(false);
  });

  it.each([new Error('Invalid refresh token'), 'Invalid refresh token', { response: { status: 401, data: 'proxy error' } }])
  ('does not infer token revocation without a GoTrue rejection: %p', (error) => {
    expect(isAuthRefreshFailure(error)).toBe(false);
  });
});
