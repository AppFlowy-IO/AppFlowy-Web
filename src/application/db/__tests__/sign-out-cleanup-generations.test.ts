import 'fake-indexeddb/auto';
import { deserialize, serialize } from 'node:v8';

import Dexie from 'dexie';

import { db, removeSignedOutLocalData } from '@/application/db';
import { appViewCacheSchema } from '@/application/db/tables/app_view_cache';
import { atomicCreationSchema } from '@/application/db/tables/atomic_creation';
import { collabStorageSchema } from '@/application/db/tables/collab_storage';
import { rowSchema } from '@/application/db/tables/rows';
import { syncOutboxSchema } from '@/application/db/tables/sync_outbox';
import { userSchema } from '@/application/db/tables/users';
import { versionSchema } from '@/application/db/tables/versions';
import { viewMetasSchema } from '@/application/db/tables/view_metas';
import { workspaceDatabaseCatalogSchema } from '@/application/db/tables/workspace_database_catalog';
import { workspaceMemberProfileSchema } from '@/application/db/tables/workspace_member_profiles';

jest.mock('@/utils/runtime-config', () => ({ getConfigValue: () => 'https://server.test' }));
// This tab runs in the generation a server restore created; the initial generation is older.
jest.mock('@/application/server-restore', () => {
  const actual = jest.requireActual('@/application/server-restore');
  const storage = { getItem: () => '11111111-1111-4111-8111-111111111111', setItem: jest.fn() };

  return { ...actual, serverRestore: new actual.ServerRestoreBoundary('https://server.test', storage, jest.fn()) };
});
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const server = 'https://server.test';
const signedOut = 'user-1';
const CURRENT = '11111111-1111-4111-8111-111111111111';
const OLDER = '22222222-2222-4222-8222-222222222222';
const LEGACY_DOC = '33333333-3333-4333-8333-333333333333';
const STORES_V12 = {
  ...viewMetasSchema, ...userSchema, ...rowSchema, ...workspaceMemberProfileSchema, ...versionSchema,
  ...syncOutboxSchema, ...collabStorageSchema, ...appViewCacheSchema, ...workspaceDatabaseCatalogSchema,
};
const scoped = (userId: string, workspaceId: string | null, objectId: string) =>
  `af_collab:v2:${JSON.stringify([server, userId, workspaceId])}:${objectId}`;
const stored = (restoreId: string | null, name: string) => (restoreId ? `server-restore:${restoreId}:${name}` : name);
const accountKey = (userId: string) => JSON.stringify([server, userId]);

beforeAll(() => {
  if (!globalThis.structuredClone) globalThis.structuredClone = (value) => deserialize(serialize(value));
});

afterEach(async () => {
  // Release the current generation's cache so it can be deleted; the next test reopens it.
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

/** The shared cache a build released before the restore left in the initial generation. */
async function createInitialSharedCache() {
  const cache = new Dexie('af_database_cache');

  cache.version(13).stores({ ...STORES_V12, ...atomicCreationSchema });
  // An edit the signed-out account never sent before the restore.
  await cache.table('sync_outbox').add({
    userId: signedOut, workspaceId: 'workspace-a', objectId: 'doc-pending', payload: new Uint8Array([1]), collabType: 0, createdAt: 1,
  });
  await cache.table('collab_snapshots').bulkAdd([
    { objectId: scoped(signedOut, 'workspace-a', 'row-a'), updatedAt: 1 },
    { objectId: scoped(signedOut, 'workspace-a', 'doc-pending'), updatedAt: 1 },
    { objectId: scoped('user-2', 'workspace-a', 'row-a'), updatedAt: 1 },
  ]);
  await cache.table('rows').bulkAdd([
    { row_key: scoped(signedOut, 'workspace-a', 'database-a_rows_row-a'), row_id: 'row-a', version: 1 },
    { row_key: scoped('user-2', 'workspace-a', 'database-a_rows_row-a'), row_id: 'row-a', version: 1 },
  ]);
  await cache.table('app_view_cache').bulkAdd([
    { user_id: accountKey(signedOut), workspace_id: 'workspace-a', view_id: 'view-a', updated_at: 1 },
    { user_id: accountKey('user-2'), workspace_id: 'workspace-a', view_id: 'view-a', updated_at: 1 },
  ]);
  await cache.table('workspace_database_catalog').bulkAdd([
    { user_id: accountKey(signedOut), workspace_id: 'workspace-a', view_id: 'view-a', database_id: 'database-a', updated_at: 1 },
    { user_id: accountKey('user-2'), workspace_id: 'workspace-a', view_id: 'view-a', database_id: 'database-a', updated_at: 1 },
  ]);
  cache.close();
}

async function readInitialSharedCache() {
  const cache = new Dexie('af_database_cache');

  await cache.open();
  try {
    return {
      outbox: await cache.table('sync_outbox').count(),
      snapshots: (await cache.table('collab_snapshots').toArray()).map(({ objectId }) => objectId).sort(),
      rows: (await cache.table('rows').toArray()).map(({ row_key }) => row_key).sort(),
      views: (await cache.table('app_view_cache').toArray()).map(({ user_id }) => user_id),
      catalog: (await cache.table('workspace_database_catalog').toArray()).map(({ user_id }) => user_id),
    };
  } finally {
    cache.close();
  }
}

afterAll(() => db.close());

describe('sign-out local data cleanup across server restore generations', () => {
  it('also removes the copies the account left before a server restore, keeping unsent edits', async () => {
    await createInitialSharedCache();
    for (const name of [
      scoped(signedOut, 'workspace-a', 'doc-a'),
      scoped(signedOut, 'workspace-a', 'doc-pending'),
      scoped('user-2', 'workspace-a', 'doc-a'),
      LEGACY_DOC,
      stored(OLDER, scoped(signedOut, 'workspace-b', 'doc-b')),
      stored(CURRENT, scoped(signedOut, 'workspace-a', 'doc-c')),
      stored(CURRENT, scoped('user-2', 'workspace-a', 'doc-c')),
    ]) {
      await createDatabase(name);
    }

    localStorage.setItem(`af_database_blob_rid:${scoped(signedOut, 'workspace-a', 'database-a')}`, 'initial');
    localStorage.setItem(`af_database_blob_rid:${scoped('user-2', 'workspace-a', 'database-a')}`, 'other account');
    localStorage.setItem(`af_database_restore:v1:${server}:${signedOut}:workspace-a:database-a`, 'initial');
    localStorage.setItem(stored(OLDER, `af_database_blob_epoch:${scoped(signedOut, 'workspace-b', 'database-b')}`), 'older');
    localStorage.setItem(stored(CURRENT, `af_database_blob_rid:${scoped(signedOut, 'workspace-a', 'database-a')}`), 'current');
    localStorage.setItem(`af_server_restore:v1:${server}`, CURRENT);

    await removeSignedOutLocalData({ serverUrl: server, userId: signedOut });

    expect(await databaseNames()).toEqual([
      'af_database_cache',
      scoped(signedOut, 'workspace-a', 'doc-pending'),
      scoped('user-2', 'workspace-a', 'doc-a'),
      stored(CURRENT, 'af_database_cache'),
      stored(CURRENT, scoped('user-2', 'workspace-a', 'doc-c')),
    ].sort());
    expect(await readInitialSharedCache()).toEqual({
      // The unsent edit and the copy it belongs to stay, as in the current generation.
      outbox: 1,
      snapshots: [scoped(signedOut, 'workspace-a', 'doc-pending'), scoped('user-2', 'workspace-a', 'row-a')].sort(),
      rows: [scoped('user-2', 'workspace-a', 'database-a_rows_row-a')],
      views: [accountKey('user-2')],
      catalog: [accountKey('user-2')],
    });
    expect(Object.keys(localStorage).sort()).toEqual([
      `af_database_blob_rid:${scoped('user-2', 'workspace-a', 'database-a')}`,
      `af_server_restore:v1:${server}`,
    ].sort());
  });

  it('leaves a generation alone when its outbox cannot be read, and still cleans the current one', async () => {
    // A cache whose outbox predates the per-object index cannot say which copies are still needed.
    const legacy = new Dexie('af_database_cache');

    legacy.version(4).stores({ sync_outbox: '++id, objectId', collab_snapshots: 'objectId, updatedAt' });
    await legacy.table('collab_snapshots').add({ objectId: scoped(signedOut, 'workspace-a', 'row-a'), updatedAt: 1 });
    legacy.close();
    await createDatabase(scoped(signedOut, 'workspace-a', 'doc-a'));
    await createDatabase(stored(CURRENT, scoped(signedOut, 'workspace-a', 'doc-c')));
    localStorage.setItem(`af_database_blob_rid:${scoped(signedOut, 'workspace-a', 'database-a')}`, 'initial');

    await removeSignedOutLocalData({ serverUrl: server, userId: signedOut });

    expect(await databaseNames()).toEqual(
      ['af_database_cache', scoped(signedOut, 'workspace-a', 'doc-a'), stored(CURRENT, 'af_database_cache')].sort()
    );
    const cache = new Dexie('af_database_cache');

    await cache.open();
    expect(await cache.table('collab_snapshots').count()).toBe(1);
    cache.close();
    expect(localStorage.getItem(`af_database_blob_rid:${scoped(signedOut, 'workspace-a', 'database-a')}`)).toBe('initial');
  });

  it('touches no generation once the same account signs in again', async () => {
    await createDatabase(scoped(signedOut, 'workspace-a', 'doc-a'));
    await createDatabase(stored(CURRENT, scoped(signedOut, 'workspace-a', 'doc-c')));

    await removeSignedOutLocalData({ serverUrl: server, userId: signedOut }, () => false);

    expect(await databaseNames()).toEqual(expect.arrayContaining(
      [scoped(signedOut, 'workspace-a', 'doc-a'), stored(CURRENT, scoped(signedOut, 'workspace-a', 'doc-c'))]
    ));
  });
});
