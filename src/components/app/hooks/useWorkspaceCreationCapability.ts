import { useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { APP_EVENTS } from '@/application/constants';
import {
  getWorkspaceCreationCapability,
  WorkspaceCreationCapability,
} from '@/application/services/js-services/http/workspace-creation-api';
import { EventType, on } from '@/application/session/event';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { useAuthenticatedUserIdOptional, useIsAuthenticatedOptional } from '@/components/main/app.hooks';
import { getConfigValue } from '@/utils/runtime-config';

type Snapshot = {
  status: 'loading' | 'ready' | 'error';
  capability?: WorkspaceCreationCapability;
  /** An explicit Check again is in flight. */
  checking: boolean;
};

/**
 * The answer for one account on one server, shared by every consumer mounted for it (the sidebar
 * switcher, Manage data, the importer, /import): a newly mounted one starts from it, and they read
 * together instead of each asking.
 */
type Entry = {
  snapshot: Snapshot;
  listeners: Set<() => void>;
  /** The newest read; an answer to an older one is dropped. */
  request: number;
  /** The read in flight. Background triggers join it instead of asking again. */
  read?: Promise<WorkspaceCreationCapability | undefined>;
  /** One read queued for the permission hints that arrived after `read` started, however many. */
  next?: Promise<WorkspaceCreationCapability | undefined>;
  /** When the newest read started. */
  startedAt: number;
  /** When the shown answer was confirmed; 0 once a hint or a failure leaves it uncertain. */
  confirmedAt: number;
  /** Revision of the shown answer. */
  revision?: bigint;
};

/** Focus and visibility only re-ask once the last attempt is this old, and a mount once the answer is. */
const REVALIDATE_MIN_AGE_MS = 30_000;
const WEBSOCKET_OPEN = 1;
const entries = new Map<string, Entry>();

function entryFor(key: string) {
  let entry = entries.get(key);

  if (!entry) {
    entry = {
      snapshot: { status: 'loading', checking: false },
      listeners: new Set(),
      request: 0,
      startedAt: 0,
      confirmedAt: 0,
    };
    entries.set(key, entry);
  }

  return entry;
}

function sameCapability(left?: WorkspaceCreationCapability, right?: WorkspaceCreationCapability) {
  return (
    left === right ||
    (left?.supported === right?.supported &&
      left?.mode === right?.mode &&
      left?.revision === right?.revision &&
      left?.can_create_workspace === right?.can_create_workspace &&
      left?.legacy === right?.legacy)
  );
}

function publish(entry: Entry, next: Snapshot) {
  const previous = entry.snapshot;

  // An unchanged answer keeps its snapshot, so the always-mounted switcher does not re-render.
  if (
    previous.status === next.status &&
    previous.checking === next.checking &&
    sameCapability(previous.capability, next.capability)
  ) {
    return;
  }

  entry.snapshot = next;
  entry.listeners.forEach((listener) => listener());
}

function isRecent(at: number) {
  return at > 0 && Date.now() - at < REVALIDATE_MIN_AGE_MS;
}

function read(key: string, entry: Entry, explicit: boolean) {
  const request = ++entry.request;
  const isLatest = () => entries.get(key) === entry && entry.request === request;
  let settled = false;

  // It starts after every hint seen so far, so a queued read has nothing left to answer.
  entry.next = undefined;
  entry.startedAt = Date.now();
  if (explicit) publish(entry, { ...entry.snapshot, checking: true });
  const promise = (async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const capability = await getWorkspaceCreationCapability();

      if (!isLatest()) return;
      const revision = BigInt(capability.revision);

      // A lagging replica may answer with an older policy revision; keep the newer answer. An
      // explicit check accepts it, so a server restored to an older revision cannot wedge this.
      if (!explicit && entry.revision !== undefined && revision < entry.revision) return capability;
      entry.revision = revision;
      entry.confirmedAt = Date.now();
      publish(entry, { status: 'ready', capability, checking: false });
      return capability;
    } catch {
      if (!isLatest()) return;
      const previous = entry.snapshot;

      entry.confirmedAt = 0;
      // Offline creation cannot succeed, and an explicit check must report its failure. Otherwise a
      // failed background read keeps the last confirmed answer; the server re-checks every request.
      publish(
        entry,
        !explicit && navigator.onLine && previous.status === 'ready'
          ? { ...previous, checking: false }
          : { status: 'error', checking: false }
      );
    } finally {
      settled = true;
      if (isLatest()) {
        entry.read = undefined;
        if (entry.snapshot.checking) publish(entry, { ...entry.snapshot, checking: false });
      }
    }
  })();

  // An offline read settles before it would ever be joined.
  if (!settled) entry.read = promise;
  return promise;
}

/**
 * A permission hint: a read that started before it can no longer answer, and one read follows it.
 * Every mounted consumer hears the same hint and hints come in bursts, so they share that one read.
 */
function invalidate(key: string, entry: Entry) {
  entry.confirmedAt = 0;
  if (entry.next) return;
  const running = entry.read;

  if (running) entry.request += 1;
  const next: Promise<WorkspaceCreationCapability | undefined> = (running ?? Promise.resolve()).then(() => {
    if (entry.next !== next) return entry.read;
    entry.next = undefined;
    // Nobody is left to show it, or the session ended: don't ask.
    if (entries.get(key) !== entry || entry.listeners.size === 0) {
      entry.read = undefined;
      publish(entry, { ...entry.snapshot, checking: false });
      return undefined;
    }

    return read(key, entry, false);
  });

  entry.next = next;
}

/** Forget every answer and drop the reads in flight, so a later sign-in starts from nothing. */
export function clearWorkspaceCreationCapabilityCache() {
  const cleared = [...entries.values()];

  entries.clear();
  // Mounted consumers re-render and move to a new entry for their scope.
  cleared.forEach((entry) => {
    entry.snapshot = { status: 'loading', checking: false };
    entry.listeners.forEach((listener) => listener());
  });
}

on(EventType.SESSION_INVALID, clearWorkspaceCreationCapabilityCache);

/**
 * Actor-local permission, usable on /import before any workspace is selected. The last confirmed
 * answer stays visible while it is rechecked; the final mutation helper re-admits regardless.
 * Consumers of the same account and server share that answer and its reads.
 */
export function useWorkspaceCreationCapability(enabled = true) {
  const userId = useAuthenticatedUserIdOptional();
  const authenticated = useIsAuthenticatedOptional();
  const eventEmitter = useContext(AppEventEmitterContext);
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const scope = useMemo(
    () => ({ userId, serverUrl, active: enabled && authenticated }),
    [userId, serverUrl, enabled, authenticated]
  );
  const scopeKey = `${serverUrl}:${userId ?? ''}`;
  const liveScope = useRef<object | null>(scope);
  // Looked up on every render: after sign-out clears the answers, this consumer gets a new entry.
  const entry = scope.active && userId ? entryFor(scopeKey) : undefined;
  const subscribe = useCallback(
    (listener: () => void) => {
      entry?.listeners.add(listener);
      return () => {
        entry?.listeners.delete(listener);
      };
    },
    [entry]
  );
  const getSnapshot = useCallback(() => entry?.snapshot, [entry]);
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  liveScope.current = scope;
  const isCurrent = useCallback(() => liveScope.current === scope, [scope]);
  const refresh = useCallback(
    () => (entry ? read(scopeKey, entry, true) : Promise.resolve(undefined)),
    [entry, scopeKey]
  );

  useEffect(() => {
    liveScope.current = scope;
    return () => {
      liveScope.current = null;
    };
  }, [scope]);
  useEffect(() => {
    if (!entry) return;
    // A newly mounted consumer already shows the shared answer: it joins a read in flight, and only
    // asks again once that answer is old or a hint made it uncertain.
    if (!entry.next && !entry.read && !isRecent(entry.confirmedAt)) void read(scopeKey, entry, false);
    const revalidate = () => {
      if (!entry.next && !entry.read) void read(scopeKey, entry, false);
    };

    // Returning to the tab fires both focus and visibilitychange; the first one's read covers both.
    const revalidateIfStale = () => {
      if (!isRecent(entry.startedAt)) revalidate();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidateIfStale();
    };

    const onSocket = (state: unknown) => {
      if (state === WEBSOCKET_OPEN) revalidate();
    };

    const onOffline = () => {
      void read(scopeKey, entry, false);
    };

    const onPermissionChanged = () => invalidate(scopeKey, entry);

    window.addEventListener('focus', revalidateIfStale);
    window.addEventListener('online', revalidate);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    eventEmitter?.on(APP_EVENTS.WEBSOCKET_STATUS, onSocket);
    eventEmitter?.on(APP_EVENTS.PERMISSION_CHANGED, onPermissionChanged);
    return () => {
      window.removeEventListener('focus', revalidateIfStale);
      window.removeEventListener('online', revalidate);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      eventEmitter?.off(APP_EVENTS.WEBSOCKET_STATUS, onSocket);
      eventEmitter?.off(APP_EVENTS.PERMISSION_CHANGED, onPermissionChanged);
    };
  }, [entry, scopeKey, eventEmitter]);

  return {
    status: current?.status ?? 'loading',
    canCreate: current?.status === 'ready' && current.capability?.can_create_workspace === true,
    /** An explicit Check again is in flight. */
    checking: current?.checking === true,
    refresh,
    isCurrent,
    scopeKey,
    capability: current?.capability,
  };
}

export type WorkspaceCreationCapabilityState = ReturnType<typeof useWorkspaceCreationCapability>;
