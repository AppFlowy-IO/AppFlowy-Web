import { useCallback, useSyncExternalStore } from 'react';

const PUBLISH_COMMENTS_STORAGE_PREFIX = 'appflowy:publish-comments:v2:';
const LEGACY_PUBLISH_COMMENTS_SESSION_PREFIX = 'appflowy:publish-comments:v1:';

// This store is a same-browser cache and invalidation signal. Published-info
// responses remain authoritative; durable cross-browser state belongs on the
// backend. See doc/PUBLISH_COMMENTS_STATE.md.

type Listener = () => void;

const values = new Map<string, boolean | undefined>();
const listenersByViewId = new Map<string, Set<Listener>>();
const getServerSnapshot = () => undefined;

let listeningWindow: Window | null = null;

function getStorageKey(viewId: string) {
  return `${PUBLISH_COMMENTS_STORAGE_PREFIX}${viewId}`;
}

function parseStoredValue(value: string | null): boolean | undefined {
  if (value === '1') return true;
  if (value === '0') return false;
  return undefined;
}

function notifyView(viewId: string) {
  listenersByViewId.get(viewId)?.forEach((listener) => listener());
}

function handleStorageChange(event: StorageEvent) {
  if (event.storageArea && event.storageArea !== window.localStorage) return;

  if (event.key === null) {
    values.clear();
    listenersByViewId.forEach((_listeners, viewId) => notifyView(viewId));
    return;
  }

  if (!event.key.startsWith(PUBLISH_COMMENTS_STORAGE_PREFIX)) return;

  const viewId = event.key.slice(PUBLISH_COMMENTS_STORAGE_PREFIX.length);

  if (!viewId) return;
  values.set(viewId, parseStoredValue(event.newValue));
  notifyView(viewId);
}

function startListening() {
  if (typeof window === 'undefined' || listeningWindow === window) return;

  listeningWindow = window;
  listeningWindow.addEventListener('storage', handleStorageChange);
}

export function getCachedPublishCommentsEnabled(viewId: string): boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  startListening();
  if (values.has(viewId)) return values.get(viewId);

  let value: boolean | undefined;

  try {
    value = parseStoredValue(window.localStorage.getItem(getStorageKey(viewId)));
  } catch {
    // Fall back to the previous session value below when localStorage is unavailable.
  }

  // Migrate the session-only value written by the previous implementation.
  if (value === undefined) {
    const legacyKey = `${LEGACY_PUBLISH_COMMENTS_SESSION_PREFIX}${viewId}`;

    try {
      value = parseStoredValue(window.sessionStorage.getItem(legacyKey));

      if (value !== undefined) {
        try {
          window.localStorage.setItem(getStorageKey(viewId), value ? '1' : '0');
          window.sessionStorage.removeItem(legacyKey);
        } catch {
          // Continue using the migrated in-memory value when persistence fails.
        }
      }
    } catch {
      value = undefined;
    }
  }

  values.set(viewId, value);
  return value;
}

export function cachePublishCommentsEnabled(viewId: string, enabled: boolean) {
  const previousValue = getCachedPublishCommentsEnabled(viewId);

  values.set(viewId, enabled);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(getStorageKey(viewId), enabled ? '1' : '0');
    } catch {
      // Keep the in-memory value when persistent browser storage is unavailable.
    }
  }

  if (previousValue !== enabled) notifyView(viewId);
}

export function clearCachedPublishCommentsEnabled(viewId: string) {
  const previousValue = getCachedPublishCommentsEnabled(viewId);

  values.delete(viewId);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(getStorageKey(viewId));
      window.sessionStorage.removeItem(`${LEGACY_PUBLISH_COMMENTS_SESSION_PREFIX}${viewId}`);
    } catch {
      // Browser storage may be unavailable or disabled.
    }
  }

  if (previousValue !== undefined) notifyView(viewId);
}

export function subscribeToPublishCommentsEnabled(viewId: string, listener: Listener) {
  const listeners = listenersByViewId.get(viewId) ?? new Set<Listener>();

  if (!listenersByViewId.has(viewId)) listenersByViewId.set(viewId, listeners);
  listeners.add(listener);
  startListening();

  return () => {
    if (!listeners.delete(listener)) return;

    if (listeners.size === 0) listenersByViewId.delete(viewId);
  };
}

export function useCachedPublishCommentsEnabled(viewId: string): boolean | undefined {
  const subscribe = useCallback((listener: Listener) => subscribeToPublishCommentsEnabled(viewId, listener), [viewId]);
  const getSnapshot = useCallback(() => getCachedPublishCommentsEnabled(viewId), [viewId]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
