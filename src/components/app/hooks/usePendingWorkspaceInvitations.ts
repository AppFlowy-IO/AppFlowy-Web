import { useCallback, useEffect, useRef, useState } from 'react';

import { listPendingWorkspaceInvitations } from '@/application/services/js-services/http/workspace-api';
import { Invitation } from '@/application/types';
import { isUnsupportedRouteError } from '@/utils/errors';
import { Log } from '@/utils/log';

const REVALIDATE_MIN_AGE_MS = 30_000;

/**
 * Invitations the signed-in account can accept without opening the link. Joining needs no
 * permission to create workspaces. A failed refresh keeps the last list.
 */
export function usePendingWorkspaceInvitations() {
  const [state, setState] = useState<{ items: Invitation[]; status: 'loading' | 'ready' | 'error' }>({
    items: [],
    status: 'loading',
  });
  const sequence = useRef(0);
  const mounted = useRef(true);
  const loadedAt = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;

    try {
      const items = await listPendingWorkspaceInvitations();

      if (mounted.current && request === sequence.current) {
        loadedAt.current = Date.now();
        setState({ items, status: 'ready' });
      }

      return true;
    } catch (error) {
      if (!mounted.current || request !== sequence.current) return false;
      // A server without this route has no invitations to list; that is not a failure.
      if (isUnsupportedRouteError(error)) {
        setState({ items: [], status: 'ready' });
        return true;
      }

      Log.warn('[NoWorkspace] Failed to load pending invitations', error);
      setState((previous) => ({ items: previous.items, status: 'error' }));
      return false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const revalidate = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - loadedAt.current < REVALIDATE_MIN_AGE_MS) return;
      void refresh();
    };

    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      mounted.current = false;
      sequence.current += 1;
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [refresh]);

  return { ...state, refresh };
}
