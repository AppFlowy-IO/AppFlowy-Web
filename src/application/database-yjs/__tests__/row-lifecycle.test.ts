import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/application/sync-outbox', () => ({
  deleteOutboxByObjectId: jest.fn().mockResolvedValue(undefined),
}));

import { deleteCollabDB } from '@/application/db';
import {
  isRowOrderTombstoned,
  removeRowsFromDatabase,
  restoreSoftDeletedRowsInDatabase,
  softDeleteRowsInDatabase,
} from '@/application/database-yjs/dispatch/row-lifecycle';
import { deleteOutboxByObjectId } from '@/application/sync-outbox';
import { YDatabase, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';

interface RowOrderEntry {
  id: string;
  height: number;
  is_deleted?: boolean;
}

const VIEW_IDS = ['view-a', 'view-b'];

function createDatabaseFixture(rowIds: string[]) {
  const doc = new Y.Doc();
  const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map();

  doc.transact(() => {
    sharedRoot.set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.id, 'db-1');
    database.set(YjsDatabaseKey.views, views);

    VIEW_IDS.forEach((viewId) => {
      const view = new Y.Map();
      const rowOrders = new Y.Array();

      rowOrders.push(rowIds.map((id) => ({ id, height: 36 })));
      view.set(YjsDatabaseKey.row_orders, rowOrders);
      views.set(viewId, view);
    });
  });

  const readRowOrders = (viewId: string) =>
    (views.get(viewId) as Y.Map<unknown>).get(YjsDatabaseKey.row_orders) as Y.Array<RowOrderEntry>;

  return { sharedRoot, database, readRowOrders };
}

describe('row lifecycle (soft delete / restore / permanent delete)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('soft delete tombstones the row in every view and keeps order', () => {
    const { sharedRoot, database, readRowOrders } = createDatabaseFixture(['row-1', 'row-2', 'row-3']);

    softDeleteRowsInDatabase(sharedRoot, database, ['row-2']);

    VIEW_IDS.forEach((viewId) => {
      const entries = readRowOrders(viewId).toJSON() as RowOrderEntry[];

      expect(entries.map((entry) => entry.id)).toEqual(['row-1', 'row-2', 'row-3']);
      expect(entries[1].is_deleted).toBe(true);
      expect(entries[0].is_deleted).toBeUndefined();
      expect(entries[2].is_deleted).toBeUndefined();
    });
    expect(isRowOrderTombstoned(database, 'view-a', 'row-2')).toBe(true);
    expect(isRowOrderTombstoned(database, 'view-a', 'row-1')).toBe(false);
  });

  it('soft delete is idempotent', () => {
    const { sharedRoot, database, readRowOrders } = createDatabaseFixture(['row-1']);

    softDeleteRowsInDatabase(sharedRoot, database, ['row-1']);
    softDeleteRowsInDatabase(sharedRoot, database, ['row-1']);

    const entries = readRowOrders('view-a').toJSON() as RowOrderEntry[];

    expect(entries).toHaveLength(1);
    expect(entries[0].is_deleted).toBe(true);
  });

  it('restore clears the tombstone in every view', () => {
    const { sharedRoot, database, readRowOrders } = createDatabaseFixture(['row-1', 'row-2']);

    softDeleteRowsInDatabase(sharedRoot, database, ['row-1', 'row-2']);
    restoreSoftDeletedRowsInDatabase(sharedRoot, database, ['row-1']);

    VIEW_IDS.forEach((viewId) => {
      const entries = readRowOrders(viewId).toJSON() as RowOrderEntry[];

      expect(entries.map((entry) => entry.id)).toEqual(['row-1', 'row-2']);
      // Restored entries drop the flag entirely, matching the collab wire
      // format where is_deleted is omitted when false.
      expect(entries[0].is_deleted).toBeUndefined();
      expect(entries[1].is_deleted).toBe(true);
    });
  });

  it('permanent delete removes the row orders and cleans local collab', () => {
    const { sharedRoot, database, readRowOrders } = createDatabaseFixture(['row-1', 'row-2']);

    softDeleteRowsInDatabase(sharedRoot, database, ['row-1']);
    removeRowsFromDatabase(sharedRoot, database, ['row-1']);

    VIEW_IDS.forEach((viewId) => {
      const entries = readRowOrders(viewId).toJSON() as RowOrderEntry[];

      expect(entries.map((entry) => entry.id)).toEqual(['row-2']);
    });
    expect(deleteOutboxByObjectId).toHaveBeenCalledWith('row-1');
    expect(deleteCollabDB).toHaveBeenCalledWith('row-1', { destroyDoc: false });
  });

  it('permanent delete can skip local collab cleanup', () => {
    const { sharedRoot, database } = createDatabaseFixture(['row-1']);

    removeRowsFromDatabase(sharedRoot, database, ['row-1'], { cleanupLocalCollab: false });

    expect(deleteOutboxByObjectId).not.toHaveBeenCalled();
    expect(deleteCollabDB).not.toHaveBeenCalled();
  });
});
