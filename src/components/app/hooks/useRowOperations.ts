import { useCallback, useEffect, useRef } from 'react';

import { RowService } from '@/application/services/domains';
import { Types, YDoc } from '@/application/types';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

// Hook for managing database row operations (create + cleanup)
export function useRowOperations() {
  const { currentWorkspaceId } = useAuthInternal();
  const { registerSyncContext } = useSyncInternal();

  const createdRowKeys = useRef<string[]>([]);

  // Create row document
  const createRow = useCallback(
    async (rowKey: string): Promise<YDoc> => {
      if (!currentWorkspaceId) {
        throw new Error('Failed to create row doc');
      }

      try {
        const doc = await RowService.create(rowKey);

        if (!doc) {
          throw new Error('Failed to create row doc');
        }

        const rowId = rowKey.split('_rows_')[1];

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
    [currentWorkspaceId, registerSyncContext]
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
