/**
 * Row lifecycle operations for the row-page trash flow.
 *
 * A row whose document has content is not hard-deleted: its row orders are
 * tombstoned (`is_deleted: true`, mirroring collab-database's RowOrder flag)
 * so the row disappears from every view but stays restorable from trash.
 * Restoring clears the tombstone; permanent deletion removes the row orders
 * entirely. Plain functions (not hooks) so the trash page can call them on an
 * imperatively opened database collab.
 */

import { deleteCollabDB } from '@/application/db';
import { deleteOutboxByObjectId } from '@/application/sync-outbox';
import { YDatabase, YjsDatabaseKey, YSharedRoot } from '@/application/types';

import { executeOperationWithAllViews } from './utils';

interface RowOrderEntry {
  id: string;
  height?: number;
  is_deleted?: boolean;
}

const DEFAULT_ROW_HEIGHT = 36;

function setRowOrdersDeleted(
  sharedRoot: YSharedRoot,
  database: YDatabase,
  rowIds: string[],
  isDeleted: boolean,
  operationName: string
) {
  const ids = new Set(rowIds);

  executeOperationWithAllViews(
    sharedRoot,
    database,
    (view) => {
      const rows = view.get(YjsDatabaseKey.row_orders);

      if (!rows) {
        throw new Error('Row orders not found');
      }

      const rowArray = rows.toJSON() as RowOrderEntry[];

      rowArray.forEach((entry, index) => {
        if (!ids.has(entry.id)) return;
        if (Boolean(entry.is_deleted) === isDeleted) return;

        // Row orders hold plain JSON values, so updating a field means
        // replacing the entry in place (delete + insert keeps the index).
        const next: { id: string; height: number; is_deleted?: boolean } = {
          id: entry.id,
          height: entry.height ?? DEFAULT_ROW_HEIGHT,
        };

        if (isDeleted) {
          next.is_deleted = true;
        }

        rows.delete(index);
        rows.insert(index, [next]);
      });
    },
    operationName
  );
}

export function softDeleteRowsInDatabase(sharedRoot: YSharedRoot, database: YDatabase, rowIds: string[]) {
  setRowOrdersDeleted(sharedRoot, database, rowIds, true, 'softDeleteRows');
}

export function restoreSoftDeletedRowsInDatabase(sharedRoot: YSharedRoot, database: YDatabase, rowIds: string[]) {
  setRowOrdersDeleted(sharedRoot, database, rowIds, false, 'restoreSoftDeletedRows');
}

export function removeRowsFromDatabase(
  sharedRoot: YSharedRoot,
  database: YDatabase,
  rowIds: string[],
  options: { cleanupLocalCollab?: boolean } = {}
) {
  const { cleanupLocalCollab = true } = options;

  executeOperationWithAllViews(
    sharedRoot,
    database,
    (view) => {
      const rows = view.get(YjsDatabaseKey.row_orders);

      if (!rows) {
        throw new Error('Row orders not found');
      }

      rowIds.forEach((rowId) => {
        const rowArray = rows.toJSON() as RowOrderEntry[];
        const sourceIndex = rowArray.findIndex((row) => row.id === rowId);

        if (sourceIndex !== -1) {
          rows.delete(sourceIndex);
        }
      });
    },
    'removeRowsFromDatabase'
  );

  if (cleanupLocalCollab) {
    rowIds.forEach((rowId) => {
      void deleteOutboxByObjectId(rowId);
      void deleteCollabDB(rowId, { destroyDoc: false });
    });
  }
}

export function isRowOrderTombstoned(database: YDatabase, viewId: string, rowId: string): boolean {
  const view = database.get(YjsDatabaseKey.views)?.get(viewId);
  const rowArray = view?.get(YjsDatabaseKey.row_orders)?.toJSON() as RowOrderEntry[] | undefined;

  return Boolean(rowArray?.find((entry) => entry.id === rowId)?.is_deleted);
}
