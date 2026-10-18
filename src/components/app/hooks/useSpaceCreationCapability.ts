import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { WorkspaceService } from '@/application/services/domains';
import { isSpaceCreationDenial } from '@/application/services/js-services/space-creation-recovery';
import { EventType, on } from '@/application/session/event';
import {
  compareWorkspacePermissionRevisions,
  isWorkspacePermissionRevision,
  WorkspacePermissionRevision,
  WorkspacePermissionsChanged,
  WorkspaceSpaceCreationCapabilities,
} from '@/application/workspace-permissions';
import { AppEventEmitterContext } from '@/components/app/contexts/AppEventEmitterContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { useAuthenticatedUserIdOptional } from '@/components/main/app.hooks';
import { createCoalescedRefresh } from '@/utils/coalesced-refresh';
import { isUnsupportedRouteError } from '@/utils/errors';
import { getConfigValue } from '@/utils/runtime-config';

type Snapshot = {
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  /** Last confirmed answer for this scope. It stays visible while a refresh is in flight or failed. */
  capability?: WorkspaceSpaceCreationCapabilities;
  error?: unknown;
};

/** How a read ended: the capability, or why there is none (a missing route, a refusal, a failure). */
export type SpaceCreationAnswer =
  | { status: 'ready'; capability: WorkspaceSpaceCreationCapabilities }
  | { status: 'unsupported' | 'error'; error: unknown };

type Read = {
  answer: Promise<SpaceCreationAnswer | undefined>;
  capability: Promise<WorkspaceSpaceCreationCapabilities | undefined>;
};

/**
 * The answer for one account and workspace on one server, shared by every consumer mounted for it
 * (New Page and its Create Space dialog, the space menu, the Permissions panel): a newly mounted one
 * starts from it, and they read together instead of each asking.
 */
type Entry = {
  /** `settled` counts finished reads; a consumer only admits a yes that finished after it mounted. */
  state: { snapshot?: Snapshot; settled: number };
  listeners: Set<() => void>;
  /** The newest read; an answer to an older one is dropped. */
  request: number;
  queue: (read: () => Promise<SpaceCreationAnswer | undefined>) => Promise<SpaceCreationAnswer | undefined>;
  /** The reads in flight or queued. Background triggers join them instead of asking again. */
  read?: Read;
  /** The newest revision seen in an answer or a hint; an older answer is rejected. */
  floor?: WorkspacePermissionRevision;
  /** When the shown answer was confirmed; 0 once a hint or a failure leaves it uncertain. */
  answeredAt: number;
};

/** A newly mounted consumer only asks again once the shared answer is this old. */
const REVALIDATE_MIN_AGE_MS = 30_000;
const WEBSOCKET_OPEN = 1;
const entries = new Map<string, Entry>();

function entryFor(key: string) {
  let entry = entries.get(key);

  if (!entry) {
    entry = {
      state: { settled: 0 },
      listeners: new Set(),
      request: 0,
      queue: createCoalescedRefresh<SpaceCreationAnswer | undefined>(),
      answeredAt: 0,
    };
    entries.set(key, entry);
  }

  return entry;
}

function publish(entry: Entry, snapshot: Snapshot, settled: boolean) {
  entry.state = { snapshot, settled: entry.state.settled + (settled ? 1 : 0) };
  entry.listeners.forEach((listener) => listener());
}

/**
 * Answers that never admit creation by themselves stay as they are while they are asked again: an
 * older server without the route (it decides by itself) and a refused read. A capability goes back
 * to loading instead, because admission must never use a stale yes.
 */
function keepsAnswerWhileRechecked(snapshot: Snapshot | undefined) {
  return snapshot?.status === 'unsupported' || (snapshot?.status === 'error' && isSpaceCreationDenial(snapshot.error));
}

/** Ask again, after any read in flight. Every caller until it finishes shares the newest answer. */
function recheck(key: string, entry: Entry, workspaceId: string): Read {
  const request = ++entry.request;
  const isLatest = () => entries.get(key) === entry && entry.request === request;
  const { snapshot } = entry.state;

  if (!keepsAnswerWhileRechecked(snapshot) && snapshot?.status !== 'loading') {
    publish(entry, { status: 'loading', capability: snapshot?.capability }, false);
  }

  const answer = entry.queue(async (): Promise<SpaceCreationAnswer | undefined> => {
    // A queued read is not sent once every consumer has closed.
    if (!isLatest() || entry.listeners.size === 0) return;
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const capability = await WorkspaceService.getWorkspaceSpaceCreationCapabilities(workspaceId);

      if (!isLatest()) return;
      if (entry.floor && compareWorkspacePermissionRevisions(capability.revision, entry.floor) < 0) {
        throw new Error('Permission state changed while loading');
      }

      entry.floor = capability.revision;
      entry.answeredAt = Date.now();
      publish(entry, { status: 'ready', capability }, true);
      return { status: 'ready', capability };
    } catch (error) {
      if (!isLatest()) return;
      // A missing route means there is no capability to show; any other failure keeps stale data.
      const unsupported = isUnsupportedRouteError(error);
      const status = unsupported ? 'unsupported' : 'error';

      // A missing route and a refusal are answers too; any other failure leaves the answer uncertain.
      entry.answeredAt = unsupported || isSpaceCreationDenial(error) ? Date.now() : 0;
      publish(entry, { status, capability: unsupported ? undefined : entry.state.snapshot?.capability, error }, true);
      return { status, error };
    }
  });

  if (entry.read?.answer === answer) return entry.read;
  const read: Read = {
    answer,
    capability: answer.then((result) => (result?.status === 'ready' ? result.capability : undefined)),
  };
  const clear = () => {
    if (entry.read === read) entry.read = undefined;
  };

  entry.read = read;
  answer.then(clear, clear);
  return read;
}

/** Forget every answer and drop the reads in flight, so a later sign-in starts from nothing. */
export function clearSpaceCreationCapabilityCache() {
  const cleared = [...entries.values()];

  entries.clear();
  // Mounted consumers re-render and move to a new entry for their scope.
  cleared.forEach((entry) => publish(entry, { status: 'loading' }, false));
}

on(EventType.SESSION_INVALID, clearSpaceCreationCapabilityCache);

/**
 * Live admission hints. Publication still rechecks current authority on the server.
 *
 * Refreshes are stale-while-revalidate for display: `capability` keeps the last confirmed answer for
 * the same scope (and `revalidating` is true) so settings never blank or remount on a background
 * refresh. Admission is not stale: `canCreateSpace` is true only for a `ready` answer read since this
 * consumer mounted. Consumers of the same scope share that answer and its reads.
 */
export function useSpaceCreationCapability(workspaceId?: string, enabled = true) {
  const auth = useContext(AuthInternalContext);
  const eventEmitter = useContext(AppEventEmitterContext);
  const userId = useAuthenticatedUserIdOptional();
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const active = Boolean(
    enabled && userId && workspaceId && auth?.isAuthenticated && auth.currentWorkspaceId === workspaceId
  );
  // Dialogs with in-flight mutations can key their local draft state to this identity.
  const scopeKey = JSON.stringify([serverUrl, userId, workspaceId]);
  // Looked up on every render: after sign-out clears the answers, this consumer gets a new entry.
  const entry = active ? entryFor(scopeKey) : undefined;
  const subscribe = useCallback(
    (listener: () => void) => {
      entry?.listeners.add(listener);
      return () => {
        entry?.listeners.delete(listener);
      };
    },
    [entry]
  );
  const getState = useCallback(() => entry?.state, [entry]);
  const state = useSyncExternalStore(subscribe, getState, getState);
  // How many reads had finished when this consumer started showing the entry.
  const [seen, setSeen] = useState(() => ({ entry, settled: entry?.state.settled ?? 0 }));
  const watched = seen.entry === entry ? seen : { entry, settled: entry?.state.settled ?? 0 };

  if (watched !== seen) setSeen(watched);

  const refresh = useCallback(
    (): Promise<WorkspaceSpaceCreationCapabilities | undefined> =>
      entry && workspaceId ? recheck(scopeKey, entry, workspaceId).capability : Promise.resolve(undefined),
    [entry, scopeKey, workspaceId]
  );
  /** Like refresh, but also says why a read has no capability (no read: undefined). */
  const refreshAnswer = useCallback(
    (): Promise<SpaceCreationAnswer | undefined> =>
      entry && workspaceId ? recheck(scopeKey, entry, workspaceId).answer : Promise.resolve(undefined),
    [entry, scopeKey, workspaceId]
  );

  useEffect(() => {
    if (!entry || !workspaceId) return;
    // A newly mounted consumer already shows the shared answer: it joins a read in flight, and only
    // asks again once that answer is old or a newer revision made it uncertain.
    const fresh = entry.answeredAt > 0 && Date.now() - entry.answeredAt < REVALIDATE_MIN_AGE_MS;

    if (!entry.read && !fresh) recheck(scopeKey, entry, workspaceId);
    // Returning to the tab fires both focus and visibilitychange; the first one's read covers both.
    const revalidate = () => {
      if (!entry.read) recheck(scopeKey, entry, workspaceId);
    };

    // A change since the read in flight started: that read can no longer answer.
    const invalidate = () => {
      entry.answeredAt = 0;
      recheck(scopeKey, entry, workspaceId);
    };

    const handleHint = (hint: WorkspacePermissionsChanged) => {
      if (hint?.workspaceId !== workspaceId || !isWorkspacePermissionRevision(hint.revision)) return;
      const floor = entry.floor;

      if (floor && compareWorkspacePermissionRevisions(hint.revision, floor) <= 0) return;
      entry.floor = hint.revision;
      invalidate();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') revalidate();
    };

    const handleSocket = (readyState: unknown) => {
      if (readyState === WEBSOCKET_OPEN) revalidate();
    };

    eventEmitter?.on(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, handleHint);
    eventEmitter?.on(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, invalidate);
    eventEmitter?.on(APP_EVENTS.SERVER_LIMIT_CHANGED, invalidate);
    eventEmitter?.on(APP_EVENTS.WEBSOCKET_STATUS, handleSocket);
    window.addEventListener('online', revalidate);
    window.addEventListener('offline', invalidate);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      eventEmitter?.off(APP_EVENTS.WORKSPACE_PERMISSIONS_CHANGED, handleHint);
      eventEmitter?.off(APP_EVENTS.MENTIONABLE_PERSON_LIST_CHANGED, invalidate);
      eventEmitter?.off(APP_EVENTS.SERVER_LIMIT_CHANGED, invalidate);
      eventEmitter?.off(APP_EVENTS.WEBSOCKET_STATUS, handleSocket);
      window.removeEventListener('online', revalidate);
      window.removeEventListener('offline', invalidate);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [entry, eventEmitter, scopeKey, workspaceId]);

  const shared = state?.snapshot;
  // A yes confirmed before this consumer mounted stays on screen, but admission waits for a fresh read.
  const current =
    shared?.status === 'ready' && (state?.settled ?? 0) <= watched.settled
      ? { ...shared, status: 'loading' as const }
      : shared;
  const status = current?.status ?? 'loading';

  return {
    status,
    capability: current?.capability,
    canCreateSpace: status === 'ready' && current?.capability?.can_create_space === true,
    /** A confirmed capability is shown, but not admitted, until a newer answer arrives. */
    revalidating: status === 'loading' && current?.capability !== undefined,
    error: current?.error,
    refresh,
    refreshAnswer,
    scopeKey,
  };
}
