import { useCallback } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import { Types, YDoc } from '@/application/types';
import { openRowSubDocument } from '@/application/view-loader';
import { Log } from '@/utils/log';

/**
 * Extended YDoc with metadata for deferred sync binding.
 */
export interface YDocWithMeta extends YDoc {
  object_id?: string;
  _collabType?: Types;
  _syncBound?: boolean;
}

/**
 * Hook to load a row sub-document (document content inside a database row).
 *
 * Uses a cached Y.Doc instance to preserve sync state across reopens.
 * This prevents content loss when the same card is opened multiple times.
 */
export function useLoadRowDocument() {
  const { workspaceId } = useDatabaseContext();

  return useCallback(
    async (documentId: string): Promise<YDoc | null> => {
      if (!workspaceId) {
        Log.warn('[useLoadRowDocument] workspaceId not available');
        return null;
      }

      try {
        // Use openRowSubDocument which caches Y.Doc instances
        // This ensures the same doc is reused across card reopens,
        // preserving sync state and preventing content loss
        const { doc } = await openRowSubDocument(workspaceId, documentId);

        // Set metadata for sync binding
        const docWithMeta = doc as YDocWithMeta;

        docWithMeta.object_id = documentId;
        docWithMeta._collabType = Types.Document;
        // Don't reset _syncBound if already bound - reuse existing sync
        if (docWithMeta._syncBound === undefined) {
          docWithMeta._syncBound = false;
        }

        Log.debug('[useLoadRowDocument] loaded', { documentId, alreadySyncBound: docWithMeta._syncBound });

        return doc;
      } catch (e) {
        Log.error('[useLoadRowDocument] failed to load', e);
        return null;
      }
    },
    [workspaceId]
  );
}
