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

  // Optional: false when the server reported that no image model is configured
  imageGenerationAvailable?: boolean;
}

export const ModelSelectorContext = createContext<ModelSelectorContextType | undefined>(undefined);

export function useModelSelectorContext() {
  const context = useContext(ModelSelectorContext);

  return context; // Return undefined if no provider
}

/**
 * Whether image answers can be requested. Older servers omit the flag and some
 * surfaces have no model selector, so the single default lives here.
 */
export function useImageGenerationAvailable(): boolean {
  return useModelSelectorContext()?.imageGenerationAvailable ?? true;
}
