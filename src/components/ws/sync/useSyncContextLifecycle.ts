import { useCallback } from 'react';
import { validate as uuidValidate } from 'uuid';
import * as Y from 'yjs';

import { initSync, SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types } from '@/application/types';
import { messages } from '@/proto/messages';
import { Log } from '@/utils/log';

import { SyncRefs } from './syncRefs';
import { RegisterSyncContext } from './types';

/**
 * Manages the lifecycle of sync contexts: registration, ref-counting,
 * deferred cleanup, and teardown.
 *
 * @param refs - Shared mutable state container (see {@link SyncRefs}).
 *   Also provides `latestUserRef` so callbacks always read the freshest user
 *   without depending on a potentially-unstable `currentUser` object reference.
 * @param sendMessage - Sends a protobuf-encoded `messages.IMessage` to the
 *   **server** over the WebSocket connection. Originates from
 *   `useAppflowyWebSocket`. Called whenever the sync protocol needs to push
 *   data outward — initial sync requests, local Y.js updates, awareness
 *   changes, and sync responses to server-initiated requests.
 * @param postMessage - Broadcasts a protobuf-encoded `messages.IMessage` to
 *   **sibling browser tabs** via the BroadcastChannel API. Originates from
 *   `useBroadcastChannel`. Called in tandem with `sendMessage` so that all
 *   tabs sharing the same workspace stay in sync without each maintaining its
 *   own WebSocket connection.
 *
 * Both callbacks are wired into `context.emit` during registration (line
 * `context.emit = (msg) => { sendMessage(msg); postMessage(msg); }`), which
 * the sync protocol (`initSync`, `handleSyncRequest`, `handleUpdate`) invokes
 * whenever it needs to send a message. This dual-emit pattern ensures that:
 *   1. The server receives the update (via WebSocket).
 *   2. Other tabs in the same browser receive it immediately (via
 *      BroadcastChannel), without waiting for a server round-trip.
 */
export function useSyncContextLifecycle(
  refs: SyncRefs,
  sendMessage: (message: messages.IMessage) => void,
  postMessage: (message: messages.IMessage) => void
) {
  const cancelDeferredCleanup = useCallback((objectId: string) => {
    const timer = refs.pendingCleanups.current.get(objectId);

    if (timer !== undefined) {
      clearTimeout(timer);
      refs.pendingCleanups.current.delete(objectId);
      Log.debug(`Cancelled deferred cleanup for objectId ${objectId}`);
    }
  }, [refs]);

  const incrementContextRefCount = useCallback((objectId: string): number => {
    const nextRefCount = (refs.contextRefCounts.current.get(objectId) ?? 0) + 1;

    refs.contextRefCounts.current.set(objectId, nextRefCount);
    return nextRefCount;
  }, [refs]);

  const decrementContextRefCount = useCallback((objectId: string): number => {
    const currentRefCount = refs.contextRefCounts.current.get(objectId) ?? 0;

    if (currentRefCount <= 1) {
      refs.contextRefCounts.current.delete(objectId);
      return 0;
    }

    const nextRefCount = currentRefCount - 1;

    refs.contextRefCounts.current.set(objectId, nextRefCount);
    return nextRefCount;
  }, [refs]);

  const unregisterSyncContext = useCallback((objectId: string, options?: { flushPending?: boolean }) => {
    const ctx = refs.registeredContexts.current.get(objectId);

    if (!ctx) return;

    if (options?.flushPending === false) {
      // Version reset/revert path: drop stale updates instead of replaying them.
      ctx.discardPendingUpdates?.();
    } else if (ctx.flush) {
      // Standard path: flush pending local updates before removing observers.
      ctx.flush();
    }

    // Remove update/awareness observers
    if (ctx._cleanup) {
      ctx._cleanup();
    }

    const destroyListener = refs.destroyListeners.current.get(objectId);

    if (destroyListener) {
      destroyListener.doc.off('destroy', destroyListener.handler);
      refs.destroyListeners.current.delete(objectId);
    }

    const mappingListener = refs.mappingListeners.current.get(objectId);

    if (mappingListener) {
      mappingListener.doc.off('beforeObserverCalls', mappingListener.handler);
      refs.mappingListeners.current.delete(objectId);
    }

    refs.registeredContexts.current.delete(objectId);
    refs.contextRefCounts.current.delete(objectId);
    Log.debug(`Unregistered sync context for objectId ${objectId}`);
  }, [refs]);

  const scheduleDeferredCleanup = useCallback((objectId: string, delayMs = 10_000) => {
    // Cancel any existing timer for this objectId
    cancelDeferredCleanup(objectId);

    const remainingRefCount = decrementContextRefCount(objectId);

    // Context is still actively used elsewhere; don't schedule teardown yet.
    if (remainingRefCount > 0) {
      Log.debug(`Skipped deferred cleanup for objectId ${objectId}; ${remainingRefCount} active owner(s) remain`);
      return;
    }

    const timer = setTimeout(() => {
      refs.pendingCleanups.current.delete(objectId);

      const activeRefCount = refs.contextRefCounts.current.get(objectId) ?? 0;

      if (activeRefCount > 0) {
        Log.debug(`Skipped deferred cleanup for objectId ${objectId}; ref count restored to ${activeRefCount}`);
        return;
      }

      unregisterSyncContext(objectId);
    }, delayMs);

    refs.pendingCleanups.current.set(objectId, timer);
    Log.debug(`Scheduled deferred cleanup for objectId ${objectId} in ${delayMs}ms`);
  }, [refs, cancelDeferredCleanup, decrementContextRefCount, unregisterSyncContext]);

  const registerSyncContext = useCallback(
    (context: RegisterSyncContext): SyncContext => {
      if (!uuidValidate(context.doc.guid)) {
        throw new Error(`Invalid Y.Doc guid: ${context.doc.guid}. It must be a valid UUID v4.`);
      }

      // Cancel any pending deferred cleanup for this doc
      cancelDeferredCleanup(context.doc.guid);

      const existingContext = refs.registeredContexts.current.get(context.doc.guid);

      // If the context is already registered, check if it's the same doc instance
      if (existingContext !== undefined) {
        // If same doc instance, reuse the existing context
        if (existingContext.doc === context.doc) {
          const refCount = incrementContextRefCount(context.doc.guid);

          Log.debug(`Reusing existing sync context for objectId ${context.doc.guid}; owner count=${refCount}`);
          return existingContext;
        }

        // Different doc instance - clean up old context and register new one
        Log.debug(`Replacing stale sync context for objectId ${context.doc.guid} (different doc instance)`);
        unregisterSyncContext(context.doc.guid);
      }

      Log.debug(`Registering sync context for objectId ${context.doc.guid} with collabType ${context.collabType}`);
      context.emit = (message) => {
        sendMessage(message);
        postMessage(message);
      };

      // SyncContext extends RegisterSyncContext by attaching the emit function and destroy handler
      const syncContext = context as SyncContext;

      refs.registeredContexts.current.set(syncContext.doc.guid, syncContext);
      const handleDocDestroy = () => {
        const objectId = syncContext.doc.guid;
        const flushPending = !refs.skipFlushOnDestroy.current.has(objectId);

        cancelDeferredCleanup(objectId);
        refs.skipFlushOnDestroy.current.delete(objectId);
        unregisterSyncContext(objectId, { flushPending });
      };

      syncContext.doc.on('destroy', handleDocDestroy);
      refs.destroyListeners.current.set(syncContext.doc.guid, { doc: syncContext.doc, handler: handleDocDestroy });

      const currentUser = refs.latestUserRef.current;

      if (context.collabType === Types.Document && currentUser) {
        const uid = currentUser.uid;
        const onBeforeObserverCalls = (tx: Y.Transaction, doc: Y.Doc) => {
          if (!syncContext.userMappings && tx.local && tx.changed.size > 0) {
            // user mappings were not initialized and the currently committed transaction had some changes
            // made locally
            const userMappings = new Y.PermanentUserData(doc);

            Log.debug('Remember new user mapping', doc.clientID, uid);
            userMappings.setUserMapping(doc, doc.clientID, uid);
            syncContext.userMappings = userMappings;
          }
        };

        context.doc.on('beforeObserverCalls', onBeforeObserverCalls);
        refs.mappingListeners.current.set(syncContext.doc.guid, {
          doc: context.doc,
          handler: onBeforeObserverCalls,
        });
      }

      // Initialize the sync process for the new context
      initSync(syncContext);
      const refCount = incrementContextRefCount(syncContext.doc.guid);

      Log.debug(`Registered sync context for objectId ${syncContext.doc.guid}; owner count=${refCount}`);

      return syncContext;
    },
    [refs, sendMessage, postMessage, cancelDeferredCleanup, unregisterSyncContext, incrementContextRefCount]
  );

  return {
    registerSyncContext,
    unregisterSyncContext,
    scheduleDeferredCleanup,
    cancelDeferredCleanup,
  };
}
