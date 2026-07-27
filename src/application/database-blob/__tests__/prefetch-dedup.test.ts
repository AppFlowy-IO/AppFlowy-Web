import { prefetchDatabaseBlobDiff, clearDatabaseRowDocSeedCache } from '@/application/database-blob';
import { deleteCollabDB, openRowCollabDBWithProvider } from '@/application/db';
import { deleteRow } from '@/application/services/js-services/cache';
import { databaseBlobDiff } from '@/application/services/js-services/http/http_api';
import { deleteOutboxByObjectId, getCurrentOutboxSession } from '@/application/sync-outbox';
import { database_blob } from '@/proto/database_blob';

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  openCollabDBWithProvider: jest.fn(),
  openRowCollabDBWithProvider: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  deleteRow: jest.fn(),
  getCachedRowDoc: jest.fn(),
}));

jest.mock('@/application/services/js-services/http/http_api', () => ({
  databaseBlobDiff: jest.fn(),
}));

jest.mock('@/application/sync-outbox', () => ({
  deleteOutboxByObjectId: jest.fn(),
  getCurrentOutboxSession: jest.fn((workspaceId: string) => ({ userId: 'user-1', workspaceId })),
}));

// Persist assertions only care about control flow, not Yjs decoding, so the
// tests can hand IndexedDB a stub doc.
jest.mock('@/application/ydoc/apply', () => ({
  applyYDoc: jest.fn(),
}));

jest.mock('@/utils/log', () => ({
  Log: {
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockedDatabaseBlobDiff = databaseBlobDiff as jest.MockedFunction<typeof databaseBlobDiff>;
const mockedDeleteCollabDB = deleteCollabDB as jest.MockedFunction<typeof deleteCollabDB>;
const mockedOpenRowCollabDB = openRowCollabDBWithProvider as jest.MockedFunction<typeof openRowCollabDBWithProvider>;
const mockedDeleteRow = deleteRow as jest.MockedFunction<typeof deleteRow>;
const mockedDeleteOutbox = deleteOutboxByObjectId as jest.MockedFunction<typeof deleteOutboxByObjectId>;
const mockedGetCurrentOutboxSession = getCurrentOutboxSession as jest.MockedFunction<typeof getCurrentOutboxSession>;
const databaseIds = new Set<string>();

/** Drains the promise chain the page walk runs on, without advancing timers. */
function flushPendingWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

// Version 4 / variant 10xx bytes, so decodeRowId can stringify them.
const VALID_ROW_ID_BYTES = Uint8Array.from([
  0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x47, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
]);
const VALID_ROW_ID = '11223344-5566-4788-99aa-bbccddeeff00';
const SECOND_VALID_ROW_ID_BYTES = Uint8Array.from([
  0x21, 0x22, 0x33, 0x44, 0x55, 0x66, 0x47, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01,
]);
const SECOND_VALID_ROW_ID = '21223344-5566-4788-99aa-bbccddeeff01';

/**
 * A page whose row is well-formed enough to reach IndexedDB, so that failing the
 * collab open below makes the page's persist fail rather than skip.
 */
function persistablePage(
  rid: { timestamp: number; seqNo: number },
  page: {
    hasMore?: boolean;
    nextCursor?: Uint8Array;
  } = {}
) {
  return database_blob.DatabaseBlobDiffResponse.create({
    status: database_blob.DiffStatus.READY,
    creates: [
      {
        rowId: VALID_ROW_ID_BYTES,
        rid,
        docState: { docState: new Uint8Array([1, 2, 3]), encoderVersion: 1 },
      },
    ],
    updates: [],
    deletes: [],
    page: {
      hasMore: page.hasMore ?? false,
      nextCursor: page.nextCursor ?? new Uint8Array(),
      restartRequired: false,
    },
  });
}

function deletePage(
  rid: { timestamp: number; seqNo: number },
  options: {
    rowId?: Uint8Array;
    hasMore?: boolean;
    nextCursor?: Uint8Array;
  } = {}
) {
  return database_blob.DatabaseBlobDiffResponse.create({
    status: database_blob.DiffStatus.READY,
    creates: [],
    updates: [],
    deletes: [
      {
        rowId: options.rowId ?? VALID_ROW_ID_BYTES,
        rid,
      },
    ],
    page: {
      hasMore: options.hasMore ?? false,
      nextCursor: options.nextCursor ?? new Uint8Array(),
      restartRequired: false,
    },
  });
}

describe('database blob prefetch deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockedDeleteCollabDB.mockResolvedValue(true);
    mockedDeleteOutbox.mockResolvedValue(undefined);
    mockedGetCurrentOutboxSession.mockImplementation((workspaceId) => ({
      userId: 'user-1',
      workspaceId: workspaceId ?? 'workspace-1',
    }));
    mockedOpenRowCollabDB.mockResolvedValue({
      doc: { destroy: jest.fn() },
      provider: { destroy: jest.fn().mockResolvedValue(undefined) },
    } as unknown as Awaited<ReturnType<typeof openRowCollabDBWithProvider>>);
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
        persistablePage(
          { timestamp: 20, seqNo: 1 },
          {
            hasMore: true,
            nextCursor,
          }
        )
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
    expect(mockedOpenRowCollabDB).not.toHaveBeenCalled();

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
    const abandonedPage = persistablePage(
      { timestamp: 99, seqNo: 0 },
      {
        hasMore: true,
        nextCursor,
      }
    );
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
    expect(mockedOpenRowCollabDB).not.toHaveBeenCalled();
  });

  it('withholds delta seeds and persistence until the terminal page', async () => {
    const workspaceId = 'workspace-stream-delta';
    const databaseId = 'database-stream-delta';
    const onSeedsReady = jest.fn();
    const finalPage = createDeferred<database_blob.DatabaseBlobDiffResponse>();

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff
      .mockResolvedValueOnce(
        persistablePage(
          { timestamp: 400, seqNo: 1 },
          {
            hasMore: true,
            nextCursor: new Uint8Array([1]),
          }
        )
      )
      .mockReturnValueOnce(finalPage.promise);

    const prefetch = prefetchDatabaseBlobDiff(workspaceId, databaseId, { onSeedsReady });

    await flushPendingWork();

    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(2);
    expect(onSeedsReady).not.toHaveBeenCalled();
    expect(mockedOpenRowCollabDB).not.toHaveBeenCalled();

    finalPage.resolve(readyDiff());
    await prefetch;

    expect(onSeedsReady).toHaveBeenCalledTimes(1);
    expect(mockedOpenRowCollabDB).toHaveBeenCalledTimes(1);
  });

  it('withholds full-sync seeds until the terminal page', async () => {
    const workspaceId = 'workspace-stream-full';
    const databaseId = 'database-stream-full';
    const onSeedsReady = jest.fn();
    const finalPage = createDeferred<database_blob.DatabaseBlobDiffResponse>();

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff
      .mockResolvedValueOnce(pageDiff({ hasMore: true, nextCursor: new Uint8Array([1]) }))
      .mockReturnValueOnce(finalPage.promise);

    const prefetch = prefetchDatabaseBlobDiff(workspaceId, databaseId, {
      forceFullSync: true,
      onSeedsReady,
    });

    await flushPendingWork();

    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(2);
    expect(onSeedsReady).not.toHaveBeenCalled();

    finalPage.resolve(readyDiff());
    await prefetch;

    expect(onSeedsReady).toHaveBeenCalledTimes(1);
  });

  it('rejects a final page that carries a continuation cursor', async () => {
    const databaseId = 'database-final-cursor';

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff.mockResolvedValueOnce(pageDiff({ hasMore: false, nextCursor: new Uint8Array([1]) }));

    await expect(prefetchDatabaseBlobDiff('workspace-final-cursor', databaseId)).rejects.toThrow(
      'final page contained a continuation cursor'
    );
    expect(localStorage.getItem(`af_database_blob_rid:${databaseId}`)).toBeNull();
  });

  it('rejects a non-final page that omits its continuation cursor', async () => {
    const databaseId = 'database-missing-cursor';

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff.mockResolvedValueOnce(pageDiff({ hasMore: true, nextCursor: new Uint8Array() }));

    await expect(prefetchDatabaseBlobDiff('workspace-missing-cursor', databaseId)).rejects.toThrow(
      'non-final page omitted its continuation cursor'
    );
  });

  it('rejects a repeated continuation cursor', async () => {
    const databaseId = 'database-repeated-cursor';
    const repeatedCursor = new Uint8Array([5]);

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff
      .mockResolvedValueOnce(pageDiff({ hasMore: true, nextCursor: repeatedCursor }))
      .mockResolvedValueOnce(pageDiff({ hasMore: true, nextCursor: repeatedCursor }));

    await expect(prefetchDatabaseBlobDiff('workspace-repeated-cursor', databaseId)).rejects.toThrow(
      'server repeated a continuation cursor'
    );
    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(2);
  });

  it('falls back to row sync once restarts are exhausted', async () => {
    const workspaceId = 'workspace-restart-loop';
    const databaseId = 'database-restart-loop';
    const onSeedsReady = jest.fn();
    const restartResponse = pageDiff({ restartRequired: true });

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff
      .mockResolvedValueOnce(restartResponse)
      .mockResolvedValueOnce(restartResponse)
      .mockResolvedValueOnce(restartResponse);

    const result = await prefetchDatabaseBlobDiff(workspaceId, databaseId, { onSeedsReady });

    expect(result).toBe(restartResponse);
    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem(`af_database_blob_rid:${databaseId}`)).toBeNull();
    expect(onSeedsReady).toHaveBeenCalledTimes(1);

    // An exhausted walk holds no complete seed set, so it must not be reused.
    mockedDatabaseBlobDiff.mockResolvedValueOnce(readyDiff());
    await prefetchDatabaseBlobDiff(workspaceId, databaseId, { forceFullSync: true });

    expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(4);
  });

  it('leaves the RID unadvanced when a page fails to persist', async () => {
    const workspaceId = 'workspace-persist-failure';
    const databaseId = 'database-persist-failure';

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff.mockResolvedValueOnce(persistablePage({ timestamp: 500, seqNo: 4 }));
    mockedOpenRowCollabDB.mockRejectedValueOnce(new Error('indexeddb unavailable'));

    await prefetchDatabaseBlobDiff(workspaceId, databaseId);

    expect(mockedOpenRowCollabDB).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`af_database_blob_rid:${databaseId}`)).toBeNull();
  });

  it('advances the RID when the same page persists cleanly', async () => {
    const workspaceId = 'workspace-persist-success';
    const databaseId = 'database-persist-success';

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff.mockResolvedValueOnce(persistablePage({ timestamp: 500, seqNo: 4 }));
    mockedOpenRowCollabDB.mockResolvedValueOnce({
      doc: { destroy: jest.fn() },
      provider: { destroy: jest.fn().mockResolvedValue(undefined) },
    } as unknown as Awaited<ReturnType<typeof openRowCollabDBWithProvider>>);

    await prefetchDatabaseBlobDiff(workspaceId, databaseId);

    expect(JSON.parse(localStorage.getItem(`af_database_blob_rid:${databaseId}`) ?? 'null')).toEqual({
      timestamp: 500,
      seqNo: 4,
    });
  });

  it('applies an authoritative row tombstone before advancing the RID', async () => {
    const databaseId = 'database-delete-success';

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff.mockResolvedValueOnce(deletePage({ timestamp: 600, seqNo: 2 }));

    await prefetchDatabaseBlobDiff('workspace-delete-success', databaseId);

    expect(mockedDeleteOutbox).toHaveBeenCalledWith(VALID_ROW_ID, {
      session: { userId: 'user-1', workspaceId: 'workspace-delete-success' },
    });
    expect(mockedDeleteCollabDB).toHaveBeenCalledWith(VALID_ROW_ID, { destroyDoc: false });
    expect(mockedDeleteCollabDB).toHaveBeenCalledWith(`${databaseId}_rows_${VALID_ROW_ID}`);
    expect(mockedDeleteRow).toHaveBeenCalledWith(`${databaseId}_rows_${VALID_ROW_ID}`);
    expect(JSON.parse(localStorage.getItem(`af_database_blob_rid:${databaseId}`) ?? 'null')).toEqual({
      timestamp: 600,
      seqNo: 2,
    });
  });

  it('does not apply a non-terminal row tombstone', async () => {
    const databaseId = 'database-delete-terminal-gate';
    const terminalPage = createDeferred<database_blob.DatabaseBlobDiffResponse>();

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff
      .mockResolvedValueOnce(
        deletePage(
          { timestamp: 700, seqNo: 1 },
          {
            hasMore: true,
            nextCursor: new Uint8Array([4]),
          }
        )
      )
      .mockReturnValueOnce(terminalPage.promise);

    const prefetch = prefetchDatabaseBlobDiff('workspace-delete-terminal-gate', databaseId);

    await flushPendingWork();

    expect(mockedDeleteOutbox).not.toHaveBeenCalled();
    expect(mockedDeleteCollabDB).not.toHaveBeenCalled();
    expect(mockedDeleteRow).not.toHaveBeenCalled();

    terminalPage.resolve(readyDiff());
    await prefetch;

    expect(mockedDeleteCollabDB).toHaveBeenCalledTimes(2);
    expect(mockedDeleteRow).toHaveBeenCalledTimes(1);
  });

  it('uses the session captured before a paged tombstone finishes', async () => {
    const workspaceId = 'workspace-origin';
    const databaseId = 'database-delete-session-scope';
    const originSession = { userId: 'user-1', workspaceId };
    const terminalPage = createDeferred<database_blob.DatabaseBlobDiffResponse>();

    databaseIds.add(databaseId);
    mockedGetCurrentOutboxSession.mockReturnValueOnce(originSession);
    mockedDatabaseBlobDiff
      .mockResolvedValueOnce(
        deletePage(
          { timestamp: 750, seqNo: 1 },
          {
            hasMore: true,
            nextCursor: new Uint8Array([5]),
          }
        )
      )
      .mockReturnValueOnce(terminalPage.promise);

    const prefetch = prefetchDatabaseBlobDiff(workspaceId, databaseId);

    await flushPendingWork();
    mockedGetCurrentOutboxSession.mockReturnValue({ userId: 'user-1', workspaceId: 'workspace-replacement' });
    terminalPage.resolve(readyDiff());
    await prefetch;

    expect(mockedGetCurrentOutboxSession).toHaveBeenCalledTimes(1);
    expect(mockedDeleteOutbox).toHaveBeenCalledWith(VALID_ROW_ID, { session: originSession });
  });

  it('leaves the RID unchanged when a row tombstone cannot be persisted', async () => {
    const databaseId = 'database-delete-failure';
    const cachedRid = { timestamp: 10, seqNo: 3 };

    databaseIds.add(databaseId);
    localStorage.setItem(`af_database_blob_rid:${databaseId}`, JSON.stringify(cachedRid));
    mockedDatabaseBlobDiff.mockResolvedValueOnce(deletePage({ timestamp: 800, seqNo: 5 }));
    mockedDeleteCollabDB.mockResolvedValueOnce(false);

    await prefetchDatabaseBlobDiff('workspace-delete-failure', databaseId);

    expect(mockedDeleteRow).toHaveBeenCalledWith(`${databaseId}_rows_${VALID_ROW_ID}`);
    expect(JSON.parse(localStorage.getItem(`af_database_blob_rid:${databaseId}`) ?? 'null')).toEqual(cachedRid);
  });

  it('leaves the RID unchanged when legacy row storage cannot be deleted', async () => {
    const databaseId = 'database-legacy-delete-failure';

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff.mockResolvedValueOnce(deletePage({ timestamp: 850, seqNo: 1 }));
    mockedDeleteCollabDB.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await prefetchDatabaseBlobDiff('workspace-legacy-delete-failure', databaseId);

    expect(mockedDeleteCollabDB).toHaveBeenNthCalledWith(1, VALID_ROW_ID, { destroyDoc: false });
    expect(mockedDeleteCollabDB).toHaveBeenNthCalledWith(2, `${databaseId}_rows_${VALID_ROW_ID}`);
    expect(localStorage.getItem(`af_database_blob_rid:${databaseId}`)).toBeNull();
  });

  it('waits for every tombstone in a failed delete batch to settle', async () => {
    const databaseId = 'database-delete-batch-failure';
    const delayedDelete = createDeferred<boolean>();
    let settled = false;

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff.mockResolvedValueOnce(
      database_blob.DatabaseBlobDiffResponse.create({
        status: database_blob.DiffStatus.READY,
        creates: [],
        updates: [],
        deletes: [
          {
            rowId: VALID_ROW_ID_BYTES,
            rid: { timestamp: 875, seqNo: 1 },
          },
          {
            rowId: SECOND_VALID_ROW_ID_BYTES,
            rid: { timestamp: 875, seqNo: 2 },
          },
        ],
        page: {
          hasMore: false,
          nextCursor: new Uint8Array(),
          restartRequired: false,
        },
      })
    );
    mockedDeleteCollabDB.mockImplementation((name) => {
      if (name === VALID_ROW_ID) return Promise.reject(new Error('current row delete failed'));
      if (name === SECOND_VALID_ROW_ID) return delayedDelete.promise;
      return Promise.resolve(true);
    });

    const prefetch = prefetchDatabaseBlobDiff('workspace-delete-batch-failure', databaseId).finally(() => {
      settled = true;
    });

    await flushPendingWork();

    expect(settled).toBe(false);
    expect(mockedDeleteCollabDB).toHaveBeenCalledWith(SECOND_VALID_ROW_ID, { destroyDoc: false });

    delayedDelete.resolve(true);
    await prefetch;

    expect(settled).toBe(true);
    expect(mockedDeleteRow).toHaveBeenCalledWith(`${databaseId}_rows_${VALID_ROW_ID}`);
    expect(mockedDeleteRow).toHaveBeenCalledWith(`${databaseId}_rows_${SECOND_VALID_ROW_ID}`);
    expect(localStorage.getItem(`af_database_blob_rid:${databaseId}`)).toBeNull();
  });

  it('does not advance the RID for a malformed row tombstone', async () => {
    const databaseId = 'database-delete-invalid';

    databaseIds.add(databaseId);
    mockedDatabaseBlobDiff.mockResolvedValueOnce(
      deletePage(
        { timestamp: 900, seqNo: 1 },
        {
          rowId: new Uint8Array([1, 2, 3]),
        }
      )
    );

    await prefetchDatabaseBlobDiff('workspace-delete-invalid', databaseId);

    expect(mockedDeleteCollabDB).not.toHaveBeenCalled();
    expect(localStorage.getItem(`af_database_blob_rid:${databaseId}`)).toBeNull();
  });
});
