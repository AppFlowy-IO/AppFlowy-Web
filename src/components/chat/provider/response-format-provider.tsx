import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useChatContext } from '@/components/chat/chat/context';
import { ChatInputMode, OutputContent, OutputLayout, ResponseFormat } from '@/components/chat/types';

interface ResponseFormatContextTypes {
  responseFormat: ResponseFormat;
  responseMode: ChatInputMode;
  setResponseFormat: (responseFormat: ResponseFormat) => void;
  setResponseMode: (responseMode: ChatInputMode) => void;
  getMessageResponseFormat: (id: number) => ResponseFormat | undefined;
  setResponseFormatWithId: (id: number, responseFormat: ResponseFormat) => void;
}

export const ResponseFormatContext = createContext<ResponseFormatContextTypes | undefined>(undefined);

export function useResponseFormatContext() {
  const context = useContext(ResponseFormatContext);

  if(!context) {
    throw new Error('useResponseFormatContext must be used within a ResponseFormatProvider');
  }

  return context;
}

export const ResponseFormatProvider = ({ children }: { children: ReactNode }) => {
  const [responseFormat, setResponseFormat] = useState<ResponseFormat>({
    output_layout: OutputLayout.BulletList,
    output_content: OutputContent.TEXT,
  });
  const messagesResponseFormat = useRef<Map<number, ResponseFormat>>(new Map());
  const [responseMode, setResponseMode] = useState<ChatInputMode>(ChatInputMode.FormatResponse);

  const {
    chatId,
  } = useChatContext();

  const getMessageResponseFormat = useCallback((id: number) => {
    return messagesResponseFormat.current.get(id);
  }, []);

  const setResponseFormatWithId = useCallback((id: number, responseFormat: ResponseFormat) => {
    messagesResponseFormat.current.set(id, responseFormat);
  }, []);

  useEffect(() => {
    return () => {
      setResponseFormat({
        output_layout: OutputLayout.BulletList,
        output_content: OutputContent.TEXT,
      });
      setResponseMode(ChatInputMode.FormatResponse);
    };
  }, [chatId]);
  const contextValue = useMemo(
    () => ({
      responseMode,
      responseFormat,
      setResponseFormat,
      setResponseMode,
      getMessageResponseFormat,
      setResponseFormatWithId,
    }),
    [
      responseMode,
      responseFormat,
      getMessageResponseFormat,
      setResponseFormatWithId,
    ]
  );

  return (
    <ResponseFormatContext.Provider value={contextValue}>
      {children}
    </ResponseFormatContext.Provider>
  );
};
