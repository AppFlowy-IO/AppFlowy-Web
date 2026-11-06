import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

import { waitFor } from '@testing-library/react';

import { OutputContent, OutputLayout, StreamType } from '@/components/chat/types/request';

import { ChatRequest } from '../chat-request';

jest.mock('@/components/chat/lib/requets', () => ({
  ...jest.requireActual('@/components/chat/lib/requets'),
  createInitialInstance: () => ({
    defaults: { baseURL: 'https://cloud.example' },
    interceptors: { request: { use: jest.fn() } },
  }),
  getAccessToken: () => 'test-token',
}));

describe('answer stream transport lifetime', () => {
  const originalFetch = global.fetch;
  const originalDecoder = global.TextDecoder;
  const payload = {
    question_id: 10,
    format: { output_layout: OutputLayout.Paragraph, output_content: OutputContent.TEXT },
  };

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

  it('aborts fetch before response headers arrive', async () => {
    global.fetch = jest.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
        })
    ) as jest.Mock;
    const controller = new AbortController();
    const pending = new ChatRequest('workspace', 'chat').fetchAnswerStream(
      payload,
      jest.fn(),
      undefined,
      controller.signal
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://cloud.example/api/chat/workspace/chat/answer/stream',
      expect.objectContaining({ signal: controller.signal })
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  function openStream() {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new NodeReadableStream<Uint8Array>({
      start(controller) {
        source = controller as unknown as typeof source;
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/x-ndjson' },
      body,
    });

    return { body, source };
  }

  it('keeps the final partial answer when manually stopped during a pending read', async () => {
    const { source, body } = openStream();
    const onMessage = jest.fn();
    const { cancel, streamPromise } = await new ChatRequest('workspace', 'chat').fetchAnswerStream(payload, onMessage);

    source.enqueue(new TextEncoder().encode(JSON.stringify({ [StreamType.TEXT]: 'partial answer' })));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith('partial answer', [], false));
    cancel();
    await streamPromise;

    expect(onMessage).toHaveBeenLastCalledWith('partial answer', [], true);
    expect(body.locked).toBe(false);
  });

  it('allows cleanup to cancel an already errored body without an unhandled rejection', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { source, body } = openStream();
    const { cancel, streamPromise } = await new ChatRequest('workspace', 'chat').fetchAnswerStream(payload, jest.fn());

    // Aborting fetch errors its body before the provider invokes the cancel handle.
    source.error(new DOMException('Aborted', 'AbortError'));
    cancel();
    await streamPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(body.locked).toBe(false);
  });
});
