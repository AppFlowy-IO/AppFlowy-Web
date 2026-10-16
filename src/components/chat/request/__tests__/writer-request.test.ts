import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

import { WriterRequest } from '../writer-request';
import { AIAssistantType } from '@/components/chat/types/writer';

jest.mock('@/components/chat/lib/requets', () => ({
  createInitialInstance: () => ({ defaults: { baseURL: 'https://cloud.example' }, interceptors: { request: { use: jest.fn() } } }),
  getAccessToken: () => 'test-token',
  requestInterceptor: jest.fn(),
}));

describe('speaker preprocessing through the shared completion API', () => {
  const originalFetch = global.fetch;

  afterEach(() => { global.fetch = originalFetch; });

  it('sends CustomPrompt to Flutter’s completion endpoint with a cancellable request', async () => {
    const controller = new AbortController();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ '1': 'Inferred speakers' }),
    }));

    global.fetch = fetchMock as unknown as typeof fetch;
    const request = new WriterRequest('workspace', 'document');
    const { streamPromise } = await request.fetchAIAssistant({
      inputText: 'Speaker A: Hi, I am Annie.', assistantType: AIAssistantType.CustomPrompt,
      ragIds: [], completionHistory: [], customPrompt: 'Infer speaker names.', signal: controller.signal,
    }, jest.fn());

    await streamPromise;
    expect(fetchMock.mock.calls[0]).toEqual([
      'https://cloud.example/api/ai/workspace/v2/complete/stream',
      expect.objectContaining({ method: 'POST', signal: controller.signal }),
    ]);
    const options = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1];

    expect(JSON.parse(options.body as string)).toMatchObject({
      text: 'Speaker A: Hi, I am Annie.', completion_type: 8,
      metadata: { object_id: 'document', workspace_id: 'workspace', rag_ids: ['document'], custom_prompt: { system: 'Infer speaker names.' } },
    });
  });
});

describe('completion stream responses', () => {
  const originalFetch = global.fetch;
  const originalDecoder = global.TextDecoder;
  const payload = {
    inputText: 'Meeting transcript', assistantType: AIAssistantType.CustomPrompt,
    ragIds: [], completionHistory: [], customPrompt: 'Summarize this meeting.',
  };
  const encoder = new TextEncoder();

  beforeAll(() => { global.TextDecoder = TextDecoder as typeof global.TextDecoder; });
  afterAll(() => { global.TextDecoder = originalDecoder; });
  afterEach(() => { global.fetch = originalFetch; });

  function stream(chunks: (string | Uint8Array)[], close = true) {
    const cancelled = jest.fn();
    const body = new NodeReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
        if (close) controller.close();
      },
      cancel: cancelled,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true, headers: { get: () => 'application/x-ndjson' }, body,
    });
    return { body, cancelled };
  }

  function jsonResponse(json: unknown, ok = true) {
    global.fetch = jest.fn().mockResolvedValue({
      ok, status: ok ? 200 : 429, headers: { get: () => 'application/json' },
      json: async () => json,
    });
  }

  it('handles split JSON frames, UTF-8 characters, comments, and braces inside content', async () => {
    const bytes = encoder.encode('{"1":"Résumé {ref:block}"}{"4":"Comment"}\n{"1":" done"}');
    const accented = bytes.indexOf(0xc3);
    const { body } = stream([bytes.slice(0, accented + 1), bytes.slice(accented + 1, -3), bytes.slice(-3)]);
    const onMessage = jest.fn();
    const { streamPromise } = await new WriterRequest('workspace', 'document').fetchAIAssistant(payload, onMessage);

    await streamPromise;
    expect(onMessage).toHaveBeenLastCalledWith('Résumé {ref:block} done', 'Comment', true);
    expect(body.locked).toBe(false);
  });

  it('surfaces Flutter’s provider error frame instead of reporting an empty result', async () => {
    const { body, cancelled } = stream(['{"error":"AI provider temporarily unavailable"}'], false);
    const onMessage = jest.fn();
    const { streamPromise } = await new WriterRequest().fetchAIAssistant(payload, onMessage);

    await expect(streamPromise).rejects.toThrow('AI provider temporarily unavailable');
    expect(onMessage).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('preserves application error codes and retry metadata in an HTTP 200 stream', async () => {
    stream(['{"code":1033,"message":"Workspace AI limit reached","retry_after_secs":3}']);
    const { streamPromise } = await new WriterRequest().fetchAIAssistant(payload, jest.fn());

    await expect(streamPromise).rejects.toMatchObject({
      code: 1033, message: 'Workspace AI limit reached', retry_after_secs: 3,
    });
  });

  it('rejects a provider failure after partial content without marking that content complete', async () => {
    stream(['{"1":"Partial summary"}\n{"error":"Provider connection lost"}']);
    const onMessage = jest.fn();
    const { streamPromise } = await new WriterRequest().fetchAIAssistant(payload, onMessage);

    await expect(streamPromise).rejects.toThrow('Provider connection lost');
    expect(onMessage).toHaveBeenCalledWith('Partial summary', '', false);
    expect(onMessage.mock.calls.some(([, , done]) => done)).toBe(false);
  });

  it('preserves an API quota error on a failed HTTP response', async () => {
    jsonResponse({ code: 1033, message: 'Upgrade to Pro for more AI responses' }, false);
    await expect(new WriterRequest().fetchAIAssistant(payload, jest.fn())).rejects.toMatchObject({
      code: 1033, message: 'Upgrade to Pro for more AI responses',
    });
  });

  it('reads a completion frame returned as application/json', async () => {
    jsonResponse({ '1': 'Summary returned as JSON' });
    const onMessage = jest.fn();
    const { streamPromise } = await new WriterRequest().fetchAIAssistant(payload, onMessage);

    await streamPromise;
    expect(onMessage).toHaveBeenLastCalledWith('Summary returned as JSON', '', true);
  });

  it('surfaces a provider error returned as application/json', async () => {
    jsonResponse({ error: 'Provider is overloaded' });
    const { streamPromise } = await new WriterRequest().fetchAIAssistant(payload, jest.fn());

    await expect(streamPromise).rejects.toThrow('Provider is overloaded');
  });

  it.each(['', '{"3":"keepalive"}', '{"0":{}}\n{"6":"reasoning only"}'])('rejects an empty or content-free response: %s', async (body) => {
    stream([body]);
    const onMessage = jest.fn();
    const { streamPromise } = await new WriterRequest().fetchAIAssistant(payload, onMessage);

    await expect(streamPromise).rejects.toThrow('The AI service returned no content. Please try again.');
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('does not report a JSON success envelope without content as a successful completion', async () => {
    jsonResponse({ code: 0 });
    const onMessage = jest.fn();
    const { streamPromise } = await new WriterRequest().fetchAIAssistant(payload, onMessage);

    await expect(streamPromise).rejects.toThrow('The AI service returned no content. Please try again.');
    expect(onMessage).not.toHaveBeenCalled();
  });

  it.each(['{"1":invalid}', '{"1":"incomplete'])('rejects invalid or interrupted output after partial content: %s', async (ending) => {
    stream([`{"1":"Partial summary"}\n${ending}`]);
    const onMessage = jest.fn();
    const { streamPromise } = await new WriterRequest().fetchAIAssistant(payload, onMessage);

    await expect(streamPromise).rejects.toBeInstanceOf(Error);
    expect(onMessage.mock.calls.some(([, , done]) => done)).toBe(false);
  });

  it('propagates callback errors instead of swallowing them as JSON parse failures', async () => {
    stream(['{"1":"Summary"}']);
    const error = new Error('Cannot apply content');
    const onMessage = jest.fn().mockImplementationOnce(() => { throw error; });
    const { streamPromise } = await new WriterRequest().fetchAIAssistant(payload, onMessage);

    await expect(streamPromise).rejects.toBe(error);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending read, releases its reader, and does not emit a completed partial summary', async () => {
    const { body, cancelled } = stream(['{"1":"Partial summary"}'], false);
    const onMessage = jest.fn();
    const { cancel, streamPromise } = await new WriterRequest().fetchAIAssistant(payload, onMessage);

    cancel();
    await expect(streamPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(onMessage.mock.calls.some(([, , done]) => done)).toBe(false);
  });
});
