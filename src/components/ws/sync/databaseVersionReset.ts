import { invalidateDatabaseBlobCache } from '@/application/database-blob';
import { resetDatabaseRowDocs } from '@/application/services/js-services/cache';
import { Types, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import type { SyncContext } from '@/application/services/js-services/sync-protocol';

function collectDatabaseRowIds(doc: YDoc): string[] {
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);
  const rowIds = new Set<string>();

  views?.forEach((view) => {
    const rowOrders = view?.get(YjsDatabaseKey.row_orders);

    rowOrders?.forEach((rowOrder) => {
      if (rowOrder?.id) {
        rowIds.add(rowOrder.id);
      }
    });
  });

  return Array.from(rowIds);
}

type PrepareDatabaseRowsForVersionResetOptions = {
  beforeResetRow?: (rowId: string) => Promise<void> | void;
};

export async function prepareDatabaseRowsForVersionReset(
  context: SyncContext,
  previousDoc: YDoc,
  options?: PrepareDatabaseRowsForVersionResetOptions
): Promise<string[]> {
  if (context.collabType !== Types.Database) return [];

  const databaseId = previousDoc.guid;
  const rowIds = collectDatabaseRowIds(previousDoc);

  invalidateDatabaseBlobCache(databaseId);

  if (rowIds.length > 0) {
    await Promise.all(rowIds.map((rowId) => options?.beforeResetRow?.(rowId)));
    await resetDatabaseRowDocs(databaseId, rowIds);
  }

  return rowIds;
}
