import { parse as uuidParse } from 'uuid';
import * as Y from 'yjs';

import {
  clearDatabaseRowDocSeedCache,
  holdsDatabaseSourceRows,
  peekDatabaseRowDocSeed,
  prefetchDatabaseBlobDiff,
  releaseDatabaseRowDocSeedCache,
  retainDatabaseRowDocSeedCache,
  subscribeToDatabaseSourceResidency,
} from '@/application/database-blob';
import { FieldType } from '@/application/database-yjs/database.type';
import { createDatabaseMentionRowsSource } from '@/application/database-yjs/mention-local-rows';
import { openRowCollabDBWithProvider } from '@/application/db';
import { databaseBlobDiff } from '@/application/services/js-services/http/http_api';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { database_blob } from '@/proto/database_blob';

jest.mock('@/application/db', () => ({
  captureDatabaseStorageFence: jest.fn(async (databaseId: string) => ({ databaseId, epoch: null, cacheEpoch: null })),
  rotateDatabaseStorageFence: jest.fn(),
  publishWithDatabaseStorageFence: jest.fn(async (_fence: unknown, publish: () => void) => {
    publish();
    return true;
  }),
  deleteCollabDB: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  getCachedRowProvider: jest.fn(),
  hasSharedCollabData: jest.fn(async () => true),
  openCollabDBWithProvider: jest.fn(),
  openRowCollabDBWithProvider: jest.fn(),
}));
jest.mock('@/application/services/js-services/cache', () => ({ deleteRow: jest.fn(), getCachedRowDoc: jest.fn() }));
jest.mock('@/application/services/js-services/http/http_api', () => ({ databaseBlobDiff: jest.fn() }));
jest.mock('@/application/sync-outbox', () => ({
  deleteOutboxByObjectId: jest.fn(),
  getCurrentOutboxSession: jest.fn((workspaceId: string) => ({ userId: 'user-1', workspaceId })),
}));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn() } }));

const mockedBlobDiff = databaseBlobDiff as jest.MockedFunction<typeof databaseBlobDiff>;
const mockedOpenRow = openRowCollabDBWithProvider as jest.MockedFunction<typeof openRowCollabDBWithProvider>;
const NAME = 'field-name';

function rowId(database: number, n: number) {
  return `${database.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function rowState(id: string, databaseId: string, title: string) {
  const doc = new Y.Doc({ guid: id });

  doc.transact(() => {
    const row = new Y.Map<unknown>();
    const cells = new Y.Map<unknown>();
    const cell = new Y.Map<unknown>();

    cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    cell.set(YjsDatabaseKey.data, title);
    cells.set(NAME, cell);
    row.set(YjsDatabaseKey.id, id);
    row.set(YjsDatabaseKey.database_id, databaseId);
    row.set(YjsDatabaseKey.created_at, '1762862400');
    row.set(YjsDatabaseKey.cells, cells);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
  });

  const state = Y.encodeStateAsUpdate(doc);

  doc.destroy();
  return state;
}

/** The server's one page of `rows`, the terminal one. */
function serve(databaseId: string, rows: { id: string; title: string }[]) {
  mockedBlobDiff.mockResolvedValue(
    database_blob.DatabaseBlobDiffResponse.create({
      status: database_blob.DiffStatus.READY,
      creates: rows.map(({ id, title }, index) => ({
        rowId: uuidParse(id),
        rid: { timestamp: 100 + index, seqNo: 1 },
        docState: { docState: rowState(id, databaseId, title), encoderVersion: 1 },
      })),
      updates: [],
      deletes: [],
      page: { hasMore: false, nextCursor: new Uint8Array(), restartRequired: false },
    })
  );
}

function databaseDoc(databaseId: string, ids: string[]) {
  const doc = new Y.Doc({ guid: databaseId }) as YDoc;

  doc.transact(() => {
    const database = new Y.Map<unknown>();
    const fields = new Y.Map<unknown>();
    const field = new Y.Map<unknown>();
    const views = new Y.Map<unknown>();
    const grid = new Y.Map<unknown>();
    const rowOrders = new Y.Array<{ id: string; height: number }>();
    const metas = new Y.Map<unknown>();

    field.set(YjsDatabaseKey.id, NAME);
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    field.set(YjsDatabaseKey.is_primary, true);
    fields.set(NAME, field);
    rowOrders.push(ids.map((id) => ({ id, height: 36 })));
    grid.set(YjsDatabaseKey.row_orders, rowOrders);
    grid.set(YjsDatabaseKey.is_inline, true);
    views.set('grid', grid);
    metas.set(YjsDatabaseKey.iid, 'grid');
    database.set(YjsDatabaseKey.id, databaseId);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    database.set(YjsDatabaseKey.metas, metas);
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  });
  return doc;
}

/** The source over the real row walk's seeds and residency, with its slices run by the test. */
function source(doc: YDoc) {
  const tasks: (() => void)[] = [];
  const rows = createDatabaseMentionRowsSource({
    databaseDoc: doc,
    getLiveRowDoc: () => undefined,
    peekRowSeed: peekDatabaseRowDocSeed,
    holdsRows: holdsDatabaseSourceRows,
    subscribeToResidency: subscribeToDatabaseSourceResidency,
    schedule: (task) => {
      tasks.push(task);
      return () => undefined;
    },
  });

  return {
    rows,
    runSlices: () => {
      while (tasks.length > 0) tasks.shift()?.();
    },
    titles: () => rows.getSnapshot().rows.map((row) => row.title),
  };
}

async function microtasks() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

// MEN-WEB-15: the rows source on the real row walk (`prefetchDatabaseBlobDiff`), with the network and
// IndexedDB faked, as a Text cell's picker reads it.
describe('database mention rows source on the row walk', () => {
  const databases: string[] = [];

  beforeEach(() => {
    localStorage.clear();
    mockedBlobDiff.mockReset();
    mockedOpenRow.mockImplementation(
      async () =>
        ({
          doc: new Y.Doc(),
          provider: {
            destroy: jest.fn().mockResolvedValue(undefined),
            whenPersisted: jest.fn().mockResolvedValue(undefined),
          },
        } as unknown as Awaited<ReturnType<typeof openRowCollabDBWithProvider>>)
    );
  });

  afterEach(() => {
    databases.splice(0).forEach((databaseId) => {
      releaseDatabaseRowDocSeedCache(databaseId);
      clearDatabaseRowDocSeedCache(databaseId);
    });
  });

  it("is complete once a cold walk committed every row's seed", async () => {
    const databaseId = rowId(0x1, 0xdb);
    const rows = [1, 2, 3].map((n) => ({ id: rowId(0x1, n), title: `Road trip ${n}` }));
    const test = source(
      databaseDoc(
        databaseId,
        rows.map((row) => row.id)
      )
    );

    databases.push(databaseId);
    retainDatabaseRowDocSeedCache(databaseId);
    test.rows.subscribe(() => undefined);
    expect(test.rows.getSnapshot().complete).toBe(false);

    serve(databaseId, rows);
    // As the editor tells the source when the walk commits its seeds (`subscribeToRowPassState`).
    await prefetchDatabaseBlobDiff('workspace', databaseId, { onSeedsReady: () => test.rows.refresh() });
    await microtasks();
    test.runSlices();

    expect(test.titles()).toEqual(['Road trip 1', 'Road trip 2', 'Road trip 3']);
    expect(test.rows.getSnapshot().complete).toBe(true);
  });

  it('is never complete after a walk of only the rows changed since a cached RID', async () => {
    const databaseId = rowId(0x2, 0xdb);
    const ids = [1, 2, 3].map((n) => rowId(0x2, n));
    const test = source(databaseDoc(databaseId, ids));

    databases.push(databaseId);
    localStorage.setItem(`af_database_blob_rid:${databaseId}`, JSON.stringify({ timestamp: 50, seqNo: 1 }));
    retainDatabaseRowDocSeedCache(databaseId);
    test.rows.subscribe(() => undefined);
    // After a reload, the walk brings the one row that changed; the others are in IndexedDB only.
    serve(databaseId, [{ id: ids[0], title: 'Road trip 1' }]);
    await prefetchDatabaseBlobDiff('workspace', databaseId, { onSeedsReady: () => test.rows.refresh() });
    await microtasks();
    test.runSlices();

    expect(test.titles()).toEqual(['Road trip 1']);
    expect(test.rows.getSnapshot().complete).toBe(false);
  });
});
