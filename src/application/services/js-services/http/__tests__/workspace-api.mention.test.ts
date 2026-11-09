import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { saveGoTrueAuth } from '@/application/session/token';
import { MentionSearchRequest, MentionSearchResponse, MentionTargetKind } from '@/application/types';

import { getAxiosInstance, initAPIService } from '../core';
import { MENTION_STREAM_HEADERS_OFF_MS, resetMentionStreamHeadersForTests, searchMentions } from '../workspace-api';

jest.mock('@/application/sync-outbox', () => ({ purgeAllOutbox: jest.fn(async () => undefined) }));
jest.mock('@/utils/log', () => ({
  Log: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const cloudRequest = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>();
const grantRequest = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>();
const originalAdapter = axios.defaults.adapter;
const baseURL = 'https://cloud.example';
const gotrueURL = 'https://auth.example';
const workspaceId = 'workspace-id';
const url = `/api/workspace/${workspaceId}/mentions/search`;
const payload: MentionSearchRequest = { query: 'road', limit: 20, include: [MentionTargetKind.Page] };
const answer: MentionSearchResponse = { sections: [], partial: false };
const streamOptions = (requestTime: number) => ({ streamId: 'stream', requestTime });

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

function sentHeaders() {
  return cloudRequest.mock.calls.map(([config]) => streamHeaders(config));
}

// An older nginx: every request that carries one of the headers fails its preflight.
async function rejectStreamHeaders(config: InternalAxiosRequestConfig) {
  const { time, stream } = streamHeaders(config);

  if (time || stream) throw networkError(config);
  return ok(config);
}

function mentionWarnings() {
  return (console.warn as jest.Mock).mock.calls.filter(([message]) => String(message).startsWith('[mention-search]'));
}

beforeAll(() => {
  // Exercise the real Axios instances and interceptors, with every request kept inside this adapter.
  axios.defaults.adapter = (config) => (config.baseURL === gotrueURL ? grantRequest(config) : cloudRequest(config));
  initAPIService({ baseURL, gotrueURL, wsURL: 'wss://cloud.example/ws' });
});

afterAll(() => {
  axios.defaults.adapter = originalAdapter;
});

beforeEach(() => {
  resetMentionStreamHeadersForTests();
  localStorage.clear();
  cloudRequest.mockReset().mockImplementation(async (config) => ok(config));
  grantRequest.mockReset();
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

    expect(sentHeaders()).toEqual([
      { time: undefined, stream: 'stream' },
      { time: undefined, stream: 'stream' },
    ]);
  });

  it('retries a rejected search without the headers, and leaves them out after a second rejection', async () => {
    cloudRequest.mockImplementation(rejectStreamHeaders);

    await expect(searchMentions(workspaceId, payload, streamOptions(1))).resolves.toEqual(answer);
    expect(sentHeaders()).toEqual([
      { time: '1', stream: 'stream' },
      { time: undefined, stream: undefined },
    ]);
    expect(cloudRequest.mock.calls.map(([config]) => JSON.parse(config.data as string))).toEqual([payload, payload]);
    expect(mentionWarnings()).toHaveLength(0);

    // One rejection may be a dropped connection, so the next search tries the headers again.
    await expect(searchMentions(workspaceId, payload, streamOptions(2))).resolves.toEqual(answer);
    expect(sentHeaders().slice(2)).toEqual([
      { time: '2', stream: 'stream' },
      { time: undefined, stream: undefined },
    ]);
    expect(mentionWarnings()).toHaveLength(1);

    await expect(searchMentions(workspaceId, payload, streamOptions(3))).resolves.toEqual(answer);
    expect(sentHeaders().slice(4)).toEqual([{ time: undefined, stream: undefined }]);
  });

  it('counts a rejected pair that was in flight together as one rejection', async () => {
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
    expect(mentionWarnings()).toHaveLength(0);

    await searchMentions(workspaceId, payload, { streamId: 'primary', requestTime: 2 });
    expect(sentHeaders().slice(4)).toEqual([
      { time: '2', stream: 'primary' },
      { time: undefined, stream: undefined },
    ]);
    expect(mentionWarnings()).toHaveLength(1);
  });

  it('sends the headers again once the off period ends, and warns only once per tab', async () => {
    let now = 1_000_000;

    jest.spyOn(Date, 'now').mockImplementation(() => now);
    cloudRequest.mockImplementation(rejectStreamHeaders);
    await searchMentions(workspaceId, payload, streamOptions(1));
    await searchMentions(workspaceId, payload, streamOptions(2));
    expect(mentionWarnings()).toHaveLength(1);

    now += MENTION_STREAM_HEADERS_OFF_MS - 1;
    cloudRequest.mockClear();
    await searchMentions(workspaceId, payload, streamOptions(3));
    expect(sentHeaders()).toEqual([{ time: undefined, stream: undefined }]);

    now += 1;
    cloudRequest.mockClear();
    await searchMentions(workspaceId, payload, streamOptions(4));
    await searchMentions(workspaceId, payload, streamOptions(5));
    await searchMentions(workspaceId, payload, streamOptions(6));
    expect(sentHeaders()).toEqual([
      { time: '4', stream: 'stream' },
      { time: undefined, stream: undefined },
      { time: '5', stream: 'stream' },
      { time: undefined, stream: undefined },
      { time: undefined, stream: undefined },
    ]);
    expect(mentionWarnings()).toHaveLength(1);
  });

  it.each([
    { between: 'an answer', respond: ok },
    {
      between: 'an error status',
      respond: (config: InternalAxiosRequestConfig): AxiosResponse => {
        throw new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, undefined, {
          config,
          data: { code: 503, message: 'unavailable' },
          headers: {},
          status: 503,
          statusText: 'Service Unavailable',
        });
      },
    },
  ])('keeps the headers after single transient failures with $between between them', async ({ respond }) => {
    const outcomes: Array<'fail' | 'respond'> = ['fail', 'respond', 'fail'];

    // Searches with the headers fail, get a response, and fail again; the retries without them pass.
    cloudRequest.mockImplementation(async (config) => {
      const { stream } = streamHeaders(config);
      const outcome = stream ? outcomes.shift() : undefined;

      if (outcome === 'fail') throw networkError(config);
      if (outcome === 'respond') return respond(config);
      return ok(config);
    });

    for (const requestTime of [1, 2, 3, 4]) {
      await searchMentions(workspaceId, payload, streamOptions(requestTime)).catch(() => undefined);
    }

    expect(sentHeaders()).toEqual([
      { time: '1', stream: 'stream' },
      { time: undefined, stream: undefined },
      { time: '2', stream: 'stream' },
      { time: '3', stream: 'stream' },
      { time: undefined, stream: undefined },
      { time: '4', stream: 'stream' },
    ]);
    expect(mentionWarnings()).toHaveLength(0);
  });

  it('keeps the headers when the retry without them fails too, as in an outage', async () => {
    cloudRequest.mockImplementation(async (config) => {
      throw networkError(config);
    });

    for (const requestTime of [1, 2]) {
      await expect(searchMentions(workspaceId, payload, streamOptions(requestTime))).rejects.toMatchObject({
        code: -1,
        sourceDomain: 'transport',
        transportFailure: 'network',
      });
    }

    expect(cloudRequest).toHaveBeenCalledTimes(4);
    expect(mentionWarnings()).toHaveLength(0);

    cloudRequest.mockImplementation(async (config) => ok(config));
    await searchMentions(workspaceId, payload, streamOptions(3));
    expect(sentHeaders()[4]).toEqual({ time: '3', stream: 'stream' });
  });

  it('never retries a same-origin search without the headers, which no preflight can reject', async () => {
    const instance = getAxiosInstance()!;

    instance.defaults.baseURL = window.location.origin;
    try {
      cloudRequest.mockImplementation(async (config) => {
        throw networkError(config);
      });

      for (const requestTime of [1, 2]) {
        await expect(searchMentions(workspaceId, payload, streamOptions(requestTime))).rejects.toMatchObject({
          transportFailure: 'network',
        });
      }

      cloudRequest.mockImplementation(async (config) => ok(config));
      await searchMentions(workspaceId, payload, streamOptions(3));
    } finally {
      instance.defaults.baseURL = baseURL;
    }

    expect(sentHeaders()).toEqual([
      { time: '1', stream: 'stream' },
      { time: '2', stream: 'stream' },
      { time: '3', stream: 'stream' },
    ]);
    expect(mentionWarnings()).toHaveLength(0);
  });

  it('does not retry when another request fails first, such as the token refresh', async () => {
    saveGoTrueAuth(
      JSON.stringify({ access_token: 'access-a', refresh_token: 'refresh-a', expires_at: 1, user: { id: 'account-a' } })
    );
    grantRequest.mockImplementation(async (config) => {
      throw networkError(config);
    });

    await expect(searchMentions(workspaceId, payload, streamOptions(1))).rejects.toMatchObject({
      code: -1,
      transportFailure: 'network',
    });
    expect(grantRequest).toHaveBeenCalledTimes(1);
    expect(cloudRequest).not.toHaveBeenCalled();

    grantRequest.mockImplementation(async (config) => ({
      config,
      data: { access_token: 'access-b', refresh_token: 'refresh-b', expires_at: 4102444800, user: { id: 'account-a' } },
      headers: {},
      status: 200,
      statusText: 'OK',
    }));
    await searchMentions(workspaceId, payload, streamOptions(2));
    expect(sentHeaders()).toEqual([{ time: '2', stream: 'stream' }]);
    expect(mentionWarnings()).toHaveLength(0);
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

    await expect(searchMentions(workspaceId, payload, streamOptions(1))).rejects.toMatchObject(expected);
    expect(cloudRequest).toHaveBeenCalledTimes(1);
    expect(mentionWarnings()).toHaveLength(0);
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
    expect(mentionWarnings()).toHaveLength(0);
  });
});
