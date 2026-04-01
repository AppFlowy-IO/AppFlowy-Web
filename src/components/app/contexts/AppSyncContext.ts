import { createContext } from 'react';
import { Awareness } from 'y-protocols/awareness';

/**
 * Sync / realtime state context.
 *
 * **Provider:** `AppBusinessLayer` (reads internal sync state from `AppSyncLayer`)
 *
 * **Change frequency:** HIGH — `awarenessMap` updates on every cursor movement
 * from any collaborator. Separated from `AppOperationsContext` so that
 * awareness changes don't cause the 30+ stable operation callbacks to
 * appear to change and trigger re-renders in unrelated consumers.
 *
 * **Hooks:**
 * - `useScheduleDeferredCleanup()` — schedule cleanup for a sync object
 * - `useAppAwareness(viewId)` — per-view collaborator awareness (optional, no throw)
 * - `useAppSyncContext()` — the full sync context
 */
export interface AppSyncContextType {
  /** Map of view ID → Yjs Awareness instance, tracking collaborator cursors and presence. */
  awarenessMap?: Record<string, Awareness>;
  /** Schedule deferred cleanup of a sync object (e.g. Yjs doc) after a delay. */
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
}

export const AppSyncContext = createContext<AppSyncContextType | null>(null);
