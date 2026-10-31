import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const snapshot = () => typeof navigator === 'undefined' || navigator.onLine;

/** A menu hint only: every owned creation still checks again and awaits server admission. */
export function useDashboardCreationOnline(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
