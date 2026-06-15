import { createContext, useContext } from 'react';

import { ChatMessage } from '@/components/chat/types';

interface SelectionContextType {
  messages: ChatMessage[];
  toggleMessage: (message: ChatMessage) => void;
}

export const SelectionContext = createContext<SelectionContextType | null>(null);

export const SelectionProvider = SelectionContext.Provider;

export function useSelectionContext() {
  const context = useContext(SelectionContext);

  if(!context) {
    throw new Error('useSelectionContext must be used within a SelectionProvider');
  }

  return context;
}