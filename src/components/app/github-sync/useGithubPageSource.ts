import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

import { getPageSource, GithubPageSource } from '@/application/services/domains/github-sync';
import { AFConfigContext } from '@/components/main/app.hooks';

interface PageSourceState {
  source: GithubPageSource | null;
  loading: boolean;
  error: boolean;
  /** Keep editing disabled until source ownership has been checked. */
  readOnly: boolean;
}

interface Entry {
  state: PageSourceState;
  listeners: Set<() => void>;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

const EMPTY: PageSourceState = { source: null, loading: false, error: false, readOnly: false };
const PENDING: PageSourceState = { source: null, loading: true, error: false, readOnly: true };
const entries = new Map<string, Entry>();
const NO_AUTH_CONTEXT = createContext<React.ContextType<typeof AFConfigContext>>(undefined);
const REFRESH_MS = 30_000;

/** Scope active reads by account, workspace and view. There is no persistent metadata cache. */
export function useGithubPageSource(workspaceId?: string, viewId?: string, enabled = true) {
  const auth = useContext(AFConfigContext || NO_AUTH_CONTEXT);
  const accountId = auth?.isAuthenticated
    ? auth.authenticatedUserId ?? auth.currentUser?.uuid ?? auth.currentUser?.uid
    : undefined;
  const key = enabled && accountId && workspaceId && viewId ? JSON.stringify([accountId, workspaceId, viewId]) : '';
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key || !workspaceId || !viewId) return () => undefined;
      let entry = entries.get(key);

      if (!entry) {
        entry = { state: PENDING, listeners: new Set() };
        entries.set(key, entry);
      }

      entry.listeners.add(listener);
      if (!entry.controller && !entry.timer) refresh(key, entry, workspaceId, viewId);

      return () => {
        entry?.listeners.delete(listener);
        if (entry && entry.listeners.size === 0) {
          entry.controller?.abort();
          if (entry.timer) clearTimeout(entry.timer);
          entries.delete(key);
        }
      };
    },
    [key, workspaceId, viewId]
  );
  const snapshot = useCallback(() => (key ? entries.get(key)?.state ?? PENDING : EMPTY), [key]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  return { ...state, managed: Boolean(state.source) };
}

function refresh(key: string, entry: Entry, workspaceId: string, viewId: string) {
  const controller = new AbortController();

  entry.controller = controller;
  entry.timer = undefined;
  void getPageSource(workspaceId, viewId, controller.signal)
    .then((source) => {
      if (controller.signal.aborted || entries.get(key) !== entry) return;
      // Ownership cannot be released through this API. A transient/inconsistent null must not
      // turn an already managed document editable while it remains mounted.
      const retainedSource = source ?? entry.state.source;

      entry.state = { source: retainedSource, loading: false, error: false, readOnly: Boolean(retainedSource) };
    })
    .catch((error: { httpStatus?: number } | null) => {
      if (controller.signal.aborted || entries.get(key) !== entry) return;
      // Only a missing route on an older server can fall back to canonical permissions.
      // An unavailable ownership check must not unlock a page using cached write access.
      entry.state = {
        ...entry.state,
        loading: false,
        error: true,
        readOnly: Boolean(entry.state.source) || error?.httpStatus !== 404,
      };
    })
    .finally(() => {
      if (controller.signal.aborted || entries.get(key) !== entry) return;
      entry.controller = undefined;
      entry.listeners.forEach((listener) => listener());
      entry.timer = setTimeout(() => refresh(key, entry, workspaceId, viewId), REFRESH_MS);
    });
}
