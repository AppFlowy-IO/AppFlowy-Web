import { useSyncExternalStore } from 'react';

// One timer for all visible formula cells, previews, footers and conditions.
// Seconds match the precision of stored dates and timestamp().
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
const snapshot = () => Math.floor(Date.now() / 1000);
const disabledSnapshot = () => 0;
const disabledSubscribe = () => () => undefined;

function tick() {
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  if (listeners.size === 1) {
    timer = setInterval(tick, 1000);
    // Browsers throttle background timers. Refresh immediately on return.
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
  }

  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    }
  };
}

export function useFormulaClock(enabled = false): number {
  return useSyncExternalStore(
    enabled ? subscribe : disabledSubscribe,
    enabled ? snapshot : disabledSnapshot,
    disabledSnapshot
  );
}
