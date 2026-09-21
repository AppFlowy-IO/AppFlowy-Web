import { useCallback, useEffect, useRef, useState } from 'react';

import { IntegrationOAuthError } from '@/application/integrations/oauth';

/** Serializes UI mutations, including OAuth popup lifetime and stale response rejection. */
export function useSyncAction() {
  const active = useRef<AbortController>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  useEffect(() => () => active.current?.abort(), []);

  const run = useCallback(async <T>(operation: (signal: AbortSignal) => Promise<T>, accept: (result: T) => void) => {
    if (active.current && !active.current.signal.aborted) return;
    const controller = new AbortController();

    active.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const result = await operation(controller.signal);

      if (!controller.signal.aborted) accept(result);
    } catch (failure) {
      if (!controller.signal.aborted && !(failure instanceof IntegrationOAuthError && failure.code === 'cancelled')) {
        setError(failure);
      }
    } finally {
      if (!controller.signal.aborted) {
        active.current = undefined;
        setBusy(false);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = undefined;
    setBusy(false);
    setError(undefined);
  }, []);

  return { run, busy, error, cancel };
}
