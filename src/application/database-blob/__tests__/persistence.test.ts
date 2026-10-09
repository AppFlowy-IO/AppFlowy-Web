import { parse as uuidParse } from 'uuid';
import * as Y from 'yjs';

import {
  clearDatabaseRowDocSeedCache,
  peekDatabaseRowDocSeed,
  prefetchDatabaseBlobDiff,
  releaseDatabaseRowDocSeedCache,
  retainDatabaseRowDocSeedCache,
} from '@/application/database-blob';
import { DASHBOARD_MAX_WIDGETS } from '@/application/database-yjs/dashboard.type';
import { db, openRowCollabDBWithProvider } from '@/application/db';
import { getCachedRowDoc } from '@/application/services/js-services/cache';
import { databaseBlobDiff } from '@/application/services/js-services/http/http_api';
import { database_blob } from '@/proto/database_blob';

jest.mock('@/application/services/js-services/cache', () => ({ getCachedRowDoc: jest.fn() }));
jest.mock('@/application/services/js-services/http/http_api', () => ({ databaseBlobDiff: jest.fn() }));
jest.mock('@/application/sync-outbox', () => ({ getCurrentOutboxSession: () => null }));

const databaseId = 'database-persistence-result';
const rowId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  localStorage.clear();
  jest.mocked(getCachedRowDoc).mockReset();
  jest.spyOn(db, 'transaction').mockImplementation((async (...args: unknown[]) =>
    (args[args.length - 1] as () => Promise<unknown>)()) as never);
  jest.spyOn(db.collab_custom, 'get').mockResolvedValue(undefined);
  jest.spyOn(db.collab_snapshots, 'get').mockResolvedValue(undefined);
  jest.spyOn(db.collab_updates, 'where').mockReturnValue({ between: () => ({ toArray: async () => [] }) } as never);
  jest.spyOn(db.collab_updates, 'add').mockRejectedValue(new DOMException('Storage quota exhausted', 'QuotaExceededError'));
  const source = new Y.Doc();

  source.getMap('data').set('restored', true);
  jest.mocked(databaseBlobDiff).mockResolvedValue(database_blob.DatabaseBlobDiffResponse.create({
    status: database_blob.DiffStatus.READY,
    creates: [{ rowId: uuidParse(rowId), rid: { timestamp: 500, seqNo: 1 },
      docState: { docState: Y.encodeStateAsUpdate(source), encoderVersion: 1 } }],
    page: { hasMore: false },
  }));
  source.destroy();
});

afterEach(() => {
  clearDatabaseRowDocSeedCache(databaseId);
  jest.restoreAllMocks();
  localStorage.clear();
});

test.each(['none', 'provider', 'seed'])('a required reload rejects a failed row write with cache: %s', async (cached) => {
  const row = cached === 'provider' ? await openRowCollabDBWithProvider(rowId) : undefined;
  const seed = cached === 'seed' ? new Y.Doc({ guid: rowId }) : undefined;

  if (row) jest.mocked(getCachedRowDoc).mockReturnValue(row.doc);
  if (seed) jest.mocked(getCachedRowDoc).mockReturnValue(seed);
  try {
    await expect(prefetchDatabaseBlobDiff('workspace', databaseId, {
      forceFullSync: true, requirePersistence: true,
    })).rejects.toThrow('could not be saved locally');
    expect(db.collab_updates.add).toHaveBeenCalled();
    expect(localStorage.getItem(`af_database_blob_rid:${databaseId}`)).toBeNull();
  } finally {
    await row?.provider.destroy();
    row?.doc.destroy();
    seed?.destroy();
  }
});

test('ordinary prefetch with a failed write keeps its checkpoint and cannot satisfy a required reload', async () => {
  await prefetchDatabaseBlobDiff('workspace', databaseId, { reuseSettled: true });

  expect(db.collab_updates.add).toHaveBeenCalled();
  expect(localStorage.getItem(`af_database_blob_rid:${databaseId}`)).toBeNull();
  await expect(prefetchDatabaseBlobDiff('workspace', databaseId, {
    forceFullSync: true, requirePersistence: true,
  })).rejects.toThrow('could not be saved locally');
});

test.each([false, true])('a required reload waits until a row write commits with a cached provider: %s', async (cached) => {
  const row = cached ? await openRowCollabDBWithProvider(rowId) : undefined;

  if (row) jest.mocked(getCachedRowDoc).mockReturnValue(row.doc);
  let commit!: (id: number) => void;
  const write = new Promise<number>((resolve) => { commit = resolve; });

  jest.mocked(db.collab_updates.add).mockReturnValue(write);
  let settled = false;
  const reload = prefetchDatabaseBlobDiff('workspace', databaseId, {
    forceFullSync: true, requirePersistence: true,
  }).then(() => { settled = true; });

  // Allow the page walk to reach the deferred IndexedDB transaction.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(db.collab_updates.add).toHaveBeenCalled();
  expect(settled).toBe(false);
  commit(1);
  await reload;
  expect(settled).toBe(true);
  await row?.provider.destroy();
  row?.doc.destroy();
});

test('keeps the seeds of every source of the dashboard just left', async () => {
  // A full dashboard: one source database per widget, plus the database that hosts it.
  const sources = Array.from({ length: DASHBOARD_MAX_WIDGETS + 1 }, (_, index) => `database-dashboard-source-${index}`);
  const hasSeeds = (source: string) => peekDatabaseRowDocSeed(`${source}_rows_${rowId}`) !== null;
  const open = async () => {
    for (const source of sources) {
      retainDatabaseRowDocSeedCache(source);
      await prefetchDatabaseBlobDiff('workspace', source, { forceFullSync: true });
    }
  };

  try {
    await open();
    const walks = jest.mocked(databaseBlobDiff).mock.calls.length;

    // Leaving the dashboard unmounts every widget at once.
    sources.forEach(releaseDatabaseRowDocSeedCache);
    expect(sources.filter((source) => !hasSeeds(source))).toEqual([]);

    // Coming back within the idle time: every widget reuses its settled walk.
    await open();
    expect(jest.mocked(databaseBlobDiff)).toHaveBeenCalledTimes(walks);
  } finally {
    sources.forEach(releaseDatabaseRowDocSeedCache);
    sources.forEach(clearDatabaseRowDocSeedCache);
  }
});
