import {
  DashboardPrivatePayload,
  DashboardPrivateState,
  decodeDashboardPrivatePayload,
  isDashboardPrivateKeyOfUser,
} from '@/application/database-yjs/dashboard-private';
import { Log } from '@/utils/log';

const removalListeners = new Map<string, Set<() => void>>();

/** Active writers stop before sign-out removes their user's saved state. */
export function subscribePrivatePayloadRemoval(key: string, listener: () => void): () => void {
  const listeners = removalListeners.get(key) ?? new Set<() => void>();

  removalListeners.set(key, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) removalListeners.delete(key);
  };
}

/**
 * Device-local storage of a viewer's private dashboard state (WP07 §3.1).
 * Every call is guarded: storage can be missing, full or blocked (private
 * windows, embedded frames), and losing private state is never an error.
 */

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored private state, or `null`. A value that cannot be read (bad JSON, another version) is removed. */
export function readPrivatePayload(key: string): DashboardPrivateState | null {
  const store = storage();

  if (!store) return null;

  try {
    const raw = store.getItem(key);

    if (raw === null) return null;
    const decoded = decodeDashboardPrivatePayload(raw);

    if (!decoded) store.removeItem(key);
    return decoded;
  } catch (error) {
    Log.warn('[Dashboard] private state could not be read', error);
    return null;
  }
}

/** Store the payload, or remove the key for `null` (nothing private left). */
export function writePrivatePayload(key: string, payload: DashboardPrivatePayload | null) {
  const store = storage();

  if (!store) return;

  try {
    if (payload) store.setItem(key, JSON.stringify(payload));
    else store.removeItem(key);
  } catch (error) {
    Log.warn('[Dashboard] private state could not be saved', error);
  }
}

/** Remove every dashboard's private state of `userId` on this device (sign-out on a shared device). */
export function removePrivatePayloadsForUser(userId: string | number | null | undefined) {
  if (userId === null || userId === undefined || userId === '') return;

  removalListeners.forEach((listeners, key) => {
    if (isDashboardPrivateKeyOfUser(key, userId)) listeners.forEach((listener) => listener());
  });
  const store = storage();

  if (!store) return;

  try {
    const keys: string[] = [];

    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);

      if (key && isDashboardPrivateKeyOfUser(key, userId)) keys.push(key);
    }

    keys.forEach((key) => store.removeItem(key));
  } catch (error) {
    Log.warn('[Dashboard] private state could not be removed', error);
  }
}
