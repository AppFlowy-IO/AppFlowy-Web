import { useEffect, useMemo, useRef, useState } from 'react';

import { Log } from '@/utils/log';

type LeadershipStatus = 'waiting' | 'leader' | 'fallback';

interface LeadershipState {
  lockName: string;
  status: LeadershipStatus;
}

export interface WorkspaceWebSocketLeadership {
  /** Whether this tab owns the workspace WebSocket. */
  isLeader: boolean;
  /** Whether Web Locks are enforcing single-tab ownership. */
  isCoordinated: boolean;
}

const lockManager = (): LockManager | null => {
  if (typeof navigator === 'undefined') return null;

  return navigator.locks ?? null;
};

/**
 * Elects one browser tab to own the WebSocket for a workspace.
 *
 * The lock is held for the lifetime of the mounted workspace layer. Waiting
 * tabs automatically take over when the owner closes or switches workspace.
 * If Web Locks are unavailable (or fail), each tab keeps its own socket so
 * realtime sync remains available instead of failing closed.
 */
export function useWorkspaceWebSocketLeader(workspaceId: string): WorkspaceWebSocketLeadership {
  const lockName = useMemo(() => `appflowy:websocket:${workspaceId}`, [workspaceId]);
  const [state, setState] = useState<LeadershipState>(() => ({
    lockName,
    status: lockManager() ? 'waiting' : 'fallback',
  }));
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    const locks = lockManager();
    const generation = ++requestGenerationRef.current;

    if (!locks) {
      setState({ lockName, status: 'fallback' });
      return;
    }

    setState({ lockName, status: 'waiting' });

    const abortController = new AbortController();
    let releaseLock: (() => void) | undefined;
    const lockLifetime = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    void locks
      .request(
        lockName,
        {
          mode: 'exclusive',
          signal: abortController.signal,
        },
        async (lock) => {
          if (!lock || requestGenerationRef.current !== generation) return;

          setState({ lockName, status: 'leader' });
          await lockLifetime;
        }
      )
      .catch((error: unknown) => {
        if (abortController.signal.aborted || requestGenerationRef.current !== generation) return;

        Log.warn('WebSocket leader election failed; falling back to a socket per tab', {
          workspaceId,
          error,
        });
        setState({ lockName, status: 'fallback' });
      });

    return () => {
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
      }

      abortController.abort();
      releaseLock?.();
    };
  }, [lockName, workspaceId]);

  const status = state.lockName === lockName ? state.status : lockManager() ? 'waiting' : 'fallback';

  return {
    isLeader: status === 'leader' || status === 'fallback',
    isCoordinated: status !== 'fallback',
  };
}
