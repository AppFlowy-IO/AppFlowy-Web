import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';

import { getRowKey, getMetaJSON } from '@/application/database-yjs/row_meta';
import {
  collabIndexedDBExists,
  listCollabIndexedDBNames,
  openCollabDBWithProvider,
  openRowCollabDBWithProvider,
} from '@/application/db';
import {
  getCachedRowSubDoc,
  getCachedRowSubDocIds,
  awaitPendingRowDocEnsures,
  mergeLegacyRowDocIfExists,
} from '@/application/services/js-services/cache';
import { collabFullSyncBatch, createOrphanedView, checkIfCollabExists } from '@/application/services/js-services/http/http_api';
import { handleAPIError, withRetry } from '@/application/services/js-services/http/core';
import { waitForDrain } from '@/application/sync-outbox';
import { Types, YDatabase, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';
import { Log } from '@/utils/log';

import { SyncRefs } from './syncRefs';

// 30s base delay for batch sync retries (rate-limited / server-busy).
// withRetry adds jitter and honours server Retry-After when present.
const BATCH_SYNC_DELAYS = [30_000, 30_000, 30_000];
const WS_READY_STATE_OPEN = 1;
const BACKGROUND_HTTP_SYNC_DELAY_MS = 5_000;
// Loop-level pauses after withRetry exhausts, matching the desktop client
// protocol (doc/context/api_collab_sync.md in AppFlowy-Cloud): the server
// returning 429 means it is shedding load — keep the loop quiet for 10 minutes
// instead of re-entering the 5s cadence. Other exhausted errors pause 5 minutes.
const BACKGROUND_HTTP_SYNC_RATE_LIMIT_PAUSE_MS = 10 * 60 * 1000;
const BACKGROUND_HTTP_SYNC_ERROR_PAUSE_MS = 5 * 60 * 1000;
const BACKGROUND_HTTP_SYNC_RECENT_EDIT_WINDOW_MS = 10 * 60 * 1000;
const BACKGROUND_HTTP_SYNC_TYPES = new Set<Types>([
  Types.Document,
  Types.Database,
  Types.WorkspaceDatabase,
  Types.Folder,
  Types.DatabaseRow,
]);
const EMPTY_YJS_UPDATE_MAX_BYTES = 2;

interface BackgroundDirtyEdit {
  seq: number;
  editedAt: number;
  retryRetainUntil?: number;
}

/**
 * Collect all unique row IDs from every view in a database Y.Doc.
 * Different views may reference the same rows, so we deduplicate.
 */
function collectAllRowIds(databaseDoc: Y.Doc): string[] {
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot?.get(YjsEditorKey.database) as YDatabase | undefined;

  if (!database) return [];

  const views = database.get(YjsDatabaseKey.views);

  if (!views) return [];

  const rowIdSet = new Set<string>();

  views.forEach((view) => {
    const rowOrders = view?.get(YjsDatabaseKey.row_orders);

    if (!rowOrders) return;

    for (let i = 0; i < rowOrders.length; i++) {
      const row = rowOrders.get(i) as { id?: string } | undefined;

      if (row?.id) {
        rowIdSet.add(row.id);
      }
    }
  });

  return Array.from(rowIdSet);
}

export function useBatchSync(
  refs: SyncRefs,
  options?: {
    workspaceId?: string;
    wsReadyState?: number;
  }
) {
  const batchSyncAbortRef = useRef<AbortController | null>(null);
  const backgroundHttpSyncAbortRef = useRef<AbortController | null>(null);
  const backgroundHttpSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundHttpSyncInFlightRef = useRef(false);
  const backgroundDirtyEditsRef = useRef<Map<string, BackgroundDirtyEdit>>(new Map());
  const backgroundDirtySeqRef = useRef(0);
  // Epoch ms until which the background loop must stay quiet after the server
  // signalled busy (429/503) or a cycle exhausted its retries. 0 = not paused.
  const backgroundHttpSyncPausedUntilRef = useRef(0);
  const wsReadyStateRef = useRef<number | undefined>(options?.wsReadyState);
  const workspaceIdRef = useRef<string | undefined>(options?.workspaceId);
  const runBackgroundHttpSyncRef = useRef<() => Promise<void>>(async () => undefined);

  const clearBackgroundHttpSyncTimer = useCallback(() => {
    if (backgroundHttpSyncTimerRef.current) {
      clearTimeout(backgroundHttpSyncTimerRef.current);
      backgroundHttpSyncTimerRef.current = null;
    }
  }, []);

  const scheduleBackgroundHttpSyncTimer = useCallback(() => {
    const workspaceId = workspaceIdRef.current;
    const readyState = wsReadyStateRef.current;

    if (!workspaceId || readyState === undefined || readyState === WS_READY_STATE_OPEN) return;

    // Honour an active busy pause: local edits keep marking docs dirty, but
    // the next request waits until the pause expires instead of every 5s.
    const pauseRemainingMs = backgroundHttpSyncPausedUntilRef.current - Date.now();
    const delayMs = Math.max(BACKGROUND_HTTP_SYNC_DELAY_MS, pauseRemainingMs);

    clearBackgroundHttpSyncTimer();
    backgroundHttpSyncTimerRef.current = setTimeout(() => {
      backgroundHttpSyncTimerRef.current = null;
      void runBackgroundHttpSyncRef.current();
    }, delayMs);
  }, [clearBackgroundHttpSyncTimer]);

  useEffect(() => {
    const previousWorkspaceId = workspaceIdRef.current;

    workspaceIdRef.current = options?.workspaceId;

    if (previousWorkspaceId && previousWorkspaceId !== options?.workspaceId) {
      backgroundDirtyEditsRef.current.clear();
      clearBackgroundHttpSyncTimer();
      backgroundHttpSyncAbortRef.current?.abort();
    }
  }, [options?.workspaceId, clearBackgroundHttpSyncTimer]);

  useEffect(() => {
    wsReadyStateRef.current = options?.wsReadyState;

    if (options?.wsReadyState === WS_READY_STATE_OPEN) {
      clearBackgroundHttpSyncTimer();
      backgroundHttpSyncAbortRef.current?.abort();
      return;
    }

    if (backgroundDirtyEditsRef.current.size > 0) {
      scheduleBackgroundHttpSyncTimer();
    }
  }, [options?.wsReadyState, clearBackgroundHttpSyncTimer, scheduleBackgroundHttpSyncTimer]);

  const buildBackgroundHttpSyncItems = useCallback((objectIds: Iterable<string>) => {
    const ids = new Set(objectIds);
    const items: Array<{
      objectId: string;
      collabType: Types;
      stateVector: Uint8Array;
      docState: Uint8Array;
    }> = [];

    refs.registeredContexts.current.forEach((context) => {
      const { doc, collabType } = context;

      if (!doc || collabType === undefined || !ids.has(doc.guid)) return;
      if (!BACKGROUND_HTTP_SYNC_TYPES.has(collabType)) return;

      items.push({
        objectId: doc.guid,
        collabType,
        stateVector: Y.encodeStateVector(doc),
        docState: Y.encodeStateAsUpdate(doc),
      });
    });

    return items;
  }, [refs]);

  const clearBackgroundDirtyEdits = useCallback((objectIds: Iterable<string>) => {
    for (const objectId of objectIds) {
      backgroundDirtyEditsRef.current.delete(objectId);
    }
  }, []);

  const notifyManifestSync = useCallback((objectId: string) => {
    if (wsReadyStateRef.current !== WS_READY_STATE_OPEN) return;

    clearBackgroundDirtyEdits([objectId]);
  }, [clearBackgroundDirtyEdits]);

  const applyFullSyncResults = useCallback((results: Awaited<ReturnType<typeof collabFullSyncBatch>>) => {
    for (const result of results) {
      if (result.error) {
        Log.warn('[sync] HTTP full-sync result error', {
          objectId: result.objectId,
          collabType: result.collabType,
          error: result.error,
        });
        continue;
      }

      const missingUpdate = result.missingUpdate;

      if (!missingUpdate || missingUpdate.byteLength <= EMPTY_YJS_UPDATE_MAX_BYTES) {
        continue;
      }

      const context = refs.registeredContexts.current.get(result.objectId);

      if (!context?.doc) {
        Log.debug('[sync] HTTP full-sync missing update skipped: context not registered', {
          objectId: result.objectId,
        });
        continue;
      }

      try {
        applyYDoc(context.doc, missingUpdate);

        if (context.doc.store.pendingStructs || context.doc.store.pendingDs) {
          Log.debug('[sync] HTTP full-sync missing update has pending dependencies; sending sync request', {
            objectId: result.objectId,
            collabType: context.collabType,
          });
          context.emit({
            collabMessage: {
              objectId: context.doc.guid,
              collabType: context.collabType,
              syncRequest: {
                stateVector: Y.encodeStateVector(context.doc),
                lastMessageId: context.lastMessageId || { timestamp: 0, counter: 0 },
                version: context.doc.version,
              },
            },
          });
        }
      } catch (error) {
        Log.warn('[sync] failed to apply HTTP full-sync missing update', {
          objectId: result.objectId,
          error,
        });
      }
    }
  }, [refs]);

  const runBackgroundHttpSync = useCallback(async () => {
    if (backgroundHttpSyncInFlightRef.current) return;

    const workspaceId = workspaceIdRef.current;
    const readyState = wsReadyStateRef.current;

    if (!workspaceId || readyState === undefined || readyState === WS_READY_STATE_OPEN) return;

    const now = Date.now();
    const dirtySnapshot = Array.from(backgroundDirtyEditsRef.current.entries()).filter(([objectId, dirty]) => {
      const isRecentEdit = now - dirty.editedAt <= BACKGROUND_HTTP_SYNC_RECENT_EDIT_WINDOW_MS;
      const isRetainedForRetry = dirty.retryRetainUntil !== undefined && now <= dirty.retryRetainUntil;

      if (isRecentEdit || isRetainedForRetry) return true;

      if (backgroundDirtyEditsRef.current.get(objectId)?.seq === dirty.seq) {
        backgroundDirtyEditsRef.current.delete(objectId);
      }

      return false;
    });

    if (dirtySnapshot.length === 0) return;

    const items = buildBackgroundHttpSyncItems(dirtySnapshot.map(([objectId]) => objectId));
    const itemIds = new Set(items.map((item) => item.objectId));

    for (const [objectId, dirty] of dirtySnapshot) {
      if (!itemIds.has(objectId) && backgroundDirtyEditsRef.current.get(objectId)?.seq === dirty.seq) {
        backgroundDirtyEditsRef.current.delete(objectId);
      }
    }

    if (items.length === 0) return;

    backgroundHttpSyncInFlightRef.current = true;
    backgroundHttpSyncAbortRef.current?.abort();
    const controller = new AbortController();

    backgroundHttpSyncAbortRef.current = controller;

    try {
      Log.debug('[sync] background HTTP full-sync started', {
        workspaceId,
        items: items.length,
      });
      const results = await withRetry(() => collabFullSyncBatch(workspaceId, items), {
        delays: BATCH_SYNC_DELAYS,
        signal: controller.signal,
      });

      backgroundHttpSyncPausedUntilRef.current = 0;
      applyFullSyncResults(results);

      for (const [objectId, dirty] of dirtySnapshot) {
        if (itemIds.has(objectId) && backgroundDirtyEditsRef.current.get(objectId)?.seq === dirty.seq) {
          backgroundDirtyEditsRef.current.delete(objectId);
        }
      }

      Log.debug('[sync] background HTTP full-sync completed', {
        workspaceId,
        items: items.length,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        // withRetry already consumed the per-request Retry-After delays; an
        // error landing here means the server stayed busy (or kept failing)
        // through every attempt, so back off at the loop level.
        const normalized = handleAPIError(error);
        const pauseMs =
          normalized.code === 429 ? BACKGROUND_HTTP_SYNC_RATE_LIMIT_PAUSE_MS : BACKGROUND_HTTP_SYNC_ERROR_PAUSE_MS;
        const pauseUntil = Date.now() + pauseMs;
        const shouldRetainFailedDirtyEdits = normalized.code === 429 || normalized.code === -1 || normalized.code >= 500;

        backgroundHttpSyncPausedUntilRef.current = pauseUntil;

        if (shouldRetainFailedDirtyEdits) {
          const retryRetainUntil = pauseUntil + BACKGROUND_HTTP_SYNC_RECENT_EDIT_WINDOW_MS;

          for (const [objectId, dirty] of dirtySnapshot) {
            const currentDirty = backgroundDirtyEditsRef.current.get(objectId);

            if (itemIds.has(objectId) && currentDirty?.seq === dirty.seq) {
              currentDirty.retryRetainUntil = retryRetainUntil;
            }
          }
        }

        Log.warn('[sync] background HTTP full-sync failed; pausing loop', {
          workspaceId,
          error,
          pauseMs,
        });
      }
    } finally {
      if (backgroundHttpSyncAbortRef.current === controller) {
        backgroundHttpSyncAbortRef.current = null;
      }

      backgroundHttpSyncInFlightRef.current = false;

      if (backgroundDirtyEditsRef.current.size > 0) {
        scheduleBackgroundHttpSyncTimer();
      }
    }
  }, [applyFullSyncResults, buildBackgroundHttpSyncItems, scheduleBackgroundHttpSyncTimer]);

  useEffect(() => {
    runBackgroundHttpSyncRef.current = runBackgroundHttpSync;
  }, [runBackgroundHttpSync]);

  const notifyLocalEdit = useCallback((objectId: string) => {
    const readyState = wsReadyStateRef.current;

    backgroundDirtySeqRef.current += 1;
    backgroundDirtyEditsRef.current.set(objectId, {
      seq: backgroundDirtySeqRef.current,
      editedAt: Date.now(),
    });

    if (readyState === undefined || readyState === WS_READY_STATE_OPEN) return;

    scheduleBackgroundHttpSyncTimer();
  }, [scheduleBackgroundHttpSyncTimer]);

  /**
   * Wait until the persistent sync_outbox has drained for every registered
   * sync context. Returns `true` when fully drained, `false` on timeout
   * (e.g. the WebSocket stayed closed). Callers that need hard delivery
   * should follow up with the HTTP batch path — the Yjs handshake recovers
   * anything left behind.
   */
  const flushAllSync = useCallback(async () => {
    Log.debug('Flushing all sync contexts (awaiting outbox drain)');
    const objectIds = Array.from(refs.registeredContexts.current.keys());

    const drained = await waitForDrain(objectIds);

    if (!drained) {
      Log.warn('[sync] flushAllSync returned with pending outbox records (WS likely closed)');
    }

    return drained;
  }, [refs]);

  /**
   * Sync all registered collab documents to the server via HTTP API.
   * This uses the same collab_full_sync_batch API that desktop uses to send
   * all collab states in a single batch request before operations like duplicate.
   *
   * For database collabs, this also loads any unregistered row documents from
   * IndexedDB and includes them in the batch. This ensures that all rows are
   * synced before operations like duplicate, not just the ones currently visible.
   */
  const syncAllToServer = useCallback(
    async (workspaceId: string) => {
      // Kick the WS outbox drain in the background but do NOT block on it —
      // the HTTP batch below encodes the current doc state (which already
      // includes every local edit), so we don't need WS quiescence before
      // proceeding. Awaiting here could consume the caller's duplicate
      // timeout budget (Promise.race in `duplicatePage`) when the socket
      // is reconnecting; any WS sends that fire later are idempotent.
      void flushAllSync();

      // Collect all registered contexts into a batch
      const items: Array<{
        objectId: string;
        collabType: Types;
        stateVector: Uint8Array;
        docState: Uint8Array;
      }> = [];

      const registeredObjectIds = new Set<string>();

      refs.registeredContexts.current.forEach((context) => {
        const { doc, collabType } = context;

        if (!doc || collabType === undefined) return;

        registeredObjectIds.add(doc.guid);

        // Encode the document state and state vector
        const docState = Y.encodeStateAsUpdate(doc);
        const stateVector = Y.encodeStateVector(doc);

        Log.debug('Adding collab to batch sync', {
          objectId: doc.guid,
          collabType,
          docStateSize: docState.length,
        });

        items.push({
          objectId: doc.guid,
          collabType,
          stateVector,
          docState,
        });
      });

      // For each registered database, find all row IDs and load any that are
      // not already registered (i.e. rows that were never scrolled into view).
      // Process in batches to avoid overwhelming IndexedDB with too many
      // concurrent opens (matches BACKGROUND_CONCURRENCY in useBackgroundRowDocLoader).
      const ROW_SYNC_CONCURRENCY = 12;

      const unregisteredRows: { rowId: string; rowKey: string }[] = [];
      const unregisteredRowDocumentIds = new Set<string>();

      refs.registeredContexts.current.forEach((context) => {
        if (context.collabType !== Types.Database || !context.doc) return;

        const databaseId =
          context.doc.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database)?.get(YjsDatabaseKey.id) ||
          context.doc.guid;
        const allRowIds = collectAllRowIds(context.doc);
        const unregisteredRowIds = allRowIds.filter((id) => !registeredObjectIds.has(id));

        if (unregisteredRowIds.length === 0) return;

        Log.debug('Loading unregistered database rows for batch sync', {
          databaseId,
          totalRows: allRowIds.length,
          unregisteredRows: unregisteredRowIds.length,
        });

        for (const rowId of unregisteredRowIds) {
          unregisteredRows.push({ rowId, rowKey: getRowKey(databaseId, rowId) });
        }
      });

      const existingIndexedDBNames = unregisteredRows.length > 0 ? await listCollabIndexedDBNames() : new Set<string>();

      for (let i = 0; i < unregisteredRows.length; i += ROW_SYNC_CONCURRENCY) {
        const slice = unregisteredRows.slice(i, i + ROW_SYNC_CONCURRENCY);

        await Promise.all(
          slice.map(async ({ rowId, rowKey }) => {
            try {
              // Use skipCache to avoid permanently pinning every row doc in memory.
              const { doc: rowDoc, provider } = await openRowCollabDBWithProvider(rowId, { skipCache: true });

              try {
                // If the row was never cached locally, the doc will be empty.
                // Skip it — uploading an empty state would overwrite the server's
                // real data during duplicate.
                let rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);

                const legacyExists =
                  existingIndexedDBNames.has(rowKey) ||
                  (existingIndexedDBNames.size === 0 && (await collabIndexedDBExists(rowKey)));

                if (legacyExists) {
                  await mergeLegacyRowDocIfExists(rowKey, rowId, rowDoc, { legacyExists: true });
                  rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
                }

                if (!rowSharedRoot.has(YjsEditorKey.database_row)) {
                  return;
                }

                const rowMeta = rowSharedRoot.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;
                const rowDocumentId = rowMeta ? getMetaJSON(rowId, rowMeta).documentId : '';

                if (rowDocumentId && !registeredObjectIds.has(rowDocumentId)) {
                  unregisteredRowDocumentIds.add(rowDocumentId);
                }

                const docState = Y.encodeStateAsUpdate(rowDoc);
                const stateVector = Y.encodeStateVector(rowDoc);

                items.push({
                  objectId: rowId,
                  collabType: Types.DatabaseRow,
                  stateVector,
                  docState,
                });
              } finally {
                try {
                  await provider.destroy();
                } finally {
                  rowDoc.destroy();
                }
              }

            } catch (e) {
              Log.warn('Failed to load unregistered row doc for sync', { rowKey, error: e });
            }
          })
        );
      }

      for (const documentId of getCachedRowSubDocIds()) {
        if (!registeredObjectIds.has(documentId)) {
          unregisteredRowDocumentIds.add(documentId);
        }
      }

      // Closed row-detail editors are not registered sync contexts, but their
      // document collabs still need to be pushed before duplicate so the server
      // copies the latest row-document content.
      for (const documentId of unregisteredRowDocumentIds) {
        try {
          const cachedRowDocument = getCachedRowSubDoc(documentId);
          let rowDocument = cachedRowDocument;
          let provider: { destroy: () => Promise<void> } | null = null;

          if (!rowDocument) {
            const opened = await openCollabDBWithProvider(documentId, { skipCache: true });

            rowDocument = opened.doc;
            provider = opened.provider;
          }

          const documentSharedRoot = rowDocument.getMap(YjsEditorKey.data_section);

          if (!documentSharedRoot.has(YjsEditorKey.document)) {
            if (provider) {
              await provider.destroy();
              rowDocument.destroy();
            }

            continue;
          }

          const docState = Y.encodeStateAsUpdate(rowDocument);
          const stateVector = Y.encodeStateVector(rowDocument);

          items.push({
            objectId: documentId,
            collabType: Types.Document,
            stateVector,
            docState,
          });

          // Only destroy docs we opened ourselves (skipCache: true).
          // Cached docs are owned by the cache and must not be destroyed here.
          if (provider) {
            await provider.destroy();
            rowDocument.destroy();
          }
        } catch (e) {
          Log.warn('Failed to load unregistered row document for sync', { documentId, error: e });
        }
      }

      if (items.length === 0) {
        Log.debug('No collabs to sync');
        return;
      }

      // Ensure server-side collabs exist for all row sub-documents before batch
      // sync. Row sub-documents are created on the server lazily via
      // `ensureRowDocumentExists` (fire-and-forget) when the user first types in
      // them. Two-phase approach:
      //   1. Await any in-flight creations tracked by `trackRowDocEnsure` — this
      //      covers the common case where the dialog's ensureRowDocumentExists is
      //      still running.
      //   2. As a fallback, check existence and create if missing — this covers
      //      edge cases where the creation never fired (e.g., dialog closed
      //      before the first edit's debounce).
      const rowDocItemIds = items
        .filter((item) => item.collabType === Types.Document && unregisteredRowDocumentIds.has(item.objectId))
        .map((item) => item.objectId);

      if (rowDocItemIds.length > 0) {
        // Phase 1: Wait for any in-flight ensureRowDocumentExists calls
        await awaitPendingRowDocEnsures(rowDocItemIds);

        // Phase 2: Verify existence and create if still missing
        await Promise.all(
          rowDocItemIds.map(async (documentId) => {
            try {
              const exists = await checkIfCollabExists(workspaceId, documentId);

              if (!exists) {
                Log.debug('[sync] creating orphaned view for row document before batch sync', {
                  documentId,
                });
                await createOrphanedView(workspaceId, { document_id: documentId });
              }
            } catch (e) {
              Log.warn('[sync] failed to ensure row document collab exists', {
                documentId,
                error: e,
              });
            }
          })
        );
      }

      // Send all collabs in a single batch request (same as desktop's collab_full_sync_batch).
      // Retry on 429/503 with server-driven Retry-After + full jitter, matching the Rust
      // client-api pause_for_busy pattern. Uses 30s base delays for rate-limited retries.
      // Cancel any in-flight sync and create a new abort controller
      batchSyncAbortRef.current?.abort();
      const controller = new AbortController();

      batchSyncAbortRef.current = controller;
      const dirtySeqBeforeSync = new Map(
        items.map((item) => [item.objectId, backgroundDirtyEditsRef.current.get(item.objectId)?.seq])
      );

      try {
        const results = await withRetry(() => collabFullSyncBatch(workspaceId, items), {
          delays: BATCH_SYNC_DELAYS,
          signal: controller.signal,
        });

        applyFullSyncResults(results);
        for (const item of items) {
          const seq = dirtySeqBeforeSync.get(item.objectId);

          if (seq !== undefined && backgroundDirtyEditsRef.current.get(item.objectId)?.seq === seq) {
            backgroundDirtyEditsRef.current.delete(item.objectId);
          }
        }

        Log.debug('Batch sync completed successfully');
      } catch (error) {
        Log.warn('Failed to batch sync collabs to server', { error });
        // Don't throw - we still want to attempt the duplicate
      }
    },
    [refs, flushAllSync, applyFullSyncResults]
  );

  // Cancel all pending deferred cleanup timers and in-flight batch sync on unmount
  useEffect(() => {
    const timers = refs.pendingCleanups.current;
    const abortRef = batchSyncAbortRef;
    const backgroundAbortRef = backgroundHttpSyncAbortRef;
    const dirtyEdits = backgroundDirtyEditsRef.current;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      abortRef.current?.abort();
      backgroundAbortRef.current?.abort();
      clearBackgroundHttpSyncTimer();
      dirtyEdits.clear();
    };
  }, [refs, clearBackgroundHttpSyncTimer]);

  return { flushAllSync, syncAllToServer, notifyLocalEdit, notifyManifestSync };
}
