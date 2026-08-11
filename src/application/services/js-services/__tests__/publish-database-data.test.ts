import { TextDecoder, TextEncoder } from 'util';
import * as Y from 'yjs';

Object.assign(globalThis, { TextDecoder, TextEncoder });

jest.mock('@/application/db', () => ({
  openCollabDB: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  createRow: jest.fn(),
}));

jest.mock('@/utils/log', () => ({
  Log: {
    debug: jest.fn(),
  },
}));

import { openCollabDB } from '@/application/db';
import { createRow } from '@/application/services/js-services/cache';
import { gatherDatabasePublishData } from '@/application/services/js-services/publish-database-data';
import { YDatabase, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

function createRowDoc(rowId: string) {
  const doc = new Y.Doc();
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map();

  row.set(YjsDatabaseKey.id, rowId);
  sharedRoot.set(YjsEditorKey.database_row, row);

  return doc;
}

type TestRowOrder = { id: string; height: number; is_deleted?: boolean };

function createDatabaseDoc(
  initialRowOrders: TestRowOrder[] = [
    { id: 'live-row', height: 36 },
    { id: 'trashed-row', height: 36, is_deleted: true },
  ]
) {
  const doc = new Y.Doc({ guid: 'database-id' });
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<TestRowOrder>();

  rowOrders.push(initialRowOrders);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set('view-id', view);
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return { doc, rowOrders };
}

describe('gatherDatabasePublishData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('excludes tombstoned rows from row collabs and the encoded database snapshot', async () => {
    const { doc, rowOrders } = createDatabaseDoc();

    jest.mocked(openCollabDB).mockResolvedValue(doc);
    jest.mocked(createRow).mockImplementation(async (rowKey) => {
      const rowId = rowKey.endsWith('live-row') ? 'live-row' : 'trashed-row';

      return createRowDoc(rowId);
    });

    const encoded = await gatherDatabasePublishData('view-id', undefined, 'database-id');
    const payload = JSON.parse(new TextDecoder().decode(encoded)) as {
      database_collab: number[];
      database_row_collabs: Record<string, number[]>;
    };

    expect(Object.keys(payload.database_row_collabs)).toEqual(['live-row']);
    expect(createRow).toHaveBeenCalledTimes(1);
    expect(createRow).toHaveBeenCalledWith('database-id_rows_live-row');

    const publishedDoc = new Y.Doc();

    Y.applyUpdate(publishedDoc, Uint8Array.from(payload.database_collab));
    const publishedDatabase = publishedDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const publishedRows = publishedDatabase
      .get(YjsDatabaseKey.views)
      ?.get('view-id')
      ?.get(YjsDatabaseKey.row_orders)
      ?.toJSON();

    expect(publishedRows).toEqual([{ id: 'live-row', height: 36 }]);
    expect(rowOrders.toJSON()).toEqual([
      { id: 'live-row', height: 36 },
      { id: 'trashed-row', height: 36, is_deleted: true },
    ]);
  });

  it('loads row collabs in bounded parallel batches while preserving row order', async () => {
    const rowIds = Array.from({ length: 12 }, (_, index) => `row-${index}`);
    const { doc } = createDatabaseDoc(rowIds.map((id) => ({ id, height: 36 })));
    let activeLoads = 0;
    let maxActiveLoads = 0;

    jest.mocked(openCollabDB).mockResolvedValue(doc);
    jest.mocked(createRow).mockImplementation(async (rowKey) => {
      const rowId = rowKey.split('_rows_')[1];

      activeLoads += 1;
      maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeLoads -= 1;

      return createRowDoc(rowId);
    });

    const encoded = await gatherDatabasePublishData('view-id', undefined, 'database-id');
    const payload = JSON.parse(new TextDecoder().decode(encoded)) as {
      database_row_collabs: Record<string, number[]>;
    };

    expect(maxActiveLoads).toBeGreaterThan(1);
    expect(maxActiveLoads).toBeLessThan(rowIds.length);
    expect(Object.keys(payload.database_row_collabs)).toEqual(rowIds);
  });
});
