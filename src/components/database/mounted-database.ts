import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import type { DatabaseContextState } from '@/application/database-yjs/context';
import { captureTokenSession, isTokenSessionCurrent } from '@/application/session/token';
import { UIVariant } from '@/application/types';

interface MountedDatabase {
  context: DatabaseContextState;
  name: string;
  session: ReturnType<typeof captureTokenSession>;
}
const mounted = new Map<string, Map<symbol, MountedDatabase>>();
const listeners = new Map<string, Set<() => void>>();
const identity = (workspace: string, view: string) => JSON.stringify([workspace, view]);
const notify = (key: string) => listeners.get(key)?.forEach((listener) => listener());

/** Share only a mounted authenticated view's live resources, never a detached snapshot or history. */
export function usePublishMountedDatabase(context: DatabaseContextState, name: string, share = true) {
  const owner = useRef(Symbol('mounted-database'));
  const session = useRef(captureTokenSession());
  const key = identity(context.workspaceId, context.activeViewId);
  const enabled = share && context.variant === UIVariant.App && !context.isDatabaseRowPage && !context.dataSource;

  useLayoutEffect(() => {
    if (!enabled) return;
    const token = owner.current;

    return () => {
      const entries = mounted.get(key);

      entries?.delete(token);
      if (!entries?.size) mounted.delete(key);
      notify(key);
    };
  }, [key, enabled]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const entries = mounted.get(key) ?? new Map<symbol, MountedDatabase>();

    entries.set(owner.current, { context, name, session: session.current });
    mounted.set(key, entries);
    notify(key);
  }, [key, enabled, context, name]);
}

/** Callers must independently confirm current read permission before consuming these resources. */
export function useMountedDatabase(workspace: string, view: string, databaseId?: string) {
  const key = identity(workspace, view);
  const subscribe = useCallback(
    (listener: () => void) => {
      const subscribers = listeners.get(key) ?? new Set<() => void>();

      subscribers.add(listener);
      listeners.set(key, subscribers);
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) listeners.delete(key);
      };
    },
    [key]
  );
  const snapshot = useCallback(() => {
    const entries = mounted.get(key);

    if (!entries) return undefined;
    return Array.from(entries.values()).find(
      ({ context, session }) =>
        isTokenSessionCurrent(session) &&
        (!databaseId || (context.databaseDoc.object_id ?? context.databaseDoc.guid) === databaseId)
    );
  }, [key, databaseId]);

  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}
