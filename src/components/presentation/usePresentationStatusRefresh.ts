import { useCallback, useEffect, useRef } from 'react';

import { getPresentationStatus } from './presentation-client';

import type { PresentationStatus } from './server-contract';

/** Refresh only allowances: never reload the user's deck, draft, source, or settings. */
export function usePresentationStatusRefresh(workspaceId: string, userId: string, onStatus: (status: PresentationStatus) => void) {
  const identity = `${workspaceId}:${userId}`;
  const current = useRef(identity);
  const request = useRef<AbortController>();

  current.current = identity;
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();

    request.current = controller;
    try {
      const status = await getPresentationStatus({ workspaceId }, controller.signal);

      if (!controller.signal.aborted && current.current === identity) onStatus(status);
    } catch {
      // A failed availability read must not discard a successfully saved artifact or its draft.
      // Mutations continue to use server admission; a later refresh can recover the display.
    }
  }, [workspaceId, identity, onStatus]);

  useEffect(() => {
    const onFocus = () => { void refresh(); };

    window.addEventListener('focus', onFocus);
    return () => {
      request.current?.abort();
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return refresh;
}
