import * as Y from 'yjs';

import { invalidateDatabaseBlobCache } from '@/application/database-blob';
import { resetDatabaseRowDocs } from '@/application/services/js-services/cache';
import { Types, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { prepareDatabaseRowsForVersionReset } from '../databaseVersionReset';

import type { SyncContext } from '@/application/services/js-services/sync-protocol';

jest.mock('@/application/database-blob', () => ({
  invalidateDatabaseBlobCache: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  resetDatabaseRowDocs: jest.fn(),
}));

const mockedInvalidateDatabaseBlobCache = invalidateDatabaseBlobCache as jest.MockedFunction<
  typeof invalidateDatabaseBlobCache
>;
const mockedResetDatabaseRowDocs = resetDatabaseRowDocs as jest.MockedFunction<typeof resetDatabaseRowDocs>;

function createDatabaseDoc(databaseId: string, viewRows: string[][]) {
  const doc = new Y.Doc();
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();

  doc.guid = databaseId;
  database.set(YjsDatabaseKey.id, databaseId);

  viewRows.forEach((rowIds, index) => {
    const view = new Y.Map();
    const rowOrders = new Y.Array<{ id: string; height: number }>();

    rowOrders.push(rowIds.map((id) => ({ id, height: 44 })));
    view.set(YjsDatabaseKey.row_orders, rowOrders);
    views.set(`view-${index}`, view);
  });

  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

describe('prepareDatabaseRowsForVersionReset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedResetDatabaseRowDocs.mockResolvedValue(undefined);
  });

  it('invalidates database blob state and row docs for database version resets', async () => {
    const databaseId = '05c8f835-4dfb-4723-a83c-f64f3d2d5b78';
    const rowA = '834e9fec-21d4-4500-a34e-31da6cd0f5b5';
    const rowB = '9d05e6b4-13e0-42cf-aac5-b518cb017c0c';
    const doc = createDatabaseDoc(databaseId, [[rowA, rowB], [rowB]]);
    const context = { collabType: Types.Database } as SyncContext;
    const beforeResetRow = jest.fn();

    const resetRows = await prepareDatabaseRowsForVersionReset(context, doc, { beforeResetRow });

    expect(mockedInvalidateDatabaseBlobCache).toHaveBeenCalledWith(databaseId);
    expect(beforeResetRow).toHaveBeenCalledTimes(2);
    expect(beforeResetRow).toHaveBeenCalledWith(rowA);
    expect(beforeResetRow).toHaveBeenCalledWith(rowB);
    expect(mockedResetDatabaseRowDocs).toHaveBeenCalledWith(databaseId, [rowA, rowB]);
    expect(resetRows).toEqual([rowA, rowB]);
  });

  it('does not touch row caches for non-database collabs', async () => {
    const doc = createDatabaseDoc('05c8f835-4dfb-4723-a83c-f64f3d2d5b78', [['row-1']]);
    const context = { collabType: Types.Document } as SyncContext;

    await prepareDatabaseRowsForVersionReset(context, doc);

    expect(mockedInvalidateDatabaseBlobCache).not.toHaveBeenCalled();
    expect(mockedResetDatabaseRowDocs).not.toHaveBeenCalled();
  });
});
