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