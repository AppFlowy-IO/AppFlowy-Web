import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

import { WriterRequest } from '@/components/chat/request/writer-request';
import { ApplyingState, useWriterContext } from '@/components/chat/writer/context';

import { AIAssistantProvider } from '../ai-assistant-provider';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/components/chat/lib/requets', () => ({
  createInitialInstance: () => ({ defaults: { baseURL: 'https://cloud.example' }, interceptors: { request: { use: jest.fn() } } }),
  getAccessToken: () => 'test-token',
  requestInterceptor: jest.fn(),
}));
jest.mock('../prompt-modal-provider', () => ({
  usePromptModal: () => ({ currentPromptId: null, updateCurrentPromptId: jest.fn(), prompts: [] }),
}));
jest.mock('../view-loader-provider', () => ({
  ViewLoaderProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/components/chat/components/ai-writer/confirm-discard', () => ({ ConfirmDiscard: () => null }));
jest.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
}));

describe('AI Writer stream lifecycle', () => {
  const originalFetch = global.fetch;
  const originalDecoder = global.TextDecoder;
  const encoder = new TextEncoder();

  beforeAll(() => { global.TextDecoder = TextDecoder as typeof global.TextDecoder; });
  afterAll(() => { global.TextDecoder = originalDecoder; });
  afterEach(() => { global.fetch = originalFetch; });

  function fixture() {
    let send!: (text: string) => void;
    let fail!: (error: Error) => void;
    const cancelled = jest.fn();
    const body = new NodeReadableStream<Uint8Array>({
      start(controller) {
        send = (text) => controller.enqueue(encoder.encode(JSON.stringify({ '1': text })));
        fail = (error) => controller.error(error);
      },
      cancel: cancelled,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true, headers: { get: () => 'application/x-ndjson' }, body,
    });
    const request = new WriterRequest('workspace', 'document');
    const hook = renderHook(() => useWriterContext(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AIAssistantProvider viewId='document' request={request}>{children}</AIAssistantProvider>
      ),
    });

    return { ...hook, body, cancelled, send, fail };
  }

  it.each(['', 'Partial answer'])('stops normally with content "%s" without showing a connection error', async (content) => {
    const { result, body, cancelled, send } = fixture();
    let pending!: Promise<() => void>;

    await act(async () => { pending = result.current.improveWriting('Draft'); });
    if (content) {
      await act(async () => { send(content); });
      await waitFor(() => expect(result.current.applyingState).toBe(ApplyingState.applying));
    }

    await act(async () => {
      result.current.stop();
      await pending;
    });
    expect(result.current).toMatchObject({
      placeholderContent: content, error: null, applyingState: ApplyingState.idle,
      isFetching: false, isApplying: false,
    });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('still reports a connection failure after partial content', async () => {
    const { result, body, send, fail } = fixture();
    const error = new Error('Connection lost');
    let pending!: Promise<() => void>;

    await act(async () => { pending = result.current.improveWriting('Draft'); });
    await act(async () => { send('Partial answer'); });
    await waitFor(() => expect(result.current.applyingState).toBe(ApplyingState.applying));
    await act(async () => {
      fail(error);
      await pending;
    });
    expect(result.current).toMatchObject({
      placeholderContent: 'Partial answer', error, applyingState: ApplyingState.failed,
      isFetching: false, isApplying: false,
    });
    expect(body.locked).toBe(false);
  });
});
