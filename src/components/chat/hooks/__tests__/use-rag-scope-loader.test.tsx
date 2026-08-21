import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';

import { useRagScopeLoader } from '@/components/chat/hooks/use-rag-scope-loader';
import type { ChatRequest } from '@/components/chat/request/chat-request';
import { ChatSettings, View, ViewLayout } from '@/components/chat/types';

function view(overrides: Partial<View> = {}): View {
  return {
    view_id: 'parent-id',
    name: 'Parent',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_private: false,
    ...overrides,
  };
}

function settings(overrides: Partial<ChatSettings> = {}): ChatSettings {
  return {
    name: 'Chat',
    rag_ids: [],
    metadata: {},
    full_workspace: false,
    web_search_enabled: false,
    ...overrides,
  };
}

function deferred() {
  let resolvePromise: () => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function deferredValue<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

describe('useRagScopeLoader', () => {
  it('uses the second setup barrier and persists migration once in React Strict Mode', async () => {
    const parent = view({ children: [view({ view_id: 'child-id' })] });
    const requestInstance = {
      fetchCurrentChatParentScope: jest.fn().mockResolvedValue(parent),
      getViewNavigation: jest.fn(),
    } as unknown as ChatRequest;
    const fetchChatSettings = jest.fn().mockResolvedValue(settings({ full_workspace: true }));
    const persistChatSettings = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () =>
        useRagScopeLoader({
          chatId: 'chat-id',
          requestInstance,
          fetchChatSettings,
          persistChatSettings,
        }),
      { wrapper: StrictMode }
    );

    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await expect(result.current.waitUntilReady()).resolves.toBe(true);
    expect(persistChatSettings).toHaveBeenCalledTimes(1);
    expect(persistChatSettings).toHaveBeenCalledWith({
      full_workspace: false,
      rag_ids: ['parent-id', 'child-id'],
    });
  });

  it('keeps readiness blocked until full-workspace migration is persisted', async () => {
    const migration = deferred();
    const parent = view({ children: [view({ view_id: 'child-id' })] });
    const requestInstance = {
      fetchCurrentChatParentScope: jest.fn().mockResolvedValue(parent),
      getViewNavigation: jest.fn(),
    } as unknown as ChatRequest;
    const fetchChatSettings = jest.fn().mockResolvedValue(
      settings({
        full_workspace: true,
        rag_ids: [],
      })
    );
    const persistChatSettings = jest.fn(() => migration.promise);
    const { result } = renderHook(() =>
      useRagScopeLoader({
        chatId: 'chat-id',
        requestInstance,
        fetchChatSettings,
        persistChatSettings,
      })
    );
    let ready: boolean | undefined;

    act(() => {
      void result.current.waitUntilReady().then((value) => {
        ready = value;
      });
    });

    await waitFor(() => expect(persistChatSettings).toHaveBeenCalledTimes(1));
    expect(ready).toBeUndefined();
    expect(result.current.state.status).toBe('loading');

    act(() => migration.resolve());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    expect(ready).toBe(true);
    expect(persistChatSettings).toHaveBeenCalledWith({
      full_workspace: false,
      rag_ids: ['parent-id', 'child-id'],
    });
  });

  it('invalidates the ready barrier synchronously when refreshing', async () => {
    const parent = view();
    const refreshedScope = deferredValue<View>();
    const requestInstance = {
      fetchCurrentChatParentScope: jest
        .fn()
        .mockResolvedValueOnce(parent)
        .mockImplementationOnce(() => refreshedScope.promise),
      getViewNavigation: jest.fn(),
    } as unknown as ChatRequest;
    const fetchChatSettings = jest.fn().mockResolvedValue(settings({ rag_ids: ['parent-id'] }));
    const persistChatSettings = jest.fn();
    const { result } = renderHook(() =>
      useRagScopeLoader({
        chatId: 'chat-id',
        requestInstance,
        fetchChatSettings,
        persistChatSettings,
      })
    );

    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    let refreshedReady: boolean | undefined;

    act(() => {
      result.current.refresh();
      void result.current.waitUntilReady().then((ready) => {
        refreshedReady = ready;
      });
    });
    await act(async () => Promise.resolve());

    expect(refreshedReady).toBeUndefined();

    act(() => refreshedScope.resolve(parent));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(refreshedReady).toBe(true);
  });

  it('fails closed when the authoritative parent scope cannot be loaded', async () => {
    const requestInstance = {
      fetchCurrentChatParentScope: jest.fn().mockRejectedValue(new Error('scope unavailable')),
      getViewNavigation: jest.fn(),
    } as unknown as ChatRequest;
    const fetchChatSettings = jest.fn().mockResolvedValue(settings());
    const persistChatSettings = jest.fn();
    const { result } = renderHook(() =>
      useRagScopeLoader({
        chatId: 'chat-id',
        requestInstance,
        fetchChatSettings,
        persistChatSettings,
      })
    );

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    await expect(result.current.waitUntilReady()).resolves.toBe(false);
  });

  it('fails closed when the scoped settings migration cannot be persisted', async () => {
    const parent = view({ children: [view({ view_id: 'child-id' })] });
    const requestInstance = {
      fetchCurrentChatParentScope: jest.fn().mockResolvedValue(parent),
      getViewNavigation: jest.fn(),
    } as unknown as ChatRequest;
    const fetchChatSettings = jest.fn().mockResolvedValue(
      settings({
        full_workspace: true,
        rag_ids: [],
      })
    );
    const persistenceError = new Error('settings unavailable');
    const persistChatSettings = jest.fn().mockRejectedValue(persistenceError);
    const { result } = renderHook(() =>
      useRagScopeLoader({
        chatId: 'chat-id',
        requestInstance,
        fetchChatSettings,
        persistChatSettings,
      })
    );

    await waitFor(() => expect(result.current.state.status).toBe('error'));

    expect(persistChatSettings).toHaveBeenCalledWith({
      full_workspace: false,
      rag_ids: ['parent-id', 'child-id'],
    });
    expect(result.current.state.error).toBe(persistenceError);
    await expect(result.current.waitUntilReady()).resolves.toBe(false);
  });

  it('removes a saved view whose navigation path is outside the parent scope', async () => {
    const parent = view();
    const outside = view({ view_id: 'outside-id' });
    const requestInstance = {
      fetchCurrentChatParentScope: jest.fn().mockResolvedValue(parent),
      getViewNavigation: jest.fn().mockResolvedValue(
        view({
          view_id: 'workspace-id',
          children: [view({ view_id: 'other-space-id', extra: { is_space: true }, children: [outside] })],
        })
      ),
    } as unknown as ChatRequest;
    const fetchChatSettings = jest.fn().mockResolvedValue(settings({ rag_ids: ['outside-id'] }));
    const persistChatSettings = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRagScopeLoader({
        chatId: 'chat-id',
        requestInstance,
        fetchChatSettings,
        persistChatSettings,
      })
    );

    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    expect(requestInstance.getViewNavigation).toHaveBeenCalledWith('outside-id');
    expect(persistChatSettings).toHaveBeenCalledWith({
      full_workspace: false,
      rag_ids: [],
    });
  });

  it('preserves a legacy opaque source when no view navigation exists', async () => {
    const requestInstance = {
      fetchCurrentChatParentScope: jest.fn().mockResolvedValue(view()),
      getViewNavigation: jest.fn().mockRejectedValue({ code: 404 }),
    } as unknown as ChatRequest;
    const fetchChatSettings = jest.fn().mockResolvedValue(settings({ rag_ids: ['row-id'] }));
    const persistChatSettings = jest.fn();
    const { result } = renderHook(() =>
      useRagScopeLoader({
        chatId: 'chat-id',
        requestInstance,
        fetchChatSettings,
        persistChatSettings,
      })
    );

    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    expect(result.current.state.scopedSettings?.ragIds).toEqual(['row-id']);
    expect(persistChatSettings).not.toHaveBeenCalled();
  });

  it('fails closed when saved-source navigation fails unexpectedly', async () => {
    const navigationError = new Error('navigation unavailable');
    const requestInstance = {
      fetchCurrentChatParentScope: jest.fn().mockResolvedValue(view()),
      getViewNavigation: jest.fn().mockRejectedValue(navigationError),
    } as unknown as ChatRequest;
    const fetchChatSettings = jest.fn().mockResolvedValue(settings({ rag_ids: ['unknown-id'] }));
    const persistChatSettings = jest.fn();
    const { result } = renderHook(() =>
      useRagScopeLoader({
        chatId: 'chat-id',
        requestInstance,
        fetchChatSettings,
        persistChatSettings,
      })
    );

    await waitFor(() => expect(result.current.state.status).toBe('error'));

    expect(result.current.state.error).toBe(navigationError);
    expect(persistChatSettings).not.toHaveBeenCalled();
    await expect(result.current.waitUntilReady()).resolves.toBe(false);
  });
});
