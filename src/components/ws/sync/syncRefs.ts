import { useMemo, useRef } from 'react';
import * as Y from 'yjs';

import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { User } from '@/application/types';
import { collab } from '@/proto/messages';

import ICollabMessage = collab.ICollabMessage;

/**
 * Shared mutable state for all sync sub-hooks.
 *
 * Every field is a `MutableRefObject` so mutations are invisible to React's
 * reconciliation — they never trigger re-renders. The container itself is
 * wrapped in `useMemo(…, [])` by {@link useSyncRefs} to guarantee referential
 * stability across renders, preventing cascading `useCallback`/`useEffect`
 * invalidations in downstream hooks.
 *
 * Refs are grouped into four logical sections:
 *
 * ## 1. Sync context registry
 * Core bookkeeping for which Y.Docs are actively syncing.
 *
 * ## 2. Listener tracking
 * Pointers to event handlers attached to Y.Docs so they can be cleaned up
 * when a sync context is unregistered.
 *
 * ## 3. Version-reset coordination
 * Transient state that coordinates the async doc-rebuild flow when the server
 * signals a new collab version or the user initiates a revert.
 *
 * ## 4. Message queue & lifecycle
 * Incoming message routing and hook lifecycle flags.
 */
export type SyncRefs = {
  // ── 1. Sync context registry ─────────────────────────────────────────

  /**
   * The canonical map of every actively-syncing Y.Doc, keyed by `doc.guid`.
   *
   * Populated by `registerSyncContext` (in `useSyncContextLifecycle`).
   * Entries are removed by `unregisterSyncContext` — either directly or after
   * `scheduleDeferredCleanup`'s timer fires.
   *
   * Read by `applyCollabMessage` to look up the target context for an incoming
   * message, and by `flushAllSync` / `syncAllToServer` to iterate all docs.
   */
  registeredContexts: React.MutableRefObject<Map<string, SyncContext>>;

  /**
   * Owner ref-count per `doc.guid`.
   *
   * Incremented each time `registerSyncContext` is called with the *same* doc
   * instance (e.g. two components both bind the same database row doc).
   * Decremented by `scheduleDeferredCleanup`. Actual teardown only proceeds
   * when the count reaches zero, preventing premature destruction while another
   * component still holds a reference.
   */
  contextRefCounts: React.MutableRefObject<Map<string, number>>;

  // ── 2. Listener tracking ─────────────────────────────────────────────

  /**
   * Per-doc `'destroy'` event handler, keyed by `doc.guid`.
   *
   * Attached in `registerSyncContext` so that when a Y.Doc is destroyed (e.g.
   * the user navigates away or the version-reset path tears it down), the
   * corresponding sync context is automatically unregistered. The handler
   * checks `skipFlushOnDestroy` to decide whether to flush or discard pending
   * local updates.
   *
   * Removed in `unregisterSyncContext` via `doc.off('destroy', handler)`.
   */
  destroyListeners: React.MutableRefObject<Map<string, { doc: Y.Doc; handler: () => void }>>;

  /**
   * Per-doc `'beforeObserverCalls'` handler for `PermanentUserData` mapping.
   *
   * Only attached for `Types.Document` collabs when a user is logged in.
   * On the first local transaction that changes the doc, it lazily initialises
   * `PermanentUserData` and maps the current `doc.clientID` → `user.uid`.
   * This enables per-user change attribution in the Y.js history.
   *
   * Removed in `unregisterSyncContext`.
   */
  mappingListeners: React.MutableRefObject<Map<string, { doc: Y.Doc; handler: (tx: Y.Transaction, doc: Y.Doc) => void }>>;

  // ── 3. Version-reset coordination ────────────────────────────────────

  /**
   * Set of `doc.guid`s whose destroy handler should skip flushing pending
   * local updates.
   *
   * Added just before `previousDoc.destroy()` in the version-reset and revert
   * paths. The destroy handler in `registerSyncContext` checks membership here
   * to call `unregisterSyncContext(id, { flushPending: false })` instead of
   * the default flush path. This prevents stale edits from being sent to the
   * server while the doc is being replaced.
   *
   * Cleaned up by the destroy handler itself after reading the flag.
   */
  skipFlushOnDestroy: React.MutableRefObject<Set<string>>;

  /**
   * Active deferred-cleanup timers, keyed by `doc.guid`.
   *
   * Set by `scheduleDeferredCleanup` when a component unmounts but the doc may
   * still be needed (grace period, default 10 s). Cleared by
   * `cancelDeferredCleanup` when the doc is re-registered before the timer
   * fires. Also checked by `applyCollabMessage` to carry forward cleanup intent
   * when rebuilding a doc during version-reset (`hadPendingDeferredCleanup`).
   *
   * All remaining timers are cancelled on hook unmount (in `useBatchSync`).
   */
  pendingCleanups: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>;

  /**
   * Set of `objectId`s currently undergoing an async doc-rebuild.
   *
   * Added at the start of the version-reset or revert sequence, removed in the
   * `finally` block. While an objectId is in this set, incoming messages for
   * that object are diverted into `queuedMessagesDuringReset` instead of being
   * applied immediately (which would fail because the sync context has been
   * torn down).
   */
  resettingObjectIds: React.MutableRefObject<Set<string>>;

  /**
   * Messages received for an objectId while its doc is being rebuilt.
   *
   * Populated by `applyCollabMessage` when it detects the objectId is in
   * `resettingObjectIds` and no active context exists. After the rebuild
   * completes (in the `finally` block), these queued messages are replayed
   * through `applyCollabMessage` with `allowVersionReset: true` so that the
   * freshly-registered doc receives any updates that arrived during the gap.
   */
  queuedMessagesDuringReset: React.MutableRefObject<Map<string, ICollabMessage[]>>;

  /**
   * Transient per-tab "latest seen" incoming version, keyed by `objectId`.
   *
   * Updated at the top of `applyCollabMessage` for every message that carries a
   * valid version ID. Read by `shouldAbortReset()` to detect when a *newer*
   * version has arrived while an older reset is still in flight — if so, the
   * older reset is abandoned and the newer version's message will trigger its
   * own reset.
   *
   * This is intentionally **not** authoritative/persisted state. The source of
   * truth is `context.doc.version` plus IndexedDB `<objectId>/version`.
   */
  latestIncomingVersionRef: React.MutableRefObject<Map<string, string>>;

  // ── 4. Message queue & lifecycle ─────────────────────────────────────

  /**
   * Per-objectId FIFO queue for incoming collab messages.
   *
   * Messages are enqueued by `enqueueIncomingCollabMessage` (called from the
   * WS and BC `useEffect`s in `useCollabMessageHandler`). A single async
   * consumer per objectId (`processIncomingMessageQueueForObject`) drains the
   * queue sequentially — this guarantees that messages for the same document
   * are applied in order, even when one message triggers an async version-reset.
   *
   * Messages for *different* objectIds are processed concurrently (each has its
   * own queue and processing flag), so a slow reset on one doc never blocks
   * updates to another.
   */
  incomingMessageQueuesRef: React.MutableRefObject<Map<string, ICollabMessage[]>>;

  /**
   * Set of objectIds whose message queues are currently being drained.
   *
   * Used as a concurrency guard: `processIncomingMessageQueueForObject` bails
   * out immediately if the objectId is already in this set, preventing
   * duplicate concurrent drains for the same object.
   */
  processingObjectIdsRef: React.MutableRefObject<Set<string>>;

  /**
   * Snapshot of the latest `currentUser` value from React context.
   *
   * Kept in a ref so that async callbacks (e.g. the message queue processor)
   * always see the most recent user without needing it in their dependency
   * arrays. Updated by a `useEffect` in `useSync` whenever `currentUser`
   * changes.
   */
  latestUserRef: React.MutableRefObject<User | undefined>;

  /**
   * Whether the `useSync` hook has been unmounted.
   *
   * Set to `true` in the cleanup function of the lifecycle `useEffect` in
   * `useSync`. Checked by async message handlers to bail out early when the
   * component tree has already torn down, preventing stale state updates and
   * "setState on unmounted component" warnings.
   */
  isDisposedRef: React.MutableRefObject<boolean>;
};

export function useSyncRefs(): SyncRefs {
  // ── 1. Sync context registry ─────────────────────────────────────────
  const registeredContexts = useRef<Map<string, SyncContext>>(new Map());
  const contextRefCounts = useRef<Map<string, number>>(new Map());

  // ── 2. Listener tracking ─────────────────────────────────────────────
  const destroyListeners = useRef<Map<string, { doc: Y.Doc; handler: () => void }>>(new Map());
  const mappingListeners = useRef<Map<string, { doc: Y.Doc; handler: (tx: Y.Transaction, doc: Y.Doc) => void }>>(new Map());

  // ── 3. Version-reset coordination ────────────────────────────────────
  const skipFlushOnDestroy = useRef<Set<string>>(new Set());
  const pendingCleanups = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const resettingObjectIds = useRef<Set<string>>(new Set());
  const queuedMessagesDuringReset = useRef<Map<string, ICollabMessage[]>>(new Map());
  const latestIncomingVersionRef = useRef<Map<string, string>>(new Map());

  // ── 4. Message queue & lifecycle ─────────────────────────────────────
  const incomingMessageQueuesRef = useRef<Map<string, ICollabMessage[]>>(new Map());
  const processingObjectIdsRef = useRef<Set<string>>(new Set());
  const latestUserRef = useRef<User | undefined>(undefined);
  const isDisposedRef = useRef(false);

  // Stable container — individual refs are already stable via useRef,
  // but the wrapper must also be referentially stable so downstream
  // useCallback / useEffect deps don't cascade on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({
    registeredContexts,
    contextRefCounts,
    destroyListeners,
    mappingListeners,
    skipFlushOnDestroy,
    pendingCleanups,
    resettingObjectIds,
    queuedMessagesDuringReset,
    latestIncomingVersionRef,
    incomingMessageQueuesRef,
    processingObjectIdsRef,
    latestUserRef,
    isDisposedRef,
  }), []);
}
