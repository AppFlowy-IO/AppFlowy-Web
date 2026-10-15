import 'fake-indexeddb/auto';
import { deserialize, serialize } from 'node:v8';

import Dexie from 'dexie';

import { databasePrefix } from '@/application/constants';
import { appViewCacheSchema } from '@/application/db/tables/app_view_cache';
import { atomicCreationSchema } from '@/application/db/tables/atomic_creation';
import { collabStorageSchema } from '@/application/db/tables/collab_storage';
import { rowSchema } from '@/application/db/tables/rows';
import { syncOutboxSchema, syncPermissionBlockSchema } from '@/application/db/tables/sync_outbox';
import { userSchema } from '@/application/db/tables/users';
import { versionSchema } from '@/application/db/tables/versions';
import { viewMetasSchema } from '@/application/db/tables/view_metas';
import { workspaceDatabaseCatalogSchema } from '@/application/db/tables/workspace_database_catalog';
import { workspaceMemberProfileSchema } from '@/application/db/tables/workspace_member_profiles';

jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const NAME = `${databasePrefix}_cache`;
const STORES_V12 = {
  ...viewMetasSchema, ...userSchema, ...rowSchema, ...workspaceMemberProfileSchema, ...versionSchema,
  ...syncOutboxSchema, ...collabStorageSchema, ...appViewCacheSchema, ...workspaceDatabaseCatalogSchema,
};
const journal = {
  id: 'journal-1', serverUrl: 'https://server', userId: 'user', workspaceId: 'workspace', kind: 'document',
  logicalTarget: 'page', requestId: 'request', requestJson: '{}', state: 'pending', createdAt: 1,
};
const block = { serverUrl: 'https://server', userId: 'user', workspaceId: 'workspace', objectId: 'page' };
const bareCacheRow = { workspace_id: 'workspace', view_id: 'view', user_id: 'legacy-user', updated_at: 1 };

beforeAll(() => {
  if (!globalThis.structuredClone) globalThis.structuredClone = (value) => deserialize(serialize(value));
});

afterEach(async () => {
  await Dexie.delete(NAME);
});

/** Opens the application database module fresh, as a page load after an upgrade does. */
async function openMergedDatabase() {
  let module!: typeof import('@/application/db');

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    module = require('@/application/db');
  });
  await module.db.open();
  return module.db;
}

it('keeps released atomic commands when a main version 13 database gains the permission tables', async () => {
  const released = new Dexie(NAME);

  released.version(13).stores({ ...STORES_V12, ...atomicCreationSchema });
  await released.table('atomic_creation').add(journal);
  await released.table('app_view_cache').add(bareCacheRow);
  released.close();

  const db = await openMergedDatabase();

  try {
    expect(db.verno).toBe(15);
    expect(await db.table('atomic_creation').get('journal-1')).toMatchObject({ requestId: 'request' });
    expect(db.tables.map((table) => table.name)).toContain('sync_permission_blocks');
    // Version 15's cleanup ran: bare-account cache rows can never be read again.
    expect(await db.table('app_view_cache').count()).toBe(0);
  } finally {
    db.close();
  }
});

it('keeps durable denials when a database created by the permissions PR build (version 13) is upgraded', async () => {
  // PR #621 builds declared sync_permission_blocks at version 13, the number main's
  // atomic_creation release also used. Dexie diffs every version from the stored one up, so
  // the merged version 13 must declare the table too or its step would drop the denials.
  const branch = new Dexie(NAME);

  branch.version(13).stores({ ...STORES_V12, ...syncPermissionBlockSchema });
  await branch.table('sync_permission_blocks').add(block);
  await branch.table('app_view_cache').add(bareCacheRow);
  branch.close();

  const db = await openMergedDatabase();

  try {
    expect(db.verno).toBe(15);
    expect(await db.table('sync_permission_blocks').toArray()).toEqual([expect.objectContaining(block)]);
    expect(await db.table('atomic_creation').count()).toBe(0);
    // Version 15's cleanup still runs for this path.
    expect(await db.table('app_view_cache').count()).toBe(0);
  } finally {
    db.close();
  }
});

it('keeps durable denials when a permissions-branch version 14 database gains atomic commands', async () => {
  const branch = new Dexie(NAME);

  branch.version(14).stores({ ...STORES_V12, ...syncPermissionBlockSchema });
  await branch.table('sync_permission_blocks').add(block);
  branch.close();

  const db = await openMergedDatabase();

  try {
    expect(db.verno).toBe(15);
    expect(await db.table('sync_permission_blocks').count()).toBe(1);
    expect(await db.table('atomic_creation').count()).toBe(0);
    await db.table('atomic_creation').add(journal);
    expect(await db.table('atomic_creation').count()).toBe(1);
  } finally {
    db.close();
  }
});
