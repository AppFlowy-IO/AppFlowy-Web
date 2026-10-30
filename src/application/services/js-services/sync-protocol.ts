import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

import { deleteCollabDB } from '@/application/db';
import {
  deleteOutboxByObjectId,
  enqueueOutboxUpdate,
  shouldRouteUpdateThroughOutbox,
  waitForDrain,
} from '@/application/sync-outbox';
import { CollabOrigin, Types, YDoc } from '@/application/types';
import { collab, messages } from '@/proto/messages';
import { Log } from '@/utils/log';

import { deleteSetDigest } from './delete-set-digest';
import { ManifestRecovery } from './manifest-recovery';

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
  emit: (reply: messages.IMessage, options?: { requireReady?: boolean }) => void;
  /** Checks the owning session/transport before a timed retry can emit. */
  canRetry?: () => boolean;
  /** Context-owned recovery; disposed with the document's observers. */
  manifestRecovery?: ManifestRecovery;
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
   * Called only when an authoritative manifest covers the current document.
   * Sending or locally persisting an upload does not establish this boundary.
   */
  onManifestSync?: (objectId: string) => void;
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

/**
 * Bind an existing sync context to the current realtime connection.
 *
 * The state-vector request starts a manifest exchange with the server. Unlike
 * {@link initSync}, this function does not attach Y.Doc or awareness observers,
 * so it is safe to call again whenever the WebSocket reopens.
 */
export const bindSyncContext = (ctx: SyncContext): void => {
  if (ctx.manifestRecovery?.isDisposed) return;
  const { doc, awareness, emit, collabType } = ctx;

  if (!doc) {
    throw new Error('SyncContext must have a Y.Doc instance.');
  }

  Log.debug('[sync] binding context with manifest exchange', {
    objectId: doc.guid,
    collabType,
    version: doc.version,
  });
  requestManifest(ctx);

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

const requestManifest = (ctx: SyncContext, requireReady = false): void => {
  const { doc, collabType, lastMessageId } = ctx;

  const message = {
    collabMessage: {
      objectId: doc.guid,
      collabType,
      syncRequest: {
        stateVector: Y.encodeStateVector(doc),
        lastMessageId: lastMessageId || { timestamp: 0, counter: 0 },
        version: doc.version,
        deleteSet: { digest: deleteSetDigest(doc) },
      },
    },
  };

  if (requireReady) {
    ctx.emit(message, { requireReady: true });
  } else {
    ctx.emit(message);
  }
};

const manifestCoversUpdate = (doc: YDoc, update: Uint8Array, message: collab.ISyncRequest): boolean => {
  if (doc.store.pendingStructs || doc.store.pendingDs) return false;
  if (isEmptyUpdateV1(update)) return true;
  // The first v1 varint counts insertion clients. A delete-only diff is sent
  // even for identical docs, so compare the canonical deletion digest too.
  const serverDigest = message.deleteSet?.digest;

  if (update[0] !== 0 || serverDigest?.length !== 32) return false;
  const localDigest = deleteSetDigest(doc);

  return localDigest.every((byte, index) => byte === serverDigest[index]);
};

const confirmCoverage = (ctx: SyncContext, message: collab.ISyncRequest): void => {
  const { doc } = ctx;
  const nil = '00000000-0000-0000-0000-000000000000';

  if (ctx.manifestRecovery?.isDisposed || (doc.version || '') !== (message.version || '')) return;
  if ((doc.databaseRestoreId || nil) !== (message.databaseRestoreId || nil)) return;
  ctx.manifestRecovery?.confirm();
  ctx.onManifestSync?.(doc.guid);
};

/** Consume authoritative coverage without replaying a relayed manifest's upload response. */
export const confirmManifestSync = (ctx: SyncContext, message: collab.ISyncRequest): void => {
  const { doc } = ctx;

  if (ctx.manifestRecovery?.isDisposed) return;
  const stateVector = message.stateVector?.length ? message.stateVector : undefined;

  if (!manifestCoversUpdate(doc, Y.encodeStateAsUpdate(doc, stateVector), message)) return;
  confirmCoverage(ctx, message);
};

const handleSyncRequest = (ctx: SyncContext, message: collab.ISyncRequest, authoritative: boolean): void => {
  const { doc, emit } = ctx;
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
  if (manifestCoversUpdate(doc, update, message)) {
    if (authoritative) confirmCoverage(ctx, message);
    return;
  }

  ctx.manifestRecovery?.start();
  ctx.onLocalUpdate?.(doc.guid);
  if (isEmptyUpdateV1(update) || ctx.manifestRecovery?.writeAllowed === false) return;

  // A manifest response can contain years of locally retained Yjs history.
  // If it exceeds the server-advertised realtime frame limit, persist it and
  // let the serialized outbox use the bounded HTTP slow lane. Emitting here
  // would close the WebSocket before any fallback could run.
  if (shouldRouteUpdateThroughOutbox(update.byteLength)) {
    void enqueueOutboxUpdate(
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
};

const handleAccessChanged = (ctx: SyncContext, message: collab.IAccessChanged): void => {
  if (message.canRead === false) {
    ctx.manifestRecovery?.dispose();
    //FIXME: we should not only destroy the doc, but also remove it from the persistent storage.
    // Access revoked: drop any queued outbox rows so we do not replay local
    // edits against a doc the user no longer has permission on. The discard
    // runs async — to prevent the destroy handler's subsequent unregister
    // from firing a flush that races with the delete, synchronously null
    // out ctx.flush first. The drain also gates on `suppressedObjects`
    // (set synchronously by discardPendingUpdates), so any new drain
    // iteration aborts before sending.
    void ctx.discardPendingUpdates?.();
    ctx.flush = undefined;
    ctx.discardPendingUpdates = undefined;
    void deleteCollabDB(ctx.doc.guid, { destroyDoc: false });
    ctx.doc.destroy();
  } else if (typeof message.canWrite === 'boolean') {
    ctx.manifestRecovery?.setWriteAccess(message.canWrite);
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

  ctx.manifestRecovery?.dispose();
  ctx.manifestRecovery = new ManifestRecovery(
    () => requestManifest(ctx, true),
    () => ctx.canRetry?.() ?? true
  );

  // Persist every local update synchronously to the sync_outbox, then let the
  // background drain loop push it over the WebSocket. Survives refresh, tab
  // crash, and modal-unmount races because IndexedDB is the source of truth.
  ctx.flush = () => waitForDrain([doc.guid]);

  ctx.discardPendingUpdates = (options) => deleteOutboxByObjectId(doc.guid, options);

  const onUpdate = (update: Uint8Array, origin: string, _doc: Y.Doc, transaction: Y.Transaction) => {
    if (origin === CollabOrigin.Remote) return;

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

  const onDestroy = () => {
    ctx.manifestRecovery?.dispose();
    // when switching versions, we destroy previous instance of the document
    // at this point all stashed updates are no longer valid. Fire-and-forget
    // is acceptable here: the unregister path that sets `skipFlushOnDestroy`
    // will also trigger its own discard, and callers that need to observe
    // completion go through the await path in useCollab{Message,Version}Revert.
    void ctx.discardPendingUpdates?.();
  };

  doc.on('update', onUpdate);
  doc.on('destroy', onDestroy);

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
    ctx.manifestRecovery?.dispose();
    doc.off('update', onUpdate);
    doc.off('destroy', onDestroy);
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
export const handleMessage = (ctx: SyncContext, message: collab.ICollabMessage, authoritative = true): void => {
  if (ctx.manifestRecovery?.isDisposed) return;
  const doc = ctx.doc || ctx.awareness?.doc;

  if (message.objectId !== doc.guid) {
    throw new Error(`collab message mismatch - expected objectId ${message.objectId}, got ${doc.guid}`);
  }

  if (message.update) {
    handleUpdate(ctx, message.update);
  } else if (message.syncRequest) {
    handleSyncRequest(ctx, message.syncRequest, authoritative);
  } else if (message.accessChanged) {
    handleAccessChanged(ctx, message.accessChanged);
  } else if (message.awarenessUpdate) {
    handleAwarenessUpdate(ctx, message.awarenessUpdate);
  }
};
