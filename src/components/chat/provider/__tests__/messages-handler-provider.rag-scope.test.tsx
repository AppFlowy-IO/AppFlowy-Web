import { act, render } from '@testing-library/react';

import {
  MessagesHandlerProvider,
  useMessagesHandlerContext,
} from '@/components/chat/provider/messages-handler-provider';
import { AuthorType, MessageType } from '@/components/chat/types';

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

const toastError = jest.fn();
const waitUntilReady = jest.fn<Promise<boolean>, []>();
const waitForPendingChatSettings = jest.fn<Promise<boolean>, []>();
const insertMessage = jest.fn();
const requestInstance = {
  submitQuestion: jest.fn().mockResolvedValue({
    message_id: 10,
    reply_message_id: 11,
    content: 'Question',
    author: { author_type: AuthorType.Human, author_uuid: 'user-id' },
  }),
  getCurrentView: jest.fn().mockResolvedValue(undefined),
};

jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: () => ({
    chatId: 'chat-id',
    requestInstance,
    currentUser: { uuid: 'user-id' },
  }),
}));

jest.mock('@/components/chat/hooks/use-chat-settings-loader', () => ({
  useChatSettingsLoader: () => ({
    chatSettings: null,
    fetchChatSettings: jest.fn(),
    persistChatSettings: jest.fn(),
    waitForPendingChatSettings,
    updateChatSettings: jest.fn(),
  }),
}));

jest.mock('@/components/chat/hooks/use-rag-scope-loader', () => ({
  useRagScopeLoader: () => ({
    state: { status: 'loading', parentView: null, scopedSettings: null },
    waitUntilReady,
    refresh: jest.fn(),
  }),
}));

jest.mock('@/components/chat/provider/message-animation-provider', () => ({
  useMessageAnimation: () => ({ registerAnimation: jest.fn() }),
}));

jest.mock('@/components/chat/provider/messages-provider', () => ({
  useChatMessagesContext: () => ({
    messageIds: [1],
    addMessages: jest.fn(),
    insertMessage,
    removeMessages: jest.fn(() => []),
    saveMessageContent: jest.fn(),
    getMessage: jest.fn(),
  }),
}));

jest.mock('@/components/chat/provider/prompt-modal-provider', () => ({
  usePromptModal: () => ({ currentPromptId: null }),
}));

jest.mock('@/components/chat/provider/response-format-provider', () => ({
  useResponseFormatContext: () => ({ setResponseFormatWithId: jest.fn() }),
}));

jest.mock('@/components/chat/provider/suggestions-provider', () => ({
  useSuggestionsContext: () => ({
    registerFetchSuggestions: jest.fn(),
    startFetchSuggestions: jest.fn(),
  }),
}));

let messagesContext: ReturnType<typeof useMessagesHandlerContext>;

function ContextProbe() {
  messagesContext = useMessagesHandlerContext();
  return null;
}

describe('MessagesHandlerProvider RAG scope readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    waitForPendingChatSettings.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('does not submit a question until scope validation succeeds', async () => {
    const readiness = deferred<boolean>();

    waitUntilReady.mockReturnValue(readiness.promise);
    render(
      <MessagesHandlerProvider>
        <ContextProbe />
      </MessagesHandlerProvider>
    );

    let submission!: Promise<void>;

    act(() => {
      submission = messagesContext.submitQuestion('Scoped question');
    });

    expect(requestInstance.submitQuestion).not.toHaveBeenCalled();
    expect(insertMessage).not.toHaveBeenCalled();

    await act(async () => {
      readiness.resolve(true);
      await submission;
    });

    expect(requestInstance.submitQuestion).toHaveBeenCalledWith({
      content: 'Scoped question',
      message_type: MessageType.User,
      prompt_id: undefined,
      model_name: undefined,
    });
  });

  it('fails closed when scope validation fails', async () => {
    waitUntilReady.mockResolvedValue(false);
    render(
      <MessagesHandlerProvider>
        <ContextProbe />
      </MessagesHandlerProvider>
    );

    await act(async () => {
      await expect(messagesContext.submitQuestion('Unsafe question')).rejects.toThrow(
        'Unable to validate the AI chat context'
      );
    });

    expect(requestInstance.submitQuestion).not.toHaveBeenCalled();
    expect(insertMessage).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Unable to validate the AI chat context');
  });

  it('flushes a pending source update before sending the question', async () => {
    const sourceWrite = deferred<void>();

    waitUntilReady.mockResolvedValue(true);
    render(
      <MessagesHandlerProvider>
        <ContextProbe />
      </MessagesHandlerProvider>
    );
    messagesContext.registerChatSettingsFlush(() => sourceWrite.promise);

    let submission!: Promise<void>;

    act(() => {
      submission = messagesContext.submitQuestion('Latest sources');
    });

    await act(async () => Promise.resolve());
    expect(requestInstance.submitQuestion).not.toHaveBeenCalled();

    await act(async () => {
      sourceWrite.resolve(undefined);
      await submission;
    });

    expect(requestInstance.submitQuestion).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a pending settings write failed', async () => {
    waitUntilReady.mockResolvedValue(true);
    waitForPendingChatSettings.mockResolvedValue(false);
    render(
      <MessagesHandlerProvider>
        <ContextProbe />
      </MessagesHandlerProvider>
    );

    await act(async () => {
      await expect(messagesContext.submitQuestion('Unsaved sources')).rejects.toThrow(
        'Unable to save the AI chat context'
      );
    });

    expect(requestInstance.submitQuestion).not.toHaveBeenCalled();
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it('rejects a concurrent question before it can share the readiness wait', async () => {
    const readiness = deferred<boolean>();

    waitUntilReady.mockReturnValue(readiness.promise);
    render(
      <MessagesHandlerProvider>
        <ContextProbe />
      </MessagesHandlerProvider>
    );

    let firstSubmission!: Promise<void>;

    act(() => {
      firstSubmission = messagesContext.submitQuestion('First question');
    });

    await act(async () => {
      await expect(messagesContext.submitQuestion('Duplicate question')).rejects.toThrow(
        'A question is already being sent'
      );
    });
    expect(waitUntilReady).toHaveBeenCalledTimes(1);

    await act(async () => {
      readiness.resolve(true);
      await firstSubmission;
    });

    expect(requestInstance.submitQuestion).toHaveBeenCalledTimes(1);
  });
});
