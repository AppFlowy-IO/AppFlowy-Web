import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useChatContext } from '@/components/chat/chat/context';
import { buildResponseFormat, DEFAULT_IMAGE_OPTIONS, ImageOptions, inferResponseFormatFromContent, isImageContent } from '@/components/chat/lib/image-format';
import { ChatInputMode, OutputContent, OutputLayout, ResponseFormat } from '@/components/chat/types';

interface ResponseFormatContextTypes {
  /** Layout and content type chosen in the input. The layout only applies in FormatResponse mode. */
  responseFormat: ResponseFormat;
  responseMode: ChatInputMode;
  imageOptions: ImageOptions;
  setResponseFormat: (responseFormat: ResponseFormat) => void;
  setResponseMode: (responseMode: ChatInputMode) => void;
  setOutputContent: (content: OutputContent) => void;
  setImageOptions: (options: Partial<ImageOptions>) => void;
  /** The format to send with the next question, derived from the current input state. */
  buildRequestFormat: () => ResponseFormat;
  /**
   * Clears a one-shot image request after it was sent. The server cannot continue an
   * image conversation yet, so leaving image mode on would turn the next follow-up
   * question into another picture.
   */
  resetImageIntent: () => void;
  getMessageResponseFormat: (id: number) => ResponseFormat | undefined;
  setResponseFormatWithId: (id: number, responseFormat: ResponseFormat) => void;
  /**
   * The format an existing answer was produced with: remembered for answers
   * streamed in this session, inferred from `content` for answers loaded from
   * history, and the automatic text format otherwise. Regenerating and editing
   * use it so an image answer stays an image answer whatever the input shows.
   */
  resolveAnswerFormat: (answerId: number, content?: string) => ResponseFormat;
}

export const ResponseFormatContext = createContext<ResponseFormatContextTypes | undefined>(undefined);

export function useResponseFormatContext() {
  const context = useContext(ResponseFormatContext);

  if (!context) {
    throw new Error('useResponseFormatContext must be used within a ResponseFormatProvider');
  }

  return context;
}

const DEFAULT_RESPONSE_FORMAT: ResponseFormat = {
  output_layout: OutputLayout.Paragraph,
  output_content: OutputContent.TEXT,
};

/** What Auto mode sends: the model chooses the layout of a text answer. */
const AUTO_REQUEST_FORMAT: ResponseFormat = {
  output_layout: OutputLayout.Flex,
  output_content: OutputContent.TEXT,
};

export const ResponseFormatProvider = ({ children }: { children: ReactNode }) => {
  const [responseFormat, setResponseFormat] = useState<ResponseFormat>(DEFAULT_RESPONSE_FORMAT);
  const [imageOptions, setImageOptionsState] = useState<ImageOptions>(DEFAULT_IMAGE_OPTIONS);
  const messagesResponseFormat = useRef<Map<number, ResponseFormat>>(new Map());
  // Auto by default: answers come back in natural prose and the model picks the layout.
  const [responseMode, setResponseMode] = useState<ChatInputMode>(ChatInputMode.Auto);

  const { chatId } = useChatContext();

  const getMessageResponseFormat = useCallback((id: number) => {
    return messagesResponseFormat.current.get(id);
  }, []);

  const setResponseFormatWithId = useCallback((id: number, responseFormat: ResponseFormat) => {
    messagesResponseFormat.current.set(id, responseFormat);
  }, []);

  const resolveAnswerFormat = useCallback(
    (answerId: number, content?: string): ResponseFormat =>
      messagesResponseFormat.current.get(answerId) ??
      (content ? inferResponseFormatFromContent(content) : undefined) ??
      AUTO_REQUEST_FORMAT,
    []
  );

  const setOutputContent = useCallback((content: OutputContent) => {
    setResponseFormat((current) => ({ ...current, output_content: content }));
  }, []);

  const setImageOptions = useCallback((options: Partial<ImageOptions>) => {
    setImageOptionsState((current) => ({ ...current, ...options }));
  }, []);

  const buildRequestFormat = useCallback(
    () =>
      buildResponseFormat({
        formatMode: responseMode === ChatInputMode.FormatResponse,
        layout: responseFormat.output_layout,
        content: responseFormat.output_content,
        imageOptions,
      }),
    [responseMode, responseFormat, imageOptions]
  );

  const resetImageIntent = useCallback(() => {
    setResponseFormat((current) =>
      isImageContent(current.output_content) ? { ...current, output_content: OutputContent.TEXT } : current
    );
    setImageOptionsState((current) => (current.customImagePrompt ? { ...current, customImagePrompt: '' } : current));
  }, []);

  useEffect(() => {
    return () => {
      setResponseFormat(DEFAULT_RESPONSE_FORMAT);
      setImageOptionsState(DEFAULT_IMAGE_OPTIONS);
      setResponseMode(ChatInputMode.Auto);
      messagesResponseFormat.current = new Map();
    };
  }, [chatId]);

  const contextValue = useMemo(
    () => ({
      responseMode,
      responseFormat,
      imageOptions,
      setResponseFormat,
      setResponseMode,
      setOutputContent,
      setImageOptions,
      buildRequestFormat,
      resetImageIntent,
      getMessageResponseFormat,
      setResponseFormatWithId,
      resolveAnswerFormat,
    }),
    [
      responseMode,
      responseFormat,
      imageOptions,
      setOutputContent,
      setImageOptions,
      buildRequestFormat,
      resetImageIntent,
      getMessageResponseFormat,
      setResponseFormatWithId,
      resolveAnswerFormat,
    ]
  );

  return <ResponseFormatContext.Provider value={contextValue}>{children}</ResponseFormatContext.Provider>;
};
