import { PromptDatabaseConfiguration } from '@/components/chat/provider/prompt-modal-provider';
import { ChatRequest } from '@/components/chat/request/chat-request';

import { RawPromptData, PromptDatabaseField } from './prompt';
import { User } from './request';

export * from './ai-model';
export * from './checkbox';
export * from './prompt';
export * from './request';
export * from './writer';
export * from '@/components/chat/request';
export * from '@/components/chat/writer';

export interface ChatProps {
  workspaceId: string;
  chatId: string;
  requestInstance: ChatRequest;
  currentUser?: User;
  openingViewId?: string;
  onOpenView?: (viewId: string) => void;
  onCloseView?: () => void;
  selectionMode?: boolean;
  onOpenSelectionMode?: () => void;
  onCloseSelectionMode?: () => void;
  loadDatabasePrompts?: (config: PromptDatabaseConfiguration) => Promise<{
    rawDatabasePrompts: RawPromptData[];
    fields: PromptDatabaseField[];
  }>;
  testDatabasePromptConfig?: (databaseViewId: string) => Promise<{
    config: PromptDatabaseConfiguration;
    fields: PromptDatabaseField[];
  }>;
}
