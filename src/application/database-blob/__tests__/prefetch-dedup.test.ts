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
    page: {
      hasMore: false,
      nextCursor: new Uint8Array(),
      restartRequired: false,
    },
  });
}

function pageDiff(options: {
  status?: database_blob.DiffStatus;
  hasMore?: boolean;
  nextCursor?: Uint8Array;
  restartRequired?: boolean;
  retryAfterSecs?: number;
  rid?: { timestamp: number; seqNo: number };
}) {
  return database_blob.DatabaseBlobDiffResponse.create({
    status: options.status ?? database_blob.DiffStatus.READY,
    retryAfterSecs: options.retryAfterSecs,
    creates: options.rid
      ? [
          {
            // An invalid row ID keeps persistence side-effect free while still
            // exercising watermark selection across pages.
            rowId: new Uint8Array(),
            rid: options.rid,
          },
        ]
      : [],
    updates: [],
    deletes: [],
    page: {
      hasMore: options.hasMore ?? false,
      nextCursor: options.nextCursor ?? new Uint8Array(),
      restartRequired: options.restartRequired ?? false,
    },
  });
}

describe('database blob prefetch deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
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

  it('shares one multi-page walk among three concurrent consumers', async () => {
    const workspaceId = 'workspace-three-consumers';
    const databaseId = 'database-three-consumers';
    const firstPage = createDeferred<database_blob.DatabaseBlobDiffResponse>();
    const callbacks = [jest.fn(), jest.fn(), jest.fn()];

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff
      .mockReturnValueOnce(firstPage.promise)
      .mockResolvedValueOnce(readyDiff());

    const prefetches = callbacks.map((onSeedsReady) =>
      prefetchDatabaseBlobDiff(workspaceId, databaseId, { onSeedsReady })
    );

    firstPage.resolve(
      pageDiff({
        hasMore: true,
        nextCursor: new Uint8Array([1]),
      })
    );
    await Promise.all(prefetches);

    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(2);
    callbacks.forEach((callback) => {
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  it('walks every page with fixed limits and the original RID', async () => {
    const workspaceId = 'workspace-paged';
    const databaseId = 'database-paged';
    const nextCursor = new Uint8Array([1, 2, 3]);
    const originalRid = { timestamp: 1_721_800_000, seqNo: 7 };
    const firstPage = pageDiff({
      hasMore: true,
      nextCursor,
      rid: { timestamp: 1_721_800_001, seqNo: 1 },
    });
    const finalPage = pageDiff({
      rid: { timestamp: 1_721_800_002, seqNo: 2 },
    });

    databaseIds.add(databaseId);
    localStorage.setItem(`af_database_blob_rid:${databaseId}`, JSON.stringify(originalRid));
    mockedDatabaseBlobDiff.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(finalPage);

    const result = await prefetchDatabaseBlobDiff(workspaceId, databaseId);

    expect(result).toBe(finalPage);
    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(2);

    const firstRequest = mockedDatabaseBlobDiff.mock.calls[0][2];
    const finalRequest = mockedDatabaseBlobDiff.mock.calls[1][2];

    expect(firstRequest).toMatchObject({
      version: 3,
      maxKnownRid: originalRid,
      page: {
        maxItems: 256,
        maxBytes: 16 * 1024 * 1024,
      },
    });
    expect(Array.from(firstRequest.page?.cursor ?? [])).toEqual([]);
    expect(finalRequest.maxKnownRid).toMatchObject(originalRid);
    expect(Array.from(finalRequest.page?.cursor ?? [])).toEqual(Array.from(nextCursor));
    expect(JSON.parse(localStorage.getItem(`af_database_blob_rid:${databaseId}`) ?? 'null')).toEqual({
      timestamp: 1_721_800_002,
      seqNo: 2,
    });
  });

  it('retries a Pending page with the same cursor', async () => {
    jest.useFakeTimers();

    const workspaceId = 'workspace-pending';
    const databaseId = 'database-pending';
    const nextCursor = new Uint8Array([9, 8, 7]);

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff
      .mockResolvedValueOnce(pageDiff({ hasMore: true, nextCursor }))
      .mockResolvedValueOnce(
        pageDiff({
          status: database_blob.DiffStatus.PENDING,
          hasMore: true,
          nextCursor,
          retryAfterSecs: 1,
        })
      )
      .mockResolvedValueOnce(readyDiff());

    const prefetch = prefetchDatabaseBlobDiff(workspaceId, databaseId);

    await jest.advanceTimersByTimeAsync(1000);
    await prefetch;

    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(3);
    expect(Array.from(mockedDatabaseBlobDiff.mock.calls[1][2].page?.cursor ?? [])).toEqual(Array.from(nextCursor));
    expect(Array.from(mockedDatabaseBlobDiff.mock.calls[2][2].page?.cursor ?? [])).toEqual(Array.from(nextCursor));
  });

  it('does not advance the RID when a continuation remains Pending', async () => {
    jest.useFakeTimers();

    const workspaceId = 'workspace-still-pending';
    const databaseId = 'database-still-pending';
    const nextCursor = new Uint8Array([3, 2, 1]);
    const onSeedsReady = jest.fn();
    const pendingPage = pageDiff({
      status: database_blob.DiffStatus.PENDING,
      hasMore: true,
      nextCursor,
      retryAfterSecs: 1,
    });

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff
      .mockResolvedValueOnce(
        pageDiff({
          hasMore: true,
          nextCursor,
          rid: { timestamp: 20, seqNo: 1 },
        })
      )
      .mockResolvedValueOnce(pendingPage)
      .mockResolvedValueOnce(pendingPage);

    const prefetch = prefetchDatabaseBlobDiff(workspaceId, databaseId, {
      onSeedsReady,
    });

    await jest.advanceTimersByTimeAsync(1000);
    const result = await prefetch;

    expect(result).toBe(pendingPage);
    expect(localStorage.getItem(`af_database_blob_rid:${databaseId}`)).toBeNull();
    expect(onSeedsReady).toHaveBeenCalledTimes(1);

    mockedDatabaseBlobDiff.mockResolvedValueOnce(readyDiff());
    await prefetchDatabaseBlobDiff(workspaceId, databaseId, {
      forceFullSync: true,
    });

    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(4);
  });

  it('discards collected pages and restarts from the original RID', async () => {
    const workspaceId = 'workspace-restart';
    const databaseId = 'database-restart';
    const nextCursor = new Uint8Array([4, 5, 6]);
    const abandonedPage = pageDiff({
      hasMore: true,
      nextCursor,
      rid: { timestamp: 99, seqNo: 0 },
    });
    const restartResponse = pageDiff({
      restartRequired: true,
    });
    const replacementPage = pageDiff({
      rid: { timestamp: 7, seqNo: 3 },
    });

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff
      .mockResolvedValueOnce(abandonedPage)
      .mockResolvedValueOnce(restartResponse)
      .mockResolvedValueOnce(replacementPage);

    await prefetchDatabaseBlobDiff(workspaceId, databaseId);

    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(3);
    expect(Array.from(mockedDatabaseBlobDiff.mock.calls[0][2].page?.cursor ?? [])).toEqual([]);
    expect(Array.from(mockedDatabaseBlobDiff.mock.calls[1][2].page?.cursor ?? [])).toEqual(Array.from(nextCursor));
    expect(Array.from(mockedDatabaseBlobDiff.mock.calls[2][2].page?.cursor ?? [])).toEqual([]);
    expect(mockedDatabaseBlobDiff.mock.calls.map(([, , request]) => request.maxKnownRid)).toEqual([null, null, null]);
    expect(JSON.parse(localStorage.getItem(`af_database_blob_rid:${databaseId}`) ?? 'null')).toEqual({
      timestamp: 7,
      seqNo: 3,
    });
  });
});
