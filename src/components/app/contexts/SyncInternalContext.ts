import EventEmitter from 'events';

import { createContext, useContext } from 'react';
import { Awareness } from 'y-protocols/awareness';

import { YDoc, Types } from '@/application/types';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { AppflowyWebSocketType } from '@/components/ws/useAppflowyWebSocket';
import { BroadcastChannelType } from '@/components/ws/useBroadcastChannel';
import { UpdateCollabInfo } from '@/components/ws/useSync';

// Internal context for synchronization layer
// This context is only used within the app provider layers
export interface SyncInternalContextType {
  webSocket: AppflowyWebSocketType; // WebSocket connection from useAppflowyWebSocket
  broadcastChannel: BroadcastChannelType; // BroadcastChannel from useBroadcastChannel
  registerSyncContext: (params: {
    doc: YDoc;
    collabType: Types;
    awareness?: Awareness;
  }) => SyncContext;
  eventEmitter: EventEmitter;
  awarenessMap: Record<string, Awareness>;
  lastUpdatedCollab: UpdateCollabInfo | null;
  /**
   * Flush all pending updates for all registered sync contexts.
   * This ensures all local changes are sent to the server before operations like duplicate.
   */
  flushAllSync: () => void;
  /**
   * Sync all registered collab documents to the server via HTTP API.
   * This is similar to desktop's collab_full_sync_batch - it sends the full doc state
   * to ensure the server has the latest data before operations like duplicate.
   */
  syncAllToServer: (workspaceId: string) => Promise<void>;
}

export const SyncInternalContext = createContext<SyncInternalContextType | null>(null);

// Hook to access sync internal context
export function useSyncInternal() {
  const context = useContext(SyncInternalContext);
  
  if (!context) {
    throw new Error('useSyncInternal must be used within a SyncInternalProvider');
  }
  
  return context;
}