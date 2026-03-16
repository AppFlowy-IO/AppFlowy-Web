import { createContext, useContext } from 'react';

import { AvailableModel } from '@/components/chat/types/ai-model';

export interface ModelSelectorContextType {
  // Current selected model
  selectedModelName?: string;
  setSelectedModelName?: (modelName: string, explicit?: boolean) => void;
  
  // Required: for both chat and writer contexts - server capabilities  
  requestInstance: {
    getModelList: () => Promise<{ models: AvailableModel[] }>;
    getCurrentModel?: () => Promise<string>;
    setCurrentModel?: (modelName: string) => Promise<void>;
  };
  
  // Optional: for chat context - identification for settings persistence
  chatId?: string;
}

export const ModelSelectorContext = createContext<ModelSelectorContextType | undefined>(undefined);

export function useModelSelectorContext() {
  const context = useContext(ModelSelectorContext);

  return context; // Return undefined if no provider
}