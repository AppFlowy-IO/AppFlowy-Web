import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  getCachedWorkspaceDatabaseCatalog,
  getWorkspaceDatabaseCatalog,
  getWorkspaceDatabaseCatalogRevision,
  subscribeWorkspaceDatabaseCatalog,
} from '@/application/services/domains/view';
import { WorkspaceDatabaseWithViews } from '@/application/services/services.type';
import { Log } from '@/utils/log';

const EMPTY_DATABASES: WorkspaceDatabaseWithViews[] = [];
const SERVER_REVISION = 'server';
const IDLE = { loading: false, error: null as string | null };

export interface WorkspaceDatabasesState {
  databases: WorkspaceDatabaseWithViews[];
  loading: boolean;
  error: string | null;
}

/**
 * The shared workspace database catalog (every database with its views).
 * Reuses the in-memory snapshot other pickers load, and reloads when the
 * catalog is invalidated. Disabled callers never hit the network.
 */
export function useWorkspaceDatabases(workspaceId: string | undefined, enabled: boolean): WorkspaceDatabasesState {
  const revision = useSyncExternalStore(
    subscribeWorkspaceDatabaseCatalog,
    () => (workspaceId ? getWorkspaceDatabaseCatalogRevision(workspaceId) : ''),
    () => SERVER_REVISION
  );
  // The catalog hands out one array object per snapshot, so it is read from
  // the store rather than copied into state after the fact.
  const cached = useSyncExternalStore(
    subscribeWorkspaceDatabaseCatalog,
    () => (enabled && workspaceId ? getCachedWorkspaceDatabaseCatalog(workspaceId) ?? null : null),
    () => null
  );
  const [status, setStatus] = useState(IDLE);

  useEffect(() => {
    if (!enabled || !workspaceId) return;

    if (getCachedWorkspaceDatabaseCatalog(workspaceId)) {
      setStatus((current) => (current.loading || current.error ? IDLE : current));
      return;
    }

    let cancelled = false;

    setStatus({ loading: true, error: null });
    getWorkspaceDatabaseCatalog(workspaceId)
      .then(() => {
        if (!cancelled) setStatus(IDLE);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        Log.warn('[Dashboard] failed to load the workspace database catalog', error);
        setStatus({ loading: false, error: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, revision, workspaceId]);

  return useMemo(
    () => ({ databases: cached ?? EMPTY_DATABASES, loading: status.loading, error: status.error }),
    [cached, status]
  );
}
