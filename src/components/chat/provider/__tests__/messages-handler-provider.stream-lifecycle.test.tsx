import { act, render, screen } from '@testing-library/react';
import { ReactNode, StrictMode } from 'react';

import { AssistantMessage } from '@/components/chat/components/chat-messages/assistant-message';
import { ERROR_CODE_NO_LIMIT } from '@/components/chat/lib/const';
import {
  MessagesHandlerProvider,
  useMessagesHandlerContext,
} from '@/components/chat/provider/messages-handler-provider';
import type { ChatMessageMetadata } from '@/components/chat/types/request';

const mockToastError = jest.fn();
const mockSaveMessageContent = jest.fn();
const mockStartFetchSuggestions = jest.fn();
const mockRemoveMessages = jest.fn(() => []);
const mockInsertMessage = jest.fn();
const mockTranslate = (key: string) => key;
const mockRequest = {
  fetchAnswerStream: jest.fn(),
  saveAnswer: jest.fn(),
};
let mockChatId = 'chat-A';
let mockWorkspaceId = 'workspace-A';

jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args) } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('@appflowyinc/editor', () => ({ EditorProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/components/app/app.hooks', () => ({ useIsOfficialHosted: () => false }));
jest.mock('@/components/chat/components/chat-messages/answer-md', () => ({
  AnswerMd: ({ mdContent }: { mdContent: string }) => <output data-testid='answer'>{mdContent}</output>,
}));
jest.mock('@/components/chat/components/chat-messages/message-actions', () => ({ MessageActions: () => null }));
jest.mock('@/components/chat/components/chat-messages/message-suggestions', () => ({ MessageSuggestions: () => null }));
jest.mock('@/components/chat/components/chat-messages/message-checkbox', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/chat/components/chat-messages/message-sources', () => ({
  useResolvedMessageSources: () => [],
  ResolvedMessageSources: () => null,
}));
jest.mock('@/components/chat/types', () => jest.requireActual('@/components/chat/types/request'));
jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: () => ({ chatId: mockChatId, workspaceId: mockWorkspaceId, requestInstance: mockRequest }),
}));
jest.mock('@/components/chat/hooks/use-chat-settings-loader', () => ({
  useChatSettingsLoader: () => ({ chatSettings: null }),
}));
jest.mock('@/components/chat/hooks/use-rag-scope-loader', () => ({
  useRagScopeLoader: () => ({ state: {}, waitUntilReady: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('@/components/chat/provider/message-animation-provider', () => ({
  useMessageAnimation: () => ({ registerAnimation: jest.fn() }),
}));
jest.mock('@/components/chat/provider/messages-provider', () => ({
  useChatMessagesContext: () => ({
    messageIds: [11],
    getMessage: () => ({ reply_message_id: 11 }),
    addMessages: jest.fn(),
    insertMessage: mockInsertMessage,
    removeMessages: mockRemoveMessages,
    saveMessageContent: mockSaveMessageContent,
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
    startFetchSuggestions: mockStartFetchSuggestions,
    getMessageSuggestions: () => undefined,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

let messagesContext: ReturnType<typeof useMessagesHandlerContext>;

function Probe() {
  messagesContext = useMessagesHandlerContext();
  return null;
}

function renderHandler() {
  return render(
    <MessagesHandlerProvider>
      <Probe />
    </MessagesHandlerProvider>
  );
}

function createStream(pendingHandle = false) {
  const completion = deferred<void>();
  const handle = { cancel: jest.fn(), streamPromise: completion.promise };
  const response = deferred<typeof handle>();
  let emit!: (content: string, metadata: ChatMessageMetadata[], done?: boolean) => void;
  let progress!: (step: string) => void;

  mockRequest.fetchAnswerStream.mockImplementationOnce((_payload, onMessage, onProgress) => {
    emit = onMessage;
    progress = onProgress;
    return response.promise;
  });
  if (!pendingHandle) response.resolve(handle);

  return {
    handle,
    completion,
    response,
    emit: (content: string, metadata: ChatMessageMetadata[] = [], done = false) => emit(content, metadata, done),
    progress: (step: string) => progress(step),
  };
}

async function startStream(onMessage = jest.fn(), onProgress = jest.fn()) {
  let pending!: Promise<void>;

  await act(async () => {
    pending = messagesContext.fetchAnswerStream(10, undefined, onMessage, onProgress);
    await Promise.resolve();
  });
  return { pending, onMessage, onProgress };
}

describe('MessagesHandlerProvider answer stream ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChatId = 'chat-A';
    mockWorkspaceId = 'workspace-A';
    mockRequest.saveAnswer.mockResolvedValue({ message_id: 11 });
    mockStartFetchSuggestions.mockResolvedValue(undefined);
  });

  it('cancels on unmount and ignores late chunks, progress and completion', async () => {
    const stream = createStream();
    const view = renderHandler();
    const { pending, onMessage, onProgress } = await startStream();

    view.unmount();
    expect(stream.handle.cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      stream.emit('late chunk');
      stream.progress('late progress');
      stream.emit('late answer', [], true);
      stream.completion.resolve(undefined);
      await pending;
    });

    expect(onMessage).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(mockRequest.saveAnswer).not.toHaveBeenCalled();
    expect(mockStartFetchSuggestions).not.toHaveBeenCalled();
  });

  it('cancels a handle that arrives after unmount without waiting for its stream', async () => {
    const stream = createStream(true);
    const view = renderHandler();
    const { pending } = await startStream();

    view.unmount();
    await act(async () => {
      stream.response.resolve(stream.handle);
      await pending;
    });

    expect(stream.handle.cancel).toHaveBeenCalledTimes(1);
    stream.emit('late answer', [], true);
    expect(mockRequest.saveAnswer).not.toHaveBeenCalled();
    stream.completion.reject(new Error('cancelled transport'));
    await act(async () => undefined);
  });

  it.each(['chat', 'workspace'])('invalidates the old stream after a %s change', async (identity) => {
    const stream = createStream();
    const view = renderHandler();
    const { pending, onMessage } = await startStream();

    if (identity === 'chat') mockChatId = 'chat-B';
    else mockWorkspaceId = 'workspace-B';
    view.rerender(
      <MessagesHandlerProvider>
        <Probe />
      </MessagesHandlerProvider>
    );
    await act(async () => {
      stream.emit('old response', [], true);
      stream.completion.reject(new Error('obsolete transport failure'));
      await pending;
    });

    expect(stream.handle.cancel).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalled();
    expect(mockRequest.saveAnswer).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('does not apply a pending save or start suggestions after teardown', async () => {
    const stream = createStream();
    const saved = deferred<{ message_id: number }>();

    mockRequest.saveAnswer.mockReturnValue(saved.promise);
    const view = renderHandler();
    const { pending } = await startStream();

    await act(async () => stream.emit('complete answer', [], true));
    expect(mockRequest.saveAnswer).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      saved.resolve({ message_id: 11 });
      stream.completion.resolve(undefined);
      await pending;
    });

    expect(mockSaveMessageContent).not.toHaveBeenCalled();
    expect(mockStartFetchSuggestions).not.toHaveBeenCalled();
  });

  it('preserves normal completion, metadata persistence and suggestions', async () => {
    const stream = createStream();
    const view = renderHandler();
    const { pending, onMessage, onProgress } = await startStream();
    const metadata = [{ id: 'source', name: 'Source', source: 'document' }];

    await act(async () => {
      stream.progress('Searching');
      stream.emit('answer chunk');
      stream.emit('complete answer', metadata, true);
      stream.completion.resolve(undefined);
      await pending;
    });
    await act(async () => undefined);

    expect(onProgress).toHaveBeenCalledWith('Searching');
    expect(onMessage).toHaveBeenCalledWith('answer chunk', false);
    expect(mockRequest.saveAnswer).toHaveBeenCalledWith({
      question_message_id: 10,
      content: 'complete answer',
      meta_data: metadata,
    });
    expect(mockSaveMessageContent).toHaveBeenCalledWith(11, 'complete answer', metadata);
    expect(mockStartFetchSuggestions).toHaveBeenCalledWith(10);
    expect(messagesContext.answerApplying).toBe(false);
    view.unmount();
    expect(stream.handle.cancel).not.toHaveBeenCalled();
  });

  it('preserves manual stop and persistence of a final partial answer', async () => {
    const stream = createStream();

    renderHandler();
    const { pending } = await startStream();

    await act(async () => messagesContext.cancelAnswerStream());
    expect(stream.handle.cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      stream.emit('partial answer', [], true);
      stream.completion.resolve(undefined);
      await pending;
    });
    expect(mockRequest.saveAnswer).toHaveBeenCalledWith({ question_message_id: 10, content: 'partial answer' });
  });

  it('preserves current request limit errors for the assistant message to display', async () => {
    const error = { code: ERROR_CODE_NO_LIMIT, message: 'Response limit reached' };

    mockRequest.fetchAnswerStream.mockRejectedValueOnce(error);
    renderHandler();
    await act(async () => {
      await expect(messagesContext.fetchAnswerStream(10)).rejects.toBe(error);
    });

    expect(mockToastError).toHaveBeenCalledWith(error.message);
    expect(mockRemoveMessages).not.toHaveBeenCalled();
    expect(messagesContext.answerApplying).toBe(false);
  });

  it('honors manual stop before the cancellation handle is available', async () => {
    const stream = createStream(true);

    renderHandler();
    const { pending } = await startStream();

    await act(async () => messagesContext.cancelAnswerStream());
    await act(async () => {
      stream.response.resolve(stream.handle);
    });
    expect(stream.handle.cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      stream.emit('partial answer', [], true);
      stream.completion.resolve(undefined);
      await pending;
    });
  });

  it('keeps a replacement stream active when an obsolete request finishes', async () => {
    const first = createStream(true);

    renderHandler();
    const old = await startStream();
    const second = createStream();
    const current = await startStream();

    await act(async () => {
      first.response.resolve(first.handle);
    });
    first.emit('obsolete answer', [], true);
    first.completion.resolve(undefined);
    await act(async () => old.pending);
    expect(first.handle.cancel).toHaveBeenCalledTimes(1);
    expect(old.onMessage).not.toHaveBeenCalled();
    expect(messagesContext.answerApplying).toBe(true);
    expect(second.handle.cancel).not.toHaveBeenCalled();
    await act(async () => {
      second.emit('replacement answer', [], true);
      second.completion.resolve(undefined);
      await current.pending;
    });
    expect(mockRequest.saveAnswer).toHaveBeenCalledTimes(1);
    expect(mockRequest.saveAnswer).toHaveBeenCalledWith({ question_message_id: 10, content: 'replacement answer' });
  });

  it('replaces the cancelled StrictMode request once and persists the actual assistant answer', async () => {
    const first = createStream();
    const second = createStream();
    const content = (isHovered: boolean) => (
      <StrictMode>
        <MessagesHandlerProvider>
          <Probe />
          <AssistantMessage id={11} isHovered={isHovered} />
        </MessagesHandlerProvider>
      </StrictMode>
    );
    const view = render(content(false));

    await act(async () => undefined);
    expect(mockRequest.fetchAnswerStream).toHaveBeenCalledTimes(2);
    expect(first.handle.cancel).toHaveBeenCalledTimes(1);
    expect(second.handle.cancel).not.toHaveBeenCalled();
    view.rerender(content(true));
    expect(mockRequest.fetchAnswerStream).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.emit('obsolete replay answer', [], true);
      first.completion.resolve(undefined);
      second.emit('current answer', [], true);
      second.completion.resolve(undefined);
    });
    await act(async () => undefined);

    expect(screen.getByTestId('answer').textContent).toBe('current answer');
    expect(mockRequest.saveAnswer).toHaveBeenCalledTimes(1);
    expect(mockRequest.saveAnswer).toHaveBeenCalledWith({ question_message_id: 10, content: 'current answer' });
  });

  it('cancels when the assistant unmounts while its provider remains mounted', async () => {
    const stream = createStream();
    const content = (showAssistant: boolean) => (
      <MessagesHandlerProvider>
        <Probe />
        {showAssistant && <AssistantMessage id={11} isHovered={false} />}
      </MessagesHandlerProvider>
    );
    const view = render(content(true));

    await act(async () => undefined);
    view.rerender(content(false));
    expect(stream.handle.cancel).toHaveBeenCalledTimes(1);
    expect(messagesContext.answerApplying).toBe(false);
    await act(async () => {
      stream.emit('obsolete answer', [], true);
      stream.completion.resolve(undefined);
    });
    expect(mockRequest.saveAnswer).not.toHaveBeenCalled();
  });

  it('does not restart an actual assistant after manual stop or later rerenders', async () => {
    const stream = createStream();
    const content = (isHovered: boolean) => (
      <MessagesHandlerProvider>
        <Probe />
        <AssistantMessage id={11} isHovered={isHovered} />
      </MessagesHandlerProvider>
    );
    const view = render(content(false));

    await act(async () => undefined);
    await act(async () => {
      stream.emit('partial answer');
      messagesContext.cancelAnswerStream();
      stream.emit('partial answer', [], true);
      stream.completion.resolve(undefined);
    });
    view.rerender(content(true));
    await act(async () => undefined);

    expect(mockRequest.fetchAnswerStream).toHaveBeenCalledTimes(1);
    expect(stream.handle.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('answer').textContent).toBe('partial answer');
    expect(mockRequest.saveAnswer).toHaveBeenCalledWith({ question_message_id: 10, content: 'partial answer' });
  });

  it('disposes a completing assistant before a pending save applies to its provider', async () => {
    const stream = createStream();
    const saved = deferred<{ message_id: number }>();

    mockRequest.saveAnswer.mockReturnValue(saved.promise);
    const content = (showAssistant: boolean) => (
      <MessagesHandlerProvider>
        <Probe />
        {showAssistant && <AssistantMessage id={11} isHovered={false} />}
      </MessagesHandlerProvider>
    );
    const view = render(content(true));

    await act(async () => undefined);
    await act(async () => {
      stream.emit('complete answer', [], true);
      stream.completion.resolve(undefined);
    });
    view.rerender(content(false));
    expect(messagesContext.answerApplying).toBe(false);
    expect(stream.handle.cancel).not.toHaveBeenCalled();
    await act(async () => saved.resolve({ message_id: 11 }));

    expect(mockSaveMessageContent).not.toHaveBeenCalled();
    expect(mockStartFetchSuggestions).not.toHaveBeenCalled();
  });
});
