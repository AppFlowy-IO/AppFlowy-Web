import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useChatContext } from '@/components/chat/chat/context';
import { useChatSettingsLoader } from '@/components/chat/hooks/use-chat-settings-loader';
import { RagScopeLoadState, useRagScopeLoader } from '@/components/chat/hooks/use-rag-scope-loader';
import { deriveChatTitle } from '@/components/chat/lib/utils';
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
  /** `format` is remembered for the answer so a later "Try again" reuses it. */
  submitQuestion: (message: string, format?: ResponseFormat) => Promise<void>;
  regenerateAnswer: (questionId: number, format?: ResponseFormat) => Promise<void>;
  fetchAnswerStream: (
    questionId: number,
    format?: ResponseFormat,
    onMessage?: (text: string, done?: boolean, metadata?: ChatMessageMetadata[]) => void,
    onProgress?: (step: string) => void,
    onReasoning?: (reasoning: string) => void
  ) => Promise<void>;
  cancelAnswerStream: () => void;
  /** Saves an edited question and streams a fresh answer for it. */
  editQuestion: (questionId: number, content: string) => Promise<void>;
  /** The question currently shown in its edit box, if any. */
  editingQuestionId: number | null;
  setEditingQuestionId: (questionId: number | null) => void;
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

function useMessagesHandler() {
  const { chatId, requestInstance, currentUser } = useChatContext();

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

  const {
    messageIds,
    addMessages,
    insertMessage,
    removeMessages,
    saveMessageContent,
    updateMessageContent,
    getMessage,
  } = useChatMessagesContext();
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);

  // Use refs for values that change frequently but are only read inside callbacks,
  // to avoid recreating the entire callback chain on each change.
  const selectedModelNameRef = useRef(selectedModelName);

  selectedModelNameRef.current = selectedModelName;
  const messageIdsRef = useRef(messageIds);

  messageIdsRef.current = messageIds;

  const { setResponseFormatWithId, resolveAnswerFormat } = useResponseFormatContext();

  const { currentPromptId } = usePromptModal();

  const { registerAnimation } = useMessageAnimation();
  const { registerFetchSuggestions, startFetchSuggestions } = useSuggestionsContext();
  const [questionSending, setQuestionSending] = useState(false);
  const questionSendingRef = useRef(false);
  const [answerApplying, setAnswerApplying] = useState(false);
  const cancelStreamRef = useRef<() => void>();
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

  useEffect(() => {
    return () => {
      setQuestionSending(false);
      questionSendingRef.current = false;
      setAnswerApplying(false);
      setEditingQuestionId(null);
      cancelStreamRef.current = undefined;
    };
  }, [chatId]);

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
    async (questionId: number, format?: ResponseFormat) => {
      const question = getMessage(questionId);
      const answerId = question?.reply_message_id || questionId + 1;

      if (format) {
        setResponseFormatWithId(answerId, format);
      }

      const newMessages = removeMessages([answerId]);

      setTimeout(() => {
        const index = newMessages.map((message) => message.message_id).indexOf(questionId);

        createAssistantMessage(answerId, index);
      }, 200);
    },
    [createAssistantMessage, getMessage, removeMessages, setResponseFormatWithId]
  );

  const submitQuestion = useCallback(
    async (message: string, format?: ResponseFormat) => {
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

        // Snapshot the format now: the input may reset a one-shot image request
        // before the assistant message mounts and starts streaming.
        if (format) {
          setResponseFormatWithId(answerId, format);
        }

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
              await requestInstance.updateViewName(view, deriveChatTitle(message));
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
      setResponseFormatWithId,
    ]
  );

  const saveAnswer = useCallback(
    async (questionId: number, content: string, metadata: ChatMessageMetadata[]) => {
      try {
        const answer = await requestInstance.saveAnswer({
          question_message_id: questionId,
          content,
          ...(metadata.length !== 0 && { meta_data: metadata }),
        });

        saveMessageContent(answer.message_id, content, metadata);
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
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
      onMessage?: (text: string, done?: boolean, metadata?: ChatMessageMetadata[]) => void,
      onProgress?: (step: string) => void,
      onReasoning?: (reasoning: string) => void
    ) => {
      const question = getMessage(questionId);
      let answerId = question?.reply_message_id;

      if (!answerId) {
        answerId = questionId + 1;
      }

      if (format) {
        setResponseFormatWithId(answerId, format);
      }

      const handleMessageProgress = (message: string, metadata: ChatMessageMetadata[], done?: boolean) => {
        onMessage?.(message, done, metadata);

        if (done) {
          if (message) {
            void (async () => {
              await saveAnswer(questionId, message, metadata);
              setAnswerApplying(false);
              if (answerId && messageIdsRef.current.indexOf(answerId) === 0) {
                await startFetchSuggestions(questionId);
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
        setAnswerApplying(true);
        const { cancel, streamPromise } = requestInstance.fetchAnswerStream(
          {
            question_id: questionId,
            format: format || {
              output_layout: OutputLayout.Flex,
              output_content: OutputContent.TEXT,
            },
            model_name: selectedModelNameRef.current,
          },
          handleMessageProgress,
          onProgress,
          onReasoning
        );

        // Registered before the request resolves so Stop works while waiting for headers.
        cancelStreamRef.current = cancel;
        await streamPromise;
      } catch (e) {
        setAnswerApplying(false);

        // The assistant message stays mounted: it renders the error with a retry
        // button instead of silently disappearing with a toast.
        return Promise.reject(e);
      } finally {
        cancelStreamRef.current = undefined;
      }
    },
    [getMessage, setResponseFormatWithId, saveAnswer, startFetchSuggestions, removeAssistantMessage, requestInstance]
  );

  const cancelAnswerStream = useCallback(() => {
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
    }
  }, []);

  const editQuestion = useCallback(
    async (questionId: number, content: string) => {
      const question = getMessage(questionId);

      if (!question) return;

      const answerId = question.reply_message_id || questionId + 1;
      // Keep the answer's original format (an image question stays an image question).
      const format = resolveAnswerFormat(answerId, getMessage(answerId)?.content);

      try {
        await requestInstance.updateQuestion({
          chat_id: chatId,
          message_id: questionId,
          content,
          generate_answer: false,
        });
        updateMessageContent(questionId, content);
        setEditingQuestionId(null);
        await regenerateAnswer(questionId, format);
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
        return Promise.reject(e);
      }
    },
    [chatId, getMessage, regenerateAnswer, requestInstance, resolveAnswerFormat, updateMessageContent]
  );

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
      editQuestion,
      editingQuestionId,
      setEditingQuestionId,
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
      editQuestion,
      editingQuestionId,
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
