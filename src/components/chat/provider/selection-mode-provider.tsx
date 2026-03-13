import { AnimatePresence, motion } from 'framer-motion';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useChatContext } from '@/components/chat/chat/context';
import { Banner } from '@/components/chat/components/multi-selection/banner';
import { ANIMATION_PRESETS, MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { AuthorType, ChatMessage } from '@/components/chat/types';
import { CheckStatus } from '@/components/chat/types/checkbox';
import { cn } from '@/lib/utils';

import { useChatMessagesContext } from './messages-provider';


interface SelectionModeContextTypes {
  messages: ChatMessage[];
  toggleMessage: (message: ChatMessage) => void;
}

export const SelectionModeContext = createContext<SelectionModeContextTypes | undefined>(undefined);

export function useSelectionModeContext() {
  const context = useContext(SelectionModeContext);

  if(!context) {
    throw new Error('useSelectionModeContext must be used within a SelectionModeProvider');
  }

  return context;
}

export const SelectionModeProvider = ({ children }: { children: ReactNode }) => {
  const {
    chatId,
    selectionMode,
  } = useChatContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [checkStatus, setCheckStatus] = useState<CheckStatus>(CheckStatus.Unchecked);

  useEffect(() => {
    return () => {
      setMessages([]);
      setCheckStatus(CheckStatus.Unchecked);
    };
  }, [chatId]);

  useEffect(() => {
    if(!selectionMode) {
      setMessages([]);
      setCheckStatus(CheckStatus.Unchecked);
    }
  }, [selectionMode]);

  const {
    messageIds,
    getMessage,
  } = useChatMessagesContext();

  const toggleMessage = useCallback((message: ChatMessage) => {
    setMessages(messages => {
      if(messages.find(m => m.message_id === message.message_id)) {
        return messages.filter(m => m.message_id !== message.message_id);
      }

      return [...messages, message];
    });
  }, []);

  const allMessages = useMemo(() => {
    return messageIds.map(getMessage).filter(item => {
      if(item?.author?.author_type !== undefined && [AuthorType.Assistant, AuthorType.AI].includes(item?.author?.author_type)) {
        return item;
      }
    }) as ChatMessage[];
  }, [getMessage, messageIds]);

  useEffect(() => {
    const isAllChecked = allMessages.length > 0 && messages.length === allMessages.length;
    const isAllUnchecked = messages.length === 0;

    setCheckStatus(isAllChecked ? CheckStatus.Checked : isAllUnchecked ? CheckStatus.Unchecked : CheckStatus.Indeterminate);
  }, [allMessages, messages]);

  const handleSelectAll = useCallback(() => {
    setMessages(allMessages);
  }, [allMessages]);

  const handleUnselectAll = useCallback(() => {
    setMessages([]);
  }, []);
  const contextValue = useMemo(
    () => ({
      messages,
      toggleMessage,
    }),
    [messages, toggleMessage]
  );

  return <SelectionModeContext.Provider
    value={contextValue}
  >
    <div
      className={cn('h-full w-full  px-1')}
    >
      <AnimatePresence mode="wait">
        {selectionMode && (
          <motion.div
            key="banner"
            variants={MESSAGE_VARIANTS.getBannerVariants()}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute top-0 left-0 right-0 z-10"
          >
            <Banner
              messages={messages}
              onSelectAll={handleSelectAll}
              onClearAll={handleUnselectAll}
              checkStatus={checkStatus}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        className="h-full w-full relative"
        animate={{
          y: selectionMode ? 48 : 0,
        }}
        transition={ANIMATION_PRESETS.SPRING_GENTLE}
      >
        {children}
      </motion.div>

    </div>
  </SelectionModeContext.Provider>;
};
