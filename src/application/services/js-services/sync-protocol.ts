import { debounce } from 'lodash-es';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';

import { Types } from '@/application/types';
import { collab, messages } from '@/proto/messages';
import { Log } from '@/utils/log';

/**
 * SyncContext is the context object passed to the sync protocol handlers.
 * It contains the Y.Doc instance, optional awareness instance, collab type
 * and an emit function to send messages back to the server.
 */
export interface SyncContext {
  doc: Y.Doc;
  awareness?: awarenessProtocol.Awareness;
  collabType: Types;
  lastMessageId?: collab.IRid;
  /**
   * Emit function to send messages back to the server.
   */
  emit: (reply: messages.IMessage) => void;
  /**
   * Flush function to immediately send any pending updates.
   * This is used before operations like duplicate to ensure all local changes
   * are synced to the server.
   */
  flush?: () => void;
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

const handleSyncRequest = (ctx: SyncContext, message: collab.ISyncRequest): void => {
  const { doc, emit } = ctx;
  const stateVector = message.stateVector && message.stateVector.length > 0 ? message.stateVector : undefined;
  const update = Y.encodeStateAsUpdate(doc, stateVector);

  // send the update containing new data back to the server
  emit({
    collabMessage: {
      objectId: doc.guid,
      collabType: ctx.collabType,
      update: {
        flags: UpdateFlags.Lib0v1,
        payload: update,
      },
    },
  });
};

const handleAccessChanged = (ctx: SyncContext, message: collab.IAccessChanged): void => {
  if (message.canRead === false) {
    //FIXME: we should not only destroy the doc, but also remove it from the persistent storage.
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
  const { doc, awareness, emit, collabType, lastMessageId } = ctx;

  if (!doc) {
    throw new Error('SyncContext must have a Y.Doc instance.');
  }

  Log.debug(`Initializing sync for objectId ${doc.guid} with collabType ${collabType}`);

  if (collabType === Types.DatabaseRow) {
    Log.debug('[Database] row sync start', { rowId: doc.guid });
  }

  let onAwarenessChange: ((event: AwarenessEvent, origin: string) => void) | undefined;
  const updates: Uint8Array[] = [];
  const debounced = debounce(() => {
    if (updates.length === 0) return; // Skip if no pending updates
    const mergedUpdates = Y.mergeUpdates(updates);

    updates.length = 0; // Clear the updates array without GC overhead
    emit({
      collabMessage: {
        objectId: doc.guid,
        collabType,
        update: {
          flags: UpdateFlags.Lib0v1,
          payload: mergedUpdates,
        },
      },
    });
  }, 250);

  // Store flush function in context for external access
  ctx.flush = () => {
    debounced.flush();
  };

  const onUpdate = (update: Uint8Array, origin: string) => {
    if (origin === 'remote') {
      return; // Ignore remote updates
    }

    updates.push(update);
    debounced();
  };

  doc.on('update', onUpdate);

  // emit initial sync request to the server
  emit({
    collabMessage: {
      objectId: ctx.doc.guid,
      collabType: ctx.collabType,
      syncRequest: {
        stateVector: Y.encodeStateVector(ctx.doc),
        lastMessageId: lastMessageId || { timestamp: 0, counter: 0 },
      },
    },
  });

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

    const allClients = Array.from(awareness.getStates().keys());

    // emit initial awareness update with all the clients
    emit({
      collabMessage: {
        objectId: ctx.doc.guid,
        collabType: ctx.collabType,
        awarenessUpdate: {
          payload: awarenessProtocol.encodeAwarenessUpdate(awareness, allClients),
        },
      },
    });
  }

  // Build a single cleanup function that tears down all observers
  const cleanup = () => {
    debounced.cancel();
    doc.off('update', onUpdate);
    if (awareness && onAwarenessChange) {
      awareness.off('change', onAwarenessChange);
    }

    ctx.flush = undefined;
  };

  ctx._cleanup = cleanup;

  return { cleanup };
};

/**
 * Handles incoming collab messages by dispatching them to the appropriate handler.
 *
 * @param ctx
 * @param message
 */
export const handleMessage = (ctx: SyncContext, message: collab.ICollabMessage): void => {
  const doc = ctx.doc || ctx.awareness?.doc;

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
