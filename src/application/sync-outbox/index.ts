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
   * SHOULD tolerate a closed socket by buffering in the WebSocket library's
   * in-memory retry queue (e.g. react-use-websocket's `keep=true`), so the
   * edit at least reaches the server after reconnect while this tab is alive.
   */
  sendBestEffort?: OutboxSender;
  isReady: OutboxReady;
}

let drainConfig: DrainConfig | null = null;
// The (userId, workspaceId) that new enqueues are stamped with. Must be set
// before any local edits can happen; kept in sync with the active sync layer.
let currentUserId: string | null = null;
let currentWorkspaceId: string | null = null;
const draining = new Map<string, Promise<void>>();
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

/**
 * Set (or clear) the session that subsequent enqueues will be stamped with.
 * Called by the app's sync layer when mounting / switching sessions.
 * Records left behind from a previous session stay in the outbox and will
 * only drain when that session's sync layer is re-mounted with the matching
 * `(userId, workspaceId)`.
 */
export function setCurrentSession(session: { userId: string; workspaceId: string } | null) {
  currentUserId = session?.userId ?? null;
  currentWorkspaceId = session?.workspaceId ?? null;
}

export function enqueueOutboxUpdate(record: Omit<SyncOutboxRecord, 'id' | 'createdAt' | 'workspaceId' | 'userId'>) {
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
  // server send happens later through the outbox drain; the peer broadcast
  // keeps multi-tab collaboration responsive during reconnect windows.
  const broadcast = drainConfig?.broadcast;

  if (broadcast && drainConfig?.workspaceId === workspaceId) {
    const peerMessage: messages.IMessage = {
      collabMessage: {
        objectId: record.objectId,
        collabType: record.collabType,
        update: {
          flags: FLAGS_LIB0V1,
          payload: record.payload,
          version: record.version ?? undefined,
        } as collab.IUpdate,
      },
    };

    try {
      broadcast(peerMessage);
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

  const addPromise: Promise<unknown> = db.sync_outbox.add(row as SyncOutboxRecord);
  const set = inflightAdds.get(record.objectId) ?? new Set<Promise<unknown>>();

  set.add(addPromise);
  inflightAdds.set(record.objectId, set);

  addPromise
    .then(() => {
      Log.debug('[outbox] enqueue persisted', {
        workspaceId,
        objectId: record.objectId,
        collabType: record.collabType,
        payloadBytes: record.payload.byteLength,
      });
      scheduleDrain(record.objectId);
    })
    .catch((error) => {
      Log.error('[outbox] enqueue failed', { objectId: record.objectId, error });

      // IDB write failed (quota exhausted, upgrade blocked, etc.). Fall back
      // through the CURRENT drain config's best-effort send, but only if we
      // are still in the same session (userId AND workspaceId). Comparing
      // by string (not by config object identity) is important: AppSyncLayer
      // rebuilds drainConfig on same-session readyState changes — identity
      // comparison would spuriously treat those rebuilds as session switches.
      const activeConfig = drainConfig;

      if (
        !activeConfig ||
        activeConfig.userId !== enqueueUserId ||
        activeConfig.workspaceId !== enqueueWorkspaceId
      ) {
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

      const directMessage: messages.IMessage = {
        collabMessage: {
          objectId: record.objectId,
          collabType: record.collabType,
          update: {
            flags: FLAGS_LIB0V1,
            payload: record.payload,
            version: record.version ?? undefined,
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
  drainConfig = config;
}

export function clearDrainConfig() {
  drainConfig = null;
  pendingRerun.clear();
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

    if (!drainConfig) return;

    try {
      const objectIds = await distinctObjectIdsForSession(drainConfig.userId, drainConfig.workspaceId);

      Log.debug('[outbox] startDrainAll discovered pending objects', {
        workspaceId: drainConfig.workspaceId,
        objectCount: objectIds.length,
      });

      for (const objectId of objectIds) {
        scheduleDrain(objectId);
      }
    } catch (error) {
      Log.warn('[outbox] startDrainAll failed', error);
    }
  });
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
export async function waitForDrain(
  objectIds?: string[],
  opts?: WaitForDrainOptions,
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 5_000;
  const pollIntervalMs = opts?.pollIntervalMs ?? 150;
  const start = Date.now();
  const ids = objectIds ?? (drainConfig ? await distinctObjectIdsForSession(drainConfig.userId, drainConfig.workspaceId) : []);

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
      ids.map((id) =>
        db.sync_outbox.where('[userId+workspaceId+objectId]').equals([userId, workspaceId, id]).count(),
      ),
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

export async function deleteOutboxByObjectId(objectId: string): Promise<void> {
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

    if (existingDrain) {
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

    await db.sync_outbox
      .where('[userId+workspaceId+objectId]')
      .equals([userId, workspaceId, objectId])
      .delete();
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

// Note: we deliberately do NOT use `navigator.locks.request(..., { ifAvailable: true })`
// to coordinate drains across tabs. That approach silently skipped the drain
// body when another tab held the lock, stranding records until some later
// trigger re-scheduled them. Each tab now drains its own schedule; duplicate
// sends are harmless because Yjs updates are idempotent and the post-send
// `bulkDelete` on already-deleted ids is a no-op.

async function drainObjectWhileReady(objectId: string): Promise<void> {
  // Snapshot the drain config at loop entry. If the user switches workspace
  // mid-iteration, `drainConfig` changes but this snapshot does not — so we
  // never send workspace A's records over workspace B's WebSocket.
  const initialConfig = drainConfig;

  // eslint-disable-next-line no-constant-condition
  for (;;) {
    // Re-read the module config each iteration and abort if it has been
    // swapped out (workspace change / sign-out) or is not ready (WS closed).
    const config = drainConfig;

    if (!config || config !== initialConfig || !config.isReady()) return;

    const userId = config.userId;
    const workspaceId = config.workspaceId;
    const records = await db.sync_outbox
      .where('[userId+workspaceId+objectId]')
      .equals([userId, workspaceId, objectId])
      .sortBy('id');

    if (records.length === 0) return;

    const merged = records.length === 1
      ? records[0].payload
      : Y.mergeUpdates(records.map((r) => r.payload));
    const collabType = records[records.length - 1].collabType as Types;
    const version = records[records.length - 1].version;
    const payloadBytes = records.reduce((sum, record) => sum + record.payload.byteLength, 0);

    Log.debug('[outbox] draining object', {
      workspaceId,
      objectId,
      collabType,
      recordCount: records.length,
      payloadBytes,
      mergedBytes: merged.byteLength,
    });

    const message: messages.IMessage = {
      collabMessage: {
        objectId,
        collabType,
        update: {
          flags: FLAGS_LIB0V1,
          payload: merged,
          version: version ?? undefined,
        } as collab.IUpdate,
      },
    };

    // Synchronous gate right before the send. Abort if a discard is in
    // progress for this objectId, the drain config has been swapped out
    // (workspace change), or a purge is quiescing the outbox (logout).
    // Records stay in IDB (if any still exist after a concurrent delete)
    // and will be picked up by a future drain.
    if (suppressedObjects.has(objectId) || drainConfig !== initialConfig || isPurging) return;

    try {
      config.send(message);
      Log.debug('[outbox] sent object update', {
        workspaceId,
        objectId,
        collabType,
        recordCount: records.length,
        mergedBytes: merged.byteLength,
      });
    } catch (error) {
      Log.warn('[outbox] send failed; leaving records for retry', { objectId, error });
      return;
    }

    const ids = records.map((r) => r.id).filter((id): id is number => id !== undefined);

    try {
      await db.sync_outbox.bulkDelete(ids);
      Log.debug('[outbox] deleted drained records', {
        workspaceId,
        objectId,
        deletedCount: ids.length,
      });
    } catch (error) {
      Log.error('[outbox] bulkDelete failed after send', { objectId, error });
      return;
    }
  }
}
