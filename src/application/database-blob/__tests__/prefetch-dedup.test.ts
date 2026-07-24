import { prefetchDatabaseBlobDiff, clearDatabaseRowDocSeedCache } from '@/application/database-blob';
import { databaseBlobDiff } from '@/application/services/js-services/http/http_api';
import { database_blob } from '@/proto/database_blob';

jest.mock('@/application/db', () => ({
  getCachedProviderDoc: jest.fn(),
  openCollabDBWithProvider: jest.fn(),
  openRowCollabDBWithProvider: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  getCachedRowDoc: jest.fn(),
}));

jest.mock('@/application/services/js-services/http/http_api', () => ({
  databaseBlobDiff: jest.fn(),
}));

jest.mock('@/utils/log', () => ({
  Log: {
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockedDatabaseBlobDiff = databaseBlobDiff as jest.MockedFunction<typeof databaseBlobDiff>;
const databaseIds = new Set<string>();

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function readyDiff() {
  return database_blob.DatabaseBlobDiffResponse.create({
    status: database_blob.DiffStatus.READY,
    creates: [],
    updates: [],
    deletes: [],
  });
}

describe('database blob prefetch deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    databaseIds.forEach(clearDatabaseRowDocSeedCache);
    databaseIds.clear();
  });

  it('reuses an in-flight cold delta request for a concurrent full prefetch', async () => {
    const workspaceId = 'workspace-cold';
    const databaseId = 'database-cold';
    const deferred = createDeferred<database_blob.DatabaseBlobDiffResponse>();
    const deltaSeedsReady = jest.fn();
    const fullSeedsReady = jest.fn();

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff.mockReturnValueOnce(deferred.promise);

    const deltaPrefetch = prefetchDatabaseBlobDiff(workspaceId, databaseId, {
      onSeedsReady: deltaSeedsReady,
    });
    const fullPrefetch = prefetchDatabaseBlobDiff(workspaceId, databaseId, {
      forceFullSync: true,
      onSeedsReady: fullSeedsReady,
    });

    deferred.resolve(readyDiff());
    await Promise.all([deltaPrefetch, fullPrefetch]);

    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(1);
    expect(mockedDatabaseBlobDiff.mock.calls[0][2].maxKnownRid).toBeNull();
    expect(deltaSeedsReady).toHaveBeenCalledTimes(1);
    expect(fullSeedsReady).toHaveBeenCalledTimes(1);
  });

  it('keeps an incremental delta separate from a full prefetch', async () => {
    const workspaceId = 'workspace-incremental';
    const databaseId = 'database-incremental';
    const deltaDeferred = createDeferred<database_blob.DatabaseBlobDiffResponse>();
    const fullDeferred = createDeferred<database_blob.DatabaseBlobDiffResponse>();

    databaseIds.add(databaseId);
    localStorage.setItem(`af_database_blob_rid:${databaseId}`, JSON.stringify({ timestamp: 1_721_800_000, seqNo: 7 }));
    mockedDatabaseBlobDiff.mockReturnValueOnce(deltaDeferred.promise).mockReturnValueOnce(fullDeferred.promise);

    const deltaPrefetch = prefetchDatabaseBlobDiff(workspaceId, databaseId);
    const fullPrefetch = prefetchDatabaseBlobDiff(workspaceId, databaseId, {
      forceFullSync: true,
    });

    deltaDeferred.resolve(readyDiff());
    fullDeferred.resolve(readyDiff());
    await Promise.all([deltaPrefetch, fullPrefetch]);

    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(2);
    expect(mockedDatabaseBlobDiff.mock.calls[0][2].maxKnownRid).toMatchObject({
      timestamp: 1_721_800_000,
      seqNo: 7,
    });
    expect(mockedDatabaseBlobDiff.mock.calls[1][2].maxKnownRid).toBeNull();
  });
});
