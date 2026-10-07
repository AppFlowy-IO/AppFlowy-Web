import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { DashboardPrivateState, encodeDashboardPrivatePayload } from '@/application/database-yjs/dashboard-private';

import { readPrivatePayload, subscribePrivatePayloadRemoval, writePrivatePayload } from './private-storage';

/** Writes wait this long after the last private change (trailing). */
export const PRIVATE_PERSIST_DEBOUNCE_MS = 300;

/**
 * This device's stored private state for `storageKey`, read synchronously
 * once per key (so widgets restore on their first render). `null` without a
 * key (published view, anonymous viewer) or when nothing is stored.
 */
export function usePrivatePayload(storageKey: string | null): DashboardPrivateState | null {
  const [loaded, setLoaded] = useState(() => ({
    key: storageKey,
    payload: storageKey ? readPrivatePayload(storageKey) : null,
  }));

  if (loaded.key === storageKey) return loaded.payload;
  const next = { key: storageKey, payload: storageKey ? readPrivatePayload(storageKey) : null };

  setLoaded(next);
  return next.payload;
}

export interface PrivatePersistenceOptions {
  /** `null`: nothing is persisted. */
  storageKey: string | null;
  /** The private state to store, read when a write happens. */
  collect: () => DashboardPrivateState;
  /** Commit draft inputs before collecting the final state on navigation or pagehide. */
  flushInputs: () => void;
  /** Change notifications (private widget edits); value changes call `schedule`. */
  subscribe: (listener: () => void) => () => void;
}

export interface PrivatePersistence {
  /** Write after the debounce. */
  schedule: () => void;
  /**
   * Write now (Reset, Save). `override` replaces parts of what `collect`
   * returns, for state set in the same event that has not rendered yet.
   */
  flush: (override?: Partial<DashboardPrivateState>) => void;
}

/**
 * Persists the private state of one dashboard on this device: a 300ms
 * trailing write after each change, an immediate write on Reset and Save,
 * and a final write when the key changes (another dashboard), on unmount and
 * on `pagehide`. The key is removed once nothing private is left. Two tabs of
 * one dashboard overwrite each other (last writer wins).
 */
export function usePrivatePersistence({
  storageKey,
  collect,
  flushInputs,
  subscribe,
}: PrivatePersistenceOptions): PrivatePersistence {
  // The key and collector of the last commit: a write for a key that is being
  // left still reads that dashboard's state (its overlays are released later).
  const liveRef = useRef({ key: storageKey, collect, flushInputs });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revokedRef = useRef(false);

  useLayoutEffect(() => {
    liveRef.current = { key: storageKey, collect, flushInputs };
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(
    (override?: Partial<DashboardPrivateState>) => {
      clearTimer();
      const { key, collect: read } = liveRef.current;

      if (!key || revokedRef.current) return;
      writePrivatePayload(key, encodeDashboardPrivatePayload({ ...read(), ...override }, Date.now()));
    },
    [clearTimer]
  );

  const schedule = useCallback(() => {
    if (!liveRef.current.key || revokedRef.current) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, PRIVATE_PERSIST_DEBOUNCE_MS);
  }, [clearTimer, flush]);

  useEffect(() => subscribe(schedule), [schedule, subscribe]);

  useLayoutEffect(() => {
    revokedRef.current = false;
    if (!storageKey) return;
    return subscribePrivatePayloadRemoval(storageKey, () => {
      revokedRef.current = true;
      clearTimer();
    });
  }, [clearTimer, storageKey]);

  // A pending write lands before the key changes or the dashboard unmounts.
  // A layout cleanup runs before the overlays are released (a passive effect).
  useLayoutEffect(
    () => () => {
      liveRef.current.flushInputs();
      // An input can have committed during its own layout cleanup without a
      // render to schedule persistence. Always collect the final live values.
      flush();
    },
    [flush, storageKey]
  );

  useEffect(() => {
    const onPageHide = () => {
      liveRef.current.flushInputs();
      flush();
    };

    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [flush]);

  return { schedule, flush };
}
