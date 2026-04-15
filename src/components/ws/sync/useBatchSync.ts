import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';

import { getRowKey , getMetaJSON } from '@/application/database-yjs/row_meta';
import { openCollabDBWithProvider } from '@/application/db';
import { getCachedRowSubDoc, getCachedRowSubDocIds } from '@/application/services/js-services/cache';
import { collabFullSyncBatch } from '@/application/services/js-services/http/http_api';
import { withRetry } from '@/application/services/js-services/http/core';
import { Types, YDatabase, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { Log } from '@/utils/log';

import { SyncRefs } from './syncRefs';

// 30s base delay for batch sync retries (rate-limited / server-busy).
// withRetry adds jitter and honours server Retry-After when present.
const BATCH_SYNC_DELAYS = [30_000, 30_000, 30_000];

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

export function useBatchSync(refs: SyncRefs) {
  const batchSyncAbortRef = useRef<AbortController | null>(null);

  /**
   * Flush all pending updates for all registered sync contexts.
   * This ensures all local changes are sent to the server via WebSocket.
   */
  const flushAllSync = useCallback(() => {
    Log.debug('Flushing all sync contexts');
    refs.registeredContexts.current.forEach((context) => {
      if (context.flush) {
        context.flush();
      }
    });
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
      // First flush any pending WebSocket updates
      flushAllSync();

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

      for (let i = 0; i < unregisteredRows.length; i += ROW_SYNC_CONCURRENCY) {
        const slice = unregisteredRows.slice(i, i + ROW_SYNC_CONCURRENCY);

        await Promise.all(
          slice.map(async ({ rowId, rowKey }) => {
            try {
              // Use skipCache to avoid permanently pinning every row doc in memory.
              // Destroy the provider immediately after reading — we only need the
              // encoded state for the batch request.
              const { doc: rowDoc, provider } = await openCollabDBWithProvider(rowKey, { skipCache: true });

              await provider.destroy();

              // If the row was never cached locally, the doc will be empty.
              // Skip it — uploading an empty state would overwrite the server's
              // real data during duplicate.
              const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
              const rowMeta = rowSharedRoot.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;

              if (!rowSharedRoot.has(YjsEditorKey.database_row)) {
                rowDoc.destroy();
                return;
              }

              const rowDocumentId = rowMeta ? getMetaJSON(rowId, rowMeta).documentId : '';

              if (rowDocumentId && !registeredObjectIds.has(rowDocumentId)) {
                unregisteredRowDocumentIds.add(rowDocumentId);
              }

              const docState = Y.encodeStateAsUpdate(rowDoc);
              const stateVector = Y.encodeStateVector(rowDoc);

              rowDoc.destroy();

              items.push({
                objectId: rowId,
                collabType: Types.DatabaseRow,
                stateVector,
                docState,
              });
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

      // Send all collabs in a single batch request (same as desktop's collab_full_sync_batch).
      // Retry on 429/503 with server-driven Retry-After + full jitter, matching the Rust
      // client-api pause_for_busy pattern. Uses 30s base delays for rate-limited retries.
      // Cancel any in-flight sync and create a new abort controller
      batchSyncAbortRef.current?.abort();
      const controller = new AbortController();

      batchSyncAbortRef.current = controller;

      try {
        await withRetry(() => collabFullSyncBatch(workspaceId, items), {
          delays: BATCH_SYNC_DELAYS,
          signal: controller.signal,
        });
        Log.debug('Batch sync completed successfully');
      } catch (error) {
        Log.warn('Failed to batch sync collabs to server', { error });
        // Don't throw - we still want to attempt the duplicate
      }
    },
    [refs, flushAllSync]
  );

  // Cancel all pending deferred cleanup timers and in-flight batch sync on unmount
  useEffect(() => {
    const timers = refs.pendingCleanups.current;
    const abortRef = batchSyncAbortRef;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      abortRef.current?.abort();
    };
  }, [refs]);

  return { flushAllSync, syncAllToServer };
}
