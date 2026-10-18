import { captureCollabStorageScope, setCollabStorageWorkspace } from '@/application/db/collab-storage-scope';
import {
  type DatabaseStorageFence,
  publishDatabaseCacheEpoch,
  readDatabaseCacheEpoch,
} from '@/application/db/database-storage-fence';

import {
  createDatabaseRowDocSeed,
  invalidateDatabaseRowDocSeedGeneration,
  isDatabaseRowDocSeedCurrent,
} from '../row-seed-fence';

const serverUrl = 'https://test.appflowy.cloud';
const databaseId = 'database-a';

function signIn(userId: string) {
  localStorage.setItem(
    'token',
    JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_at: 2_000_000_000, user: { id: userId } })
  );
}

function storageFence(): DatabaseStorageFence {
  const scope = captureCollabStorageScope();

  return {
    databaseId,
    scopeKey: scope.key,
    scopeGeneration: scope.generation,
    epoch: 'restore-1',
    cacheEpoch: readDatabaseCacheEpoch(databaseId),
  };
}

/** Counts reads of the stored login from now on. */
function countTokenReads() {
  const getItem = jest.spyOn(Storage.prototype, 'getItem');

  return () => getItem.mock.calls.filter(([key]) => key === 'token').length;
}

function seed(rowId = 'row-a') {
  return createDatabaseRowDocSeed(rowId, {
    bytes: new Uint8Array([1]),
    encoderVersion: 1,
    storageFence: storageFence(),
  });
}

beforeEach(() => {
  localStorage.clear();
  signIn('actor-a');
  setCollabStorageWorkspace({ serverUrl, userId: 'actor-a', workspaceId: 'workspace-a' });
  publishDatabaseCacheEpoch(databaseId, 'restore-1');
});

afterEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
  setCollabStorageWorkspace(null);
});

it('reads the stored login once for the scope of a seed, and once more for its row generation', () => {
  const fence = storageFence();
  const tokenReads = countTokenReads();

  createDatabaseRowDocSeed('row-a', { bytes: new Uint8Array([1]), encoderVersion: 1, storageFence: fence });
  expect(tokenReads()).toBe(2);
});

it('checks a seed and its storage fence against one capture of the scope', () => {
  const current = seed();
  const tokenReads = countTokenReads();

  expect(isDatabaseRowDocSeedCurrent(current)).toBe(true);
  // One read for the scope, shared by the seed and fence checks, and one for the row generation.
  expect(tokenReads()).toBe(2);
});

it('still notices another account between checks', () => {
  const current = seed();

  expect(isDatabaseRowDocSeedCurrent(current)).toBe(true);
  // Another tab signs in as someone else; nothing in this tab announces it.
  signIn('actor-b');
  expect(isDatabaseRowDocSeedCurrent(current)).toBe(false);
});

it('still notices a reset row and a restore in another tab', () => {
  const reset = seed('row-b');
  const restored = seed('row-a');

  invalidateDatabaseRowDocSeedGeneration('row-b');
  expect(isDatabaseRowDocSeedCurrent(reset)).toBe(false);
  expect(isDatabaseRowDocSeedCurrent(restored)).toBe(true);
  publishDatabaseCacheEpoch(databaseId, 'restore-2');
  expect(isDatabaseRowDocSeedCurrent(restored)).toBe(false);
});
