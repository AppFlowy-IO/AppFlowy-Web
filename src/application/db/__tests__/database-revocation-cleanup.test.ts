import * as Y from 'yjs';

import { db, deleteDatabaseLocalCopies } from '@/application/db';
import { collabStorageKey, setCollabStorageWorkspace } from '@/application/db/collab-storage-scope';
import { metaIdFromRowId } from '@/application/database-yjs/const';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { YjsDatabaseKey, YjsEditorKey } from '@/application/types';

const mockStores = new Map<string, Uint8Array>();

jest.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    synced = true;

    constructor(public readonly name: string, private readonly doc: Y.Doc) {
      const state = mockStores.get(name);

      if (state) Y.applyUpdate(doc, state);
    }

    async get() { return undefined; }
    async set() { return undefined; }
    async destroy() { return undefined; }
    on() { return undefined; }
    off() { return undefined; }
  },
}));
jest.mock('@/application/session/token-storage', () => ({ getTokenParsed: () => ({ user: { id: 'actor' } }) }));
jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => 'https://server' }));

const databaseId = 'database-1';
const editedRow = '11111111-1111-4111-8111-111111111111';
const plainRow = '22222222-2222-4222-8222-222222222222';
const pendingRow = '33333333-3333-4333-8333-333333333333';
const legacyOnlyRow = '44444444-4444-4444-8444-444444444444';
const rowPage = (rowId: string) => metaIdFromRowId(rowId)(RowMetaKey.DocumentId);

/** A database whose two views list the rows. */
function databaseState(rowIds: string[][]) {
  const doc = new Y.Doc({ guid: databaseId });
  const database = new Y.Map();
  const views = new Y.Map();

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.views, views);
  rowIds.forEach((ids, index) => {
    const view = new Y.Map();
    const rowOrders = new Y.Array();

    views.set(`view-${index}`, view);
    view.set(YjsDatabaseKey.row_orders, rowOrders);
    rowOrders.push(ids.map((id) => ({ id, height: 36 })));
  });
  return Y.encodeStateAsUpdate(doc);
}

describe('removing the local copies of a database whose read access was revoked', () => {
  const originalIndexedDB = globalThis.indexedDB;
  let databases: string[];
  let deletedDatabases: string[];
  let snapshots: Set<string>;
  let updates: Set<string>;
  let rowIndex: Array<{ row_id: string; row_key: string }>;
  let deletedShared: string[];
  let outboxKeys: Array<[string, string, string]>;

  beforeEach(() => {
    setCollabStorageWorkspace({ serverUrl: 'https://server', userId: 'actor', workspaceId: 'workspace' });
    mockStores.set(collabStorageKey(databaseId), databaseState([[editedRow, plainRow], [plainRow, pendingRow]]));
    databases = [
      collabStorageKey(databaseId),
      collabStorageKey(rowPage(editedRow)),
      collabStorageKey(rowPage(pendingRow)),
      collabStorageKey(`${databaseId}_rows_${plainRow}`),
      collabStorageKey(`${databaseId}_rows_${legacyOnlyRow}`),
      collabStorageKey(`${databaseId}_rows_${pendingRow}`),
      collabStorageKey('another-page'),
    ];
    deletedDatabases = [];
    snapshots = new Set([collabStorageKey(editedRow), collabStorageKey(pendingRow)]);
    updates = new Set([collabStorageKey(plainRow)]);
    rowIndex = [plainRow, legacyOnlyRow, pendingRow].map((rowId) => ({
      row_id: rowId,
      row_key: collabStorageKey(`${databaseId}_rows_${rowId}`),
    }));
    deletedShared = [];
    // The pending row still has an unsent (quarantined) edit.
    outboxKeys = [['actor', 'workspace', pendingRow], ['actor', 'workspace', 'another-page']];

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        databases: async () => databases.map((name) => ({ name })),
        open: () => {
          const request: { result?: unknown; onsuccess?: () => void } = {};

          setTimeout(() => {
            request.result = { objectStoreNames: { contains: () => true }, close: () => undefined, version: 1 };
            request.onsuccess?.();
          }, 0);
          return request;
        },
        deleteDatabase: (name: string) => {
          const request: { onsuccess?: () => void } = {};

          setTimeout(() => {
            deletedDatabases.push(name);
            databases = databases.filter((existing) => existing !== name);
            request.onsuccess?.();
          }, 0);
          return request;
        },
      },
    });
    jest.spyOn(db, 'transaction').mockImplementation((async (...args: unknown[]) =>
      (args[args.length - 1] as () => Promise<unknown>)()) as never);
    jest.spyOn(db.collab_custom, 'get').mockResolvedValue(undefined);
    jest.spyOn(db.collab_custom, 'put').mockResolvedValue(['', ''] as never);
    jest.spyOn(db.collab_custom, 'where').mockReturnValue({ equals: () => ({ delete: async () => 0 }) } as never);
    jest.spyOn(db.collab_snapshots, 'delete').mockImplementation((async (name: string) => {
      deletedShared.push(name);
      snapshots.delete(name);
    }) as never);
    jest.spyOn(db.collab_snapshots, 'where').mockImplementation(((index: string) => ({
      anyOf: (names: string[]) => ({
        primaryKeys: async () => {
          expect(index).toBe('objectId');
          return names.filter((name) => snapshots.has(name));
        },
      }),
    })) as never);
    jest.spyOn(db.collab_updates, 'where').mockImplementation(((index: string) => ({
      anyOf: (names: string[]) => ({
        keys: async () => {
          expect(index).toBe('objectId');
          return names.filter((name) => updates.has(name));
        },
      }),
      equals: (name: string) => ({
        delete: async () => {
          updates.delete(name);
          return 0;
        },
      }),
    })) as never);
    jest.spyOn(db.rows, 'where').mockImplementation(((index: string) => {
      expect(index).toBe('row_key');
      return {
        startsWith: (prefix: string) => {
          const matching = () => rowIndex.filter((row) => row.row_key.startsWith(prefix));

          return {
            toArray: async () => matching(),
            filter: (keep: (row: { row_id: string; row_key: string }) => boolean) => ({
              delete: async () => {
                const removed = new Set(matching().filter(keep));

                rowIndex = rowIndex.filter((row) => !removed.has(row));
              },
            }),
          };
        },
      };
    }) as never);
    jest.spyOn(db.sync_outbox, 'where').mockImplementation(((index: string) => ({
      between: (lower: unknown[], upper: unknown[]) => ({
        uniqueKeys: async () => {
          expect(index).toBe('[userId+workspaceId+objectId]');
          return outboxKeys.filter(([userId, workspaceId]) =>
            userId === lower[0] && userId === upper[0] && workspaceId === lower[1] && workspaceId === upper[1]);
        },
      }),
    })) as never);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: originalIndexedDB });
    jest.restoreAllMocks();
    mockStores.clear();
    setCollabStorageWorkspace(null);
  });

  it('removes the rows and row pages with the database, except the copy of a row with unsent edits', async () => {
    await expect(deleteDatabaseLocalCopies(databaseId, { destroyDoc: true })).resolves.toBe(true);

    // The database, its row pages and its legacy row copies.
    expect(databases).toEqual([
      collabStorageKey(`${databaseId}_rows_${pendingRow}`),
      collabStorageKey('another-page'),
    ]);
    // The rows' shared copies (snapshot or update tail).
    expect(deletedShared).toEqual(expect.arrayContaining([collabStorageKey(editedRow), collabStorageKey(plainRow)]));
    expect(snapshots).toEqual(new Set([collabStorageKey(pendingRow)]));
    expect(updates).toEqual(new Set());
    // The legacy row index keeps only the row whose edits still need it to find the database.
    expect(rowIndex.map((row) => row.row_id)).toEqual([pendingRow]);
  });

  it('uses the rows the caller still holds in memory when the database copy is gone', async () => {
    mockStores.clear();
    databases = databases.filter((name) => name !== collabStorageKey(databaseId));

    await deleteDatabaseLocalCopies(databaseId, { destroyDoc: false, knownRowIds: [editedRow] });

    expect(deletedShared).toEqual(expect.arrayContaining([collabStorageKey(editedRow)]));
    expect(databases).not.toContain(collabStorageKey(rowPage(editedRow)));
    // Rows only in the legacy index are still found there.
    expect(databases).not.toContain(collabStorageKey(`${databaseId}_rows_${legacyOnlyRow}`));
    expect(snapshots.has(collabStorageKey(pendingRow))).toBe(true);
  });

  it('still removes the database copy when the rows cannot be listed', async () => {
    jest.spyOn(db.sync_outbox, 'where').mockImplementation((() => ({
      between: () => ({ uniqueKeys: async () => { throw new Error('IndexedDB is closing'); } }),
    })) as never);

    await deleteDatabaseLocalCopies(databaseId, { destroyDoc: true });

    expect(deletedDatabases).toContain(collabStorageKey(databaseId));
    // Without knowing which rows have unsent edits, no row copy is removed.
    expect(deletedShared).not.toContain(collabStorageKey(editedRow));
    expect(rowIndex).toHaveLength(3);
  });
});
