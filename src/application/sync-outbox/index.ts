import BaseDexie from 'dexie';
import * as Y from 'yjs';

import { db } from '@/application/db';
import { SyncOutboxRecord } from '@/application/db/tables/sync_outbox';
import { Types } from '@/application/types';
import { collab, messages } from '@/proto/messages';
import { Log } from '@/utils/log';

// Inlined to avoid a circular import with sync-protocol. Value must match
// UpdateFlags.Lib0v1 in sync-protocol.ts.
const FLAGS_LIB0V1 = 0;

export type OutboxSender = (message: messages.IMessage) => void;

export type OutboxReady = () => boolean;

export interface SlowSyncOutboxItem {
  objectId: string;
  collabType: Types;
  version?: string | null;
  stateVector: Uint8Array;
  docState: Uint8Array;
}

export type SlowSyncBlockedReason = 'permission_denied' | 'update_too_large';

export type SlowSyncOutboxResult =
  | {
      outcome: 'confirmed';
      /** An authoritative collab-version supersession needs no RID. */
      messageId?: collab.IRid;
    }
  | {
      outcome: 'blocked';
      reason: SlowSyncBlockedReason;
    };

interface DrainConfig {
  userId: string;
  workspaceId: string;
  /** Sends to the authoritative server (WebSocket). Only invoked when isReady(). */
  send: OutboxSender;
  /**
   * Fans a message out to sibling tabs (BroadcastChannel). Runs regardless of
   * `isReady()` so other tabs stay in sync during WebSocket reconnect.
   */
  broadcast?: OutboxSender;
  /**
   * Best-effort send used only when the durable IndexedDB enqueue fails
   * (quota exhausted, private-mode, upgrade blocked). Unlike `send` this
   * SHOULD tolerate the absence of a direct open socket by buffering on the
   * owning socket or relaying to the elected socket owner, so the edit can
   * still reach the server while this browser session is alive.
   */
  sendBestEffort?: OutboxSender;
  isReady: OutboxReady;
  /** Notifies the elected socket owner after the IndexedDB row is durable. */
  onPersisted?: (workspaceId: string, objectId: string) => void;
  /** Realtime raw-update cap advertised by the server. */
  maxUpdateBytes?: number;
  /** Optional raw-update cap for the backward-compatible HTTP slow lane. */
  maxSlowSyncUpdateBytes?: number;
  /**
   * False only while server-info is unresolved. The realtime lane still uses
   * its conservative legacy limit; the HTTP slow lane remains disabled.
   */
  syncLimitsLoaded?: boolean;
  /** Cancels an in-flight slow request before logout waits for drains. */
  abortSlowSync?: () => void;
  /**
   * Persists one oversized object through the authenticated HTTP full-sync
   * endpoint. Confirmation requires a durable RID unless an authoritative
   * collab-version change supersedes the queued update.
   */
  slowSync?: (item: SlowSyncOutboxItem) => Promise<SlowSyncOutboxResult>;
}

let drainConfig: DrainConfig | null = null;
// The (userId, workspaceId) that new enqueues are stamped with. Must be set
// before any local edits can happen; kept in sync with the active sync layer.
let currentUserId: string | null = null;
let currentWorkspaceId: string | null = null;
const draining = new Map<string, Promise<void>>();
const slowSyncRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const slowSyncRetryAttempts = new Map<string, number>();
const oversizedDiagnostics = new Map<string, string>();
const blockedSlowSyncObjects = new Map<string, SlowSyncBlockedReason>();
const serializedSlowSyncObjects = new Set<string>();
let slowSyncQueue: Promise<void> = Promise.resolve();
// Object ids whose records were enqueued while a drain was already in flight.
// Processed in the drain's finally block so the race between the drain loop's
// "nothing left" exit and a concurrent enqueue cannot leave records stranded.
const pendingRerun = new Set<string>();
// Tracks in-flight `db.sync_outbox.add()` promises per objectId. `flush()` and
// `discardPendingUpdates()` await these before proceeding so a record whose
// IDB write is still pending cannot be missed by a flush or survive a discard.
const inflightAdds = new Map<string, Set<Promise<unknown>>>();
// Object ids currently being discarded. A drain loop that has already loaded
// records for one of these into memory must abort before sending — otherwise a
// pre-reset edit can slip through after `discardPendingUpdates()` resolves.
const suppressedObjects = new Set<string>();
// When `purgeAllOutbox` is running, both new enqueues and new drain iterations
// are blocked so we can quiesce the outbox across a logout boundary without
// racing concurrent writes or sends.
let isPurging = false;
// Tracks the in-flight purge promise so a newly-mounted session's
// `startDrainAll` can await it before querying the outbox, instead of
// forcing `invalidToken()` to delay its `SESSION_INVALID` emission until
// IndexedDB finishes.
let pendingPurge: Promise<void> | null = null;
let startDrainAllQueued = false;
// A newly mounted session must discover persisted predecessors before any
// fresh update can take the immediate WebSocket path. Otherwise a small edit
// can leapfrog an oversized record left in IndexedDB by a prior page load.
let discoveredOutboxSessionKey: string | null = null;

const SLOW_SYNC_RETRY_DELAYS_MS = [5_000, 30_000, 2 * 60_000, 5 * 60_000];
const DEFAULT_REALTIME_UPDATE_BYTES = 4 * 1024 * 1024;
const OUTBOX_READ_BATCH_SIZE = 64;
const SLOW_SYNC_LOCK_PREFIX = 'appflowy:sync-outbox:slow';

interface EnqueueOutboxOptions {
  /** Manifest replies are server-directed and do not need sibling-tab fan-out. */
  broadcast?: boolean;
}

function sessionObjectKey(userId: string, workspaceId: string, objectId: string): string {
  return `${userId}\u0000${workspaceId}\u0000${objectId}`;
}

function sessionKey(userId: string, workspaceId: string): string {
  return `${userId}\u0000${workspaceId}`;
}

/**
 * Set (or clear) the session that subsequent enqueues will be stamped with.
 * Called by the app's sync layer when mounting / switching sessions.
 * Records left behind from a previous session stay in the outbox and will
 * only drain when that session's sync layer is re-mounted with the matching
 * `(userId, workspaceId)`.
 */
export function setCurrentSession(session: { userId: string; workspaceId: string } | null) {
  const nextUserId = session?.userId ?? null;
  const nextWorkspaceId = session?.workspaceId ?? null;
  const nextSessionKey = nextUserId && nextWorkspaceId ? sessionKey(nextUserId, nextWorkspaceId) : null;
  const currentSessionKey = currentUserId && currentWorkspaceId ? sessionKey(currentUserId, currentWorkspaceId) : null;

  if (nextSessionKey !== currentSessionKey) {
    discoveredOutboxSessionKey = null;
  }

  currentUserId = nextUserId;
  currentWorkspaceId = nextWorkspaceId;
}

export function enqueueOutboxUpdate(
  record: Omit<SyncOutboxRecord, 'id' | 'createdAt' | 'workspaceId' | 'userId'>,
  options?: EnqueueOutboxOptions
) {
  if (isPurging) {
    // Logout / session-change in progress — drop. A new session will
    // re-enqueue any genuinely-pending edits through its own lifecycle.
    Log.debug('[outbox] enqueue dropped: purge in progress', { objectId: record.objectId });
    return;
  }

  const userId = currentUserId;
  const workspaceId = currentWorkspaceId;

  if (!userId || !workspaceId) {
    Log.warn('[outbox] enqueue skipped: no session configured', { objectId: record.objectId });
    return;
  }

  // A discard is in progress for this objectId (version reset / revert).
  // Refuse to add new rows so a local edit landing mid-discard cannot slip
  // past `deleteOutboxByObjectId()`'s inflight-snapshot wait and later drain
  // onto the rebuilt doc. The doc whose observers produced this update is
  // about to be destroyed; the rebuilt doc starts from server state.
  if (suppressedObjects.has(record.objectId)) {
    Log.debug('[outbox] enqueue dropped: discard in progress', { objectId: record.objectId });
    return;
  }

  const row: Omit<SyncOutboxRecord, 'id'> = {
    ...record,
    userId,
    workspaceId,
    createdAt: Date.now(),
  };

  // Fan out to sibling tabs immediately, regardless of WebSocket state. The
  // server send uses the same update shape below when the WebSocket is open;
  // the durable outbox row remains the fallback when it is not.
  const broadcast = drainConfig?.broadcast;

  if (options?.broadcast !== false && broadcast && drainConfig?.workspaceId === workspaceId) {
    try {
      broadcast(buildUpdateMessage(record));
    } catch (error) {
      Log.warn('[outbox] broadcast failed', { objectId: record.objectId, error });
    }
  }

  // Snapshot the session at enqueue time so a concurrent workspace/user
  // switch cannot retarget the fallback send. Without this, an enqueue that
  // fails after a switch could route session A's update over session B's
  // WebSocket.
  const enqueueUserId = userId;
  const enqueueWorkspaceId = workspaceId;
  const objectSessionKey = sessionObjectKey(userId, workspaceId, record.objectId);
  const isIndividuallyOversized = exceedsRealtimeLimit(record.payload.byteLength, drainConfig?.maxUpdateBytes);

  if (isIndividuallyOversized) {
    serializedSlowSyncObjects.add(objectSessionKey);
  }

  const addPromise: Promise<unknown> = db.sync_outbox.add(row as SyncOutboxRecord);
  const set = inflightAdds.get(record.objectId) ?? new Set<Promise<unknown>>();
  let sentImmediately = false;
  const activeConfig = drainConfig;
  const notifyPersisted =
    activeConfig?.userId === enqueueUserId && activeConfig.workspaceId === enqueueWorkspaceId
      ? activeConfig.onPersisted
      : undefined;

  // Preserve the low-latency realtime path for ordinary edits. Oversized
  // updates are different: they must first become durable, then the serialized
  // drain routes them through HTTP. Sending one here would exceed the server
  // frame limit before the slow lane gets a chance to run.
  if (
    activeConfig &&
    activeConfig.userId === enqueueUserId &&
    activeConfig.workspaceId === enqueueWorkspaceId &&
    !isPurging &&
    discoveredOutboxSessionKey === sessionKey(enqueueUserId, enqueueWorkspaceId) &&
    !suppressedObjects.has(record.objectId) &&
    !draining.has(record.objectId) &&
    activeConfig.isReady() &&
    !isIndividuallyOversized &&
    !serializedSlowSyncObjects.has(objectSessionKey)
  ) {
    try {
      activeConfig.send(buildUpdateMessage(record));
      sentImmediately = true;
    } catch (error) {
      Log.warn('[outbox] immediate send failed; durable row will drain', { objectId: record.objectId, error });
    }
  }

  set.add(addPromise);
  inflightAdds.set(record.objectId, set);

  addPromise
    .then(async (id) => {
      try {
        notifyPersisted?.(enqueueWorkspaceId, record.objectId);
      } catch (error) {
        Log.warn('[outbox] durable-update notification failed', {
          workspaceId: enqueueWorkspaceId,
          objectId: record.objectId,
          error,
        });
      }

      if (sentImmediately) {
        if (typeof id === 'number') {
          try {
            await db.sync_outbox.bulkDelete([id]);
          } catch (error) {
            Log.warn('[outbox] immediate-send cleanup failed; leaving row for drain', {
              objectId: record.objectId,
              id,
              error,
            });
          }
        }

        // A live keystroke may have followed older queued records. Kick a
        // normal drain so those older rows are reconciled instead of waiting
        // for refresh/reconnect.
        scheduleDrain(record.objectId);
        return;
      }

      scheduleDrain(record.objectId);
    })
    .catch(async (error) => {
      if (sentImmediately) {
        Log.warn('[outbox] enqueue failed after immediate send', { objectId: record.objectId, error });
        return;
      }

      Log.error('[outbox] enqueue failed', { objectId: record.objectId, error });

      // IDB write failed (quota exhausted, upgrade blocked, etc.). Fall back
      // through the CURRENT drain config's best-effort send, but only if we
      // are still in the same session (userId AND workspaceId). Comparing
      // by string (not by config object identity) is important: AppSyncLayer
      // rebuilds drainConfig on same-session readyState changes — identity
      // comparison would spuriously treat those rebuilds as session switches.
      const activeConfig = drainConfig;

      if (!activeConfig || activeConfig.userId !== enqueueUserId || activeConfig.workspaceId !== enqueueWorkspaceId) {
        Log.warn('[outbox] fallback skipped: session changed since enqueue', {
          objectId: record.objectId,
          enqueueUserId,
          enqueueWorkspaceId,
          currentUserId: activeConfig?.userId,
          currentWorkspaceId: activeConfig?.workspaceId,
        });
        return;
      }

      // A purge (logout) or version-reset discard started while the IDB write
      // was in flight. The synchronous guard at enqueue time passed, but the
      // state has since changed — drop the fallback to honour the boundary.
      if (isPurging || suppressedObjects.has(record.objectId)) {
        Log.debug('[outbox] fallback skipped: purge/discard in progress', { objectId: record.objectId });
        return;
      }

      // An update above the realtime limit must never leak onto WebSocket.
      // Without a durable row there is no safe way to retry the slow lane
      // after a refresh, so fail visibly and let the next manifest exchange
      // reconstruct the diff instead of closing the socket with an oversize
      // frame.
      if (exceedsRealtimeLimit(record.payload.byteLength, activeConfig.maxUpdateBytes)) {
        Log.error('[outbox] oversized update could not be persisted; WebSocket fallback suppressed', {
          objectId: record.objectId,
          payloadBytes: record.payload.byteLength,
          maxUpdateBytes: activeConfig.maxUpdateBytes,
        });

        try {
          const remaining = await db.sync_outbox
            .where('[userId+workspaceId+objectId]')
            .equals([enqueueUserId, enqueueWorkspaceId, record.objectId])
            .count();

          if (remaining === 0) {
            serializedSlowSyncObjects.delete(objectSessionKey);
          }
        } catch {
          // Keep the serialization guard when IndexedDB itself is unavailable.
          // The next manifest can reconstruct the update after storage recovers.
        }

        return;
      }

      const directMessage: messages.IMessage = {
        collabMessage: {
          objectId: record.objectId,
          collabType: record.collabType,
          update: {
            flags: FLAGS_LIB0V1,
            payload: record.payload,
            version: record.version ?? undefined,
            beforeStateVector: record.beforeStateVector,
          } as collab.IUpdate,
        },
      };

      const fallback = activeConfig.sendBestEffort ?? (activeConfig.isReady() ? activeConfig.send : undefined);

      if (!fallback) {
        Log.warn('[outbox] cannot fall back: no sendBestEffort and WS not OPEN', {
          objectId: record.objectId,
        });
        return;
      }

      try {
        fallback(directMessage);
      } catch (sendError) {
        Log.warn('[outbox] fallback send also failed', {
          objectId: record.objectId,
          error: sendError,
        });
      }
    })
    .finally(() => {
      const current = inflightAdds.get(record.objectId);

      if (!current) return;
      current.delete(addPromise);
      if (current.size === 0) {
        inflightAdds.delete(record.objectId);
      }
    });
}

async function awaitInflightAdds(objectId: string): Promise<void> {
  const pending = inflightAdds.get(objectId);

  if (!pending || pending.size === 0) return;
  // Snapshot the set so new additions during the await don't extend the wait.
  await Promise.allSettled(Array.from(pending));
}

export function configureDrain(config: DrainConfig) {
  // A meaningful owner/capability rebuild is the point at which a previously
  // terminal server decision may have changed (permission grant or larger
  // advertised limit). Ordinary readyState transitions no longer rebuild.
  for (const key of blockedSlowSyncObjects.keys()) {
    if (key.startsWith(`${config.userId}\u0000${config.workspaceId}\u0000`)) {
      blockedSlowSyncObjects.delete(key);
    }
  }

  drainConfig = config;
}

export function clearDrainConfig() {
  drainConfig = null;
  pendingRerun.clear();
  oversizedDiagnostics.clear();
  // Retry state is session-object keyed and intentionally survives a
  // same-session transport/config rebuild. Purge owns the hard reset.
}

/**
 * Returns true when a raw Yjs update cannot use the realtime lane.
 *
 * A conservative 4 MiB fallback protects both unresolved server-info requests
 * and older servers that omit the field. An explicitly advertised zero means
 * unlimited.
 */
export function shouldRouteUpdateThroughOutbox(updateBytes: number): boolean {
  if (drainConfig && discoveredOutboxSessionKey !== sessionKey(drainConfig.userId, drainConfig.workspaceId)) {
    return true;
  }

  return exceedsRealtimeLimit(updateBytes, drainConfig?.maxUpdateBytes);
}

/**
 * Kick a drain for every objectId present in the outbox for the currently
 * configured workspace. Safe to call on WebSocket reconnect.
 */
export function startDrainAll() {
  if (!drainConfig) return;
  if (startDrainAllQueued) return;
  startDrainAllQueued = true;

  queueMicrotask(async () => {
    startDrainAllQueued = false;

    // Block until any in-flight logout purge finishes so the next session
    // cannot observe pre-purge state. `invalidToken()` emits SESSION_INVALID
    // synchronously and kicks off the purge in the background; this await is
    // the coupling that keeps the invariant without forcing auth failures to
    // wait on IndexedDB.
    if (pendingPurge) {
      await pendingPurge.catch(() => undefined);
    }

    const config = drainConfig;

    if (!config) return;

    try {
      const objectIds = await distinctObjectIdsForSession(config.userId, config.workspaceId);

      if (!sameDrainSession(drainConfig, config)) return;
      for (const objectId of objectIds) {
        scheduleDrain(objectId);
      }

      // scheduleDrain synchronously installs the per-object drain promise, so
      // an edit arriving after this assignment is still held behind any
      // discovered predecessor for that object.
      discoveredOutboxSessionKey = sessionKey(config.userId, config.workspaceId);
    } catch (error) {
      Log.warn('[outbox] startDrainAll failed', error);
    }
  });
}

/** Wakes the configured transport for one object after another tab persists it. */
export function startDrainObject(objectId: string) {
  scheduleDrain(objectId);
}

interface WaitForDrainOptions {
  /** Max time to wait for drain completion before resolving. Default 5s. */
  timeoutMs?: number;
  /** Poll interval while WS is closed. Default 150ms. */
  pollIntervalMs?: number;
}

/**
 * Wait until the outbox is empty for the given objectIds (or all in the
 * currently configured workspace if omitted). Returns `true` when fully
 * drained, `false` on timeout (e.g. the WebSocket remained closed).
 *
 * Callers that need hard delivery guarantees should also send the current
 * doc state through an alternate channel (HTTP batch) — the Yjs handshake
 * on reconnect will still reconcile any records left behind.
 */
export async function waitForDrain(objectIds?: string[], opts?: WaitForDrainOptions): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 5_000;
  const pollIntervalMs = opts?.pollIntervalMs ?? 150;
  const start = Date.now();
  const ids =
    objectIds ?? (drainConfig ? await distinctObjectIdsForSession(drainConfig.userId, drainConfig.workspaceId) : []);

  if (ids.length === 0) return true;

  // eslint-disable-next-line no-constant-condition
  for (;;) {
    // Ensure any in-flight IDB writes land before we attempt to read/send,
    // otherwise flush can return while an enqueue's add() is still pending.
    await Promise.all(ids.map((id) => awaitInflightAdds(id)));
    ids.forEach((id) => scheduleDrain(id));
    await Promise.all(ids.map((id) => draining.get(id) ?? Promise.resolve()));

    // Check if any records still remain for these objectIds in the current
    // session. If none, drain is complete.
    const userId = drainConfig?.userId;
    const workspaceId = drainConfig?.workspaceId;

    if (!userId || !workspaceId) return false;

    const remaining = await Promise.all(
      ids.map((id) => db.sync_outbox.where('[userId+workspaceId+objectId]').equals([userId, workspaceId, id]).count())
    );

    if (remaining.every((count) => count === 0)) return true;

    if (Date.now() - start >= timeoutMs) {
      Log.warn('[outbox] waitForDrain timed out with pending records', {
        totalPending: remaining.reduce((a, b) => a + b, 0),
        timeoutMs,
      });
      return false;
    }

    // WS may be closed / reconnecting. Poll briefly and retry — the drain will
    // progress as soon as isReady() becomes true again.
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Drop every row from the persistent sync_outbox. Call this on logout so a
 * pending edit from user A cannot drain onto user B's WebSocket after
 * re-authentication. Quiesces in-flight IDB adds and drain iterations first
 * so no concurrent write can land after `clear()` or reach `config.send()`
 * after this returns.
 */
export function purgeAllOutbox(): Promise<void> {
  // De-dupe concurrent purges: a second caller (e.g. rapid logout retries)
  // should join the in-flight work rather than kick off a parallel clear().
  if (pendingPurge) return pendingPurge;

  // Set the gate synchronously so any enqueue arriving in the same tick
  // — e.g. from a React render triggered by `SESSION_INVALID` — is dropped
  // before it can add new rows behind the purge.
  isPurging = true;
  // Abort HTTP before runPurge awaits the active drain; otherwise a slow or
  // stalled request can delay logout until its transport timeout expires.
  drainConfig?.abortSlowSync?.();

  const purge = runPurge();

  pendingPurge = purge;
  return purge;
}

async function runPurge(): Promise<void> {
  try {
    // Snapshot in-flight work, then wait for it. New enqueues are blocked by
    // `isPurging` so the snapshot is complete — nothing can slip in after.
    const pendingAdds: Promise<unknown>[] = [];

    for (const set of inflightAdds.values()) {
      for (const p of set) pendingAdds.push(p.catch(() => undefined));
    }

    const pendingDrains = Array.from(draining.values()).map((p) => p.catch(() => undefined));

    await Promise.all([...pendingAdds, ...pendingDrains]);

    // Clear the in-memory scheduling state so a reschedule-after-unpurge
    // doesn't pick up stale bookkeeping.
    pendingRerun.clear();
    inflightAdds.clear();
    serializedSlowSyncObjects.clear();
    oversizedDiagnostics.clear();
    blockedSlowSyncObjects.clear();
    discoveredOutboxSessionKey = null;
    clearAllSlowSyncRetries();

    try {
      await db.sync_outbox.clear();
    } catch (error) {
      Log.warn('[outbox] purgeAllOutbox: IDB clear failed', error);
    }
  } finally {
    isPurging = false;
    pendingPurge = null;
  }
}

export async function deleteOutboxByObjectId(
  objectId: string,
  options?: {
    /**
     * Used only by an HTTP result being applied from inside this object's
     * active drain. Waiting for that drain here would await the current
     * promise and deadlock the version-reset path.
     */
    skipActiveDrain?: boolean;
  }
): Promise<void> {
  // Synchronously suppress any in-flight drain iteration for this objectId
  // BEFORE yielding to the event loop. A drain that has already read records
  // into memory checks this set just before sending, so a concurrent discard
  // cannot race past a drain that was already mid-iteration.
  suppressedObjects.add(objectId);

  try {
    // Wait for a drain that's already in flight to finish. New drain iterations
    // hit the `suppressedObjects` gate and abort, but a drain mid-send + delete
    // needs to complete before we can truthfully report "discard is done". The
    // send for that batch has already happened — at least after this await,
    // we guarantee no further stale sends can fire.
    const existingDrain = draining.get(objectId);

    if (existingDrain && !options?.skipActiveDrain) {
      await existingDrain.catch(() => undefined);
    }

    // Wait for any in-flight enqueue to land in IDB first — otherwise a record
    // whose add() is still pending will survive this delete and drain after a
    // version reset/revert onto stale state.
    await awaitInflightAdds(objectId);

    // Propagate delete failures: reset/revert callers `await` this specifically
    // to ensure stale rows are gone before rebuilding the doc. Silently
    // resolving here would let a blocked/closing IDB leave stale records that
    // then drain onto the newly rebuilt document.
    const userId = currentUserId;
    const workspaceId = currentWorkspaceId;

    if (!userId || !workspaceId) {
      // No active session — nothing the current user could have enqueued
      // against this objectId, and the sync_outbox v6 schema only indexes
      // the compound `[userId+workspaceId+objectId]` key, so there's no
      // cheap way (and no need) to touch IDB here. Rows from a prior
      // session are scoped to their own userId and will never drain
      // against another user's WebSocket.
      Log.debug('[outbox] deleteOutboxByObjectId skipped: no session configured', { objectId });
      return;
    }

    await db.sync_outbox.where('[userId+workspaceId+objectId]').equals([userId, workspaceId, objectId]).delete();
    const objectSessionKey = sessionObjectKey(userId, workspaceId, objectId);

    serializedSlowSyncObjects.delete(objectSessionKey);
    oversizedDiagnostics.delete(objectSessionKey);
    blockedSlowSyncObjects.delete(objectSessionKey);
    clearSlowSyncRetry(objectSessionKey);
  } finally {
    suppressedObjects.delete(objectId);
  }
}

async function distinctObjectIdsForSession(userId: string, workspaceId: string): Promise<string[]> {
  const ids = new Set<string>();

  await db.sync_outbox
    .where('[userId+workspaceId]')
    .equals([userId, workspaceId])
    .each((record) => {
      ids.add(record.objectId);
    });
  return Array.from(ids);
}

function buildUpdateMessage(
  record: Pick<SyncOutboxRecord, 'objectId' | 'collabType' | 'payload' | 'version' | 'beforeStateVector'>
): messages.IMessage {
  return {
    collabMessage: {
      objectId: record.objectId,
      collabType: record.collabType,
      update: {
        flags: FLAGS_LIB0V1,
        payload: record.payload,
        version: record.version ?? undefined,
        beforeStateVector: record.beforeStateVector,
      } as collab.IUpdate,
    },
  };
}

function validByteLimit(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function realtimeByteLimit(value: number | undefined): number | undefined {
  // The protocol's established frame limit protects older servers that omit
  // the optional field. A server can explicitly advertise 0 to opt out.
  if (value === 0) return undefined;

  return validByteLimit(value) ?? DEFAULT_REALTIME_UPDATE_BYTES;
}

function exceedsRealtimeLimit(payloadBytes: number, maxUpdateBytes: number | undefined): boolean {
  const limit = realtimeByteLimit(maxUpdateBytes);

  return limit !== undefined && payloadBytes > limit;
}

async function readOutboxPrefix(userId: string, workspaceId: string, objectId: string): Promise<SyncOutboxRecord[]> {
  // The four-part index is naturally ordered by the auto-incremented id. A
  // fixed prefix bound prevents one long-offline object from being read into
  // memory in a single drain iteration.
  return db.sync_outbox
    .where('[userId+workspaceId+objectId+id]')
    .between([userId, workspaceId, objectId, BaseDexie.minKey], [userId, workspaceId, objectId, BaseDexie.maxKey])
    .limit(OUTBOX_READ_BATCH_SIZE)
    .toArray();
}

function mergeRecordPrefix(records: SyncOutboxRecord[], count = records.length): Uint8Array {
  if (count === 1) return records[0].payload;

  return Y.mergeUpdates(records.slice(0, count).map((record) => record.payload));
}

function selectRecordsForRealtime(
  records: SyncOutboxRecord[],
  limit: number | undefined
): { records: SyncOutboxRecord[]; merged: Uint8Array } {
  if (limit === undefined) {
    return { records, merged: mergeRecordPrefix(records) };
  }

  // Conservatively budget by raw bytes, then merge once. If encoding overhead
  // still crosses the cap, halve the bounded prefix rather than repeatedly
  // merging every growing prefix (the old quadratic path).
  let count = 0;
  let rawBytes = 0;

  for (const record of records) {
    if (count > 0 && rawBytes + record.payload.byteLength > limit) break;
    rawBytes += record.payload.byteLength;
    count += 1;
  }

  count = Math.max(1, count);
  let merged = mergeRecordPrefix(records, count);

  while (count > 1 && merged.byteLength > limit) {
    count = Math.max(1, Math.floor(count / 2));
    merged = mergeRecordPrefix(records, count);
  }

  return { records: records.slice(0, count), merged };
}

function selectRecordsForSlowSync(
  records: SyncOutboxRecord[],
  limit: number
): { records: SyncOutboxRecord[]; merged: Uint8Array; stateVector: Uint8Array } {
  // Server-info advertises the raw doc_state cap. The state vector has its own
  // server-side bound, so charging it against this limit would reject a valid
  // update whose doc_state is exactly at the advertised maximum.
  const buildCandidate = (count: number) => {
    const merged = mergeRecordPrefix(records, count);
    const stateVector = postUpdateStateVector(records[0].beforeStateVector, merged);

    return {
      records: records.slice(0, count),
      merged,
      stateVector,
    };
  };

  const wholePrefix = buildCandidate(records.length);

  if (wholePrefix.merged.byteLength <= limit || records.length === 1) {
    return wholePrefix;
  }

  // The prefix is bounded by OUTBOX_READ_BATCH_SIZE. Binary search gives us a
  // near-maximal request with O(log n) merges instead of O(n) successively
  // larger merges that repeatedly reparse the same Yjs structs.
  let low = 1;
  let high = records.length - 1;
  let best = buildCandidate(1);

  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidate = buildCandidate(midpoint);

    if (candidate.merged.byteLength <= limit) {
      best = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  return best;
}

function recordIds(records: SyncOutboxRecord[]): number[] {
  return records.map((record) => record.id).filter((id): id is number => id !== undefined);
}

function postUpdateStateVector(beforeStateVector: Uint8Array | undefined, update: Uint8Array): Uint8Array {
  const state = beforeStateVector?.byteLength ? Y.decodeStateVector(beforeStateVector) : new Map<number, number>();
  // encodeStateVectorFromUpdate omits clients whose structs start at a
  // non-zero clock. parseUpdateMeta().to contains the actual post-update clock
  // for both full snapshots and incremental updates.
  const updateState = Y.parseUpdateMeta(update).to;

  for (const [clientId, clock] of updateState) {
    state.set(clientId, Math.max(state.get(clientId) ?? 0, clock));
  }

  return Y.encodeStateVector(state);
}

function clearSlowSyncRetry(objectSessionKey: string) {
  const timer = slowSyncRetryTimers.get(objectSessionKey);

  if (timer) clearTimeout(timer);
  slowSyncRetryTimers.delete(objectSessionKey);
  slowSyncRetryAttempts.delete(objectSessionKey);
}

function clearAllSlowSyncRetries() {
  for (const timer of slowSyncRetryTimers.values()) {
    clearTimeout(timer);
  }

  slowSyncRetryTimers.clear();
  slowSyncRetryAttempts.clear();
}

function scheduleSlowSyncRetry(userId: string, workspaceId: string, objectId: string, retryAfterSecs?: number) {
  const objectSessionKey = sessionObjectKey(userId, workspaceId, objectId);

  if (slowSyncRetryTimers.has(objectSessionKey)) return;

  const attempt = slowSyncRetryAttempts.get(objectSessionKey) ?? 0;
  const advertisedDelay =
    typeof retryAfterSecs === 'number' && Number.isFinite(retryAfterSecs) && retryAfterSecs > 0
      ? Math.ceil(retryAfterSecs * 1_000)
      : undefined;
  const delay = advertisedDelay ?? SLOW_SYNC_RETRY_DELAYS_MS[Math.min(attempt, SLOW_SYNC_RETRY_DELAYS_MS.length - 1)];

  slowSyncRetryAttempts.set(objectSessionKey, attempt + 1);
  slowSyncRetryTimers.set(
    objectSessionKey,
    setTimeout(() => {
      slowSyncRetryTimers.delete(objectSessionKey);
      const config = drainConfig;

      if (!config || config.userId !== userId || config.workspaceId !== workspaceId) return;
      scheduleDrain(objectId);
    }, delay)
  );
}

async function runSlowSyncSerialized<T>(task: () => Promise<T>): Promise<T> {
  const previous = slowSyncQueue;
  let release!: () => void;

  slowSyncQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
  }
}

async function runSlowSyncCoordinated<T>(userId: string, workspaceId: string, task: () => Promise<T>): Promise<T> {
  const lockManager = globalThis.navigator?.locks;

  if (lockManager) {
    const lockName = `${SLOW_SYNC_LOCK_PREFIX}:${userId}:${workspaceId}`;

    return lockManager.request(lockName, { mode: 'exclusive' }, task);
  }

  return runSlowSyncSerialized(task);
}

function retryAfterSecsFromError(error: unknown): number | undefined {
  const retryAfterSecs = (error as { retryAfterSecs?: unknown })?.retryAfterSecs;

  return typeof retryAfterSecs === 'number' && Number.isFinite(retryAfterSecs) && retryAfterSecs > 0
    ? retryAfterSecs
    : undefined;
}

function sameDrainSession(left: DrainConfig | null, right: DrainConfig | null): boolean {
  return Boolean(left && right && left.userId === right.userId && left.workspaceId === right.workspaceId);
}

function logOversizedOnce(objectSessionKey: string, reason: string, details: Record<string, unknown>) {
  if (oversizedDiagnostics.get(objectSessionKey) === reason) return;

  oversizedDiagnostics.set(objectSessionKey, reason);
  Log.warn('[outbox] oversized update remains durable', { reason, ...details });
}

function scheduleDrain(objectId: string) {
  if (!drainConfig) return;

  // Refuse to spawn a drain while a discard or purge is in progress. Without
  // this gate, an in-flight `db.sync_outbox.add()` can resolve mid-discard
  // and fire its `.then(scheduleDrain)` before the delete/clear query runs.
  // That late drain is not in the wait set captured by
  // `deleteOutboxByObjectId` / `runPurge`, so its own `sortBy` read can
  // snapshot the just-added row, then synchronously fall through to the
  // send after the `finally` has already cleared `suppressedObjects` /
  // `isPurging` — replaying stale updates past the reset/logout boundary.
  // Gating at schedule time prevents that drain from ever existing; the
  // row is removed by the pending delete/clear and the scheduling is
  // re-entered normally after the flag flips back off via a fresh enqueue.
  if (isPurging || suppressedObjects.has(objectId)) return;

  if (draining.has(objectId)) {
    // Another drain is in flight for this objectId. Mark it so the in-flight
    // drain reschedules itself once it finishes.
    pendingRerun.add(objectId);
    return;
  }

  const promise = drainObject(objectId).finally(() => {
    draining.delete(objectId);

    if (pendingRerun.delete(objectId)) {
      scheduleDrain(objectId);
    }
  });

  draining.set(objectId, promise);
}

async function drainObject(objectId: string): Promise<void> {
  if (!drainConfig) return;

  try {
    await drainObjectWhileReady(objectId);
  } catch (error) {
    Log.warn('[outbox] drain object failed', { objectId, error });
  }
}

// Cross-tab ownership keeps ordinary WebSocket draining on one leader. The
// oversized HTTP path additionally takes a blocking workspace lock because a
// leader handoff can otherwise upload the same multi-megabyte IndexedDB prefix
// twice. Browsers without Web Locks retain the server-idempotent fallback.

async function drainObjectWhileReady(objectId: string): Promise<void> {
  // Snapshot the drain config at loop entry. If the user switches workspace
  // mid-iteration, `drainConfig` changes but this snapshot does not — so we
  // never send workspace A's records over workspace B's WebSocket.
  const initialConfig = drainConfig;

  // eslint-disable-next-line no-constant-condition
  for (;;) {
    // Re-read the module config each iteration and abort if it has been
    // swapped out (workspace change / sign-out).
    const config = drainConfig;

    if (!config || config !== initialConfig) return;

    const userId = config.userId;
    const workspaceId = config.workspaceId;
    const objectSessionKey = sessionObjectKey(userId, workspaceId, objectId);

    if (slowSyncRetryTimers.has(objectSessionKey)) return;
    if (blockedSlowSyncObjects.has(objectSessionKey)) return;

    const records = await readOutboxPrefix(userId, workspaceId, objectId);

    if (records.length === 0) {
      serializedSlowSyncObjects.delete(objectSessionKey);
      clearSlowSyncRetry(objectSessionKey);
      return;
    }

    const realtimeLimit = realtimeByteLimit(config.maxUpdateBytes);
    const firstRecord = records[0];
    // A backlog of individually valid updates must stay on the realtime lane
    // in bounded prefixes. Only an atomic head update that can never fit the
    // WebSocket frame needs the slow HTTP lane.
    const useSlowLane = realtimeLimit !== undefined && firstRecord.payload.byteLength > realtimeLimit;

    if (useSlowLane) {
      serializedSlowSyncObjects.add(objectSessionKey);
      const slowLimit =
        config.syncLimitsLoaded === false ? undefined : validByteLimit(config.maxSlowSyncUpdateBytes);

      if (!slowLimit || !config.slowSync) {
        logOversizedOnce(objectSessionKey, !slowLimit ? 'slow_lane_not_advertised' : 'slow_lane_not_owned_by_this_tab', {
          objectId,
          payloadBytes: firstRecord.payload.byteLength,
          maxUpdateBytes: realtimeLimit,
          maxSlowSyncUpdateBytes: slowLimit,
        });
        return;
      }

      try {
        const coordinated = await runSlowSyncCoordinated(userId, workspaceId, async () => {
          if (suppressedObjects.has(objectId) || !sameDrainSession(drainConfig, initialConfig) || isPurging) {
            return { status: 'aborted' as const };
          }

          // Another tab may have completed the prefix while this tab waited
          // for the lock. Re-read and select under the lock so the upload and
          // its exact-ID retirement operate on one authoritative snapshot.
          const lockedRecords = await readOutboxPrefix(userId, workspaceId, objectId);

          if (suppressedObjects.has(objectId) || !sameDrainSession(drainConfig, initialConfig) || isPurging) {
            return { status: 'aborted' as const };
          }

          if (lockedRecords.length === 0) {
            return { status: 'rescan' as const };
          }

          const lockedFirstRecord = lockedRecords[0];
          const lockedHeadNeedsSlowLane =
            realtimeLimit !== undefined && lockedFirstRecord.payload.byteLength > realtimeLimit;

          if (!lockedHeadNeedsSlowLane) {
            return { status: 'rescan' as const };
          }

          const lockedBatch = selectRecordsForSlowSync(lockedRecords, slowLimit);

          if (lockedBatch.merged.byteLength > slowLimit) {
            logOversizedOnce(objectSessionKey, 'update_exceeds_slow_lane_limit', {
              objectId,
              payloadBytes: lockedBatch.merged.byteLength,
              stateVectorBytes: lockedBatch.stateVector.byteLength,
              maxUpdateBytes: realtimeLimit,
              maxSlowSyncUpdateBytes: slowLimit,
            });
            return { status: 'stalled' as const };
          }

          const lockedLastRecord = lockedBatch.records[lockedBatch.records.length - 1];
          const lockedIds = recordIds(lockedBatch.records);
          const result = await config.slowSync!({
            objectId,
            collabType: lockedLastRecord.collabType as Types,
            version: lockedLastRecord.version,
            stateVector: lockedBatch.stateVector,
            docState: lockedBatch.merged,
          });

          if (result.outcome === 'blocked') {
            return {
              status: 'blocked' as const,
              reason: result.reason,
              recordCount: lockedIds.length,
              payloadBytes: lockedBatch.merged.byteLength,
            };
          }

          if (suppressedObjects.has(objectId) || !sameDrainSession(drainConfig, initialConfig) || isPurging) {
            return { status: 'aborted' as const };
          }

          // Keep retirement inside the same lock as the upload. A successor
          // tab therefore observes either the old prefix (and waits) or the
          // post-confirmation state, never the stale in-between snapshot.
          await db.sync_outbox.bulkDelete(lockedIds);
          return { status: 'confirmed' as const };
        });

        if (coordinated.status === 'aborted' || coordinated.status === 'stalled') return;
        if (coordinated.status === 'rescan') continue;
        if (coordinated.status === 'blocked') {
          blockedSlowSyncObjects.set(objectSessionKey, coordinated.reason);
          logOversizedOnce(objectSessionKey, coordinated.reason, {
            objectId,
            recordCount: coordinated.recordCount,
            payloadBytes: coordinated.payloadBytes,
          });
          return;
        }
      } catch (error) {
        Log.warn('[outbox] HTTP slow-sync transaction failed; leaving records queued', {
          objectId,
          headPayloadBytes: firstRecord.payload.byteLength,
          error,
        });
        scheduleSlowSyncRetry(userId, workspaceId, objectId, retryAfterSecsFromError(error));
        return;
      }

      clearSlowSyncRetry(objectSessionKey);
      oversizedDiagnostics.delete(objectSessionKey);
      blockedSlowSyncObjects.delete(objectSessionKey);
      continue;
    }

    if (!config.isReady()) return;

    const realtimeBatch = selectRecordsForRealtime(records, realtimeLimit);
    const lastRecord = realtimeBatch.records[realtimeBatch.records.length - 1];
    const message = buildUpdateMessage({
      objectId,
      collabType: lastRecord.collabType,
      payload: realtimeBatch.merged,
      version: lastRecord.version,
      beforeStateVector: firstRecord.beforeStateVector,
    });

    // Synchronous gate right before the send. Abort if a discard is in
    // progress for this objectId, the drain config has been swapped out
    // (workspace change), or a purge is quiescing the outbox (logout).
    // Records stay in IDB (if any still exist after a concurrent delete)
    // and will be picked up by a future drain.
    if (suppressedObjects.has(objectId) || drainConfig !== initialConfig || isPurging) return;

    if (!config.isReady()) return;

    try {
      config.send(message);
    } catch (error) {
      Log.warn('[outbox] send failed; leaving records queued', { objectId, error });
      return;
    }

    const ids = recordIds(realtimeBatch.records);

    try {
      await db.sync_outbox.bulkDelete(ids);
    } catch (error) {
      Log.error('[outbox] bulkDelete failed after send', { objectId, error });
      return;
    }
  }
}
