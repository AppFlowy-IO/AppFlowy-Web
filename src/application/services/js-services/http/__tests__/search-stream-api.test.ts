import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

import { getAxios } from '../core';
import { searchWorkspaceDocumentStream, SearchStreamUnsupportedError } from '../search-stream-api';
import {
  SearchStreamDecoder,
  SEARCH_STREAM_MAX_EVENT_BYTES,
  SEARCH_STREAM_MAX_TOTAL_BYTES,
  SEARCH_STREAM_TIMEOUT_MS,
} from '../search-stream-protocol';

import type { AxiosResponse } from 'axios';

jest.mock('../core', () => ({ ...jest.requireActual('../core'), getAxios: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));

const get = jest.fn();
const encoder = new TextEncoder();
const queryId = '3ef8f900-1d18-4afb-8d43-49bf3cc714a1';
const item = { object_id: 'page-a', workspace_id: 'workspace-a', score: 0.8, content: '你好 🌊' };
const keyword = { type: 'snapshot', query_id: queryId, sequence: 0, phase: 'keyword', items: [item] };
const final = { ...keyword, sequence: 1, phase: 'final', items: [{ ...item, object_id: 'page-b' }] };
const done = { type: 'done', query_id: queryId, sequence: 2, outcome: 'complete' };
const errorEvent = {
  type: 'error',
  query_id: queryId,
  sequence: 0,
  error: {
    code: 1012,
    message: 'Denied diagnostic',
    user_error: { reason: 'PERMISSION_DENIED' },
    request_id: 'request-a',
  },
};

function frame(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function response(body: unknown, status = 200, contentType = 'text/event-stream') {
  return { status, data: body, headers: { 'content-type': contentType } } as AxiosResponse;
}

function body(chunks: Uint8Array[], cancel = jest.fn()) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel,
  });
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

beforeAll(() => {
  Object.assign(global, { TextDecoder, TextEncoder, ReadableStream, fetch: jest.fn() });
});

beforeEach(() => {
  jest.clearAllMocks();
  (getAxios as jest.Mock).mockReturnValue({ get });
});

afterEach(() => jest.useRealTimers());

it('publishes split UTF-8 keyword results before the gated final snapshot and waits for EOF', async () => {
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller as never;
    },
  });

  get.mockResolvedValue(response(stream));
  const onSnapshot = jest.fn();
  let settled = false;
  const promise = searchWorkspaceDocumentStream('workspace-a', '你好', { onSnapshot, requestStreamId: 'box-a' });

  void promise.then(() => {
    settled = true;
  });
  const bytes = frame(keyword);
  const split = bytes.indexOf(0xe4) + 1;

  streamController.enqueue(bytes.subarray(0, split));
  streamController.enqueue(bytes.subarray(split));
  await flush();
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  expect(onSnapshot).toHaveBeenLastCalledWith(keyword);
  expect(settled).toBe(false);
  streamController.enqueue(frame(final));
  streamController.enqueue(frame(done));
  await flush();
  expect(onSnapshot).toHaveBeenLastCalledWith(final);
  expect(settled).toBe(false);
  streamController.close();
  await expect(promise).resolves.toEqual({ outcome: 'complete' });
  expect(get).toHaveBeenCalledWith(
    '/api/search/workspace-a/stream',
    expect.objectContaining({
      adapter: 'fetch',
      responseType: 'stream',
      skipTransportRetry: true,
      skipResponseCache: true,
      params: { query: '你好', mode: 'hybrid', limit: 10, preview_size: 80, score: 0.2 },
      headers: expect.objectContaining({ Accept: 'text/event-stream', 'x-request-stream-id': 'box-a' }),
    })
  );
});

it('accepts final-only keyword searches and explicitly degraded completion', async () => {
  get.mockResolvedValue(
    response(body([frame({ ...final, sequence: 0 }), frame({ ...done, sequence: 1, outcome: 'degraded' })]))
  );
  await expect(
    searchWorkspaceDocumentStream('workspace-a', 'query', { mode: 'keyword', onSnapshot: jest.fn() })
  ).resolves.toEqual({ outcome: 'degraded' });
});

it('accepts supersession without a final snapshot', async () => {
  get.mockResolvedValue(response(body([frame({ ...done, sequence: 0, outcome: 'superseded' })])));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).resolves.toEqual({
    outcome: 'superseded',
  });
});

it.each([
  ['truncated frame', [frame(keyword), encoder.encode('event: done\ndata: {')]],
  ['missing terminal', [frame(keyword)]],
  ['trailing bytes after done', [frame(keyword), frame(final), frame(done), encoder.encode('x')]],
  ['event after done', [frame(keyword), frame(final), frame(done), frame({ ...done, sequence: 3 })]],
  ['invalid UTF-8', [new Uint8Array([0xff, 10, 10])]],
  ['missing event name', [encoder.encode(`data: ${JSON.stringify(keyword)}\n\n`)]],
])('rejects %s without reporting completion', async (_, chunks) => {
  get.mockResolvedValue(response(body(chunks)));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).rejects.toMatchObject({
    sourceDomain: 'client',
    code: -1,
  });
});

it('normalizes terminal errors using the existing public error identity after EOF', async () => {
  get.mockResolvedValue(response(body([frame(errorEvent)])));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).rejects.toMatchObject({
    code: 1012,
    sourceDomain: 'appflowy.server',
    diagnosticMessage: 'Denied diagnostic',
    user_error: errorEvent.error.user_error,
    requestId: 'request-a',
  });
});

it('rejects a terminal error followed by trailing data as a protocol failure', async () => {
  get.mockResolvedValue(response(body([frame(errorEvent), encoder.encode('partial')])));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).rejects.toMatchObject({
    sourceDomain: 'client',
    code: -1,
  });
});

it('decodes HTTP 200 Cloud JSON errors without falling back or losing error metadata', async () => {
  get.mockResolvedValue(response(body([encoder.encode(JSON.stringify(errorEvent.error))]), 200, 'application/json'));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).rejects.toMatchObject({
    code: 1012,
    sourceDomain: 'appflowy.server',
    requestId: 'request-a',
  });
  expect(get).toHaveBeenCalledTimes(1);
});

it.each([404, 405, 501])('classifies an unsupported HTTP %i route before reading results', async (status) => {
  const cancel = jest.fn();
  const stream = new ReadableStream({ cancel });

  get.mockResolvedValue(response(stream, status, 'text/plain'));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).rejects.toBeInstanceOf(
    SearchStreamUnsupportedError
  );
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledTimes(1);
});

it('keeps an application 404 as an application error rather than an unsupported endpoint', async () => {
  get.mockResolvedValue(response(body([encoder.encode(JSON.stringify(errorEvent.error))]), 404, 'application/json'));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).rejects.toMatchObject({
    code: 1012,
    sourceDomain: 'appflowy.server',
  });
});

it('never replays a malformed declared JSON response even on a 404 route', async () => {
  get.mockResolvedValue(response(body([encoder.encode('{broken')]), 404, 'application/json'));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).rejects.toMatchObject({
    code: -1,
    sourceDomain: 'client',
  });
});

it.each([403, 429, 503])('never classifies HTTP %i as unsupported or retries it', async (status) => {
  get.mockResolvedValue(response(body([encoder.encode('{}')]), status, 'application/json'));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).rejects.toMatchObject({
    httpStatus: status,
    sourceDomain: 'http',
  });
  expect(get).toHaveBeenCalledTimes(1);
});

it('treats a missing body on a successful route as a failure rather than replaying it', async () => {
  get.mockResolvedValue(response(null));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() })).rejects.toMatchObject({
    sourceDomain: 'client',
    code: -1,
  });
});

it('rejects cross-workspace results before publishing a snapshot', async () => {
  const onSnapshot = jest.fn();

  get.mockResolvedValue(response(body([frame({ ...keyword, items: [{ ...item, workspace_id: 'other-workspace' }] })])));
  await expect(searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot })).rejects.toMatchObject({
    sourceDomain: 'client',
    code: -1,
  });
  expect(onSnapshot).not.toHaveBeenCalled();
});

it('aborts a pending body, releases its reader, and does not emit later results', async () => {
  const cancel = jest.fn();
  const stream = new ReadableStream<Uint8Array>({ cancel });
  const controller = new AbortController();
  const onSnapshot = jest.fn();

  get.mockResolvedValue(response(stream));
  const promise = searchWorkspaceDocumentStream('workspace-a', 'query', { signal: controller.signal, onSnapshot });
  const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

  await flush();
  expect(stream.locked).toBe(true);
  controller.abort();
  await rejection;
  expect(stream.locked).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(onSnapshot).not.toHaveBeenCalled();
  expect(get).toHaveBeenCalledTimes(1);
});

it('enforces one deadline across headers and a stalled body', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn();

  get.mockResolvedValue(response(new ReadableStream({ cancel })));
  const promise = searchWorkspaceDocumentStream('workspace-a', 'query', { onSnapshot: jest.fn() });
  const rejection = expect(promise).rejects.toMatchObject({ sourceDomain: 'transport', transportFailure: 'timeout' });

  await flush();
  await jest.advanceTimersByTimeAsync(SEARCH_STREAM_TIMEOUT_MS);
  await rejection;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledTimes(1);
});

it('does not send a request for an already cancelled query', async () => {
  const controller = new AbortController();

  controller.abort();
  await expect(
    searchWorkspaceDocumentStream('workspace-a', 'query', { signal: controller.signal, onSnapshot: jest.fn() })
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(get).not.toHaveBeenCalled();
});

describe('bounded search protocol', () => {
  it('accepts CRLF, multiline data, and SSE metadata without enabling replay', () => {
    const decoder = new SearchStreamDecoder();
    const onSnapshot = jest.fn();
    const lines = JSON.stringify({ ...final, sequence: 0 }, null, 2)
      .split('\n')
      .map((line) => `data: ${line}`);

    decoder.push(
      encoder.encode(`: heartbeat\r\n\r\nid: ignored\r\nretry: 1\r\nevent: snapshot\r\n${lines.join('\r\n')}\r\n\r\n`),
      onSnapshot
    );
    decoder.push(frame({ ...done, sequence: 1 }), onSnapshot);
    expect(decoder.finish()).toMatchObject({ type: 'done' });
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['nonzero initial sequence', [{ ...keyword, sequence: 1 }]],
    ['sequence gap', [keyword, { ...final, sequence: 2 }]],
    ['query identity change', [keyword, { ...final, query_id: '5fb56cc9-b5f7-44eb-9398-c24b11f2e031' }]],
    ['invalid query UUID', [{ ...keyword, query_id: 'invalid' }]],
    ['duplicate keyword phase', [keyword, { ...keyword, sequence: 1 }]],
    [
      'keyword after final',
      [
        { ...final, sequence: 0 },
        { ...keyword, sequence: 1 },
      ],
    ],
    ['complete without final', [{ ...done, sequence: 0 }]],
    ['malformed item', [{ ...keyword, items: [{ ...item, score: 'NaN' }] }]],
  ])('rejects %s', (_, events) => {
    const decoder = new SearchStreamDecoder();

    expect(() => events.forEach((event) => decoder.push(frame(event), jest.fn()))).toThrow('Search stream');
  });

  it('rejects a mismatched SSE event name', () => {
    const decoder = new SearchStreamDecoder();

    expect(() => decoder.push(encoder.encode(`event: done\ndata: ${JSON.stringify(keyword)}\n\n`), jest.fn())).toThrow(
      'invalid event frame'
    );
  });

  it('rejects an oversized frame before buffering its excess bytes', () => {
    const decoder = new SearchStreamDecoder();

    expect(() => decoder.push(new Uint8Array(SEARCH_STREAM_MAX_EVENT_BYTES + 1), jest.fn())).toThrow(
      'event exceeds its byte limit'
    );
  });

  it('enforces total wire bytes including ignored SSE comments', () => {
    const decoder = new SearchStreamDecoder();
    const chunk = new Uint8Array(SEARCH_STREAM_MAX_EVENT_BYTES);

    chunk.fill(97);
    chunk[0] = 58;
    chunk[chunk.length - 2] = 10;
    chunk[chunk.length - 1] = 10;
    for (let length = 0; length < SEARCH_STREAM_MAX_TOTAL_BYTES; length += chunk.length) decoder.push(chunk, jest.fn());
    expect(() => decoder.push(new Uint8Array([10]), jest.fn())).toThrow('total byte limit');
  });
});
