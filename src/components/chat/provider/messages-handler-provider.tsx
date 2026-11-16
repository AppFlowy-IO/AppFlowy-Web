import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

import { useChatContext } from '@/components/chat/chat/context';
import { useChatSettingsLoader } from '@/components/chat/hooks/use-chat-settings-loader';
import { RagScopeLoadState, useRagScopeLoader } from '@/components/chat/hooks/use-rag-scope-loader';
import { ERROR_CODE_NO_LIMIT } from '@/components/chat/lib/const';
import {
  AuthorType,
  ChatMessageMetadata,
  ChatSettings,
  GetChatMessagesPayload,
  MessageType,
  OutputContent,
  OutputLayout,
  RepeatedChatMessage,
  ResponseFormat,
} from '@/components/chat/types';

import { useMessageAnimation } from './message-animation-provider';
import { useChatMessagesContext } from './messages-provider';
import { usePromptModal } from './prompt-modal-provider';
import { useResponseFormatContext } from './response-format-provider';
import { useSuggestionsContext } from './suggestions-provider';

interface MessagesHandlerContextTypes {
  fetchMessages: (payload?: GetChatMessagesPayload) => Promise<RepeatedChatMessage>;
  submitQuestion: (message: string) => Promise<void>;
  regenerateAnswer: (questionId: number) => Promise<void>;
  fetchAnswerStream: (
    questionId: number,
    format?: ResponseFormat,
    onMessage?: (text: string, done?: boolean) => void,
    onProgress?: (step: string) => void,
    signal?: AbortSignal
  ) => Promise<void>;
  cancelAnswerStream: () => void;
  questionSending: boolean;
  answerApplying: boolean;
  selectedModelName?: string;
  setSelectedModelName?: (modelName: string, explicit?: boolean) => void;
  chatSettings: ChatSettings | null;
  updateChatSettings: (payload: Partial<ChatSettings>) => Promise<void>;
  registerChatSettingsFlush: (flush: () => Promise<void>) => () => void;
  ragScopeState: RagScopeLoadState;
  refreshRagScope: () => void;
}

export const MessagesHandlerContext = createContext<MessagesHandlerContextTypes | undefined>(undefined);

interface AnswerStreamRequest {
  scope: { disposed: boolean };
  controller: AbortController;
  obsolete: boolean;
  stopRequested: boolean;
  completed: boolean;
  cancel?: () => void;
}

function invalidateAnswerStream(stream: AnswerStreamRequest) {
  stream.obsolete = true;
  stream.controller.abort();
  const cancel = stream.cancel;

  stream.cancel = undefined;
  cancel?.();
}

function useMessagesHandler() {
  const { workspaceId, chatId, requestInstance, currentUser } = useChatContext();

  const { chatSettings, fetchChatSettings, persistChatSettings, waitForPendingChatSettings, updateChatSettings } =
    useChatSettingsLoader();
  const {
    state: ragScopeState,
    waitUntilReady: waitUntilRagScopeReady,
    refresh: refreshRagScope,
  } = useRagScopeLoader({
    chatId,
    requestInstance,
    fetchChatSettings,
    persistChatSettings,
  });

  // Get the current model from chat settings
  const [selectedModelName, setSelectedModelName] = useState<string>();
  // Track whether the user has explicitly selected a model in this session.
  // Prevents async initialization (fetchChatSettings) from overwriting the user's choice.
  const userExplicitlySelectedModel = useRef(false);

  // Reset the explicit selection flag when chatId changes (new chat opened)
  useEffect(() => {
    userExplicitlySelectedModel.current = false;
  }, [chatId]);

  // Extract model from shared settings (only if user hasn't explicitly selected one)
  useEffect(() => {
    if (chatSettings && !userExplicitlySelectedModel.current) {
      const model = chatSettings.metadata?.ai_model as string | undefined;

      if (model) {
        setSelectedModelName(model);
      }
    }
  }, [chatSettings]);

  const { messageIds, addMessages, insertMessage, removeMessages, saveMessageContent, getMessage } =
    useChatMessagesContext();

  // Use refs for values that change frequently but are only read inside callbacks,
  // to avoid recreating the entire callback chain on each change.
  const selectedModelNameRef = useRef(selectedModelName);

  selectedModelNameRef.current = selectedModelName;
  const messageIdsRef = useRef(messageIds);

  messageIdsRef.current = messageIds;

  const { setResponseFormatWithId } = useResponseFormatContext();

  const { currentPromptId } = usePromptModal();

  const { registerAnimation } = useMessageAnimation();
  const { registerFetchSuggestions, startFetchSuggestions } = useSuggestionsContext();
  const [questionSending, setQuestionSending] = useState(false);
  const questionSendingRef = useRef(false);
  const [answerApplying, setAnswerApplying] = useState(false);
  const activeStreamRef = useRef<AnswerStreamRequest>();
  const streamScope = useMemo(() => ({ workspaceId, chatId, disposed: false }), [workspaceId, chatId]);
  const chatSettingsFlushersRef = useRef(new Set<() => Promise<void>>());

  const registerChatSettingsFlush = useCallback((flush: () => Promise<void>) => {
    chatSettingsFlushersRef.current.add(flush);

    return () => {
      chatSettingsFlushersRef.current.delete(flush);
    };
  }, []);

  const flushChatSettings = useCallback(async () => {
    for (const flush of Array.from(chatSettingsFlushersRef.current)) {
      await flush();
    }
  }, []);

  useLayoutEffect(() => {
    streamScope.disposed = false;
    return () => {
      streamScope.disposed = true;
      const stream = activeStreamRef.current;

      if (stream?.scope === streamScope) {
        invalidateAnswerStream(stream);
        activeStreamRef.current = undefined;
      }

      setQuestionSending(false);
      questionSendingRef.current = false;
      setAnswerApplying(false);
    };
  }, [streamScope]);

  const fetchMessages = useCallback(
    async (payload?: GetChatMessagesPayload) => {
      try {
        const data = await requestInstance.getChatMessages(payload);
        const messages = data.messages;

        addMessages(messages);

        return data;
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
        return Promise.reject(e);
      }
    },
    [requestInstance, addMessages]
  );

  const createAssistantMessage = useCallback(
    (answerId: number, index: number) => {
      registerAnimation(answerId);

      insertMessage(
        {
          message_id: answerId,
          content: '',
          author: {
            author_uuid: 'assistant',
            author_type: AuthorType.Assistant,
          },
        },
        index
      );
    },
    [insertMessage, registerAnimation]
  );

  const regenerateAnswer = useCallback(
    async (questionId: number) => {
      const question = getMessage(questionId);
      const answerId = question?.reply_message_id || questionId + 1;

      const newMessages = removeMessages([answerId]);

      setTimeout(() => {
        const index = newMessages.map((message) => message.message_id).indexOf(questionId);

        createAssistantMessage(answerId, index);
      }, 200);
    },
    [createAssistantMessage, getMessage, removeMessages]
  );

  const submitQuestion = useCallback(
    async (message: string) => {
      if (questionSendingRef.current) {
        const error = new Error('A question is already being sent');

        toast.error(error.message);
        return Promise.reject(error);
      }

      questionSendingRef.current = true;
      try {
        setQuestionSending(true);

        if (!(await waitUntilRagScopeReady())) {
          throw new Error('Unable to validate the AI chat context');
        }

        await flushChatSettings();
        if (!(await waitForPendingChatSettings())) {
          throw new Error('Unable to save the AI chat context');
        }

        // Capture whether this is the first message BEFORE we insert anything,
        // so the rename-from-first-prompt logic works correctly.
        const isFirstMessage = !messageIdsRef.current || messageIdsRef.current.length === 0;

        // insert fake message to show user message
        const fakeMessageId = Date.now();
        const author = {
          author_uuid: currentUser?.uuid || '',
          author_type: AuthorType.Human,
        };

        insertMessage(
          {
            message_id: fakeMessageId,
            content: message,
            author,
          },
          0
        );
        registerAnimation(fakeMessageId);

        const promptId = currentPromptId || undefined;

        const question = await requestInstance.submitQuestion({
          content: message,
          message_type: MessageType.User,
          prompt_id: promptId,
          model_name: selectedModelNameRef.current,
        });

        const answerId = question.reply_message_id || question.message_id + 1;

        // remove fake message
        removeMessages([fakeMessageId]);

        insertMessage(
          {
            ...question,
            author,
          },
          0
        );

        // clear suggestions and set placeholder for this question
        registerFetchSuggestions(question.message_id);

        // create assistant message after user message
        setTimeout(() => {
          createAssistantMessage(answerId, 0);
        }, 200);

        void (async () => {
          try {
            const view = await requestInstance.getCurrentView();

            if (isFirstMessage && view) {
              await requestInstance.updateViewName(view, message);
            }
            // eslint-disable-next-line
          } catch (e: any) {
            toast.error(e.message);
          }
        })();

        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);

        return Promise.reject(e);
      } finally {
        questionSendingRef.current = false;
        setQuestionSending(false);
      }
    },
    [
      currentUser?.uuid,
      insertMessage,
      registerAnimation,
      currentPromptId,
      requestInstance,
      removeMessages,
      registerFetchSuggestions,
      createAssistantMessage,
      flushChatSettings,
      waitForPendingChatSettings,
      waitUntilRagScopeReady,
    ]
  );

  const saveAnswer = useCallback(
    async (questionId: number, content: string, metadata: ChatMessageMetadata[], isCurrent: () => boolean) => {
      if (!isCurrent()) return;
      try {
        const answer = await requestInstance.saveAnswer({
          question_message_id: questionId,
          content,
          ...(metadata.length !== 0 && { meta_data: metadata }),
        });

        if (isCurrent()) saveMessageContent(answer.message_id, content, metadata);
        // eslint-disable-next-line
      } catch (e: any) {
        if (isCurrent()) toast.error(e.message);
      }
    },
    [requestInstance, saveMessageContent]
  );

  const removeAssistantMessage = useCallback(
    (messageId: number) => {
      removeMessages([messageId]);
    },
    [removeMessages]
  );

  const fetchAnswerStream = useCallback(
    async (
      questionId: number,
      format?: ResponseFormat,
      onMessage?: (text: string, done?: boolean) => void,
      onProgress?: (step: string) => void,
      signal?: AbortSignal
    ) => {
      if (streamScope.disposed || signal?.aborted) return;
      if (activeStreamRef.current) invalidateAnswerStream(activeStreamRef.current);
      const stream: AnswerStreamRequest = {
        scope: streamScope,
        controller: new AbortController(),
        obsolete: false,
        stopRequested: false,
        completed: false,
      };

      activeStreamRef.current = stream;
      const isCurrent = () => !stream.obsolete && !stream.scope.disposed && !signal?.aborted;
      const abortStream = () => {
        invalidateAnswerStream(stream);
        if (activeStreamRef.current === stream) {
          activeStreamRef.current = undefined;
          if (!stream.scope.disposed) setAnswerApplying(false);
        }
      };

      let answerCompletion: Promise<void> | undefined;

      const question = getMessage(questionId);
      let answerId = question?.reply_message_id;

      if (!answerId) {
        answerId = questionId + 1;
      }

      if (format) {
        setResponseFormatWithId(answerId, format);
      }

      const handleMessageProgress = (message: string, metadata: ChatMessageMetadata[], done?: boolean) => {
        if (!isCurrent() || stream.completed || (stream.stopRequested && !done)) return;
        onMessage?.(message, done);
        if (!isCurrent()) return;

        if (done) {
          stream.completed = true;
          if (message) {
            answerCompletion = (async () => {
              await saveAnswer(questionId, message, metadata, isCurrent);
              if (!isCurrent()) return;
              setAnswerApplying(false);
              if (answerId && messageIdsRef.current.indexOf(answerId) === 0) {
                await startFetchSuggestions(questionId, isCurrent);
              }
            })();
          } else {
            if (answerId) {
              removeAssistantMessage(answerId);
            }

            setAnswerApplying(false);
          }

          return;
        }
      };

      try {
        signal?.addEventListener('abort', abortStream, { once: true });
        setAnswerApplying(true);
        const { cancel, streamPromise } = await requestInstance.fetchAnswerStream(
          {
            question_id: questionId,
            format: format || {
              output_layout: OutputLayout.Paragraph,
              output_content: OutputContent.TEXT,
            },
            model_name: selectedModelNameRef.current,
          },
          handleMessageProgress,
          (step) => {
            if (isCurrent() && !stream.stopRequested && !stream.completed) onProgress?.(step);
          },
          stream.controller.signal
        );

        // Fetch may still be waiting for response headers when its owner unmounts.
        // Cancel that late handle too, and observe rejection without retaining the caller.
        if (!isCurrent()) {
          cancel();
          void streamPromise.catch(() => undefined);
          return;
        }

        if (stream.stopRequested) cancel();
        else stream.cancel = cancel;
        await streamPromise;
        stream.cancel = undefined;
        await answerCompletion;
        // eslint-disable-next-line
      } catch (e: any) {
        if (!isCurrent()) return;
        toast.error(e.message);
        setAnswerApplying(false);
        const code = e.code;

        if (code !== ERROR_CODE_NO_LIMIT) {
          // remove assistant message if error is not no limit
          if (answerId) {
            removeAssistantMessage(answerId);
          }

          return;
        }

        // if error is no limit, show assistant message with error
        return Promise.reject(e);
      } finally {
        signal?.removeEventListener('abort', abortStream);
        stream.cancel = undefined;
      }
    },
    [
      getMessage,
      setResponseFormatWithId,
      saveAnswer,
      startFetchSuggestions,
      removeAssistantMessage,
      requestInstance,
      streamScope,
    ]
  );

  const cancelAnswerStream = useCallback(() => {
    const stream = activeStreamRef.current;

    if (!stream || stream.obsolete || stream.scope.disposed) return;
    // A manual stop may still produce the transport's final partial answer for persistence.
    stream.stopRequested = true;
    const cancel = stream.cancel;

    stream.cancel = undefined;
    cancel?.();
  }, []);

  // Keep the shared model state in sync. Explicit persistence is handled by
  // ModelSelector's request adapter so one selection produces exactly one
  // settings write; initialization only updates local state.
  const updateSelectedModel = useCallback((modelName: string, explicit = true) => {
    if (explicit) {
      userExplicitlySelectedModel.current = true;
    }

    setSelectedModelName(modelName);
  }, []);

  return useMemo(
    () => ({
      fetchMessages,
      submitQuestion,
      regenerateAnswer,
      fetchAnswerStream,
      cancelAnswerStream,
      questionSending,
      answerApplying,
      selectedModelName,
      setSelectedModelName: updateSelectedModel,
      chatSettings,
      updateChatSettings,
      registerChatSettingsFlush,
      ragScopeState,
      refreshRagScope,
    }),
    [
      fetchMessages,
      submitQuestion,
      regenerateAnswer,
      fetchAnswerStream,
      cancelAnswerStream,
      questionSending,
      answerApplying,
      selectedModelName,
      updateSelectedModel,
      chatSettings,
      updateChatSettings,
      registerChatSettingsFlush,
      ragScopeState,
      refreshRagScope,
    ]
  );
}

export function MessagesHandlerProvider({ children }: { children: ReactNode }) {
  const value = useMessagesHandler();

  return <MessagesHandlerContext.Provider value={value}>{children}</MessagesHandlerContext.Provider>;
}

export function useMessagesHandlerContext() {
  const context = useContext(MessagesHandlerContext);

  if (!context) {
    throw new Error('useMessagesHandlerContext must be used within a MessagesHandlerProvider');
  }

  return context;
}
