import { EditorData } from '@appflowyinc/editor';
import { createContext, useContext } from 'react';

import { AIAssistantType, ChatInputMode, ResponseFormat, View } from '@/components/chat/types';

export enum ApplyingState {
  idle = 'idle',
  analyzing = 'analyzing',
  applying = 'applying',
  completed = 'completed',
  failed = 'failed',
}

export interface WriterContextTypes {
  // generate a new answer markdown string
  placeholderContent?: string;
  // comment for the answer
  comment?: string;
  // generating a new answer
  isFetching: boolean;
  isApplying: boolean;
  assistantType?: AIAssistantType;
  improveWriting: (content: string) => Promise<() => void>;
  askAIAnything: (content: string) => void;
  continueWriting: (content: string) => Promise<() => void>;
  explain: (content: string) => Promise<() => void>;
  fixSpelling: (content: string) => Promise<() => void>;
  makeLonger: (content: string) => Promise<() => void>;
  makeShorter: (content: string) => Promise<() => void>;
  askAIAnythingWithRequest: (content: string) => Promise<() => void>;
  setOpenDiscard: (open: boolean) => void;
  applyingState: ApplyingState;
  viewId: string;
  setRagIds: (ragIds: string[]) => void;
  fetchViews: () => Promise<View>;
  exit: () => void;
  setEditorData: (data: EditorData) => void;
  keep: () => void;
  accept: () => void;
  rewrite: () => void;
  stop: () => void;
  responseMode: ChatInputMode;
  setResponseMode: (mode: ChatInputMode) => void;
  responseFormat: ResponseFormat;
  setResponseFormat: (format: ResponseFormat) => void;
  hasAIAnswer: () => boolean;
  isGlobalDocument?: boolean;
  error: {
    code: number;
    message: string;
  } | null;
  scrollContainer?: HTMLElement;
  // Model selection for AI writer
  selectedModelName?: string;
  setSelectedModelName?: (modelName: string) => void;
}

export const WriterContext = createContext<WriterContextTypes | undefined>(undefined);

export function useWriterContext() {
  const context = useContext(WriterContext);

  if(!context) {
    throw new Error('useWriterContext must be used within a WriterProvider');
  }

  return context;
}