import EventEmitter from 'events';

import { createContext } from 'react';
import { Awareness } from 'y-protocols/awareness';

// Public context for sync/realtime state — MUTABLE change frequency
// Separated from AppOperationsContext so that awarenessMap changes
// don't cause all 30+ stable operation callbacks to recreate.
export interface AppSyncContextType {
  eventEmitter?: EventEmitter;
  awarenessMap?: Record<string, Awareness>;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
}

export const AppSyncContext = createContext<AppSyncContextType | null>(null);
