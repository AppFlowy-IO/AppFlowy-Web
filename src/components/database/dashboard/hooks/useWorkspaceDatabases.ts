import { useEffect, useState, useSyncExternalStore } from 'react';

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
  const [state, setState] = useState<WorkspaceDatabasesState>(() => ({
    databases: (workspaceId && enabled && getCachedWorkspaceDatabaseCatalog(workspaceId)) || EMPTY_DATABASES,
    loading: false,
    error: null,
  }));

  useEffect(() => {
    if (!enabled || !workspaceId) return;
    const cached = getCachedWorkspaceDatabaseCatalog(workspaceId);

    if (cached) {
      setState((current) =>
        current.databases === cached && !current.loading && !current.error
          ? current
          : { databases: cached, loading: false, error: null }
      );
      return;
    }

    let cancelled = false;

    setState((current) => ({ ...current, loading: true, error: null }));
    getWorkspaceDatabaseCatalog(workspaceId)
      .then((databases) => {
        if (!cancelled) setState({ databases, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        Log.warn('[Dashboard] failed to load the workspace database catalog', error);
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, revision, workspaceId]);

  return state;
}
