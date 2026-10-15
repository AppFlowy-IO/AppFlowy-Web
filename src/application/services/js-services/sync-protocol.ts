import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

import { collectDatabaseRowIds, deleteCollabDB, deleteDatabaseLocalCopies } from '@/application/db';
import { isCollabStorageCurrent } from '@/application/db/collab-storage-scope';
import {
  blockPermissionSync,
  getCurrentOutboxSession,
  deleteOutboxByObjectId,
  deleteRedundantManifestRows,
  enqueueOutboxUpdate,
  shouldRouteUpdateThroughOutbox,
  waitForDrain,
} from '@/application/sync-outbox';
import { CollabOrigin, Types, YDoc } from '@/application/types';
import { collab, messages } from '@/proto/messages';
import { Log } from '@/utils/log';

import { beginServerExchange, isNoopForServer, recordServerUpdate } from './server-acknowledged';

/**
 * SyncContext is the context object passed to the sync protocol handlers.
 * It contains the Y.Doc instance, optional awareness instance, collab type
 * and an emit function to send messages back to the server.
 */
export interface SyncContext {
  doc: YDoc;
  awareness?: awarenessProtocol.Awareness;
  collabType: Types;
  lastMessageId?: collab.IRid;
  userMappings?: Y.PermanentUserData;
  /**
   * Emit function to send messages back to the server.
   */
  emit: (reply: messages.IMessage) => void;
  /**
   * Wait until all locally-queued updates for this doc have drained to the
   * WebSocket. Backed by the persistent sync_outbox — the returned promise
   * resolves `true` once there are no pending records, or `false` on timeout
   * (e.g. the WebSocket is closed). Callers that need hard delivery guarantees
   * should combine this with a full-state HTTP send; Yjs handshake recovery
   * will still reconcile any records left in the outbox.
   */
  flush?: () => Promise<boolean>;
  /**
   * Drop queued local updates without sending them.
   * Used by version reset flows where pending updates are stale and must be discarded.
   */
  discardPendingUpdates?: (options?: { skipActiveDrain?: boolean }) => Promise<void>;
  /**
   * Called after a local Yjs update is observed. The WebSocket path still owns
   * immediate delivery; this hook lets the app schedule a debounced HTTP full
   * sync when the WebSocket is reconnecting.
   */
  onLocalUpdate?: (objectId: string) => void;
  /**
   * Called after this context participates in a state-vector sync exchange.
   * Routed manifests pass their IndexedDB persistence promise so consumers can
   * clear only the dirty generation durably owned by the outbox.
   */
  onManifestSync?: (objectId: string, persisted?: Promise<boolean>) => void;
  /**
   * Cleanup function to remove update/awareness observers and cancel debounced sends.
   * Set by initSync, called during deferred sync context cleanup.
   */
  _cleanup?: () => void;
}

interface AwarenessEvent {
  added: number[];
  updated: number[];
  removed: number[];
}

export enum UpdateFlags {
  /** Payload encoded using lib0 v1 encoding */
  Lib0v1 = 0,
  /** Payload encoded using lib0 v2 encoding */
  Lib0v2 = 1,
}

// lib0 v1 encodes an update with no structs and no delete set as two zero
// varints. A manifest can legitimately produce this when both peers have no
// state, or when the requesting peer already has everything in the local doc.
// Sending that payload is never useful. More importantly, an empty
// DatabaseRow opened just before another client uploads its initial state must
// not publish this no-op as an explicit full-state replacement.
const isEmptyUpdateV1 = (update: Uint8Array): boolean =>
  update.byteLength === 2 && update[0] === 0 && update[1] === 0;

interface ManifestCleanup {
  timer?: ReturnType<typeof setTimeout>;
  /** A manifest reply of this doc may be queued, by this context, another tab or an earlier visit. */
  pending: boolean;
  marks: number;
}

const manifestCleanups = new WeakMap<YDoc, ManifestCleanup>();
// Lets the Updates of one server answer (and its relayed copies) land before the outbox is read.
const MANIFEST_CLEANUP_DELAY_MS = 50;

function manifestCleanupOf(doc: YDoc): ManifestCleanup {
  let cleanup = manifestCleanups.get(doc);

  if (!cleanup) {
    cleanup = { pending: true, marks: 0 };
    manifestCleanups.set(doc, cleanup);
  }

  return cleanup;
}

/** A manifest reply of this doc may now be queued; the server's next proof checks the queue. */
function expectManifestReplies(doc: YDoc): void {
  const cleanup = manifestCleanupOf(doc);

  cleanup.pending = true;
  cleanup.marks += 1;
}

/**
 * The server proved more of its state. Delete this doc's queued manifest replies that are now
 * redundant: one queued for a sibling tab's request before the server's answer arrived, or one
 * left by an earlier build. Waiting replies among them would keep the notice on screen.
 */
function scheduleManifestCleanup(doc: YDoc): void {
  const cleanup = manifestCleanupOf(doc);

  if (!cleanup.pending || cleanup.timer !== undefined) return;
  cleanup.timer = setTimeout(() => {
    cleanup.timer = undefined;
    if (!isCollabStorageCurrent(doc)) return;
    const marks = cleanup.marks;
    const { version, databaseRestoreId } = doc;
    const sameGeneration = () => doc.version === version && doc.databaseRestoreId === databaseRestoreId;

    void (async () => {
      const remaining = await deleteRedundantManifestRows(
        doc.guid,
        { version: version ?? null, databaseRestoreId },
        (payload) => sameGeneration() && isNoopForServer(doc, payload)
      );

      if (remaining === 0 && cleanup.marks === marks) cleanup.pending = false;
    })().catch((error) => Log.warn('[sync] Could not remove manifest replies the server already holds', error));
  }, MANIFEST_CLEANUP_DELAY_MS);
}

/**
 * Bind an existing sync context to the current realtime connection.
 *
 * The state-vector request starts a manifest exchange with the server. Unlike
 * {@link initSync}, this function does not attach Y.Doc or awareness observers,
 * so it is safe to call again whenever the WebSocket reopens.
 */
export const bindSyncContext = (ctx: SyncContext): void => {
  const { doc, awareness, emit, collabType, lastMessageId } = ctx;

  if (!doc) {
    throw new Error('SyncContext must have a Y.Doc instance.');
  }

  if (!isCollabStorageCurrent(doc)) return;
  // Whatever the server proved before this request may since have been lost on its side; its
  // answer proves its state afresh. Replies queued meanwhile, by this tab or another, are checked
  // again then.
  beginServerExchange(doc);
  expectManifestReplies(doc);
  Log.debug('[sync] binding context with manifest exchange', {
    objectId: doc.guid,
    collabType,
    version: doc.version,
  });
  emit({
    collabMessage: {
      objectId: doc.guid,
      collabType,
      syncRequest: {
        stateVector: Y.encodeStateVector(doc),
        lastMessageId: lastMessageId || { timestamp: 0, counter: 0 },
        version: doc.version,
      },
    },
  });

  if (awareness) {
    const allClients = Array.from(awareness.getStates().keys());

    emit({
      collabMessage: {
        objectId: doc.guid,
        collabType,
        awarenessUpdate: {
          payload: awarenessProtocol.encodeAwarenessUpdate(awareness, allClients),
        },
      },
    });
  }
};

const handleSyncRequest = (ctx: SyncContext, message: collab.ISyncRequest): void => {
  const { doc, emit } = ctx;

  if (!isCollabStorageCurrent(doc)) return;
  const stateVector = message.stateVector && message.stateVector.length > 0 ? message.stateVector : undefined;
  const update = Y.encodeStateAsUpdate(doc, stateVector);

  Log.debug('[sync] responding to sync request from server', {
    objectId: doc.guid,
    collabType: ctx.collabType,
    version: doc.version,
    bytes: update.byteLength,
  });

  // The server's state vector already covers this document. Complete the
  // manifest boundary locally without putting an empty Update into the
  // durable outbox or on the wire. An empty DatabaseRow update with an empty
  // causal vector otherwise looks like a self-contained replacement even
  // though it carries no row metadata or parent database id.
  //
  // A diff always carries the complete delete set, so a page with any deletion
  // in its history never produces the empty update, and a request that is
  // behind the server makes the reply repeat structs the server holds. Bytes
  // made only of structs and deletions the server has proven it holds since
  // this context's last request are the same no-op; queueing them would show
  // a reader "waiting for edit access" and make an editor upload them again.
  // An unsent local change is never among them.
  if (isEmptyUpdateV1(update) || isNoopForServer(doc, update)) {
    ctx.onManifestSync?.(doc.guid);
    return;
  }

  // A manifest response can contain years of locally retained Yjs history.
  // If it exceeds the server-advertised realtime frame limit, persist it and
  // let the serialized outbox use the bounded HTTP slow lane. Emitting here
  // would close the WebSocket before any fallback could run.
  if (shouldRouteUpdateThroughOutbox(update.byteLength)) {
    // A request that arrives before the server has answered this context may
    // be a sibling tab's, or the server's repair request for an edit it
    // refused after the drain had deleted the edit's row. The two cannot be
    // told apart and the answer may never come, so the reply is queued like
    // any other; once server Updates prove its content, the cleanup deletes it.
    expectManifestReplies(doc);
    const persisted = enqueueOutboxUpdate(
      {
        objectId: doc.guid,
        collabType: ctx.collabType,
        version: doc.version ?? null,
        databaseRestoreId: doc.databaseRestoreId,
        payload: update,
        beforeStateVector: stateVector,
      },
      { broadcast: false, source: 'manifest' }
    );

    ctx.onManifestSync?.(doc.guid, persisted);
    return;
  }

  // send the update containing new data back to the server. This is a
  // manifest-style diff, so the causal `before` vector is the server's own
  // advertised state (what it told us it has). No after vector — the server
  // derives its own post-update state and never trusts a client-provided one.
  emit({
    collabMessage: {
      objectId: doc.guid,
      collabType: ctx.collabType,
      update: {
        flags: UpdateFlags.Lib0v1,
        payload: update,
        version: doc.version,
        databaseRestoreId: doc.databaseRestoreId,
        beforeStateVector: stateVector,
      },
    },
  });
  ctx.onManifestSync?.(doc.guid);
};

const handleAccessChanged = (ctx: SyncContext, message: collab.IAccessChanged): void => {
  if (!isCollabStorageCurrent(ctx.doc)) return;
  if (message.canRead === false || message.canWrite === false) {
    const session = getCurrentOutboxSession();

    // Revocation pauses both incremental edits and reconstructed manifests.
    // A later grant must not imply consent to upload retained offline work.
    if (session) void blockPermissionSync(ctx.doc.guid, session.workspaceId)
      .catch((error) => Log.error('[sync] Could not persist permission quarantine', error));
  }

  if (message.canRead === false) {
    // No read access: hide the content and remove the synced copy so it is no
    // longer readable on this device (for a database, with its rows, read from
    // the open document before it is destroyed). Unsent edits stay quarantined
    // in the outbox (above) for the user's Try again or Discard.
    ctx.flush = undefined;
    const removed = ctx.collabType === Types.Database
      ? deleteDatabaseLocalCopies(ctx.doc.guid, { destroyDoc: false, knownRowIds: collectDatabaseRowIds(ctx.doc) })
      : deleteCollabDB(ctx.doc.guid, { destroyDoc: false });

    void removed.catch((error) => Log.warn('[sync] Could not remove the revoked local copy', error));
    ctx.doc.destroy();
  }
};

const handleAwarenessUpdate = (ctx: SyncContext, message: collab.IAwarenessUpdate): void => {
  if (!ctx.awareness) {
    Log.debug(`No awareness instance found in SyncContext for objectId ${ctx.doc.guid}`);
  } else {
    awarenessProtocol.applyAwarenessUpdate(ctx.awareness, message.payload!, 'remote');
  }
};

const handleUpdate = (ctx: SyncContext, message: collab.IUpdate): void => {
  const { doc, emit } = ctx;

  Log.debug('[Version] handleUpdate: localDocVersion=%s, incomingMsgVersion=%s, docId=%s', doc.version, message.version, doc.guid);

  // Only the server assigns a message id: to its Updates, also when another tab
  // relays them or when one is built from an HTTP sync result. The fan-out of
  // local edits between tabs has none. buildUpdateMessage (sync-outbox) and
  // applyHttpFullSyncResult (useSync) keep it that way: a message id on bytes
  // the server does not hold would make this tab skip, or the cleanup delete,
  // a manifest reply that carries them.
  if (message.messageId) {
    const proven = recordServerUpdate(doc, message.flags === UpdateFlags.Lib0v1 ? message.payload ?? null : null);

    if (proven) scheduleManifestCleanup(doc);
  }

  switch (message.flags) {
    case UpdateFlags.Lib0v1:
      Y.applyUpdate(doc, message.payload!, 'remote');
      break;
    case UpdateFlags.Lib0v2:
      Y.applyUpdateV2(doc, message.payload!, 'remote');
      break;
    default:
      throw new Error(`Unknown update flags: ${message.flags} at ${message.messageId?.timestamp}`);
  }

  Log.debug(`applied update to doc ${doc.guid}`);
  ctx.lastMessageId = message.messageId || ctx.lastMessageId;

  // check if there are any missing update data
  if (doc.store.pendingStructs || doc.store.pendingDs) {
    Log.debug(`Doc ${doc.guid} has missing dependencies. Sending sync request...`);
    emit({
      collabMessage: {
        objectId: doc.guid,
        collabType: ctx.collabType,
        syncRequest: {
          stateVector: Y.encodeStateVector(doc),
          lastMessageId: ctx.lastMessageId || { timestamp: 0, counter: 0 },
          version: doc.version,
        },
      },
    });
  }
};

/**
 * Initializes the sync protocol for a given SyncContext. It will register
 * observers on the Y.Doc instance to handle updates and awareness changes.
 *
 * It will also emit an initial sync request and awareness update.
 *
 * @param ctx
 * @returns An object containing cleanup functions used to deregister the observers.
 */
export const initSync = (ctx: SyncContext) => {
  ctx.doc = ctx.doc || ctx.awareness?.doc;
  const { doc, awareness, emit, collabType } = ctx;

  if (!doc) {
    throw new Error('SyncContext must have a Y.Doc instance.');
  }

  Log.debug(`Initializing sync for objectId ${doc.guid} with collabType ${collabType}`);

  if (collabType === Types.DatabaseRow) {
    Log.debug('[Database] row sync start', { rowId: doc.guid });
  }

  let onAwarenessChange: ((event: AwarenessEvent, origin: string) => void) | undefined;

  // Persist every local update synchronously to the sync_outbox, then let the
  // background drain loop push it over the WebSocket. Survives refresh, tab
  // crash, and modal-unmount races because IndexedDB is the source of truth.
  ctx.flush = () => waitForDrain([doc.guid]);

  ctx.discardPendingUpdates = (options) => deleteOutboxByObjectId(doc.guid, options);

  const onUpdate = (update: Uint8Array, origin: string, _doc: Y.Doc, transaction: Y.Transaction) => {
    if (origin === CollabOrigin.Remote || !isCollabStorageCurrent(doc)) return;

    if (origin === CollabOrigin.InlineCommentAuthorized) {
      // Read-and-comment anchors use their narrowly authorized HTTP endpoint,
      // not the ordinary collaboration outbox that requires document writes.
      return;
    }

    // Causal metadata for server-side missing-update detection: the state vector
    // before this edit. Yjs already computed `transaction.beforeState`, so we just
    // encode it (lib0 v1, to match the server). We deliberately do NOT send an
    // after vector — the server never trusts a client-provided one (it derives the
    // post-update state from the update bytes itself), so it would be wasted work.
    const beforeStateVector = Y.encodeStateVector(transaction.beforeState);

    void enqueueOutboxUpdate({
      objectId: doc.guid,
      collabType,
      version: doc.version ?? null,
        databaseRestoreId: doc.databaseRestoreId,
      payload: update,
      beforeStateVector,
    });
    ctx.onLocalUpdate?.(doc.guid);
  };

  doc.on('update', onUpdate);

  if (awareness) {
    onAwarenessChange = ({ added, updated, removed }: AwarenessEvent, _: string) => {
      const changedClients = added.concat(updated).concat(removed);

      // emit awareness update to the server containing clients that changed
      emit({
        collabMessage: {
          objectId: ctx.doc.guid,
          collabType: ctx.collabType,
          awarenessUpdate: {
            payload: awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
          },
        },
      });
    };

    awareness.on('change', onAwarenessChange);
  }

  // Attach observers once, then bind the document to the current connection.
  // Reconnects call bindSyncContext directly to avoid duplicate observers.
  bindSyncContext(ctx);

  // Build a single cleanup function that tears down all observers.
  // Note: we deliberately do NOT delete outbox records here — cleanup only
  // detaches listeners. Outbox deletion is caller-driven via
  // discardPendingUpdates() (version reset/revert paths only).
  const cleanup = () => {
    doc.off('update', onUpdate);
    if (awareness && onAwarenessChange) {
      awareness.off('change', onAwarenessChange);
    }

    ctx.flush = undefined;
    ctx.discardPendingUpdates = undefined;
  };

  ctx._cleanup = cleanup;

  return { cleanup };
};

/**
 * Returns the version carried by a collab message, regardless of which field holds it.
 * Mirrors a Rust trait default method — callers get a single, uniform way to read
 * the version without knowing whether the message is an update, sync-request, etc.
 */
export const getCollabMessageVersion = (message: collab.ICollabMessage): string | null | undefined =>
  message.update?.version ?? message.syncRequest?.version;

/**
 * Handles incoming collab messages by dispatching them to the appropriate handler.
 *
 * @param ctx
 * @param message
 */
export const handleMessage = (ctx: SyncContext, message: collab.ICollabMessage): void => {
  const doc = ctx.doc || ctx.awareness?.doc;

  if (!isCollabStorageCurrent(doc)) return;
  if (message.objectId !== doc.guid) {
    throw new Error(`collab message mismatch - expected objectId ${message.objectId}, got ${doc.guid}`);
  }

  if (message.update) {
    handleUpdate(ctx, message.update);
  } else if (message.syncRequest) {
    handleSyncRequest(ctx, message.syncRequest);
  } else if (message.accessChanged) {
    handleAccessChanged(ctx, message.accessChanged);
  } else if (message.awarenessUpdate) {
    handleAwarenessUpdate(ctx, message.awarenessUpdate);
  }
};
