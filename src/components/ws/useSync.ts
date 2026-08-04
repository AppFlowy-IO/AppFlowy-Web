import EventEmitter from 'events';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { bindSyncContext, UpdateFlags } from '@/application/services/js-services/sync-protocol';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { AppflowyWebSocketType } from '@/components/ws/useAppflowyWebSocket';
import { BroadcastChannelType } from '@/components/ws/useBroadcastChannel';

import { useSyncRefs } from './sync/syncRefs';
import { HttpFullSyncResult, SyncContextType } from './sync/types';
import { useBatchSync } from './sync/useBatchSync';
import { useCollabMessageHandler } from './sync/useCollabMessageHandler';
import { useCollabVersionRevert } from './sync/useCollabVersionRevert';
import { useSyncContextLifecycle } from './sync/useSyncContextLifecycle';
import { useWorkspaceNotifications } from './sync/useWorkspaceNotifications';

const WS_READY_STATE_OPEN = 1;

// Re-export types so existing consumer import paths continue to work
export type { RegisterSyncContext, SyncContextType } from './sync/types';

/**
 * Central orchestrator hook for real-time collaborative editing.
 *
 * Instantiated once by `AppSyncLayer` at the root of the authenticated app tree.
 * The returned value is placed into `SyncInternalContext` so that child components
 * can register/unregister Y.js documents for synchronisation without direct access
 * to the WebSocket or BroadcastChannel transport.
 *
 * ## Architecture
 *
 * ```
 *  AppSyncLayer
 *    └─ useSync  (this hook — composes the sub-hooks below)
 *         ├─ useSyncRefs              shared mutable state across all sub-hooks
 *         ├─ useWorkspaceNotifications  dispatches server notifications to app events
 *         ├─ useSyncContextLifecycle    register / unregister / ref-count / cleanup
 *         ├─ useCollabMessageHandler    incoming WS/BC collab messages → Y.Doc
 *         ├─ useBatchSync               flushAllSync, syncAllToServer
 *         └─ useCollabVersionRevert     user-initiated "Restore version"
 * ```
 *
 * Dependency flow is strictly one-way (orchestrator → sub-hooks → types/utils) to
 * prevent circular imports.
 *
 * ## Returned callbacks
 *
 * ### `registerSyncContext(context): SyncContext`
 *
 * Binds a Y.Doc to the sync engine so that:
 *   - Local edits are forwarded to the server via WebSocket **and** broadcast to
 *     sibling tabs via BroadcastChannel.
 *   - Incoming remote updates are applied to the doc.
 *   - An `initSync` handshake is kicked off immediately.
 *
 * Ref-counted: if the same doc instance is registered N times, the context stays
 * alive until N corresponding `scheduleDeferredCleanup` calls have fired.
 * Registering a *different* doc instance with the same guid replaces the stale context.
 *
 * **Called by:**
 *   - `useViewOperations.bindViewSync()` — after a document/database view loads
 *   - `useViewOperations.createRow()` — immediately after creating a new database row
 *   - `useDatabaseIdentity.registerWorkspaceDatabaseDoc()` — lazily on first database view
 *   - `useBindViewSync` — simplified binding used by the Database component
 *   - `rebuildCollabDoc()` — internally during version-reset or revert to re-register
 *     the rebuilt doc
 *
 * ### `scheduleDeferredCleanup(objectId, delayMs?): void`
 *
 * Decrements the ref-count for a doc and, if it reaches zero, schedules teardown
 * after `delayMs` (default 10 s). If the doc is re-registered before the timer
 * fires the cleanup is cancelled and the existing context is reused.
 *
 * This grace period prevents unnecessary teardown→rebuild cycles during fast
 * navigation (e.g. user clicks between pages quickly).
 *
 * **Called by:**
 *   - `AppPage` effect — when the user navigates away from a view
 *   - `Database` unmount effect — cleans up all row syncs opened during the session
 *   - `rebuildCollabDoc()` — carries forward a pending cleanup timer from the
 *     previous doc to the rebuilt doc
 *
 * ### `revertCollabVersion(viewId, versionId): Promise<void>`
 *
 * User-initiated "Restore to version" flow:
 *   1. Discards pending local edits and unregisters the current sync context.
 *   2. Calls the server HTTP API (`revertCollabVersion`) to persist the revert.
 *   3. Opens a fresh Y.Doc from IndexedDB with the reverted state, applies the
 *      server-returned doc snapshot, and re-registers it.
 *   4. Emits `COLLAB_DOC_RESET` so the UI re-binds to the new doc.
 *
 * If the rebuild fails, the *previous* context is restored as a fallback to keep
 * the page functional.
 *
 * **Called by:**
 *   - `DocumentHistoryModal.handleRestore()` — when the user clicks "Restore" in
 *     the version history dialog
 *
 * ### `flushAllSync(): Promise<boolean>`
 *
 * Awaits the persistent sync_outbox drain for every registered sync context.
 * Local Y.js updates are enqueued to IndexedDB synchronously as they happen;
 * this function ensures all pending records have been transmitted before
 * returning.
 *
 * **Called by:**
 *   - `syncAllToServer()` — as its first step, before the HTTP batch request.
 *     Not called directly by any UI component.
 *
 * ### `syncAllToServer(workspaceId): Promise<void>`
 *
 * Collects the full state of every registered Y.Doc and sends them all to the
 * server in a single HTTP batch request (`collab_full_sync_batch`). This mirrors
 * the desktop client's pre-duplicate sync and guarantees the server has the latest
 * content before a destructive operation.
 *
 * **Called by:**
 *   - `MoreActionsContent.handleDuplicateClick()` — before duplicating a page, a
 *     blocking loader is shown while this runs
 *
 * ## Message flow (incoming)
 *
 * ```
 * Server ──WS──▸ lastMessage.collabMessage ──▸ useCollabMessageHandler
 *                                                 ├─ enqueue per objectId
 *                                                 ├─ version check / reset
 *                                                 └─ handleMessage(context, msg)
 *
 * Sibling tab ──BC──▸ lastBroadcastMessage.collabMessage ──▸ (same path)
 * ```
 *
 * Each objectId has its own sequential queue so a slow reset for one document
 * never blocks updates to other documents.
 *
 * ## Version-reset flow (server-initiated)
 *
 * When an incoming message carries a version that differs from the local doc's
 * version, `applyCollabMessage` triggers a reset:
 *   1. Emits `'reset'` on the old doc so UI listeners can detach.
 *   2. Destroys the old doc (skipping the flush-on-destroy path).
 *   3. Opens a fresh doc from IndexedDB with `expectedVersion`.
 *   4. Re-registers via `rebuildCollabDoc()` and emits `COLLAB_DOC_RESET`.
 *   5. Replays any messages queued during the async reset window.
 *
 * @param ws  - WebSocket transport (sendMessage + lastMessage)
 * @param bc  - BroadcastChannel transport (postMessage + lastBroadcastMessage)
 * @param eventEmitter - App-wide event bus for workspace notifications and doc reset events
 * @param workspaceId  - Current workspace ID, used by `revertCollabVersion`
 */
export const useSync = (
  ws: AppflowyWebSocketType,
  bc: BroadcastChannelType,
  eventEmitter: EventEmitter,
  workspaceId: string
): SyncContextType => {
  const { sendMessage, lastMessage, readyState } = ws;
  const { postMessage, lastBroadcastMessage } = bc;
  const currentUser = useCurrentUserOptional();

  // Extract specific values to use as primitive dependencies.
  // This prevents effect re-runs when unrelated fields of the parent object change.
  const wsCollabMessage = lastMessage?.collabMessage;
  const bcCollabMessage = lastBroadcastMessage?.collabMessage;
  const wsNotification = lastMessage?.notification;
  const bcNotification = lastBroadcastMessage?.notification;

  // Shared mutable refs container — stable across renders (wrapped in useMemo).
  // Passed to every sub-hook so they share the same Maps/Sets without prop-drilling
  // 13 individual refs.
  const refs = useSyncRefs();

  // Keep the latest user reference accessible to async callbacks that outlive
  // the render in which they were created (e.g. message queue processing).
  useEffect(() => {
    refs.latestUserRef.current = currentUser;
  }, [refs, currentUser]);

  // Mark the hook as "alive" on mount and "disposed" on unmount.
  // Disposed state is checked by async message handlers to bail out early when the
  // component tree has already torn down.
  useEffect(() => {
    refs.isDisposedRef.current = false;

    return () => {
      refs.isDisposedRef.current = true;
      for (const queue of refs.incomingMessageQueuesRef.current.values()) {
        for (const task of queue) {
          task.reject?.(new Error('Sync disposed before queued collab message was applied'));
        }
      }

      refs.incomingMessageQueuesRef.current.clear();
      refs.processingObjectIdsRef.current.clear();
    };
  }, [refs]);

  // ── Workspace notifications ──────────────────────────────────────────
  // Dispatches server-pushed workspace events (permission changes, section updates,
  // profile changes, etc.) to the app-wide EventEmitter.  Handles both direct
  // WebSocket notifications and cross-tab BroadcastChannel relays.
  useWorkspaceNotifications(wsNotification, bcNotification, eventEmitter);

  // ── Batch sync utilities ─────────────────────────────────────────────
  // flushAllSync: drain buffered local updates to WebSocket for every registered doc.
  // syncAllToServer: full HTTP batch sync (used before operations like "Duplicate").
  // notifyLocalEdit: debounced HTTP full-sync fallback while WebSocket is reconnecting.
  // notifyManifestSync: clears HTTP fallback markers after a WS manifest/state-vector exchange.
  const { flushAllSync, syncAllToServer, notifyLocalEdit, notifyManifestSync } = useBatchSync(refs, {
    workspaceId,
    wsReadyState: readyState,
  });

  // ── Sync context lifecycle ───────────────────────────────────────────
  // Provides registerSyncContext / unregisterSyncContext / scheduleDeferredCleanup.
  // Manages ref-counting so multiple components sharing the same Y.Doc don't
  // tear it down prematurely.
  const { registerSyncContext, unregisterSyncContext, scheduleDeferredCleanup } = useSyncContextLifecycle(
    refs,
    sendMessage,
    postMessage,
    notifyLocalEdit,
    notifyManifestSync
  );

  // A reopened socket has no knowledge of messages this tab missed while it
  // was disconnected. Re-bind every live document so the server and client
  // exchange current state vectors and reconcile their manifests. This is not
  // a full registration: existing observers and owner ref-counts stay intact.
  const previousReadyStateRef = useRef(readyState);
  const hasOpenedRef = useRef(readyState === WS_READY_STATE_OPEN);
  const readyStateRef = useRef(readyState);

  // Keep the public rebind callback stable so a transport state change does
  // not invalidate SyncInternalContext and every downstream database callback.
  useLayoutEffect(() => {
    readyStateRef.current = readyState;
  }, [readyState]);

  useEffect(() => {
    const previousReadyState = previousReadyStateRef.current;

    previousReadyStateRef.current = readyState;
    if (readyState !== WS_READY_STATE_OPEN || previousReadyState === WS_READY_STATE_OPEN) return;

    if (!hasOpenedRef.current) {
      // initSync already emitted the initial bind, which the transport queues
      // while connecting. Only later OPEN transitions need another bind.
      hasOpenedRef.current = true;
      return;
    }

    refs.registeredContexts.current.forEach((context) => bindSyncContext(context));
  }, [readyState, refs]);

  const rebindSyncContext = useCallback(
    (objectId: string) => {
      const context = refs.registeredContexts.current.get(objectId);

      if (!context) return undefined;

      // Reconnect already rebinds every registered context. Avoid filling the
      // transport's offline queue with repeated retry manifests.
      if (readyStateRef.current === WS_READY_STATE_OPEN) {
        bindSyncContext(context);
      }

      return context.doc;
    },
    [refs]
  );

  // ── Incoming collab messages ─────────────────────────────────────────
  // Watches wsCollabMessage / bcCollabMessage and routes them through a per-objectId
  // sequential queue.  Handles version mismatch detection and triggers doc rebuild
  // (version-reset) when the server signals a new collab version.
  const { applyCollabMessage, enqueueIncomingCollabMessage } = useCollabMessageHandler(
    refs,
    wsCollabMessage,
    bcCollabMessage,
    eventEmitter,
    registerSyncContext,
    scheduleDeferredCleanup
  );

  const applyHttpFullSyncResult = useCallback(
    async (result: HttpFullSyncResult, fallbackVersion?: string | null, signal?: AbortSignal) => {
      const activeContext = refs.registeredContexts.current.get(result.objectId);
      // When the server omits a version, retain the active local version so an
      // otherwise valid HTTP response cannot look like an authoritative
      // version clear and trigger an unnecessary reset.
      const version = result.collabVersion ?? activeContext?.doc.version ?? fallbackVersion ?? undefined;
      const hasMissingUpdate = result.missingUpdate.byteLength > 2;
      const versionDiffers = Boolean(version && activeContext?.doc.version && version !== activeContext.doc.version);
      const collabMessage =
        versionDiffers && !hasMissingUpdate
          ? {
              objectId: result.objectId,
              collabType: result.collabType,
              syncRequest: {
                stateVector: result.serverStateVector,
                lastMessageId: result.messageId,
                version,
              },
            }
          : {
              objectId: result.objectId,
              collabType: result.collabType,
              update: {
                flags: UpdateFlags.Lib0v1,
                // Canonical empty lib0-v1 update. This lets a same-version
                // response advance lastMessageId without asking Yjs to decode a
                // zero-length buffer.
                payload: hasMissingUpdate ? result.missingUpdate : new Uint8Array([0, 0]),
                version,
                messageId: result.messageId,
              },
            };
      const applied = await enqueueIncomingCollabMessage(collabMessage, {
        allowVersionReset: true,
        user: refs.latestUserRef.current,
        signal,
        // Slow-sync retirement is only safe after the response reaches a live
        // document. A persisted record can drain after reload while its collab
        // is still closed, in which case the response must remain retryable.
        requireActiveContext: true,
        skipActiveDrainOnDiscard: true,
      });

      if (!applied) {
        throw new Error(`HTTP full-sync result for ${result.objectId} was not applied to an active sync context`);
      }
    },
    [refs, enqueueIncomingCollabMessage]
  );

  // ── User-initiated version revert ────────────────────────────────────
  // Tears down the current doc, calls the server revert API, rebuilds a fresh doc
  // from the returned snapshot, and re-registers it.  Falls back to the previous
  // context if the rebuild fails.
  const { revertCollabVersion } = useCollabVersionRevert({
    refs,
    workspaceId,
    eventEmitter,
    registerSyncContext,
    unregisterSyncContext,
    scheduleDeferredCleanup,
    applyCollabMessage,
  });

  // Memoized so the hook is safe to consume directly, not only via the
  // re-memoized SyncInternalContext value in AppSyncLayer.
  return useMemo(
    () => ({
      registerSyncContext,
      rebindSyncContext,
      revertCollabVersion,
      flushAllSync,
      syncAllToServer,
      applyHttpFullSyncResult,
      scheduleDeferredCleanup,
    }),
    [
      registerSyncContext,
      rebindSyncContext,
      revertCollabVersion,
      flushAllSync,
      syncAllToServer,
      applyHttpFullSyncResult,
      scheduleDeferredCleanup,
    ]
  );
};
