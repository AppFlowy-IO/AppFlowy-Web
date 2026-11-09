import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { MentionSearchRequest, MentionSearchResponse, MentionTargetKind } from '@/application/types';

import { initAPIService } from '../core';
import { resetMentionStreamHeadersForTests, searchMentions } from '../workspace-api';

jest.mock('@/application/sync-outbox', () => ({ purgeAllOutbox: jest.fn(async () => undefined) }));
jest.mock('@/utils/log', () => ({
  Log: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const cloudRequest = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>();
const originalAdapter = axios.defaults.adapter;
const workspaceId = 'workspace-id';
const url = `/api/workspace/${workspaceId}/mentions/search`;
const payload: MentionSearchRequest = { query: 'road', limit: 20, include: [MentionTargetKind.Page] };
const answer: MentionSearchResponse = { sections: [], partial: false };

function ok(config: InternalAxiosRequestConfig): AxiosResponse {
  return { config, data: { code: 0, data: answer }, headers: {}, status: 200, statusText: 'OK' };
}

// What a page sees when the browser rejects a CORS preflight: a network error with no response.
function networkError(config: InternalAxiosRequestConfig) {
  return new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
}

function streamHeaders(config: InternalAxiosRequestConfig) {
  return {
    time: config.headers.get('x-request-time') ?? undefined,
    stream: config.headers.get('x-request-stream-id') ?? undefined,
  };
}

// An older nginx: every request that carries one of the headers fails its preflight.
async function rejectStreamHeaders(config: InternalAxiosRequestConfig) {
  const { time, stream } = streamHeaders(config);

  if (time || stream) throw networkError(config);
  return ok(config);
}

beforeAll(() => {
  // Exercise the real Axios instance and interceptors, with every request kept inside this adapter.
  axios.defaults.adapter = (config) => cloudRequest(config);
  initAPIService({
    baseURL: 'https://cloud.example',
    gotrueURL: 'https://auth.example',
    wsURL: 'wss://cloud.example/ws',
  });
});

afterAll(() => {
  axios.defaults.adapter = originalAdapter;
});

beforeEach(() => {
  resetMentionStreamHeadersForTests();
  localStorage.clear();
  cloudRequest.mockReset().mockImplementation(async (config) => ok(config));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('searchMentions', () => {
  it('sends the stream headers and the abort signal with the request', async () => {
    const controller = new AbortController();

    await expect(
      searchMentions(workspaceId, payload, {
        signal: controller.signal,
        streamId: 'web-mention-session-primary',
        requestTime: 1_700_000_000_123,
      })
    ).resolves.toEqual(answer);

    const [config] = cloudRequest.mock.calls[0];

    expect(config.method).toBe('post');
    expect(config.url).toBe(url);
    expect(JSON.parse(config.data as string)).toEqual(payload);
    expect(streamHeaders(config)).toEqual({ time: '1700000000123', stream: 'web-mention-session-primary' });
    expect(config.signal).toBe(controller.signal);
  });

  it('sends neither header nor a signal without options, as before', async () => {
    await expect(searchMentions(workspaceId, payload)).resolves.toEqual(answer);

    const [config] = cloudRequest.mock.calls[0];

    expect(streamHeaders(config)).toEqual({ time: undefined, stream: undefined });
    expect(config.signal).toBeUndefined();
  });

  it('never sends a request time that Search cannot parse', async () => {
    await searchMentions(workspaceId, payload, { streamId: 'stream', requestTime: 1.5 });
    await searchMentions(workspaceId, payload, { streamId: 'stream', requestTime: -1 });

    expect(cloudRequest.mock.calls.map(([config]) => streamHeaders(config))).toEqual([
      { time: undefined, stream: 'stream' },
      { time: undefined, stream: 'stream' },
    ]);
  });

  it('retries once without the headers when they are rejected, then leaves them out for the tab', async () => {
    cloudRequest.mockImplementation(rejectStreamHeaders);

    await expect(searchMentions(workspaceId, payload, { streamId: 'stream', requestTime: 1 })).resolves.toEqual(answer);
    expect(cloudRequest.mock.calls.map(([config]) => streamHeaders(config))).toEqual([
      { time: '1', stream: 'stream' },
      { time: undefined, stream: undefined },
    ]);
    expect(cloudRequest.mock.calls.map(([config]) => JSON.parse(config.data as string))).toEqual([payload, payload]);
    expect(console.warn).toHaveBeenCalledTimes(1);

    await expect(searchMentions(workspaceId, payload, { streamId: 'stream', requestTime: 2 })).resolves.toEqual(answer);
    expect(cloudRequest).toHaveBeenCalledTimes(3);
    expect(streamHeaders(cloudRequest.mock.calls[2][0])).toEqual({ time: undefined, stream: undefined });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('warns once when concurrent requests find the headers rejected', async () => {
    cloudRequest.mockImplementation(rejectStreamHeaders);

    await Promise.all([
      searchMentions(workspaceId, payload, { streamId: 'primary', requestTime: 1 }),
      searchMentions(
        workspaceId,
        { ...payload, include: [MentionTargetKind.DatabaseRow] },
        { streamId: 'rows', requestTime: 1 }
      ),
    ]);

    expect(cloudRequest).toHaveBeenCalledTimes(4);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the headers when the retry without them fails too, as in an outage', async () => {
    cloudRequest.mockImplementation(async (config) => {
      throw networkError(config);
    });

    await expect(searchMentions(workspaceId, payload, { streamId: 'stream', requestTime: 1 })).rejects.toMatchObject({
      code: -1,
      sourceDomain: 'transport',
      transportFailure: 'network',
    });
    expect(cloudRequest).toHaveBeenCalledTimes(2);
    expect(console.warn).not.toHaveBeenCalled();

    cloudRequest.mockImplementation(async (config) => ok(config));
    await searchMentions(workspaceId, payload, { streamId: 'stream', requestTime: 2 });
    expect(streamHeaders(cloudRequest.mock.calls[2][0])).toEqual({ time: '2', stream: 'stream' });
  });

  it.each([
    {
      failure: 'an HTTP error',
      error: (config: InternalAxiosRequestConfig) =>
        new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, undefined, {
          config,
          data: { code: 503, message: 'unavailable' },
          headers: {},
          status: 503,
          statusText: 'Service Unavailable',
        }),
      expected: { httpStatus: 503 },
    },
    {
      failure: 'a timeout',
      error: (config: InternalAxiosRequestConfig) => new AxiosError('timeout', AxiosError.ECONNABORTED, config),
      expected: { code: -1, transportFailure: 'timeout' },
    },
  ])('does not retry $failure', async ({ error, expected }) => {
    cloudRequest.mockImplementation(async (config) => {
      throw error(config);
    });

    await expect(searchMentions(workspaceId, payload, { streamId: 'stream', requestTime: 1 })).rejects.toMatchObject(
      expected
    );
    expect(cloudRequest).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('does not retry a request that its caller aborted', async () => {
    const controller = new AbortController();

    cloudRequest.mockImplementation(async (config) => {
      controller.abort();
      throw networkError(config);
    });

    await expect(
      searchMentions(workspaceId, payload, { signal: controller.signal, streamId: 'stream', requestTime: 1 })
    ).rejects.toMatchObject({ code: -1, transportFailure: 'cancelled' });
    expect(cloudRequest).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
