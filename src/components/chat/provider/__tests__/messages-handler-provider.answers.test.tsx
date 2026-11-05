import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';

import { useChatMessages } from '@/components/chat/components/chat-messages/use-chat-messages';

import { MessagesHandlerProvider, useMessagesHandlerContext } from '../messages-handler-provider';
import { ChatMessagesProvider, useChatMessagesContext } from '../messages-provider';
import { ResponseFormatProvider, useMessageResponseFormatContext } from '../response-format-provider';

import { AuthorType, ChatMessage, ChatMessageMetadata, OutputContent, OutputLayout } from '@/components/chat/types';

const requestInstance = {
  getChatMessages: jest.fn(),
  submitQuestion: jest.fn(),
  getCurrentView: jest.fn().mockResolvedValue(undefined),
  updateQuestion: jest.fn().mockResolvedValue(undefined),
  saveAnswer: jest.fn(),
  fetchAnswerStream: jest.fn(),
};
const waitUntilReady = jest.fn().mockResolvedValue(true);
const waitForPendingChatSettings = jest.fn().mockResolvedValue(true);
const registerAnimation = jest.fn();
const registerFetchSuggestions = jest.fn();
const startFetchSuggestions = jest.fn().mockResolvedValue(undefined);

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/components/chat/chat/context', () => ({
  useChatContext: () => ({ chatId: 'chat-id', requestInstance, currentUser: { uuid: 'user-id' } }),
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
    state: { status: 'ready', parentView: null, scopedSettings: null },
    waitUntilReady,
    refresh: jest.fn(),
  }),
}));
jest.mock('@/components/chat/provider/message-animation-provider', () => ({
  useMessageAnimation: () => ({ registerAnimation }),
}));
jest.mock('@/components/chat/provider/prompt-modal-provider', () => ({
  usePromptModal: () => ({ currentPromptId: null }),
}));
jest.mock('@/components/chat/provider/suggestions-provider', () => ({
  useSuggestionsContext: () => ({ registerFetchSuggestions, startFetchSuggestions }),
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

const question: ChatMessage = {
  message_id: 10,
  reply_message_id: 11,
  content: 'Original question',
  author: { author_type: AuthorType.Human, author_uuid: 'user-id' },
};
const answer: ChatMessage = {
  message_id: 11,
  content: 'Original answer',
  author: { author_type: AuthorType.AI, author_uuid: 'ai' },
};
const laterQuestion: ChatMessage = { ...question, message_id: 20, reply_message_id: 21, content: 'Later question' };
const laterAnswer: ChatMessage = { ...answer, message_id: 21, content: 'Later answer' };
const imageFormat = {
  output_layout: OutputLayout.Flex,
  output_content: OutputContent.IMAGE,
  output_content_metadata: { size: '1024x1024', quality: 'hd' },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <ChatMessagesProvider>
    <ResponseFormatProvider>
      <MessagesHandlerProvider>{children}</MessagesHandlerProvider>
    </ResponseFormatProvider>
  </ChatMessagesProvider>
);
const render = () =>
  renderHook(
    () => ({
      handlers: useMessagesHandlerContext(),
      messages: useChatMessagesContext(),
      formats: useMessageResponseFormatContext(),
      history: useChatMessages(),
    }),
    { wrapper }
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('reconciles an edited answer with its server ID and preserves content, sources, format and position', async () => {
  const metadata: ChatMessageMetadata[] = [{ id: 'source', name: 'Source', source: 'document' }];
  const savedAnswer = { ...answer, message_id: 87, content: 'Replacement answer', meta_data: metadata };
  const stream = deferred<void>();
  let onMessage!: (content: string, metadata: ChatMessageMetadata[], done?: boolean) => void;

  requestInstance.fetchAnswerStream.mockImplementation((_params, callback) => {
    onMessage = callback;
    return { cancel: jest.fn(), streamPromise: stream.promise };
  });
  requestInstance.saveAnswer.mockResolvedValue(savedAnswer);
  const { result } = render();

  act(() => {
    result.current.messages.addMessages([laterAnswer, laterQuestion, answer, question]);
    result.current.formats.setResponseFormatWithId(11, imageFormat);
  });
  await act(async () => result.current.handlers.editQuestion(10, 'Edited question'));
  act(() => {
    jest.advanceTimersByTime(200);
  });

  expect(result.current.messages.getQuestionId(11)).toBe(10);
  let fetching!: Promise<void>;

  act(() => {
    fetching = result.current.handlers.fetchAnswerStream(10, imageFormat);
  });
  await act(async () => {
    onMessage(savedAnswer.content, metadata, true);
    stream.resolve();
    await fetching;
  });

  expect(requestInstance.updateQuestion).toHaveBeenCalledWith({
    chat_id: 'chat-id',
    message_id: 10,
    content: 'Edited question',
    generate_answer: false,
  });
  expect(requestInstance.saveAnswer).toHaveBeenCalledWith({
    question_message_id: 10,
    content: savedAnswer.content,
    meta_data: metadata,
  });
  expect(result.current.messages.messageIds).toEqual([21, 20, 87, 10]);
  expect(result.current.messages.getMessage(11)).toBeUndefined();
  expect(result.current.messages.getMessage(87)?.content).toBe(savedAnswer.content);
  expect(result.current.messages.getMessage(87)?.meta_data).toEqual(metadata);
  expect(result.current.messages.getMessage(10)?.reply_message_id).toBe(87);
  expect(result.current.formats.resolveAnswerFormat(87)).toEqual(imageFormat);

  // Reloaded messages only carry the server's question-to-answer relationship.
  const reloaded = render();

  act(() =>
    reloaded.result.current.messages.addMessages([
      savedAnswer,
      laterAnswer,
      laterQuestion,
      { ...question, content: 'Edited question', reply_message_id: 87 },
    ])
  );
  expect(reloaded.result.current.messages.messageIds).toEqual([21, 20, 87, 10]);
  expect(reloaded.result.current.messages.getQuestionId(87)).toBe(10);
  await act(async () =>
    reloaded.result.current.handlers.regenerateAnswer(reloaded.result.current.messages.getQuestionId(87)!, imageFormat)
  );
  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(reloaded.result.current.messages.getMessage(87)?.question_message_id).toBe(10);
});

it('restores edited-answer order across history pages while retaining the raw pagination cursor', async () => {
  const savedAnswer = { ...answer, message_id: 87, content: 'Replacement answer' };
  const firstPage = { messages: [savedAnswer, laterAnswer, laterQuestion], has_more: true, total: 4 };
  const secondPage = {
    messages: [{ ...question, content: 'Edited question', reply_message_id: 87 }],
    has_more: true,
    total: 4,
  };

  requestInstance.getChatMessages
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(secondPage)
    .mockResolvedValueOnce({ messages: [], has_more: false, total: 4 });
  const { result } = render();

  await act(async () => {
    expect(await result.current.history.fetchInitialMessages()).toBe(firstPage);
  });
  expect(result.current.messages.messageIds).toEqual([87, 21, 20]);

  await act(async () => result.current.history.loadMoreMessages());
  expect(result.current.messages.messageIds).toEqual([21, 20, 87, 10]);
  expect(firstPage.messages.map((message) => message.message_id)).toEqual([87, 21, 20]);
  expect(secondPage.messages.map((message) => message.message_id)).toEqual([10]);

  await act(async () => result.current.history.loadMoreMessages());
  expect(requestInstance.getChatMessages.mock.calls).toEqual([
    [{ limit: 20 }],
    [{ limit: 20, before: 20 }],
    [{ limit: 20, before: 10 }],
  ]);
  expect(result.current.history.hasMore).toBe(false);
});

it('links a new placeholder even when the question has no server answer yet', async () => {
  requestInstance.submitQuestion.mockResolvedValue({ ...question, reply_message_id: undefined });
  const { result } = render();

  await act(async () => result.current.handlers.submitQuestion('New question'));

  expect(result.current.messages.getQuestionId(11)).toBe(10);
});

it('keeps one stream and its Stop callback active through answer persistence', async () => {
  const stream = deferred<void>();
  const save = deferred<ChatMessage>();
  const cancel = jest.fn();
  let onMessage!: (content: string, metadata: ChatMessageMetadata[], done?: boolean) => void;

  requestInstance.fetchAnswerStream.mockImplementation((_params, callback) => {
    onMessage = callback;
    return { cancel, streamPromise: stream.promise };
  });
  requestInstance.saveAnswer.mockReturnValue(save.promise);
  const { result } = render();

  act(() => result.current.messages.addMessages([answer, question]));
  let fetching!: Promise<void>;

  act(() => {
    fetching = result.current.handlers.fetchAnswerStream(10);
  });
  await act(async () => {
    await expect(result.current.handlers.fetchAnswerStream(30)).rejects.toThrow('already being requested');
    await expect(result.current.handlers.submitQuestion('Another question')).rejects.toThrow('already being sent');
    await result.current.handlers.regenerateAnswer(10);
  });
  expect(result.current.messages.getMessage(11)).toBeDefined();
  expect(requestInstance.fetchAnswerStream).toHaveBeenCalledTimes(1);
  act(() => result.current.handlers.cancelAnswerStream());
  expect(cancel).toHaveBeenCalledTimes(1);

  await act(async () => {
    onMessage('Saved answer', [], true);
    stream.resolve();
  });
  expect(result.current.handlers.answerApplying).toBe(true);
  await expect(result.current.handlers.fetchAnswerStream(30)).rejects.toThrow('already being requested');

  await act(async () => {
    save.resolve({ ...answer, content: 'Saved answer' });
    await fetching;
  });
  expect(result.current.handlers.answerApplying).toBe(false);
});

it('blocks retries while a new question is being submitted', async () => {
  const submission = deferred<ChatMessage>();

  requestInstance.submitQuestion.mockReturnValue(submission.promise);
  const { result } = render();
  let sending!: Promise<void>;

  act(() => {
    sending = result.current.handlers.submitQuestion('New question');
  });
  await act(async () => {
    await expect(result.current.handlers.fetchAnswerStream(10)).rejects.toThrow('already being requested');
    submission.resolve(question);
    await sending;
  });
  expect(requestInstance.fetchAnswerStream).not.toHaveBeenCalled();
});
