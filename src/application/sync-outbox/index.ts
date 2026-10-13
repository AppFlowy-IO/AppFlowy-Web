import BaseDexie from 'dexie';
import * as Y from 'yjs';

import { db, matchesDatabaseStorageFence } from '@/application/db';
import { type DatabaseStorageFence, isDatabaseStorageFenceCurrent } from '@/application/db/database-storage-fence';
import { SyncOutboxRecord } from '@/application/db/tables/sync_outbox';
import { Types } from '@/application/types';
import { collab, messages } from '@/proto/messages';
import { Log } from '@/utils/log';

import { permissionBlockKey, persistPermissionBlock, readPermissionBlock, releasePermissionBlock } from './permission-quarantine';

// Inlined to avoid a circular import with sync-protocol. Value must match
// UpdateFlags.Lib0v1 in sync-protocol.ts.
const FLAGS_LIB0V1 = 0;

export type OutboxSender = (message: messages.IMessage) => void;

export type OutboxReady = () => boolean;

export interface SyncOutboxSession {
  userId: string;
  workspaceId: string;
  serverUrl?: string;
}

export interface SlowSyncOutboxItem {
  objectId: string;
  collabType: Types;
  version?: string | null;
  databaseRestoreId?: string;
  stateVector: Uint8Array;
  docState: Uint8Array;
}

export type SlowSyncBlockedReason = 'permission_denied' | 'update_too_large';

type SlowSyncBlock =
  /** Resolves false when the durable quarantine could not be written; this tab then keeps it in memory. */
  | { reason: 'permission_denied'; persisted: Promise<boolean> }
  | { reason: 'update_too_large'; recordIds: number[] };

export type UploadPermissionVerdict = 'allowed' | 'denied' | 'unknown';

/** Outcome of an explicit retry, per object that had quarantined edits. */
export interface PermissionRetryResult {
  /** Edit access is current; the edits are queued for upload again. */
  released: string[];
  /** Edit access is still missing, or a newer denial replaced the reviewed one. */
  denied: string[];
  /** Access could not be checked (offline, server error, superseded check). */
  unknown: string[];
}

/**
 * - allowed: send now.
 * - denied: quarantined until an explicit retry.
 * - unknown: the check failed; retried with backoff.
 * - held: the database restore barrier keeps the bytes queued.
 * - stale: a permission change happened during the check; check again.
 */
type AdmissionVerdict = UploadPermissionVerdict | 'held' | 'stale';

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
  serverUrl?: string;
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
  /**
   * Verify the current database restore identity before transmitting captured
   * Database/DatabaseRow bytes; other collab types never wait on it. False
   * leaves durable records queued; a reset may discard them.
   * A callback that discards this object must use skipActiveDrain to avoid
   * waiting for the drain that is awaiting this callback.
   */
  beforeSend?: (objectId: string, collabType: Types, databaseRestoreId?: string) => Promise<boolean>;
  /** Current canonical authority, fenced by the owning session and permission revision. */
  checkPermission?: (objectId: string, collabType: Types) => Promise<UploadPermissionVerdict>;
  /**
   * Synchronous view of a still-fresh `checkPermission` verdict. An object whose
   * last full admission still holds sends edits immediately (sibling tabs and
   * the server) instead of waiting for IndexedDB and a permission round trip.
   */
  peekPermission?: (objectId: string, collabType: Types) => UploadPermissionVerdict | undefined;
  /** Fence legacy database bytes as the unmarked generation on capable servers. */
  databaseHistoryEnabled?: boolean;
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
  /**
   * Persists one oversized object through the authenticated HTTP full-sync
   * endpoint. Confirmation requires a durable RID unless an authoritative
   * collab-version change supersedes the queued update.
   */
  slowSync?: (item: SlowSyncOutboxItem, signal: AbortSignal) => Promise<SlowSyncOutboxResult>;
}

let drainConfig: DrainConfig | null = null;
// The (userId, workspaceId) that new enqueues are stamped with. Must be set
// before any local edits can happen; kept in sync with the active sync layer.
let currentUserId: string | null = null;
let currentWorkspaceId: string | null = null;
let currentServerUrl: string | undefined;
const draining = new Map<string, Promise<void>>();
const slowSyncRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const slowSyncRetryAttempts = new Map<string, number>();
const oversizedDiagnostics = new Map<string, string>();
const blockedSlowSyncObjects = new Map<string, SlowSyncBlock>();
const serializedSlowSyncObjects = new Set<string>();
const slowSyncAbortControllers = new Map<string, AbortController>();
let slowSyncQueue: Promise<void> = Promise.resolve();
// Object ids whose records were enqueued while a drain was already in flight.
// Processed in the drain's finally block so the race between the drain loop's
// "nothing left" exit and a concurrent enqueue cannot leave records stranded.
const pendingRerun = new Set<string>();
// Tracks in-flight `db.sync_outbox.add()` promises per objectId. `flush()` and
// `discardPendingUpdates()` await these before proceeding so a record whose
// IDB write is still pending cannot be missed by a flush or survive a discard.
const inflightAdds = new Map<string, Set<Promise<unknown>>>();
// Session-object keys currently being discarded. Scoping suppression prevents
// stale async cleanup from workspace A from dropping edits in workspace B.
// A drain loop that already loaded records must abort before sending.
const suppressedObjects = new Set<string>();
// An awaited permission/restore check can outlive a completed discard. The
// suppression set alone cannot detect that case once cleanup releases it.
const objectGenerations = new Map<string, number>();
let lifecycleGeneration = 0;
let permissionGeneration = 0;
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

// Objects whose last full admission (current edit access, no quarantine, restore
// barrier passed) still holds in the captured generations. Only these may take
// the immediate realtime path while permission checks are configured.
const admittedObjects = new Map<string, { lifecycle: number; permission: number; object: number }>();
// Checked enqueues still waiting for admission. A later immediate send for the
// same object must not overtake them.
const pendingAdmissions = new Map<string, number>();
const admissionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const admissionRetryAttempts = new Map<string, number>();

const SLOW_SYNC_RETRY_DELAYS_MS = [5_000, 30_000, 2 * 60_000, 5 * 60_000];
const ADMISSION_RETRY_DELAYS_MS = [5_000, 30_000, 2 * 60_000, 5 * 60_000];
const DEFAULT_REALTIME_UPDATE_BYTES = 4 * 1024 * 1024;
const OUTBOX_READ_BATCH_SIZE = 64;
const SLOW_SYNC_LOCK_PREFIX = 'appflowy:sync-outbox:slow';

interface EnqueueOutboxOptions {
  /** Manifest replies are server-directed and do not need sibling-tab fan-out. */
  broadcast?: boolean;
  /** Coalesce older server-directed manifests without touching local edits. */
  source?: 'manifest';
}

function sessionObjectKey(userId: string, workspaceId: string, objectId: string, serverUrl?: string): string {
  return `${userId}\u0000${workspaceId}\u0000${serverUrl ?? ''}\u0000${objectId}`;
}

function sessionKey(userId: string, workspaceId: string, serverUrl?: string): string {
  return `${userId}\u0000${workspaceId}\u0000${serverUrl ?? ''}`;
}

/**
 * Set (or clear) the session that subsequent enqueues will be stamped with.
 * Called by the app's sync layer when mounting / switching sessions.
 * Records left behind from a previous session stay in the outbox and will
 * only drain when that session's sync layer is re-mounted with the matching
 * `(userId, workspaceId)`.
 */
export function setCurrentSession(session: SyncOutboxSession | null) {
  const nextUserId = session?.userId ?? null;
  const nextWorkspaceId = session?.workspaceId ?? null;
  const nextSessionKey = nextUserId && nextWorkspaceId ? sessionKey(nextUserId, nextWorkspaceId, session?.serverUrl) : null;
  const currentSessionKey = currentUserId && currentWorkspaceId ? sessionKey(currentUserId, currentWorkspaceId, currentServerUrl) : null;

  if (nextSessionKey !== currentSessionKey) {
    lifecycleGeneration += 1;
    discoveredOutboxSessionKey = null;
  }

  currentUserId = nextUserId;
  currentWorkspaceId = nextWorkspaceId;
  currentServerUrl = session?.serverUrl;
}

/**
 * Capture the session that owns newly enqueued records. Passing an expected
 * workspace prevents async work from accidentally snapshotting a replacement
 * workspace during a route/session transition.
 */
export function getCurrentOutboxSession(expectedWorkspaceId?: string): SyncOutboxSession | null {
  if (!currentUserId || !currentWorkspaceId) return null;
  if (expectedWorkspaceId && currentWorkspaceId !== expectedWorkspaceId) return null;

  return { userId: currentUserId, workspaceId: currentWorkspaceId, ...(currentServerUrl ? { serverUrl: currentServerUrl } : {}) };
}

/** Resolves true only after the update has been written to IndexedDB. */
export function enqueueOutboxUpdate(
  record: Omit<SyncOutboxRecord, 'id' | 'createdAt' | 'workspaceId' | 'userId' | 'source'>,
  options?: EnqueueOutboxOptions
): Promise<boolean> {
  if (isPurging) {
    // Logout / session-change in progress — drop. A new session will
    // re-enqueue any genuinely-pending edits through its own lifecycle.
    Log.debug('[outbox] enqueue dropped: purge in progress', { objectId: record.objectId });
    return Promise.resolve(false);
  }

  const userId = currentUserId;
  const workspaceId = currentWorkspaceId;

  if (!userId || !workspaceId) {
    Log.warn('[outbox] enqueue skipped: no session configured', { objectId: record.objectId });
    return Promise.resolve(false);
  }

  const objectSessionKey = sessionObjectKey(userId, workspaceId, record.objectId, currentServerUrl);
  const capturedLifecycleGeneration = lifecycleGeneration;
  const capturedPermissionGeneration = permissionGeneration;
  const capturedObjectGeneration = objectGenerations.get(objectSessionKey) ?? 0;
  const isCurrentGeneration = () =>
    lifecycleGeneration === capturedLifecycleGeneration &&
    permissionGeneration === capturedPermissionGeneration &&
    (objectGenerations.get(objectSessionKey) ?? 0) === capturedObjectGeneration;
  // Only a permission change invalidated this enqueue's check: the row is still
  // owned by this session and object, so it is checked again.
  const onlyPermissionChanged = () =>
    lifecycleGeneration === capturedLifecycleGeneration &&
    (objectGenerations.get(objectSessionKey) ?? 0) === capturedObjectGeneration &&
    permissionGeneration !== capturedPermissionGeneration;

  // A discard is in progress for this objectId (version reset / revert).
  // Refuse to add new rows so a local edit landing mid-discard cannot slip
  // past `deleteOutboxByObjectId()`'s inflight-snapshot wait and later drain
  // onto the rebuilt doc. The doc whose observers produced this update is
  // about to be destroyed; the rebuilt doc starts from server state.
  if (suppressedObjects.has(objectSessionKey)) {
    Log.debug('[outbox] enqueue dropped: discard in progress', { objectId: record.objectId });
    return Promise.resolve(false);
  }

  const row: Omit<SyncOutboxRecord, 'id'> = {
    ...record,
    userId,
    workspaceId,
    serverUrl: currentServerUrl,
    createdAt: Date.now(),
    source: options?.source,
  };

  const activeConfig = drainConfig;
  const sameActiveSession = Boolean(
    activeConfig &&
      activeConfig.userId === userId &&
      activeConfig.workspaceId === workspaceId &&
      activeConfig.serverUrl === row.serverUrl
  );
  // Ordinary edits keep the low-latency realtime path. With permission checks,
  // that path is open only while this object's last full admission still holds;
  // otherwise the edit is persisted and checked first (database objects always
  // wait for their restore check).
  const immediate = Boolean(activeConfig && sameActiveSession && canSendImmediately(activeConfig, record));

  // Fan out to sibling tabs immediately, regardless of WebSocket state. The
  // server send uses the same update shape below when the WebSocket is open;
  // the durable outbox row remains the fallback when it is not.
  if (options?.broadcast !== false && activeConfig?.broadcast && immediate) {
    try {
      activeConfig.broadcast(buildUpdateMessage(record, activeConfig));
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
  const isIndividuallyOversized = exceedsRealtimeLimit(record.payload.byteLength, drainConfig?.maxUpdateBytes);

  if (isIndividuallyOversized) {
    serializedSlowSyncObjects.add(objectSessionKey);
  }

  const checked = Boolean(activeConfig && requiresUploadAdmission(activeConfig, record.collabType) && !immediate);

  if (checked) pendingAdmissions.set(objectSessionKey, (pendingAdmissions.get(objectSessionKey) ?? 0) + 1);
  const addPromise: Promise<unknown> = persistOutboxRow(row as SyncOutboxRecord);
  const set = inflightAdds.get(record.objectId) ?? new Set<Promise<unknown>>();
  let sentImmediately = false;
  const notifyPersisted =
    activeConfig?.userId === enqueueUserId && activeConfig.workspaceId === enqueueWorkspaceId
      ? activeConfig.onPersisted
      : undefined;
  const notifyOwner = () => {
    try {
      notifyPersisted?.(enqueueWorkspaceId, record.objectId);
    } catch (error) {
      Log.warn('[outbox] durable-update notification failed', {
        workspaceId: enqueueWorkspaceId,
        objectId: record.objectId,
        error,
      });
    }
  };

  // Oversized updates are different: they must first become durable, then the
  // serialized drain routes them through HTTP. Sending one here would exceed
  // the server frame limit before the slow lane gets a chance to run.
  if (
    activeConfig &&
    immediate &&
    !isPurging &&
    discoveredOutboxSessionKey === sessionKey(enqueueUserId, enqueueWorkspaceId, row.serverUrl) &&
    !suppressedObjects.has(objectSessionKey) &&
    !draining.has(record.objectId) &&
    activeConfig.isReady() &&
    !isIndividuallyOversized &&
    !serializedSlowSyncObjects.has(objectSessionKey)
  ) {
    try {
      activeConfig.send(buildUpdateMessage(record, activeConfig));
      sentImmediately = true;
    } catch (error) {
      Log.warn('[outbox] immediate send failed; durable row will drain', { objectId: record.objectId, error });
    }
  }

  set.add(addPromise);
  inflightAdds.set(record.objectId, set);

  const releaseAdmission = () => {
    if (!checked) return;
    const remaining = (pendingAdmissions.get(objectSessionKey) ?? 1) - 1;

    if (remaining > 0) pendingAdmissions.set(objectSessionKey, remaining);
    else pendingAdmissions.delete(objectSessionKey);
  };

  return addPromise
    .then(async (id) => {
      if (activeConfig && checked) {
        const verdict = await admitOutboxUpdate(
          activeConfig,
          record.objectId,
          record.collabType as Types,
          record.databaseRestoreId
        );

        if (verdict === 'unknown' && isCurrentGeneration() && sameDrainSession(drainConfig, activeConfig)) {
          // A transient failure keeps the row durable. Retry with backoff and let
          // the socket owner (possibly another tab) try as well.
          scheduleAdmissionRetry(activeConfig, record.objectId);
          notifyOwner();
        }

        if (
          verdict !== 'allowed' ||
          !isCurrentGeneration() ||
          !sameDrainSession(drainConfig, activeConfig) ||
          isPurging ||
          suppressedObjects.has(objectSessionKey)
        ) {
          if ((verdict === 'stale' || onlyPermissionChanged()) && sameDrainSession(drainConfig, activeConfig)) {
            scheduleDrain(record.objectId);
          }

          return true;
        }

        // Keep the enqueue durable while the check is pending, including
        // offline operation. Fan-out is subject to the same restore barrier
        // as WebSocket and HTTP transmission.
        if (options?.broadcast !== false) {
          try {
            activeConfig.broadcast?.(buildUpdateMessage(record, activeConfig));
          } catch (error) {
            Log.warn('[outbox] broadcast failed', { objectId: record.objectId, error });
          }
        }
      }

      notifyOwner();

      if (sentImmediately) {
        // A sibling tab may have quarantined this object after this tab's
        // admission. Keep a row that persisted as quarantined for explicit retry.
        if (typeof id === 'number' && !row.permissionBlocked) {
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
        return true;
      }

      scheduleDrain(record.objectId);
      return true;
    })
    .catch(async (error) => {
      if (sentImmediately) {
        Log.warn('[outbox] enqueue failed after immediate send', { objectId: record.objectId, error });
        return false;
      }

      Log.error('[outbox] enqueue failed', { objectId: record.objectId, error });

      // IDB write failed (quota exhausted, upgrade blocked, etc.). Fall back
      // through the CURRENT drain config's best-effort send, but only if we
      // are still in the same session (userId AND workspaceId). Comparing
      // by string (not by config object identity) is important: AppSyncLayer
      // rebuilds drainConfig on same-session readyState changes — identity
      // comparison would spuriously treat those rebuilds as session switches.
      const fallbackConfig = drainConfig;

      if (!fallbackConfig || fallbackConfig.userId !== enqueueUserId || fallbackConfig.workspaceId !== enqueueWorkspaceId || fallbackConfig.serverUrl !== row.serverUrl) {
        Log.warn('[outbox] fallback skipped: session changed since enqueue', {
          objectId: record.objectId,
          enqueueUserId,
          enqueueWorkspaceId,
          currentUserId: fallbackConfig?.userId,
          currentWorkspaceId: fallbackConfig?.workspaceId,
        });
        return false;
      }

      // A purge (logout) or version-reset discard started while the IDB write
      // was in flight. The synchronous guard at enqueue time passed, but the
      // state has since changed — drop the fallback to honour the boundary.
      if (isPurging || suppressedObjects.has(objectSessionKey)) {
        Log.debug('[outbox] fallback skipped: purge/discard in progress', { objectId: record.objectId });
        return false;
      }

      // An update above the realtime limit must never leak onto WebSocket.
      // Without a durable row there is no safe way to retry the slow lane
      // after a refresh, so fail visibly and let the next manifest exchange
      // reconstruct the diff instead of closing the socket with an oversize
      // frame.
      if (exceedsRealtimeLimit(record.payload.byteLength, fallbackConfig.maxUpdateBytes)) {
        Log.error('[outbox] oversized update could not be persisted; WebSocket fallback suppressed', {
          objectId: record.objectId,
          payloadBytes: record.payload.byteLength,
          maxUpdateBytes: fallbackConfig.maxUpdateBytes,
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

        return false;
      }

      const directMessage: messages.IMessage = {
        collabMessage: {
          objectId: record.objectId,
          collabType: record.collabType,
          update: {
            flags: FLAGS_LIB0V1,
            payload: record.payload,
            version: record.version ?? undefined,
            databaseRestoreId: wireDatabaseRestoreId(fallbackConfig, record.collabType, record.databaseRestoreId),
            beforeStateVector: record.beforeStateVector,
          } as collab.IUpdate,
        },
      };

      const fallback = fallbackConfig.sendBestEffort ?? (fallbackConfig.isReady() ? fallbackConfig.send : undefined);

      if (!fallback) {
        Log.warn('[outbox] cannot fall back: no sendBestEffort and WS not OPEN', {
          objectId: record.objectId,
        });
        return false;
      }

      if (
        requiresUploadAdmission(fallbackConfig, record.collabType) &&
        (await admitOutboxUpdate(fallbackConfig, record.objectId, record.collabType as Types, record.databaseRestoreId)) !==
          'allowed'
      ) {
        return false;
      }

      if (
        !isCurrentGeneration() ||
        !sameDrainSession(drainConfig, fallbackConfig) ||
        isPurging ||
        suppressedObjects.has(objectSessionKey)
      ) {
        return false;
      }

      try {
        fallback(directMessage);
      } catch (sendError) {
        Log.warn('[outbox] fallback send also failed', {
          objectId: record.objectId,
          error: sendError,
        });
      }

      return false;
    })
    .finally(() => {
      releaseAdmission();
      const current = inflightAdds.get(record.objectId);

      if (!current) return;
      current.delete(addPromise);
      if (current.size === 0) {
        inflightAdds.delete(record.objectId);
      }
    });
}

/**
 * Atomically replace older pending manifest snapshots for one session/object.
 * IndexedDB serializes read-write transactions across tabs, so concurrent
 * manifest replies cannot both observe an empty prefix and commit duplicates.
 */
async function persistOutboxRow(row: SyncOutboxRecord): Promise<number> {
  return db.transaction('rw', db.sync_outbox, db.sync_permission_blocks, async () => {
    if (await readPermissionBlock(row, row.objectId)) row.permissionBlocked = true;
    if (row.source !== 'manifest') return db.sync_outbox.add(row);
    const supersededIds: number[] = [];

    await db.sync_outbox
      .where('[userId+workspaceId+objectId]')
      .equals([row.userId, row.workspaceId, row.objectId])
      .each((pending) => {
        if (
          pending.source === 'manifest' &&
          pending.serverUrl === row.serverUrl &&
          !pending.permissionBlocked &&
          pending.id !== undefined &&
          pending.databaseRestoreId === row.databaseRestoreId &&
          (pending.version ?? undefined) === (row.version ?? undefined)
        ) {
          supersededIds.push(pending.id);
        }
      });

    if (supersededIds.length > 0) {
      await db.sync_outbox.bulkDelete(supersededIds);
    }

    return db.sync_outbox.add(row);
  });
}

/**
 * Gate non-outbox full-sync paths with the same durable quarantine. The server
 * still authorizes every item and reports `permission_denied` per item, so no
 * permission request is made here (a large batch must not drop items because
 * a probe queue overflowed).
 */
export async function mayUploadCollab(objectId: string, collabType: Types, workspaceId: string): Promise<boolean> {
  const config = drainConfig;
  const generation = lifecycleGeneration;

  if (!config || config.workspaceId !== workspaceId) return false;
  if (!config.checkPermission) return true;
  const records = await readOutboxPrefix(config.userId, workspaceId, objectId, config.serverUrl);

  if (isSlowSyncBlockedForRecords(sessionObjectKey(config.userId, workspaceId, objectId, config.serverUrl), records)) return false;
  if (await countPermissionBlockedRows(config, objectId) > 0 || await hasActivePermissionBlock(config, objectId)) return false;

  return drainConfig === config && generation === lifecycleGeneration;
}

/** Capture freshness once for a composed batch, before checking its first item. */
export function captureSyncAuthorization(workspaceId: string): () => boolean {
  const config = drainConfig;
  const lifecycle = lifecycleGeneration;
  const permission = permissionGeneration;

  return () => Boolean(config && config === drainConfig && config.workspaceId === workspaceId &&
    lifecycle === lifecycleGeneration && permission === permissionGeneration);
}

async function awaitInflightAdds(objectId: string): Promise<void> {
  const pending = inflightAdds.get(objectId);

  if (!pending || pending.size === 0) return;
  // Snapshot the set so new additions during the await don't extend the wait.
  await Promise.allSettled(Array.from(pending));
}

export function configureDrain(config: DrainConfig) {
  const previousConfig = drainConfig;

  if (previousConfig && (previousConfig.userId !== config.userId || previousConfig.workspaceId !== config.workspaceId || previousConfig.serverUrl !== config.serverUrl)) {
    abortSlowSyncCoordinations(previousConfig.userId, previousConfig.workspaceId);
  }

  // A meaningful owner/capability rebuild is the point at which a previously
  // terminal server decision may have changed (permission grant or larger
  // advertised limit). Ordinary readyState transitions no longer rebuild.
  for (const [key, block] of blockedSlowSyncObjects) {
    if (block.reason !== 'permission_denied' && key.startsWith(`${config.userId}\u0000${config.workspaceId}\u0000`)) {
      blockedSlowSyncObjects.delete(key);
    }
  }

  admittedObjects.clear();
  drainConfig = config;
}

export function clearDrainConfig() {
  const previousConfig = drainConfig;

  drainConfig = null;
  if (previousConfig) {
    abortSlowSyncCoordinations(previousConfig.userId, previousConfig.workspaceId);
  }

  admittedObjects.clear();
  pendingRerun.clear();
  oversizedDiagnostics.clear();
  // Retry state is session-object keyed and intentionally survives a
  // same-session transport/config rebuild. Purge owns the hard reset.
}

/**
 * Re-check every queued object (or one) without consuming a quarantine: a hint
 * only schedules fresh checks, and restoring a grant still requires the user's
 * explicit retry. `abortDenied` (real permission changes only) also cancels an
 * in-flight upload whose fresh check is denied; uploads that are still allowed
 * keep running.
 */
export async function resumePermissionBlockedSync(objectId?: string, options: { abortDenied?: boolean } = {}): Promise<void> {
  const config = drainConfig;

  if (!config?.checkPermission) return;
  const generation = lifecycleGeneration;
  const objectIds = objectId ? [objectId] : await distinctObjectIdsForSession(config.userId, config.workspaceId, config.serverUrl);

  for (const id of objectIds) {
    if (drainConfig !== config || generation !== lifecycleGeneration) return;
    const records = await readOutboxPrefix(config.userId, config.workspaceId, id, config.serverUrl);
    const first = records[0];

    // Quarantined edits are released only by an explicit retry, so a re-check
    // could not change anything for them.
    if (!first || records.some((record) => record.permissionBlocked)) continue;
    const permission = await config.checkPermission(id, first.collabType as Types);

    if (drainConfig !== config || generation !== lifecycleGeneration) return;
    const key = sessionObjectKey(config.userId, config.workspaceId, id, config.serverUrl);

    if (permission === 'denied') {
      if (options.abortDenied) abortSlowSyncCoordination(key);
      // Confirming an existing quarantine is not a new denial: keep the
      // revision a concurrent explicit retry may have reviewed.
      await quarantinePermissionUpdates(id, config);
    } else if (permission === 'allowed') {
      clearAdmissionRetry(key);
      scheduleDrain(id);
    } else {
      scheduleAdmissionRetry(config, id);
    }
  }
}

/**
 * A permission change fences admission decisions made before it and closes the
 * immediate path until each object is checked again. In-flight uploads keep
 * running: the server stays the authority, and `resumePermissionBlockedSync`
 * cancels only uploads whose fresh check is denied.
 */
export function invalidateOutboxPermissions(): void {
  permissionGeneration += 1;
  admittedObjects.clear();
}

/**
 * Focus, visibility, connectivity and socket-open events may follow a missed
 * permission notification. Re-check before the next immediate send without
 * fencing checks or uploads already in progress.
 */
export function expireOutboxAdmissions(): void {
  admittedObjects.clear();
}

/** Record a canonical denial even before a rejected socket edit is reconstructed. */
export async function blockPermissionSync(objectId: string, expectedWorkspaceId: string): Promise<void> {
  const config = drainConfig;

  if (!config || config.workspaceId !== expectedWorkspaceId) return;
  const key = sessionObjectKey(config.userId, config.workspaceId, objectId, config.serverUrl);

  // A denial for one object fences only that object's checks and upload.
  objectGenerations.set(key, (objectGenerations.get(key) ?? 0) + 1);
  abortSlowSyncCoordination(key);
  await quarantinePermissionUpdates(objectId, config, { renew: true });
}

/**
 * Retain pending bytes across access loss, including small WebSocket updates.
 * `renew` records a new denial revision; otherwise an existing quarantine keeps
 * its revision.
 */
async function quarantinePermissionUpdates(
  objectId: string,
  config: DrainConfig,
  options: { renew?: boolean } = {}
): Promise<void> {
  const key = sessionObjectKey(config.userId, config.workspaceId, objectId, config.serverUrl);
  const persisted = persistPermissionBlock(config, objectId, { keepExistingRevision: !options.renew }).then(
    () => true,
    (error) => {
      Log.error('[outbox] could not persist the permission quarantine; keeping it in this tab', { objectId, error });
      return false;
    }
  );

  admittedObjects.delete(key);
  clearAdmissionRetry(key);
  blockedSlowSyncObjects.set(key, { reason: 'permission_denied', persisted });
  await persisted;
}

/**
 * True while the object is quarantined. A durable block that disappeared was
 * released by an explicit retry, possibly in another tab; this tab's in-memory
 * copy then follows it. The in-memory block alone is authoritative only when
 * the durable write failed.
 */
async function hasActivePermissionBlock(config: DrainConfig, objectId: string): Promise<boolean> {
  const key = sessionObjectKey(config.userId, config.workspaceId, objectId, config.serverUrl);
  const memory = blockedSlowSyncObjects.get(key);

  if (memory?.reason === 'permission_denied' && !(await memory.persisted)) return true;
  if (await readPermissionBlock(config, objectId)) return true;
  if (memory?.reason === 'permission_denied' && blockedSlowSyncObjects.get(key) === memory) {
    blockedSlowSyncObjects.delete(key);
  }

  return false;
}

async function countPermissionBlockedRows(scope: SyncOutboxSession, objectId: string): Promise<number> {
  return db.sync_outbox
    .where('[userId+workspaceId+objectId]')
    .equals([scope.userId, scope.workspaceId, objectId])
    .filter((record) => record.serverUrl === scope.serverUrl && Boolean(record.permissionBlocked))
    .count();
}

async function permissionBlockedObjectIds(scope: SyncOutboxSession): Promise<string[]> {
  const ids = new Set<string>();

  await db.sync_outbox
    .where('[userId+workspaceId]')
    .equals([scope.userId, scope.workspaceId])
    .each((record) => {
      if (record.serverUrl === scope.serverUrl && record.permissionBlocked) ids.add(record.objectId);
    });
  return Array.from(ids);
}

function emptyRetryResult(): PermissionRetryResult {
  return { released: [], denied: [], unknown: [] };
}

/**
 * Explicitly retry retained edits after checking their current write authority.
 * Released objects wake the socket owner, which may be another tab.
 */
export async function retryPermissionBlockedSync(expectedSession?: SyncOutboxSession): Promise<PermissionRetryResult> {
  const result = emptyRetryResult();
  const config = drainConfig;
  const generation = lifecycleGeneration;
  const accessGeneration = permissionGeneration;

  if (!config?.checkPermission) return result;
  if (expectedSession && (config.userId !== expectedSession.userId || config.workspaceId !== expectedSession.workspaceId ||
    config.serverUrl !== expectedSession.serverUrl)) return result;
  const isCurrent = () => drainConfig === config && generation === lifecycleGeneration && accessGeneration === permissionGeneration;
  const ids = await permissionBlockedObjectIds(config);

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];

    if (!isCurrent()) {
      result.unknown.push(...ids.slice(index));
      break;
    }

    const records = await readOutboxPrefix(config.userId, config.workspaceId, id, config.serverUrl);
    const block = await readPermissionBlock(config, id);
    let throughId = 0;

    await db.sync_outbox.where('[userId+workspaceId+objectId]').equals([config.userId, config.workspaceId, id])
      .each((record) => {
        if (record.serverUrl === config.serverUrl && record.permissionBlocked) throughId = Math.max(throughId, record.id ?? 0);
      });

    // Released or discarded elsewhere meanwhile.
    if (!records.length || !throughId) continue;
    const permission = await config.checkPermission(id, records[0].collabType as Types);

    if (permission === 'denied') {
      result.denied.push(id);
      continue;
    }

    if (permission !== 'allowed' || !isCurrent()) {
      result.unknown.push(id);
      continue;
    }

    // Clear only the exact records the user chose to retry. A concurrent denial
    // is rechecked by the drain and a later edit cannot inherit this choice.
    if (!await releasePermissionBlock(config, id, block, throughId, isCurrent)) {
      // A newer denial replaced the reviewed quarantine, or the session moved on.
      (isCurrent() ? result.denied : result.unknown).push(id);
      continue;
    }

    const key = sessionObjectKey(config.userId, config.workspaceId, id, config.serverUrl);

    if (blockedSlowSyncObjects.get(key)?.reason === 'permission_denied') blockedSlowSyncObjects.delete(key);
    result.released.push(id);

    try {
      config.onPersisted?.(config.workspaceId, id);
    } catch (error) {
      Log.warn('[outbox] retry wake-up notification failed', { objectId: id, error });
    }

    scheduleDrain(id);
  }

  return result;
}

/**
 * Permanently delete the quarantined edits shown to the user for one session,
 * with their durable denial. Edits that are not quarantined are kept.
 * Returns the objects whose edits were discarded.
 */
export async function discardPermissionBlockedEdits(session: SyncOutboxSession): Promise<string[]> {
  const discarded: string[] = [];

  for (const objectId of await permissionBlockedObjectIds(session)) {
    const key = sessionObjectKey(session.userId, session.workspaceId, objectId, session.serverUrl);

    // One transaction with the durable block: a row persisted concurrently is
    // either quarantined and discarded here, or created after the block is gone.
    await db.transaction('rw', db.sync_outbox, db.sync_permission_blocks, async () => {
      await db.sync_outbox
        .where('[userId+workspaceId+objectId]')
        .equals([session.userId, session.workspaceId, objectId])
        .filter((record) => record.serverUrl === session.serverUrl && Boolean(record.permissionBlocked))
        .delete();
      await db.sync_permission_blocks.delete(permissionBlockKey(session, objectId));
    });

    if (blockedSlowSyncObjects.get(key)?.reason === 'permission_denied') blockedSlowSyncObjects.delete(key);
    admittedObjects.delete(key);
    clearAdmissionRetry(key);
    discarded.push(objectId);
  }

  return discarded;
}

/**
 * Returns true when a raw Yjs update cannot use the realtime lane.
 *
 * A conservative 4 MiB fallback protects both unresolved server-info requests
 * and older servers that omit the field. An explicitly advertised zero means
 * unlimited.
 */
export function shouldRouteUpdateThroughOutbox(updateBytes: number): boolean {
  if (drainConfig?.checkPermission) return true;
  if (drainConfig && discoveredOutboxSessionKey !== sessionKey(drainConfig.userId, drainConfig.workspaceId, drainConfig.serverUrl)) {
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
      await adoptLegacyOutboxRows(config);
      if (!sameDrainSession(drainConfig, config)) return;
      const objectIds = await distinctObjectIdsForSession(config.userId, config.workspaceId, config.serverUrl);

      if (!sameDrainSession(drainConfig, config)) return;
      for (const objectId of objectIds) {
        scheduleDrain(objectId);
      }

      // scheduleDrain synchronously installs the per-object drain promise, so
      // an edit arriving after this assignment is still held behind any
      // discovered predecessor for that object.
      discoveredOutboxSessionKey = sessionKey(config.userId, config.workspaceId, config.serverUrl);
    } catch (error) {
      Log.warn('[outbox] startDrainAll failed', error);
    }
  });
}

/**
 * Rows written before outbox entries recorded their API origin belong to the
 * account and workspace they name, and the previous release talked only to the
 * configured server. They join that session's queue; like every row they are
 * sent only after a fresh permission check, and a denial quarantines them for
 * the user's explicit Try again or Discard.
 */
async function adoptLegacyOutboxRows(config: DrainConfig): Promise<void> {
  if (!config.serverUrl) return;
  const serverUrl = config.serverUrl;

  await db.transaction('rw', db.sync_outbox, async () => {
    await db.sync_outbox
      .where('[userId+workspaceId]')
      .equals([config.userId, config.workspaceId])
      .filter((record) => record.serverUrl === undefined)
      .modify({ serverUrl });
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
    objectIds ?? (drainConfig ? await distinctObjectIdsForSession(drainConfig.userId, drainConfig.workspaceId, drainConfig.serverUrl) : []);

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
      ids.map((id) => db.sync_outbox.where('[userId+workspaceId+objectId]').equals([userId, workspaceId, id]).filter((record) => record.serverUrl === drainConfig?.serverUrl).count())
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

  lifecycleGeneration += 1;
  objectGenerations.clear();

  // Set the gate synchronously so any enqueue arriving in the same tick
  // — e.g. from a React render triggered by `SESSION_INVALID` — is dropped
  // before it can add new rows behind the purge.
  isPurging = true;
  // Abort lock acquisition and HTTP before runPurge awaits active drains.
  abortSlowSyncCoordinations();

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
    slowSyncAbortControllers.clear();
    admittedObjects.clear();
    discoveredOutboxSessionKey = null;
    clearAllSlowSyncRetries();
    clearAllAdmissionRetries();

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
    /**
     * Explicit owner for async work that can outlive its originating
     * workspace. When omitted, the active session is captured at call time.
     */
    session?: SyncOutboxSession;
    /** A blob tombstone may only discard updates from its captured aggregate. */
    storageFence?: DatabaseStorageFence;
    /** Keep edits already generated against this restored database generation. */
    preserveDatabaseRestoreId?: string;
  }
): Promise<void> {
  if (options?.storageFence && !isDatabaseStorageFenceCurrent(options.storageFence)) return;
  const targetSession = options?.session ?? getCurrentOutboxSession();
  const userId = targetSession?.userId;
  const workspaceId = targetSession?.workspaceId;

  if (!userId || !workspaceId) {
    Log.debug('[outbox] deleteOutboxByObjectId skipped: no session configured', { objectId });
    return;
  }

  const objectSessionKey = sessionObjectKey(userId, workspaceId, objectId, targetSession?.serverUrl);

  // Synchronously suppress in-flight work for this exact session/object BEFORE
  // yielding. A stale cleanup from another workspace must not drop current
  // edits that happen to use the same object ID.
  objectGenerations.set(objectSessionKey, (objectGenerations.get(objectSessionKey) ?? 0) + 1);
  suppressedObjects.add(objectSessionKey);
  abortSlowSyncCoordination(objectSessionKey);

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
    const discard = async () => {
      const records = db.sync_outbox.where('[userId+workspaceId+objectId]').equals([userId, workspaceId, objectId]).filter((record) => record.serverUrl === targetSession?.serverUrl);

      if (options?.preserveDatabaseRestoreId !== undefined) {
        await records
          .filter(
            (record) =>
              (record.databaseRestoreId ?? '00000000-0000-0000-0000-000000000000') !== options.preserveDatabaseRestoreId
          )
          .delete();
      } else {
        await records.delete();
      }
    };

    if (options?.storageFence) {
      const fence = options.storageFence;

      await db.transaction('rw', db.sync_outbox, db.collab_custom, async () => {
        if (!(await matchesDatabaseStorageFence(fence))) return;
        await discard();
      });
    } else if (options?.preserveDatabaseRestoreId !== undefined) {
      await db.transaction('rw', db.sync_outbox, discard);
    } else {
      await discard();
    }

    serializedSlowSyncObjects.delete(objectSessionKey);
    oversizedDiagnostics.delete(objectSessionKey);
    blockedSlowSyncObjects.delete(objectSessionKey);
    clearSlowSyncRetry(objectSessionKey);
  } finally {
    suppressedObjects.delete(objectSessionKey);
  }
}

async function distinctObjectIdsForSession(userId: string, workspaceId: string, serverUrl?: string): Promise<string[]> {
  const ids = new Set<string>();

  await db.sync_outbox
    .where('[userId+workspaceId]')
    .equals([userId, workspaceId])
    .each((record) => {
      if (record.serverUrl === serverUrl) ids.add(record.objectId);
    });
  return Array.from(ids);
}

function buildUpdateMessage(
  record: Pick<
    SyncOutboxRecord,
    'objectId' | 'collabType' | 'payload' | 'version' | 'databaseRestoreId' | 'beforeStateVector'
  >,
  config: DrainConfig | null
): messages.IMessage {
  return {
    collabMessage: {
      objectId: record.objectId,
      collabType: record.collabType,
      update: {
        flags: FLAGS_LIB0V1,
        payload: record.payload,
        version: record.version ?? undefined,
        databaseRestoreId: wireDatabaseRestoreId(config, record.collabType, record.databaseRestoreId),
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

async function readOutboxPrefix(userId: string, workspaceId: string, objectId: string, serverUrl?: string): Promise<SyncOutboxRecord[]> {
  // The four-part index is naturally ordered by the auto-incremented id. A
  // fixed prefix bound prevents one long-offline object from being read into
  // memory in a single drain iteration.
  const records = await db.sync_outbox
    .where('[userId+workspaceId+objectId+id]')
    .between([userId, workspaceId, objectId, BaseDexie.minKey], [userId, workspaceId, objectId, BaseDexie.maxKey])
    .filter((record) => record.serverUrl === serverUrl)
    .limit(OUTBOX_READ_BATCH_SIZE)
    .toArray();

  const first = records[0];

  if (!first) return records;

  // Yjs updates from distinct restore branches must never be merged and
  // stamped with the last record's identity. Missing and explicit nil UUID
  // are distinct, preserving the legacy wire contract.
  const nextBranch = records.findIndex(
    (record) =>
      record.databaseRestoreId !== first.databaseRestoreId ||
      (record.version ?? undefined) !== (first.version ?? undefined) ||
      record.collabType !== first.collabType
  );

  return nextBranch === -1 ? records : records.slice(0, nextBranch);
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

function scheduleSlowSyncRetry(userId: string, workspaceId: string, objectId: string, retryAfterSecs?: number, serverUrl?: string) {
  const objectSessionKey = sessionObjectKey(userId, workspaceId, objectId, serverUrl);

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

      if (!config || config.userId !== userId || config.workspaceId !== workspaceId || config.serverUrl !== serverUrl) return;
      scheduleDrain(objectId);
    }, delay)
  );
}

function clearAdmissionRetry(objectSessionKey: string) {
  const timer = admissionRetryTimers.get(objectSessionKey);

  if (timer) clearTimeout(timer);
  admissionRetryTimers.delete(objectSessionKey);
  admissionRetryAttempts.delete(objectSessionKey);
}

function clearAllAdmissionRetries() {
  for (const timer of admissionRetryTimers.values()) {
    clearTimeout(timer);
  }

  admissionRetryTimers.clear();
  admissionRetryAttempts.clear();
}

/**
 * Bounded backoff for an access check that could not complete (offline, a
 * server error, a saturated check queue). The row stays durable meanwhile.
 */
function scheduleAdmissionRetry(config: DrainConfig, objectId: string) {
  const { userId, workspaceId, serverUrl } = config;
  const objectSessionKey = sessionObjectKey(userId, workspaceId, objectId, serverUrl);

  if (admissionRetryTimers.has(objectSessionKey)) return;
  const attempt = admissionRetryAttempts.get(objectSessionKey) ?? 0;

  admissionRetryAttempts.set(objectSessionKey, attempt + 1);
  admissionRetryTimers.set(
    objectSessionKey,
    setTimeout(() => {
      admissionRetryTimers.delete(objectSessionKey);
      const current = drainConfig;

      if (!current || current.userId !== userId || current.workspaceId !== workspaceId || current.serverUrl !== serverUrl) return;
      scheduleDrain(objectId);
    }, ADMISSION_RETRY_DELAYS_MS[Math.min(attempt, ADMISSION_RETRY_DELAYS_MS.length - 1)])
  );
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;

  const error = new Error('The operation was aborted');

  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: unknown })?.name === 'AbortError';
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortReason(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function abortSlowSyncCoordination(objectSessionKey: string): void {
  slowSyncAbortControllers.get(objectSessionKey)?.abort();
}

function abortSlowSyncCoordinations(userId?: string, workspaceId?: string): void {
  const prefix = userId && workspaceId ? `${userId}\u0000${workspaceId}\u0000` : null;

  for (const [key, controller] of slowSyncAbortControllers) {
    if (!prefix || key.startsWith(prefix)) {
      controller.abort();
    }
  }
}

async function runSlowSyncSerialized<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const previous = slowSyncQueue.catch(() => undefined);
  let release!: () => void;
  const turnComplete = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Keep the queue chained to its predecessor even if this waiter is aborted;
  // otherwise a later task could leapfrog the still-active predecessor.
  slowSyncQueue = previous.then(() => turnComplete);

  try {
    await waitForAbort(previous, signal);
    throwIfAborted(signal);
    return await task();
  } finally {
    release();
  }
}

async function runSlowSyncCoordinated<T>(
  userId: string,
  workspaceId: string,
  objectSessionKey: string,
  task: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  abortSlowSyncCoordination(objectSessionKey);
  const controller = new AbortController();

  slowSyncAbortControllers.set(objectSessionKey, controller);

  try {
    const lockManager = globalThis.navigator?.locks;

    if (lockManager) {
      const lockName = `${SLOW_SYNC_LOCK_PREFIX}:${userId}:${workspaceId}`;

      return await lockManager.request(lockName, { mode: 'exclusive', signal: controller.signal }, () =>
        task(controller.signal)
      );
    }

    return await runSlowSyncSerialized(() => task(controller.signal), controller.signal);
  } catch (error) {
    // Axios reports an aborted request as CanceledError rather than
    // AbortError. Normalize any failure observed after lifecycle cancellation
    // so teardown does not log it as a transport failure or schedule a retry.
    if (controller.signal.aborted) throw abortReason(controller.signal);
    throw error;
  } finally {
    if (slowSyncAbortControllers.get(objectSessionKey) === controller) {
      slowSyncAbortControllers.delete(objectSessionKey);
    }
  }
}

function retryAfterSecsFromError(error: unknown): number | undefined {
  const retryAfterSecs = (error as { retryAfterSecs?: unknown })?.retryAfterSecs;

  return typeof retryAfterSecs === 'number' && Number.isFinite(retryAfterSecs) && retryAfterSecs > 0
    ? retryAfterSecs
    : undefined;
}

function sameDrainSession(left: DrainConfig | null, right: DrainConfig | null): boolean {
  return Boolean(left && right && left.userId === right.userId && left.workspaceId === right.workspaceId && left.serverUrl === right.serverUrl);
}

/** Database bytes are sent only after their restore generation is checked. */
function isRestoreGated(config: DrainConfig | null | undefined, collabType: number): boolean {
  return Boolean(config?.beforeSend) && (collabType === Types.Database || collabType === Types.DatabaseRow);
}

/**
 * Permission-aware sessions check access before transmitting any collab.
 * Legacy sessions retain immediate fan-out except for database restore checks.
 */
function requiresUploadAdmission(config: DrainConfig | null | undefined, collabType: number): boolean {
  return Boolean(config?.checkPermission) || isRestoreGated(config, collabType);
}

function recordAdmission(config: DrainConfig, objectId: string, generations: { lifecycle: number; object: number }) {
  const key = sessionObjectKey(config.userId, config.workspaceId, objectId, config.serverUrl);

  admittedObjects.set(key, { lifecycle: generations.lifecycle, permission: permissionGeneration, object: generations.object });
}

/**
 * Without permission checks every non-database edit is sent immediately, as
 * before. With them, an edit is sent immediately only while the object's last
 * full admission still holds in the current generations, the permission cache
 * still says allowed, nothing is quarantined, and no earlier checked edit for
 * the object is still waiting. Anything else persists first and is checked.
 */
function canSendImmediately(config: DrainConfig, record: Pick<SyncOutboxRecord, 'objectId' | 'collabType'>): boolean {
  if (!requiresUploadAdmission(config, record.collabType)) return true;
  if (!config.checkPermission || !config.peekPermission || isRestoreGated(config, record.collabType)) return false;
  const key = sessionObjectKey(config.userId, config.workspaceId, record.objectId, config.serverUrl);
  const admission = admittedObjects.get(key);

  if (
    !admission ||
    admission.lifecycle !== lifecycleGeneration ||
    admission.permission !== permissionGeneration ||
    admission.object !== (objectGenerations.get(key) ?? 0)
  ) {
    return false;
  }

  if (blockedSlowSyncObjects.get(key)?.reason === 'permission_denied' || pendingAdmissions.has(key)) return false;
  return config.peekPermission(record.objectId, record.collabType as Types) === 'allowed';
}

function wireDatabaseRestoreId(
  config: DrainConfig | null,
  collabType: number,
  capturedMarker?: string
): string | undefined {
  if (capturedMarker !== undefined) return capturedMarker;
  return config?.databaseHistoryEnabled && (collabType === Types.Database || collabType === Types.DatabaseRow)
    ? '00000000-0000-0000-0000-000000000000'
    : undefined;
}

async function admitOutboxUpdate(
  config: DrainConfig,
  objectId: string,
  collabType: Types,
  databaseRestoreId?: string
): Promise<AdmissionVerdict> {
  const key = sessionObjectKey(config.userId, config.workspaceId, objectId, config.serverUrl);
  const accessGeneration = permissionGeneration;
  const generations = { lifecycle: lifecycleGeneration, object: objectGenerations.get(key) ?? 0 };

  try {
    if (config.checkPermission) {
      const permission = await config.checkPermission(objectId, collabType);

      if (permission === 'denied') {
        await quarantinePermissionUpdates(objectId, config);
        return 'denied';
      }

      if (permission !== 'allowed') return 'unknown';
      if (await hasActivePermissionBlock(config, objectId)) return 'denied';
    }

    // Legacy queued database bytes predate any committed restore. Explicitly
    // check that generation; undefined is reserved by the coordinator for
    // discovery calls that do not carry a captured update.
    const expectedRestoreId =
      databaseRestoreId ??
      (collabType === Types.Database || collabType === Types.DatabaseRow
        ? '00000000-0000-0000-0000-000000000000'
        : undefined);

    const allowed = (await config.beforeSend?.(objectId, collabType, expectedRestoreId)) ?? true;

    if (!allowed) return 'held';
    if (accessGeneration !== permissionGeneration) return 'stale';
    if (config.checkPermission) {
      clearAdmissionRetry(key);
      recordAdmission(config, objectId, generations);
    }

    return 'allowed';
  } catch (error) {
    Log.warn('[outbox] pre-send check failed; leaving updates queued', { objectId, error });
    return 'unknown';
  }
}

/** Follow-up for a drain whose check did not allow sending. */
function handleRejectedAdmission(config: DrainConfig, objectId: string, verdict: AdmissionVerdict) {
  if (verdict === 'unknown') scheduleAdmissionRetry(config, objectId);
  // The check was superseded by a permission change: check again under it.
  if (verdict === 'stale') pendingRerun.add(objectId);
}

function logOversizedOnce(objectSessionKey: string, reason: string, details: Record<string, unknown>) {
  if (oversizedDiagnostics.get(objectSessionKey) === reason) return;

  oversizedDiagnostics.set(objectSessionKey, reason);
  Log.warn('[outbox] oversized update remains durable', { reason, ...details });
}

/**
 * Synchronous blocks only: quarantined rows and a rejected oversized prefix. An
 * in-memory permission block is validated against the durable quarantine by
 * `hasActivePermissionBlock`, because an explicit retry in another tab can
 * release it.
 */
function isSlowSyncBlockedForRecords(objectSessionKey: string, records: SyncOutboxRecord[]): boolean {
  if (records.some((record) => record.permissionBlocked)) return true;
  const block = blockedSlowSyncObjects.get(objectSessionKey);

  if (!block || block.reason === 'permission_denied') return false;

  const sameRejectedPrefix =
    block.recordIds.length > 0 && block.recordIds.every((id, index) => records[index]?.id === id);

  if (sameRejectedPrefix) return true;

  // The rejected record generation was deleted or replaced (for example by a
  // newer manifest). Re-evaluate the new prefix instead of retaining a stale
  // object-wide size block.
  blockedSlowSyncObjects.delete(objectSessionKey);
  oversizedDiagnostics.delete(objectSessionKey);
  return false;
}

function scheduleDrain(objectId: string) {
  const config = drainConfig;

  if (!config) return;

  const objectSessionKey = sessionObjectKey(config.userId, config.workspaceId, objectId, config.serverUrl);

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
  if (isPurging || suppressedObjects.has(objectSessionKey)) return;

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
    const objectSessionKey = sessionObjectKey(userId, workspaceId, objectId, config.serverUrl);
    const capturedLifecycleGeneration = lifecycleGeneration;
    const capturedPermissionGeneration = permissionGeneration;
    const capturedObjectGeneration = objectGenerations.get(objectSessionKey) ?? 0;
    const isCurrentGeneration = () =>
      lifecycleGeneration === capturedLifecycleGeneration &&
      permissionGeneration === capturedPermissionGeneration &&
      (objectGenerations.get(objectSessionKey) ?? 0) === capturedObjectGeneration;
    // Only a permission change superseded this iteration: check again under it.
    const onlyPermissionChanged = () =>
      lifecycleGeneration === capturedLifecycleGeneration &&
      (objectGenerations.get(objectSessionKey) ?? 0) === capturedObjectGeneration &&
      permissionGeneration !== capturedPermissionGeneration;

    if (slowSyncRetryTimers.has(objectSessionKey)) return;

    const records = await readOutboxPrefix(userId, workspaceId, objectId, config.serverUrl);

    if (records.length === 0) {
      serializedSlowSyncObjects.delete(objectSessionKey);
      clearSlowSyncRetry(objectSessionKey);
      clearAdmissionRetry(objectSessionKey);
      return;
    }

    if (isSlowSyncBlockedForRecords(objectSessionKey, records)) return;
    if (
      blockedSlowSyncObjects.get(objectSessionKey)?.reason === 'permission_denied' &&
      (await hasActivePermissionBlock(config, objectId))
    ) {
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
      const slowLimit = config.syncLimitsLoaded === false ? undefined : validByteLimit(config.maxSlowSyncUpdateBytes);

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
        const coordinated = await runSlowSyncCoordinated(userId, workspaceId, objectSessionKey, async (signal) => {
          if (suppressedObjects.has(objectSessionKey) || !sameDrainSession(drainConfig, initialConfig) || isPurging) {
            return { status: 'aborted' as const };
          }

          // Another tab may have completed the prefix while this tab waited
          // for the lock. Re-read and select under the lock so the upload and
          // its exact-ID retirement operate on one authoritative snapshot.
          const lockedRecords = await readOutboxPrefix(userId, workspaceId, objectId, config.serverUrl);

          if (suppressedObjects.has(objectSessionKey) || !sameDrainSession(drainConfig, initialConfig) || isPurging) {
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

          if (requiresUploadAdmission(config, lockedLastRecord.collabType)) {
            const verdict = await admitOutboxUpdate(
              config,
              objectId,
              lockedLastRecord.collabType as Types,
              lockedLastRecord.databaseRestoreId
            );

            if (verdict !== 'allowed') return { status: 'rejected' as const, verdict };
          }

          if (
            !isCurrentGeneration() ||
            suppressedObjects.has(objectSessionKey) ||
            !sameDrainSession(drainConfig, initialConfig) ||
            isPurging ||
            signal.aborted
          ) {
            return { status: onlyPermissionChanged() && !signal.aborted ? ('stale' as const) : ('aborted' as const) };
          }

          const result = await config.slowSync!(
            {
              objectId,
              collabType: lockedLastRecord.collabType as Types,
              version: lockedLastRecord.version,
              databaseRestoreId: wireDatabaseRestoreId(
                config,
                lockedLastRecord.collabType,
                lockedLastRecord.databaseRestoreId
              ),
              stateVector: lockedBatch.stateVector,
              docState: lockedBatch.merged,
            },
            signal
          );

          if (result.outcome === 'blocked') {
            return {
              status: 'blocked' as const,
              reason: result.reason,
              recordIds: lockedIds,
              recordCount: lockedIds.length,
              payloadBytes: lockedBatch.merged.byteLength,
            };
          }

          if (suppressedObjects.has(objectSessionKey) || !sameDrainSession(drainConfig, initialConfig) || isPurging) {
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
        if (coordinated.status === 'rejected') {
          handleRejectedAdmission(config, objectId, coordinated.verdict);
          return;
        }

        if (coordinated.status === 'stale') {
          pendingRerun.add(objectId);
          return;
        }

        if (coordinated.status === 'blocked') {
          // The server rejected this upload: a new denial for the object.
          if (coordinated.reason === 'permission_denied') {
            await quarantinePermissionUpdates(objectId, config, { renew: true });
          } else {
            blockedSlowSyncObjects.set(objectSessionKey, { reason: coordinated.reason, recordIds: coordinated.recordIds });
          }

          logOversizedOnce(objectSessionKey, coordinated.reason, {
            objectId,
            recordCount: coordinated.recordCount,
            payloadBytes: coordinated.payloadBytes,
          });
          return;
        }
      } catch (error) {
        if (isAbortError(error)) return;

        Log.warn('[outbox] HTTP slow-sync transaction failed; leaving records queued', {
          objectId,
          headPayloadBytes: firstRecord.payload.byteLength,
          error,
        });
        scheduleSlowSyncRetry(userId, workspaceId, objectId, retryAfterSecsFromError(error), config.serverUrl);
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

    if (requiresUploadAdmission(config, lastRecord.collabType)) {
      const verdict = await admitOutboxUpdate(config, objectId, lastRecord.collabType as Types, lastRecord.databaseRestoreId);

      if (verdict !== 'allowed') {
        handleRejectedAdmission(config, objectId, verdict);
        return;
      }
    }

    if (!isCurrentGeneration()) {
      if (onlyPermissionChanged()) pendingRerun.add(objectId);
      return;
    }

    const message = buildUpdateMessage(
      {
        objectId,
        collabType: lastRecord.collabType,
        payload: realtimeBatch.merged,
        version: lastRecord.version,
        databaseRestoreId: lastRecord.databaseRestoreId,
        beforeStateVector: firstRecord.beforeStateVector,
      },
      config
    );

    // Synchronous gate right before the send. Abort if a discard is in
    // progress for this objectId, the drain config has been swapped out
    // (workspace change), or a purge is quiescing the outbox (logout).
    // Records stay in IDB (if any still exist after a concurrent delete)
    // and will be picked up by a future drain.
    if (suppressedObjects.has(objectSessionKey) || drainConfig !== initialConfig || isPurging) return;

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
