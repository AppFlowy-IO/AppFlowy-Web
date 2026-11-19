import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

import { ChatRequest, parseStreamError } from '../chat-request';
import { OutputContent, OutputLayout } from '@/components/chat/types/request';

jest.mock('@/components/chat/lib/requets', () => ({
  ...jest.requireActual('@/components/chat/lib/requets'),
  createInitialInstance: () => ({
    defaults: { baseURL: 'https://cloud.example' },
    interceptors: { request: { use: jest.fn() } },
  }),
  getAccessToken: () => 'test-token',
  requestInterceptor: jest.fn(),
}));

const encoder = new TextEncoder();
const originalFetch = global.fetch;
const originalDecoder = global.TextDecoder;

beforeAll(() => {
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
});

afterAll(() => {
  global.TextDecoder = originalDecoder;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function ndjson(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
}

function mockStreamResponse(body: string, options: { ok?: boolean; status?: number; contentType?: string } = {}) {
  const stream = new NodeReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  global.fetch = jest.fn().mockResolvedValue({
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: { get: () => options.contentType ?? 'application/x-ndjson' },
    body: stream,
    text: async () => body,
  });
}

function createRequest() {
  const axiosInstance = {
    defaults: { baseURL: 'https://cloud.example' },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ChatRequest('ws-1', 'chat-1', axiosInstance as any);
}

const payload = {
  question_id: 7,
  format: {
    output_layout: OutputLayout.Flex,
    output_content: OutputContent.IMAGE,
    output_content_metadata: { size: '1024x1536' },
  },
  model_name: 'gpt-5-mini',
};

describe('ChatRequest.fetchAnswerStream', () => {
  it('delivers text, progress, reasoning and sources, and sends the image options', async () => {
    mockStreamResponse(
      ndjson([
        { '5': 'Searching the workspace' },
        { '6': 'Think ' },
        { '6': 'harder' },
        { '1': 'Hello' },
        { '1': ' world' },
        { '0': [{ id: 'view-1', name: 'Roadmap', source: 'appflowy', citation_id: 'A1' }, { bogus: true }] },
      ])
    );

    const onMessage = jest.fn();
    const onProgress = jest.fn();
    const onReasoning = jest.fn();
    const { streamPromise } = createRequest().fetchAnswerStream(payload, onMessage, onProgress, onReasoning);

    await streamPromise;

    expect(onProgress).toHaveBeenCalledWith('Searching the workspace');
    expect(onReasoning).toHaveBeenLastCalledWith('Think harder');
    expect(onMessage).toHaveBeenNthCalledWith(1, 'Hello', [], false);
    expect(onMessage).toHaveBeenLastCalledWith(
      'Hello world',
      [{ id: 'view-1', name: 'Roadmap', source: 'appflowy', citation_id: 'A1' }],
      true
    );

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];

    expect(url).toBe('https://cloud.example/api/chat/ws-1/chat-1/answer/stream');
    expect(init.headers['ai-model']).toBe('gpt-5-mini');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({ ...payload, chat_id: 'chat-1' });
  });

  it('rejects with the server error line found inside a successful stream', async () => {
    mockStreamResponse(ndjson([{ '1': 'Partial' }, { code: 1033, message: 'AI response limit exceeded', error: 'x' }]));

    const onMessage = jest.fn();
    const { streamPromise } = createRequest().fetchAnswerStream(payload, onMessage);

    await expect(streamPromise).rejects.toMatchObject({ code: 1033, message: 'AI response limit exceeded' });
    expect(onMessage).toHaveBeenCalledWith('Partial', [], false);
    expect(onMessage).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
  });

  it('surfaces the message of a failed HTTP response and falls back to the status', async () => {
    mockStreamResponse(JSON.stringify({ code: 1033, message: 'Out of credits' }), { ok: false, status: 503 });

    await expect(createRequest().fetchAnswerStream(payload, jest.fn()).streamPromise).rejects.toMatchObject({
      code: 1033,
      message: 'Out of credits',
      httpStatus: 503,
    });

    mockStreamResponse('<html>gateway timeout</html>', { ok: false, status: 504 });

    await expect(createRequest().fetchAnswerStream(payload, jest.fn()).streamPromise).rejects.toMatchObject({
      message: 'HTTP error! status: 504',
      httpStatus: 504,
    });
  });

  it('can be cancelled before the response arrives', async () => {
    global.fetch = jest.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');

            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const onMessage = jest.fn();
    const { cancel, streamPromise } = createRequest().fetchAnswerStream(payload, onMessage);

    cancel();
    await streamPromise;

    expect(onMessage).toHaveBeenCalledWith('', [], true);
  });

  it('keeps the partial answer when cancelled mid-stream', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new NodeReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        streamController.enqueue(encoder.encode(ndjson([{ '1': 'Half way' }])));
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/x-ndjson' },
      body: stream,
    });

    let firstChunk: () => void = () => undefined;
    const received = new Promise<void>((resolve) => {
      firstChunk = resolve;
    });
    const onMessage = jest.fn((text: string) => {
      if (text) firstChunk();
    });
    const { cancel, streamPromise } = createRequest().fetchAnswerStream(payload, onMessage);

    await received;
    // Cancelling closes the body stream itself; the controller must not be closed again.
    cancel();
    await streamPromise;

    expect(controller).toBeDefined();
    expect(onMessage).toHaveBeenLastCalledWith('Half way', [], true);
  });
});

describe('parseStreamError', () => {
  it('ignores ordinary stream lines and zero codes', () => {
    expect(parseStreamError({ '1': 'text' })).toBeNull();
    expect(parseStreamError({ code: 0, message: 'ok' })).toBeNull();
    expect(parseStreamError('not an object')).toBeNull();
  });

  it('turns error lines into errors with the code and best message', () => {
    expect(parseStreamError({ code: 42, error: 'boom' })).toMatchObject({ code: 42, message: 'boom' });
    expect(parseStreamError({ code: 43 })).toMatchObject({ code: 43, message: 'AI request failed with code 43' });
  });
});

describe('ChatRequest.fetchAnswerStream sources', () => {
  it('passes early sources with the text and lets the final list replace them', async () => {
    mockStreamResponse(
      ndjson([
        { '0': [{ id: 'view-1', name: 'Roadmap', source: 'appflowy', citation_id: 'A1' }] },
        { '1': 'Plan [A1]' },
        { '0': [{ id: 'view-2', name: 'Budget', source: 'appflowy', citation_id: 'A2' }] },
      ])
    );

    const onMessage = jest.fn();
    const { streamPromise } = createRequest().fetchAnswerStream(payload, onMessage);

    await streamPromise;

    expect(onMessage).toHaveBeenNthCalledWith(
      1,
      '',
      [{ id: 'view-1', name: 'Roadmap', source: 'appflowy', citation_id: 'A1' }],
      false
    );
    expect(onMessage).toHaveBeenNthCalledWith(
      2,
      'Plan [A1]',
      [{ id: 'view-1', name: 'Roadmap', source: 'appflowy', citation_id: 'A1' }],
      false
    );
    expect(onMessage).toHaveBeenLastCalledWith(
      'Plan [A1]',
      [{ id: 'view-2', name: 'Budget', source: 'appflowy', citation_id: 'A2' }],
      true
    );
  });

  it('ignores keep-alive frames', async () => {
    mockStreamResponse(ndjson([{ '3': '' }, { '1': 'Done' }, { '3': '' }]));

    const onMessage = jest.fn();
    const { streamPromise } = createRequest().fetchAnswerStream(payload, onMessage);

    await streamPromise;

    expect(onMessage).toHaveBeenNthCalledWith(1, 'Done', [], false);
    expect(onMessage).toHaveBeenLastCalledWith('Done', [], true);
  });
});
