import 'fake-indexeddb/auto';
import { deserialize, serialize } from 'node:v8';

import Dexie from 'dexie';

import { db, removeSignedOutLocalData } from '@/application/db';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => 'https://server.test' }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const server = 'https://server.test';
const signedOut = 'user-1';
const LEGACY_DOC = '33333333-3333-4333-8333-333333333333';
const scoped = (userId: string, workspaceId: string | null, objectId: string) =>
  `af_collab:v2:${JSON.stringify([server, userId, workspaceId])}:${objectId}`;
const accountKey = (userId: string) => JSON.stringify([server, userId]);

beforeAll(() => {
  if (!globalThis.structuredClone) globalThis.structuredClone = (value) => deserialize(serialize(value));
});

afterEach(async () => {
  // Release the shared cache so it can be deleted; the next test reopens it.
  db.close({ disableAutoOpen: false });
  localStorage.clear();
  await Promise.all((await indexedDB.databases()).map(({ name }) => (name ? Dexie.delete(name) : undefined)));
});

async function createDatabase(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name);

    request.onupgradeneeded = () => request.result.createObjectStore('updates', { autoIncrement: true });
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

async function databaseNames() {
  return (await indexedDB.databases()).map(({ name }) => name).sort();
}

async function seedSharedCache() {
  // An edit the signed-out account never sent.
  await db.table('sync_outbox').add({
    userId: signedOut, workspaceId: 'workspace-a', objectId: 'doc-pending', payload: new Uint8Array([1]), collabType: 0, createdAt: 1,
  });
  await db.table('collab_snapshots').bulkAdd([
    { objectId: scoped(signedOut, 'workspace-a', 'row-a'), updatedAt: 1 },
    { objectId: scoped(signedOut, 'workspace-a', 'doc-pending'), updatedAt: 1 },
    { objectId: scoped('user-2', 'workspace-a', 'row-a'), updatedAt: 1 },
  ]);
  await db.table('rows').bulkAdd([
    { row_key: scoped(signedOut, 'workspace-a', 'database-a_rows_row-a'), row_id: 'row-a', version: 1 },
    { row_key: scoped('user-2', 'workspace-a', 'database-a_rows_row-a'), row_id: 'row-a', version: 1 },
  ]);
  await db.table('app_view_cache').bulkAdd([
    { user_id: accountKey(signedOut), workspace_id: 'workspace-a', view_id: 'view-a', updated_at: 1 },
    { user_id: accountKey('user-2'), workspace_id: 'workspace-a', view_id: 'view-a', updated_at: 1 },
  ]);
  await db.table('workspace_database_catalog').bulkAdd([
    { user_id: accountKey(signedOut), workspace_id: 'workspace-a', view_id: 'view-a', database_id: 'database-a', updated_at: 1 },
    { user_id: accountKey('user-2'), workspace_id: 'workspace-a', view_id: 'view-a', database_id: 'database-a', updated_at: 1 },
  ]);
}

async function readSharedCache() {
  return {
    outbox: await db.table('sync_outbox').count(),
    snapshots: (await db.table('collab_snapshots').toArray()).map(({ objectId }) => objectId).sort(),
    rows: (await db.table('rows').toArray()).map(({ row_key }) => row_key).sort(),
    views: (await db.table('app_view_cache').toArray()).map(({ user_id }) => user_id),
    catalog: (await db.table('workspace_database_catalog').toArray()).map(({ user_id }) => user_id),
  };
}

afterAll(() => db.close());

describe('sign-out local data cleanup with IndexedDB', () => {
  it('removes the copies of the signed-out account and pre-scope copies, keeping unsent edits', async () => {
    await seedSharedCache();
    for (const name of [
      scoped(signedOut, 'workspace-a', 'doc-a'),
      scoped(signedOut, 'workspace-a', 'doc-pending'),
      scoped(signedOut, 'workspace-b', 'doc-b'),
      scoped('user-2', 'workspace-a', 'doc-a'),
      LEGACY_DOC,
    ]) {
      await createDatabase(name);
    }

    localStorage.setItem(`af_database_blob_rid:${scoped(signedOut, 'workspace-a', 'database-a')}`, 'signed-out account');
    localStorage.setItem(`af_database_blob_rid:${scoped('user-2', 'workspace-a', 'database-a')}`, 'other account');
    localStorage.setItem(`af_database_blob_epoch:${scoped(signedOut, 'workspace-b', 'database-b')}`, 'signed-out account');
    localStorage.setItem(`af_database_restore:v1:${server}:${signedOut}:workspace-a:database-a`, 'signed-out account');

    await removeSignedOutLocalData({ serverUrl: server, userId: signedOut });

    expect(await databaseNames()).toEqual([
      'af_database_cache',
      scoped(signedOut, 'workspace-a', 'doc-pending'),
      scoped('user-2', 'workspace-a', 'doc-a'),
    ].sort());
    expect(await readSharedCache()).toEqual({
      // The unsent edit and the copy it belongs to stay.
      outbox: 1,
      snapshots: [scoped(signedOut, 'workspace-a', 'doc-pending'), scoped('user-2', 'workspace-a', 'row-a')].sort(),
      rows: [scoped('user-2', 'workspace-a', 'database-a_rows_row-a')],
      views: [accountKey('user-2')],
      catalog: [accountKey('user-2')],
    });
    expect(Object.keys(localStorage)).toEqual([`af_database_blob_rid:${scoped('user-2', 'workspace-a', 'database-a')}`]);
  });

  it('touches nothing once the same account signs in again', async () => {
    await createDatabase(scoped(signedOut, 'workspace-a', 'doc-a'));

    await removeSignedOutLocalData({ serverUrl: server, userId: signedOut }, () => false);

    expect(await databaseNames()).toEqual(expect.arrayContaining([scoped(signedOut, 'workspace-a', 'doc-a')]));
  });
});
