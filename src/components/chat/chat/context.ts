import { createContext, useContext } from 'react';

import { ChatProps } from '@/components/chat/types';

export const ChatContext = createContext<ChatProps | undefined>(undefined);

export function useChatContext() {
  const context = useContext(ChatContext);

  if(!context) {
    throw new Error('useChatContext must be used within a ChatContextProvider');
  }

  return context;
}
