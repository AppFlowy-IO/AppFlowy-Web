import { useCallback, useEffect, useRef } from 'react';

import { RowService } from '@/application/services/domains';
import { Types, YDoc } from '@/application/types';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

// Hook for managing database row operations (create + cleanup)
export function useRowOperations() {
  const { currentWorkspaceId } = useAuthInternal();
  const { registerSyncContext, rebindSyncContext } = useSyncInternal();

  const createdRowKeys = useRef<string[]>([]);

  // Create row document
  const createRow = useCallback(
    async (rowKey: string, options?: { forceSync?: boolean }): Promise<YDoc> => {
      if (!currentWorkspaceId) {
        throw new Error('Failed to create row doc');
      }

      try {
        // A remote database update can advertise a row before its separate
        // DatabaseRow collab is queryable. Retrying must resend the manifest
        // on the canonical context; registering it again would leak a ref count.
        const rowId = rowKey.split('_rows_')[1];

        if (options?.forceSync) {
          if (!rowId) {
            throw new Error('Failed to create row doc');
          }

          const canonicalDoc = rebindSyncContext(rowId);

          if (canonicalDoc) return canonicalDoc;

          // Force sync is a rebind of an existing owner, never an acquisition.
          // During a version reset the old context has already been destroyed
          // and its replacement may still be opening; falling through here
          // would register a second owner that this Database never releases.
          throw new Error('Cannot rebind row sync while its context is unavailable');
        }

        const doc = await RowService.create(rowKey);

        if (!doc) {
          throw new Error('Failed to create row doc');
        }

        if (!rowId) {
          throw new Error('Failed to create row doc');
        }

        // Row collaboration is scoped to the row object itself.
        doc.guid = rowId;

        const syncContext = registerSyncContext({
          doc,
          collabType: Types.DatabaseRow
        });

        createdRowKeys.current.push(rowKey);
        return syncContext.doc;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [currentWorkspaceId, rebindSyncContext, registerSyncContext]
  );

  // Clean up created row documents when view changes
  useEffect(() => {
    const rowKeys = createdRowKeys.current;

    createdRowKeys.current = [];

    if (!rowKeys.length) return;

    rowKeys.forEach((rowKey) => {
      try {
        RowService.remove(rowKey);
      } catch (e) {
        console.error(e);
      }
    });
  }, [currentWorkspaceId]);

  return { createRow };
}
