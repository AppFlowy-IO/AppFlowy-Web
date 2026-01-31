import { useCallback } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import { Types, ViewLayout, YDoc } from '@/application/types';
import { openView } from '@/application/view-loader';
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
 * Hook to load a row document from cache or server.
 * Returns the document with metadata set for later sync binding.
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
        // Use view-loader to open document (handles cache vs fetch)
        // Pass ViewLayout.Document to ensure correct collab type detection
        const { doc } = await openView(workspaceId, documentId, ViewLayout.Document);

        // Set metadata for sync binding
        const docWithMeta = doc as YDocWithMeta;

        docWithMeta.object_id = documentId;
        docWithMeta._collabType = Types.Document;
        docWithMeta._syncBound = false;

        Log.debug('[useLoadRowDocument] loaded', { documentId });

        return doc;
      } catch (e) {
        Log.error('[useLoadRowDocument] failed to load', e);
        return null;
      }
    },
    [workspaceId]
  );
}
