import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useChatContext } from '@/components/chat/chat/context';
import { useChatSettingsLoader } from '@/components/chat/hooks/use-chat-settings-loader';
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
    onProgress?: (step: string) => void
  ) => Promise<void>;
  cancelAnswerStream: () => void;
  questionSending: boolean;
  answerApplying: boolean;
  selectedModelName?: string;
  setSelectedModelName?: (modelName: string, explicit?: boolean) => void;
  chatSettings: ChatSettings | null;
  updateChatSettings: (payload: Partial<ChatSettings>) => Promise<void>;
}

export const MessagesHandlerContext = createContext<MessagesHandlerContextTypes | undefined>(undefined);

function useMessagesHandler() {
  const { chatId, requestInstance, currentUser } = useChatContext();

  const { chatSettings, fetchChatSettings, updateChatSettings } = useChatSettingsLoader();

  // Get the current model from chat settings
  const [selectedModelName, setSelectedModelName] = useState<string>();
  // Track whether the user has explicitly selected a model in this session.
  // Prevents async initialization (fetchChatSettings) from overwriting the user's choice.
  const userExplicitlySelectedModel = useRef(false);

  useEffect(() => {
    void fetchChatSettings();
  }, [fetchChatSettings]);

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
  const [answerApplying, setAnswerApplying] = useState(false);
  const cancelStreamRef = useRef<() => void>();

  useEffect(() => {
    return () => {
      setQuestionSending(false);
      setAnswerApplying(false);
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
      try {
        setQuestionSending(true);

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
    async (questionId: number, format?: ResponseFormat, onMessage?: (text: string, done?: boolean) => void, onProgress?: (step: string) => void) => {
      const question = getMessage(questionId);
      let answerId = question?.reply_message_id;

      if (!answerId) {
        answerId = questionId + 1;
      }

      if (format) {
        setResponseFormatWithId(answerId, format);
      }

      const handleMessageProgress = (message: string, metadata: ChatMessageMetadata[], done?: boolean) => {
        onMessage?.(message, done);

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
          onProgress
        );

        cancelStreamRef.current = cancel;
        await streamPromise;
        // eslint-disable-next-line
      } catch (e: any) {
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
      }
    },
    [
      getMessage,
      setResponseFormatWithId,
      saveAnswer,
      startFetchSuggestions,
      removeAssistantMessage,
      requestInstance,
    ]
  );

  const cancelAnswerStream = useCallback(() => {
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
    }
  }, []);

  // Update local state and persist to chat settings.
  // Called from both initialization (ModelSelector loadCurrentModel) and explicit user selection.
  // The `explicit` parameter distinguishes the two to prevent async init from overwriting user choices.
  const updateSelectedModel = useCallback((modelName: string, explicit = true) => {
    if (explicit) {
      userExplicitlySelectedModel.current = true;
    }

    setSelectedModelName(modelName);
    void updateChatSettings({
      metadata: {
        ai_model: modelName,
      },
    });
  }, [updateChatSettings]);

  return useMemo(() => ({
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
  }), [
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
  ]);
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
