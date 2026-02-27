import { useCallback, useEffect, useRef } from 'react';

import { Types, YDoc } from '@/application/types';
import { Log } from '@/utils/log';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { useSyncInternal } from '../contexts/SyncInternalContext';

// Hook for managing database row operations (create + cleanup)
export function useRowOperations() {
  const { service, currentWorkspaceId } = useAuthInternal();
  const { registerSyncContext } = useSyncInternal();

  const createdRowKeys = useRef<string[]>([]);

  // Create row document
  const createRow = useCallback(
    async (rowKey: string): Promise<YDoc> => {
      if (!currentWorkspaceId || !service) {
        throw new Error('Failed to create row doc');
      }

      try {
        const doc = await service?.createRow(rowKey);

        if (!doc) {
          throw new Error('Failed to create row doc');
        }

        const [databaseId, rowId] = rowKey.split('_rows_');

        if (!rowId) {
          throw new Error('Failed to create row doc');
        }

        // Row collaboration is scoped to the row object itself.
        // Use rowId as guid; databaseId remains contextual metadata in rowKey.
        doc.guid = rowId;

        Log.debug('[Database] row sync bind start', {
          rowKey,
          rowId,
          databaseId,
        });
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
    [currentWorkspaceId, service, registerSyncContext]
  );

  // Clean up created row documents when view changes
  useEffect(() => {
    const rowKeys = createdRowKeys.current;

    createdRowKeys.current = [];

    if (!rowKeys.length) return;

    rowKeys.forEach((rowKey) => {
      try {
        service?.deleteRow(rowKey);
      } catch (e) {
        console.error(e);
      }
    });
  }, [service, currentWorkspaceId]);

  return { createRow };
}
