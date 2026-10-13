import { db, removeSignedOutLocalData } from '@/application/db';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => 'https://server.test' }));

const server = 'https://server.test';
const scoped = (userId: string, workspaceId: string | null, objectId: string) =>
  `af_collab:v2:${JSON.stringify([server, userId, workspaceId])}:${objectId}`;
const signedOut = 'user-1';
const LEGACY_ROW = '11111111-1111-4111-8111-111111111111';
const LEGACY_DOC = '22222222-2222-4222-8222-222222222222';

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the Dexie range queries the cleanup uses. */
function fakeTable(rows: Row[], keyField: string) {
  const matches = (predicate: (key: string) => boolean) => ({
    delete: async () => {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (predicate(String(rows[i][keyField]))) rows.splice(i, 1);
      }
    },
  });

  return (index: string) => {
    if (index !== keyField) throw new Error(`unexpected index ${index}`);
    return {
      startsWith: (prefix: string) => matches((key) => key.startsWith(prefix)),
      below: (bound: string) => matches((key) => key < bound),
      above: (bound: string) => matches((key) => key > bound),
      equals: (value: string) => matches((key) => key === value),
    };
  };
}

describe('sign-out local data cleanup', () => {
  const originalIndexedDB = globalThis.indexedDB;
  let databases: string[];
  let snapshots: Row[];
  let updates: Row[];
  let custom: Row[];
  let rowIndex: Row[];
  let viewCache: Row[];
  let catalog: Row[];

  beforeEach(() => {
    localStorage.clear();
    databases = [
      scoped(signedOut, 'workspace-a', 'doc-a'),
      `${scoped(signedOut, 'workspace-a', 'database-a')}:database-restore:restore-1`,
      scoped(signedOut, null, 'doc-b'),
      scoped('user-2', 'workspace-a', 'doc-a'),
      LEGACY_DOC,
      `${LEGACY_DOC}:database-restore:restore-0`,
      'appflowy_cache',
      'unrelated-database',
    ];
    snapshots = [{ objectId: scoped(signedOut, 'workspace-a', 'row-a') }, { objectId: scoped('user-2', 'workspace-a', 'row-a') },
      { objectId: LEGACY_ROW }];
    updates = [{ objectId: scoped(signedOut, 'workspace-a', 'row-a') }, { objectId: scoped('user-2', 'workspace-a', 'row-a') },
      { objectId: LEGACY_ROW }];
    custom = [{ objectId: scoped(signedOut, 'workspace-a', 'database-blob-epoch:database-a') },
      { objectId: scoped('user-2', 'workspace-a', 'row-a') }, { objectId: 'database-blob-epoch:legacy-database' }];
    rowIndex = [{ row_key: scoped(signedOut, 'workspace-a', 'database-a_rows_row-a') },
      { row_key: scoped('user-2', 'workspace-a', 'database-a_rows_row-a') }, { row_key: `${LEGACY_DOC}_rows_${LEGACY_ROW}` }];
    viewCache = [{ user_id: JSON.stringify([server, signedOut]) }, { user_id: JSON.stringify([server, 'user-2']) }];
    catalog = [{ user_id: JSON.stringify([server, signedOut]) }, { user_id: JSON.stringify([server, 'user-2']) }];

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        databases: async () => databases.map((name) => ({ name })),
        deleteDatabase: (name: string) => {
          const request: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};

          setTimeout(() => {
            databases = databases.filter((existing) => existing !== name);
            request.onsuccess?.();
          }, 0);
          return request;
        },
      },
    });
    jest.spyOn(db, 'transaction').mockImplementation((async (...args: unknown[]) =>
      (args[args.length - 1] as () => Promise<unknown>)()) as never);
    jest.spyOn(db.collab_snapshots, 'where').mockImplementation(fakeTable(snapshots, 'objectId') as never);
    jest.spyOn(db.collab_updates, 'where').mockImplementation(fakeTable(updates, 'objectId') as never);
    jest.spyOn(db.collab_custom, 'where').mockImplementation(fakeTable(custom, 'objectId') as never);
    jest.spyOn(db.rows, 'where').mockImplementation(fakeTable(rowIndex, 'row_key') as never);
    jest.spyOn(db.app_view_cache, 'where').mockImplementation(fakeTable(viewCache, 'user_id') as never);
    jest.spyOn(db.workspace_database_catalog, 'where').mockImplementation(((index: string) => ({
      between: (lower: unknown[]) => fakeTable(catalog, 'user_id')('user_id').equals(String(lower[0])),
      index,
    })) as never);
    jest.spyOn(db.sync_outbox, 'where');
    jest.spyOn(db.sync_permission_blocks, 'delete');

    for (const prefix of ['af_database_blob_rid:', 'af_database_blob_epoch:']) {
      localStorage.setItem(`${prefix}${scoped(signedOut, 'workspace-a', 'database-a')}`, 'signed-out account');
      localStorage.setItem(`${prefix}${scoped('user-2', 'workspace-a', 'database-a')}`, 'other account');
      localStorage.setItem(`${prefix}${LEGACY_DOC}`, 'pre-scope');
    }

    localStorage.setItem(`af_database_restore:v1:${server}:${signedOut}:workspace-a:database-a`, 'signed-out account');
    localStorage.setItem(`af_database_restore:v1:${server}:user-2:workspace-a:database-a`, 'other account');
    localStorage.setItem('token-unrelated', 'keep');
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: originalIndexedDB });
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('removes synced copies of the signed-out account and pre-scope copies, keeping unsent edits', async () => {
    await removeSignedOutLocalData({ serverUrl: server, userId: signedOut });

    expect(databases).toEqual([scoped('user-2', 'workspace-a', 'doc-a'), 'appflowy_cache', 'unrelated-database']);
    expect(snapshots).toEqual([{ objectId: scoped('user-2', 'workspace-a', 'row-a') }]);
    expect(updates).toEqual([{ objectId: scoped('user-2', 'workspace-a', 'row-a') }]);
    expect(custom).toEqual([{ objectId: scoped('user-2', 'workspace-a', 'row-a') }]);
    expect(rowIndex).toEqual([{ row_key: scoped('user-2', 'workspace-a', 'database-a_rows_row-a') }]);
    expect(viewCache).toEqual([{ user_id: JSON.stringify([server, 'user-2']) }]);
    expect(catalog).toEqual([{ user_id: JSON.stringify([server, 'user-2']) }]);
    expect(Object.keys(localStorage).sort()).toEqual([
      `af_database_blob_epoch:${scoped('user-2', 'workspace-a', 'database-a')}`,
      `af_database_blob_rid:${scoped('user-2', 'workspace-a', 'database-a')}`,
      `af_database_restore:v1:${server}:user-2:workspace-a:database-a`,
      'token-unrelated',
    ].sort());
    // Unsent edits and their quarantine are owned by their exact account and kept.
    expect(db.sync_outbox.where).not.toHaveBeenCalled();
    expect(db.sync_permission_blocks.delete).not.toHaveBeenCalled();
  });

  it('stops before touching storage once the same account signs in again', async () => {
    await removeSignedOutLocalData({ serverUrl: server, userId: signedOut }, () => false);

    expect(databases).toHaveLength(8);
    expect(snapshots).toHaveLength(3);
    expect(viewCache).toHaveLength(2);
    expect(localStorage.length).toBe(9);
  });

  it('never throws when IndexedDB is unavailable', async () => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    jest.spyOn(db, 'transaction').mockRejectedValue(Object.assign(new Error('IndexedDB API missing'), { name: 'MissingAPIError' }));

    await expect(removeSignedOutLocalData({ serverUrl: server, userId: signedOut })).resolves.toBeUndefined();
  });
});
