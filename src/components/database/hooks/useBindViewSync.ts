import { useCallback } from 'react';

import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { Types, YDoc } from '@/application/types';
import { useSyncInternal } from '@/components/app/contexts/SyncInternalContext';
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
 * Hook to bind a Y.js document to WebSocket sync.
 * Should be called AFTER the component renders with the document.
 */
export function useBindViewSync() {
  const syncContext = useSyncInternal();
  const registerSyncContext = syncContext?.registerSyncContext;

  return useCallback(
    (doc: YDoc): SyncContext | null => {
      if (!registerSyncContext) {
        Log.warn('[useBindViewSync] registerSyncContext not available');
        return null;
      }

      const docWithMeta = doc as YDocWithMeta;

      // Skip if already bound
      if (docWithMeta._syncBound) {
        Log.debug('[useBindViewSync] skipped - already bound', {
          viewId: docWithMeta.object_id,
        });
        return null;
      }

      const collabType = docWithMeta._collabType;
      const viewId = docWithMeta.object_id;

      // Use explicit undefined check for collabType since Types.Document = 0 is falsy
      if (collabType === undefined || !viewId) {
        Log.warn('[useBindViewSync] failed - missing metadata', {
          hasCollabType: collabType !== undefined,
          hasViewId: !!viewId,
        });
        return null;
      }

      Log.debug('[useBindViewSync] starting', {
        viewId,
        collabType,
      });

      const result = registerSyncContext({ doc, collabType });

      docWithMeta._syncBound = true;

      Log.debug('[useBindViewSync] complete', {
        viewId,
        collabType,
      });

      return result;
    },
    [registerSyncContext]
  );
}
