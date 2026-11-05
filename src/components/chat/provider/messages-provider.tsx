import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useChatContext } from '@/components/chat/chat/context';
import { AuthorType, ChatMessage, ChatMessageMetadata } from '@/components/chat/types';

export interface ChatMessagesContextTypes {
  messageIds: number[];
  getMessage: (id: number) => ChatMessage | undefined;
  getQuestionId: (answerId: number) => number | undefined;
  addMessages: (messages: ChatMessage[]) => void;
  removeMessages: (ids: number[]) => ChatMessage[];
  insertMessage: (message: ChatMessage, index: number) => void;
  saveMessageContent: (messageId: number, content: string, metadata: ChatMessageMetadata[]) => void;
  /** Reconciles a streamed placeholder and its question with the saved answer's identity. */
  saveAnswerMessage: (questionId: number, placeholderId: number, answer: ChatMessage) => void;
  /** Replaces a message's text and re-renders it (used when a question is edited). */
  updateMessageContent: (messageId: number, content: string) => void;
  /** Bumped when a message changes in place, so consumers rendering content re-read it. */
  messagesVersion: number;
}

export const ChatMessagesContext = createContext<ChatMessagesContextTypes | undefined>(undefined);

export function useChatMessagesContext() {
  const context = useContext(ChatMessagesContext);

  if(!context) {
    throw new Error('useMessagesManager: useMessagesManager must be used within a ChatMessagesProvider');
  }

  return context;
}

export const ChatMessagesProvider = ({ children }: { children: ReactNode }) => {
  const {
    chatId,
  } = useChatContext();
  const [messageIds, setMessageIds] = useState<number[]>([]);
  const [messagesVersion, setMessagesVersion] = useState(0);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    return () => {
      setMessageIds([]);
      messagesRef.current = [];
    };
  }, [chatId]);

  const getMessage = useCallback((id: number) => {
    return messagesRef.current.find((message) => message.message_id === id);
  }, []);

  const getQuestionId = useCallback((answerId: number) => {
    return messagesRef.current.find((message) => message.message_id === answerId)?.question_message_id ??
      messagesRef.current.find((message) =>
        message.author.author_type === AuthorType.Human && message.reply_message_id === answerId
      )?.message_id;
  }, []);

  const addMessages = useCallback((messages: ChatMessage[]) => {
    const allMessages = [...messagesRef.current, ...messages];
    const messagesById = new Map(allMessages.map((message) => [message.message_id, message]));
    const repliesByQuestionId = new Map<number, ChatMessage>();
    const replyIds = new Set<number>();

    for (const message of allMessages) {
      if (message.author.author_type !== AuthorType.Human || message.reply_message_id === undefined) continue;
      const reply = messagesById.get(message.reply_message_id);

      if (reply && reply.author.author_type !== AuthorType.Human) {
        repliesByQuestionId.set(message.message_id, reply);
        replyIds.add(reply.message_id);
      }
    }

    // Edited answers get newer IDs. Group replies with their questions across
    // loaded pages, leaving the server batches untouched for pagination.
    messagesRef.current = allMessages.flatMap((message) => {
      if (replyIds.has(message.message_id)) return [];
      const reply = repliesByQuestionId.get(message.message_id);

      return reply ? [reply, message] : [message];
    });
    setMessageIds(messagesRef.current.map((message) => message.message_id));
  }, []);

  const removeMessages = useCallback((ids: number[]) => {
    messagesRef.current = messagesRef.current.filter((message) => !ids.includes(message.message_id));

    setMessageIds(messagesRef.current.map((message) => message.message_id));

    return messagesRef.current;
  }, []);

  const insertMessage = useCallback((message: ChatMessage, index: number) => {
    const newMessage = [...messagesRef.current];

    newMessage.splice(index, 0, message);
    messagesRef.current = newMessage;
    setMessageIds(messagesRef.current.map((message) => message.message_id));
  }, []);

  const saveMessageContent = useCallback(
    (messageId: number, content: string, metadata: ChatMessageMetadata[]) => {
      const message = messagesRef.current.find(
        (message) => message.message_id === messageId
      );

      if(message) {
        message.content = content;
        message.meta_data = [...metadata];
        setMessagesVersion((version) => version + 1);
      }
    },
    []
  );
  const updateMessageContent = useCallback((messageId: number, content: string) => {
    messagesRef.current = messagesRef.current.map((message) =>
      message.message_id === messageId ? { ...message, content } : message
    );
    setMessagesVersion((version) => version + 1);
  }, []);

  const saveAnswerMessage = useCallback((questionId: number, placeholderId: number, answer: ChatMessage) => {
    messagesRef.current = messagesRef.current.map((message) => {
      if (message.message_id === questionId) {
        return { ...message, reply_message_id: answer.message_id };
      }

      if (message.message_id === placeholderId) {
        // Keep the streaming component mounted when the server reused its ID.
        return {
          ...answer,
          question_message_id: questionId,
          author: answer.message_id === placeholderId ? message.author : answer.author,
        };
      }

      return message;
    });
    setMessageIds(messagesRef.current.map((message) => message.message_id));
    setMessagesVersion((version) => version + 1);
  }, []);

  const contextValue = useMemo(
    () => ({
      messageIds,
      getMessage,
      getQuestionId,
      addMessages,
      removeMessages,
      insertMessage,
      saveMessageContent,
      saveAnswerMessage,
      updateMessageContent,
      messagesVersion,
    }),
    [
      messageIds,
      getMessage,
      getQuestionId,
      addMessages,
      removeMessages,
      insertMessage,
      saveMessageContent,
      saveAnswerMessage,
      updateMessageContent,
      messagesVersion,
    ]
  );

  return (
    <ChatMessagesContext.Provider value={contextValue}>
      {children}
    </ChatMessagesContext.Provider>
  );
};
