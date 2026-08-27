import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';

import { useChatSettingsLoader } from '@/components/chat/hooks/use-chat-settings-loader';
import type { ChatSettings } from '@/components/chat/types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

function settings(name: string): ChatSettings {
  return {
    name,
    rag_ids: [],
    metadata: {},
    full_workspace: false,
    web_search_enabled: false,
  };
}

const toastError = jest.fn();
let chatContext: { chatId: string; requestInstance: ReturnType<typeof request> };

function request(getChatSettings = jest.fn()) {
  return {
    getChatSettings,
    updateChatSettings: jest.fn().mockResolvedValue(undefined),
  };
}

jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: () => chatContext,
}));

describe('useChatSettingsLoader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores a stale settings response after switching chats', async () => {
    const chatA = deferred<ChatSettings>();
    const chatB = deferred<ChatSettings>();
    const requestA = request(jest.fn(() => chatA.promise));
    const requestB = request(jest.fn(() => chatB.promise));

    chatContext = { chatId: 'chat-a', requestInstance: requestA };
    const { result, rerender } = renderHook(() => useChatSettingsLoader());
    let fetchA: Promise<ChatSettings | undefined>;

    act(() => {
      fetchA = result.current.fetchChatSettings();
    });

    chatContext = { chatId: 'chat-b', requestInstance: requestB };
    rerender();

    expect(result.current.chatSettings).toBeNull();

    let fetchB: Promise<ChatSettings | undefined>;

    act(() => {
      fetchB = result.current.fetchChatSettings();
      chatB.resolve(settings('Chat B'));
    });
    await act(async () => {
      await fetchB;
    });

    act(() => chatA.resolve(settings('Chat A')));
    await act(async () => {
      await fetchA;
    });

    expect(result.current.chatSettings?.name).toBe('Chat B');
  });

  it('accepts settings responses after the Strict Mode effect replay', async () => {
    const requestInstance = request(jest.fn().mockResolvedValue(settings('Strict Chat')));

    chatContext = { chatId: 'strict-chat', requestInstance };
    const { result } = renderHook(() => useChatSettingsLoader(), { wrapper: StrictMode });

    await act(async () => {
      await result.current.fetchChatSettings();
    });

    expect(result.current.chatSettings?.name).toBe('Strict Chat');
  });

  it('keeps stale update callbacks bound to their originating request', async () => {
    const requestA = request(jest.fn().mockResolvedValue(settings('Chat A')));
    const requestB = request(jest.fn().mockResolvedValue(settings('Chat B')));

    chatContext = { chatId: 'chat-a', requestInstance: requestA };
    const { result, rerender } = renderHook(() => useChatSettingsLoader());

    await act(async () => {
      await result.current.fetchChatSettings();
    });
    const updateChatA = result.current.updateChatSettings;

    chatContext = { chatId: 'chat-b', requestInstance: requestB };
    rerender();
    await act(async () => {
      await result.current.fetchChatSettings();
      await updateChatA({ rag_ids: ['a-doc'] });
    });

    expect(requestA.updateChatSettings).toHaveBeenCalledWith({ rag_ids: ['a-doc'] });
    expect(requestB.updateChatSettings).not.toHaveBeenCalled();
    expect(result.current.chatSettings?.name).toBe('Chat B');
  });

  it('serializes settings writes and exposes when the queue is settled', async () => {
    const firstWrite = deferred<void>();
    const requestInstance = request(jest.fn().mockResolvedValue(settings('Queued Chat')));

    requestInstance.updateChatSettings
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    chatContext = { chatId: 'queued-chat', requestInstance };
    const { result } = renderHook(() => useChatSettingsLoader());

    await act(async () => {
      await result.current.fetchChatSettings();
    });

    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = result.current.persistChatSettings({ rag_ids: ['first'] });
      second = result.current.persistChatSettings({ rag_ids: ['second'] });
    });
    await act(async () => Promise.resolve());

    expect(requestInstance.updateChatSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstWrite.resolve(undefined);
      await Promise.all([first, second]);
    });

    expect(requestInstance.updateChatSettings.mock.calls).toEqual([
      [{ rag_ids: ['first'] }],
      [{ rag_ids: ['second'] }],
    ]);
    await expect(result.current.waitForPendingChatSettings()).resolves.toBe(true);
  });

  it('retains a failed source write after a later unrelated write succeeds', async () => {
    const requestInstance = request(jest.fn().mockResolvedValue(settings('Failed Queue Chat')));

    requestInstance.updateChatSettings
      .mockRejectedValueOnce(new Error('source update failed'))
      .mockResolvedValueOnce(undefined);
    chatContext = { chatId: 'failed-queue-chat', requestInstance };
    const { result } = renderHook(() => useChatSettingsLoader());

    await act(async () => {
      await result.current.fetchChatSettings();
    });

    let writes!: PromiseSettledResult<void>[];

    await act(async () => {
      writes = await Promise.allSettled([
        result.current.persistChatSettings({ rag_ids: ['new-source'] }),
        result.current.persistChatSettings({ web_search_enabled: true }),
      ]);
    });

    expect(writes.map((write) => write.status)).toEqual(['rejected', 'fulfilled']);
    await expect(result.current.waitForPendingChatSettings()).resolves.toBe(false);
    await expect(result.current.waitForPendingChatSettings()).resolves.toBe(true);
  });

  it('queues a settings refresh behind an in-flight write', async () => {
    const write = deferred<void>();
    const getChatSettings = jest
      .fn()
      .mockResolvedValueOnce(settings('Before Write'))
      .mockResolvedValueOnce(settings('After Write'));
    const requestInstance = request(getChatSettings);

    requestInstance.updateChatSettings.mockImplementationOnce(() => write.promise);
    chatContext = { chatId: 'read-queue-chat', requestInstance };
    const { result } = renderHook(() => useChatSettingsLoader());

    await act(async () => {
      await result.current.fetchChatSettings();
    });

    let update!: Promise<void>;
    let refresh!: Promise<ChatSettings | undefined>;

    act(() => {
      update = result.current.persistChatSettings({ rag_ids: ['new-source'] });
      refresh = result.current.fetchChatSettings();
    });
    await act(async () => Promise.resolve());

    expect(getChatSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      write.resolve(undefined);
      await Promise.all([update, refresh]);
    });

    expect(getChatSettings).toHaveBeenCalledTimes(2);
    expect(result.current.chatSettings?.name).toBe('After Write');
  });

  it('keeps submission blocked when a critical write and rollback read both fail', async () => {
    const getChatSettings = jest
      .fn()
      .mockResolvedValueOnce(settings('Before Unknown Write'))
      .mockRejectedValueOnce(new Error('rollback unavailable'))
      .mockResolvedValueOnce(settings('Authoritative Again'));
    const requestInstance = request(getChatSettings);

    requestInstance.updateChatSettings.mockRejectedValueOnce(new Error('source response lost'));
    chatContext = { chatId: 'unknown-write-chat', requestInstance };
    const { result } = renderHook(() => useChatSettingsLoader());

    await act(async () => {
      await result.current.fetchChatSettings();
      await expect(result.current.persistChatSettings({ rag_ids: ['uncertain-source'] })).rejects.toThrow(
        'source response lost'
      );
    });

    await expect(result.current.waitForPendingChatSettings()).resolves.toBe(false);
    await expect(result.current.waitForPendingChatSettings()).resolves.toBe(false);

    await act(async () => {
      await result.current.fetchChatSettings();
    });

    await expect(result.current.waitForPendingChatSettings()).resolves.toBe(true);
    expect(result.current.chatSettings?.name).toBe('Authoritative Again');
  });
});
