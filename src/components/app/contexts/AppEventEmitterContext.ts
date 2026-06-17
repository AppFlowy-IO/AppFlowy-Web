import EventEmitter from 'events';

import { createContext } from 'react';

export type AppEventEmitter = EventEmitter & {
  webSocketReadyState?: number;
};

/**
 * Stable app-wide event bus context.
 *
 * Separated from `AppSyncContext` so consumers that only need the event emitter
 * do not re-render on high-frequency awareness updates.
 */
export const AppEventEmitterContext = createContext<AppEventEmitter | null>(null);
