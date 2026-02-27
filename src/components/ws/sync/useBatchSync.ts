import { useCallback, useEffect } from 'react';
import * as Y from 'yjs';

import { collabFullSyncBatch } from '@/application/services/js-services/http/http_api';
import { Types } from '@/application/types';
import { Log } from '@/utils/log';

import { SyncRefs } from './syncRefs';

export function useBatchSync(refs: SyncRefs) {
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
   */
  const syncAllToServer = useCallback(async (workspaceId: string) => {
    // First flush any pending WebSocket updates
    flushAllSync();

    // Collect all registered contexts into a batch
    const items: Array<{
      objectId: string;
      collabType: Types;
      stateVector: Uint8Array;
      docState: Uint8Array;
    }> = [];

    refs.registeredContexts.current.forEach((context) => {
      const { doc, collabType } = context;

      if (!doc || collabType === undefined) return;

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

    if (items.length === 0) {
      Log.debug('No collabs to sync');
      return;
    }

    // Send all collabs in a single batch request (same as desktop's collab_full_sync_batch)
    try {
      Log.debug('Sending batch sync request', { itemCount: items.length });
      await collabFullSyncBatch(workspaceId, items);
      Log.debug('Batch sync completed successfully');
    } catch (error) {
      Log.warn('Failed to batch sync collabs to server', { error });
      // Don't throw - we still want to attempt the duplicate
    }
  }, [refs, flushAllSync]);

  // Cancel all pending deferred cleanup timers on unmount
  useEffect(() => {
    const timers = refs.pendingCleanups.current;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, [refs]);

  return { flushAllSync, syncAllToServer };
}
