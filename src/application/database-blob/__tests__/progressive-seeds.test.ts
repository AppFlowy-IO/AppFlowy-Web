import { parse as uuidParse } from 'uuid';
import * as Y from 'yjs';

import {
  clearDatabaseRowDocSeedCache,
  getDatabaseRowDocFromSeed,
  invalidateDatabaseRowDocSeed,
  peekDatabaseRowDocSeed,
  prefetchDatabaseBlobDiff,
  releaseDatabaseRowDocSeedCache,
  retainDatabaseRowDocSeedCache,
  ROW_DOC_SEED_CACHE_RELEASE_GRACE_MS,
} from '@/application/database-blob';
import { hasRowConditionData } from '@/application/database-yjs/condition-value-cache';
import { openRowCollabDBWithProvider } from '@/application/db';
import { databaseBlobDiff } from '@/application/services/js-services/http/http_api';
import { emit, EventType } from '@/application/session/event';
import { YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { database_blob } from '@/proto/database_blob';

jest.mock('@/application/db', () => ({
  captureDatabaseStorageFence: jest.fn(async (databaseId: string) => ({ databaseId, epoch: null, cacheEpoch: null })),
  rotateDatabaseStorageFence: jest.fn(),
  publishWithDatabaseStorageFence: jest.fn(async (_fence: unknown, publish: () => void) => {
    publish();
    return true;
  }),
  deleteCollabDB: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  getCachedRowProvider: jest.fn(),
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

jest.mock('@/utils/log', () => ({
  Log: {
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockedDatabaseBlobDiff = databaseBlobDiff as jest.MockedFunction<typeof databaseBlobDiff>;
const mockedOpenRowCollabDB = openRowCollabDBWithProvider as jest.MockedFunction<typeof openRowCollabDBWithProvider>;
const databaseIds = new Set<string>();
const retainedDatabaseIds: string[] = [];

function retain(databaseId: string) {
  retainedDatabaseIds.push(databaseId);
  retainDatabaseRowDocSeedCache(databaseId);
}

function release(databaseId: string) {
  retainedDatabaseIds.splice(retainedDatabaseIds.indexOf(databaseId), 1);
  releaseDatabaseRowDocSeedCache(databaseId);
}

const FIRST_ROW_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ROW_ID = '22222222-2222-4222-8222-222222222222';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

/** Drains the promise chain the page walk runs on. */
async function flushPendingWork() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function rowState(rowId: string, department: string) {
  const doc = new Y.Doc();
  const row = new Y.Map();

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database_row, row);
  row.set(YjsDatabaseKey.id, rowId);
  row.set('department', department);
  const docState = Y.encodeStateAsUpdate(doc);

  doc.destroy();
  return docState;
}

function rowPage(
  rows: Array<{ rowId: string; department: string }>,
  page: { hasMore?: boolean; nextCursor?: Uint8Array; restartRequired?: boolean; rid?: number } = {}
) {
  return database_blob.DatabaseBlobDiffResponse.create({
    status: database_blob.DiffStatus.READY,
    creates: rows.map(({ rowId, department }, index) => ({
      rowId: uuidParse(rowId),
      rid: { timestamp: page.rid ?? 100 + index, seqNo: 1 },
      docState: { docState: rowState(rowId, department), encoderVersion: 1 },
    })),
    updates: [],
    deletes: [],
    page: {
      hasMore: page.hasMore ?? false,
      nextCursor: page.nextCursor ?? new Uint8Array(),
      restartRequired: false,
    },
  });
}

function restartPage() {
  return database_blob.DatabaseBlobDiffResponse.create({
    status: database_blob.DiffStatus.READY,
    creates: [],
    updates: [],
    deletes: [],
    page: { hasMore: false, nextCursor: new Uint8Array(), restartRequired: true },
  });
}

function readDepartment(rowKey: string) {
  const doc = getDatabaseRowDocFromSeed(rowKey);
  const row = doc?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<unknown> | undefined;

  return row?.get('department');
}

describe('database blob seeds for filter and sort', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockedOpenRowCollabDB.mockImplementation(async () => {
      return {
        doc: new Y.Doc(),
        provider: {
          destroy: jest.fn().mockResolvedValue(undefined),
          whenPersisted: jest.fn().mockResolvedValue(undefined),
        },
      } as unknown as Awaited<ReturnType<typeof openRowCollabDBWithProvider>>;
    });
  });

  afterEach(() => {
    retainedDatabaseIds.splice(0).forEach(releaseDatabaseRowDocSeedCache);
    databaseIds.forEach(clearDatabaseRowDocSeedCache);
    databaseIds.clear();
    jest.useRealTimers();
  });

  describe('provisional pages', () => {
    it('lets filter and sort read the rows of a page before the terminal page commits the walk', async () => {
      const databaseId = 'database-provisional';
      const firstRowKey = `${databaseId}_rows_${FIRST_ROW_ID}`;
      const secondRowKey = `${databaseId}_rows_${SECOND_ROW_ID}`;
      const finalPage = createDeferred<database_blob.DatabaseBlobDiffResponse>();
      const onSeedsProgress = jest.fn();
      const onSeedsReady = jest.fn();

      databaseIds.add(databaseId);
      mockedDatabaseBlobDiff
        .mockResolvedValueOnce(
          rowPage([{ rowId: FIRST_ROW_ID, department: 'HR' }], { hasMore: true, nextCursor: new Uint8Array([1]) })
        )
        .mockReturnValueOnce(finalPage.promise);

      const prefetch = prefetchDatabaseBlobDiff('workspace', databaseId, {
        forceFullSync: true,
        onSeedsProgress,
        onSeedsReady,
      });

      await flushPendingWork();

      expect(onSeedsProgress).toHaveBeenCalledTimes(1);
      expect(onSeedsReady).not.toHaveBeenCalled();
      // The provisional row is readable for conditions only: it is neither a
      // committed seed that row loaders open nor persisted to row storage.
      expect(readDepartment(firstRowKey)).toBe('HR');
      expect(peekDatabaseRowDocSeed(firstRowKey)).toBeNull();
      expect(mockedOpenRowCollabDB).not.toHaveBeenCalled();
      expect(getDatabaseRowDocFromSeed(secondRowKey)).toBeNull();

      const provisionalDoc = getDatabaseRowDocFromSeed(firstRowKey);
      const destroyed = jest.fn();

      provisionalDoc?.on('destroy', destroyed);
      finalPage.resolve(rowPage([{ rowId: SECOND_ROW_ID, department: 'Sales' }], { rid: 200 }));
      await prefetch;

      expect(onSeedsReady).toHaveBeenCalledTimes(1);
      // The terminal page confirms the doc the provisional page built.
      expect(destroyed).not.toHaveBeenCalled();
      expect(getDatabaseRowDocFromSeed(firstRowKey)).toBe(provisionalDoc);
      expect(peekDatabaseRowDocSeed(firstRowKey)).not.toBeNull();
      expect(readDepartment(secondRowKey)).toBe('Sales');
      expect(mockedOpenRowCollabDB).toHaveBeenCalledTimes(2);
    });

    it('drops provisional rows when the page walk restarts and reads the replacement walk', async () => {
      const databaseId = 'database-provisional-restart';
      const firstRowKey = `${databaseId}_rows_${FIRST_ROW_ID}`;
      const restart = createDeferred<database_blob.DatabaseBlobDiffResponse>();
      const replacementFinal = createDeferred<database_blob.DatabaseBlobDiffResponse>();
      const onSeedsProgress = jest.fn();

      databaseIds.add(databaseId);
      mockedDatabaseBlobDiff
        .mockResolvedValueOnce(
          rowPage([{ rowId: FIRST_ROW_ID, department: 'HR' }], { hasMore: true, nextCursor: new Uint8Array([1]) })
        )
        .mockReturnValueOnce(restart.promise)
        .mockResolvedValueOnce(
          rowPage([{ rowId: FIRST_ROW_ID, department: 'Finance' }], { hasMore: true, nextCursor: new Uint8Array([2]) })
        )
        .mockReturnValueOnce(replacementFinal.promise);

      const prefetch = prefetchDatabaseBlobDiff('workspace', databaseId, { forceFullSync: true, onSeedsProgress });

      await flushPendingWork();
      const provisionalDoc = getDatabaseRowDocFromSeed(firstRowKey);
      const destroyed = jest.fn();

      expect(hasRowConditionData(provisionalDoc)).toBe(true);
      provisionalDoc?.on('destroy', destroyed);

      restart.resolve(restartPage());
      await flushPendingWork();

      expect(destroyed).toHaveBeenCalledTimes(1);
      // Dropped, then the first page of the replacement walk.
      expect(onSeedsProgress).toHaveBeenCalledTimes(3);
      expect(readDepartment(firstRowKey)).toBe('Finance');
      expect(getDatabaseRowDocFromSeed(firstRowKey)).not.toBe(provisionalDoc);

      replacementFinal.resolve(rowPage([], { rid: 300 }));
      await prefetch;

      expect(readDepartment(firstRowKey)).toBe('Finance');
      expect(peekDatabaseRowDocSeed(firstRowKey)).not.toBeNull();
    });

    it('drops provisional rows when the walk cannot finish', async () => {
      jest.useFakeTimers();
      const databaseId = 'database-provisional-pending';
      const firstRowKey = `${databaseId}_rows_${FIRST_ROW_ID}`;
      const pendingPage = database_blob.DatabaseBlobDiffResponse.create({
        status: database_blob.DiffStatus.PENDING,
        retryAfterSecs: 1,
        page: { hasMore: true, nextCursor: new Uint8Array([1]), restartRequired: false },
      });
      const onSeedsReady = jest.fn();

      databaseIds.add(databaseId);
      mockedDatabaseBlobDiff
        .mockResolvedValueOnce(
          rowPage([{ rowId: FIRST_ROW_ID, department: 'HR' }], { hasMore: true, nextCursor: new Uint8Array([1]) })
        )
        .mockResolvedValueOnce(pendingPage)
        .mockResolvedValueOnce(pendingPage);

      const prefetch = prefetchDatabaseBlobDiff('workspace', databaseId, { forceFullSync: true, onSeedsReady });

      await jest.advanceTimersByTimeAsync(0);
      const provisionalDoc = getDatabaseRowDocFromSeed(firstRowKey);
      const destroyed = jest.fn();

      provisionalDoc?.on('destroy', destroyed);
      await jest.advanceTimersByTimeAsync(1000);
      await prefetch;

      expect(onSeedsReady).toHaveBeenCalledTimes(1);
      expect(destroyed).toHaveBeenCalledTimes(1);
      expect(getDatabaseRowDocFromSeed(firstRowKey)).toBeNull();
      expect(mockedOpenRowCollabDB).not.toHaveBeenCalled();
    });

    it('keeps a reset row out of the provisional rows of a walk in flight', async () => {
      const databaseId = 'database-provisional-reset';
      const firstRowKey = `${databaseId}_rows_${FIRST_ROW_ID}`;
      const finalPage = createDeferred<database_blob.DatabaseBlobDiffResponse>();

      databaseIds.add(databaseId);
      mockedDatabaseBlobDiff
        .mockResolvedValueOnce(
          rowPage([{ rowId: FIRST_ROW_ID, department: 'HR' }], { hasMore: true, nextCursor: new Uint8Array([1]) })
        )
        .mockReturnValueOnce(finalPage.promise);

      const prefetch = prefetchDatabaseBlobDiff('workspace', databaseId, { forceFullSync: true });

      await flushPendingWork();
      expect(readDepartment(firstRowKey)).toBe('HR');

      invalidateDatabaseRowDocSeed(FIRST_ROW_ID);
      expect(getDatabaseRowDocFromSeed(firstRowKey)).toBeNull();

      finalPage.resolve(rowPage([], { rid: 400 }));
      await prefetch;
      expect(getDatabaseRowDocFromSeed(firstRowKey)).toBeNull();
    });
  });

  describe('released seed cache', () => {
    it('reuses the settled seeds of a database released within the grace period', async () => {
      jest.useFakeTimers();
      const databaseId = 'database-grace';
      const firstRowKey = `${databaseId}_rows_${FIRST_ROW_ID}`;
      const onSeedsReady = jest.fn();

      databaseIds.add(databaseId);
      mockedDatabaseBlobDiff.mockResolvedValueOnce(rowPage([{ rowId: FIRST_ROW_ID, department: 'HR' }]));

      // The source grid: an unfiltered view walks the cold delta, which covers the full snapshot.
      retain(databaseId);
      await prefetchDatabaseBlobDiff('workspace', databaseId);
      release(databaseId);

      await jest.advanceTimersByTimeAsync(ROW_DOC_SEED_CACHE_RELEASE_GRACE_MS - 1000);

      // A filtered dashboard widget on the same database mounts next.
      retain(databaseId);
      const reuse = prefetchDatabaseBlobDiff('workspace', databaseId, { forceFullSync: true, onSeedsReady });

      await jest.advanceTimersByTimeAsync(0);
      await reuse;

      expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(1);
      expect(onSeedsReady).toHaveBeenCalledTimes(1);
      expect(readDepartment(firstRowKey)).toBe('HR');

      // Retained again, the seeds outlive the original grace period.
      await jest.advanceTimersByTimeAsync(ROW_DOC_SEED_CACHE_RELEASE_GRACE_MS);
      expect(peekDatabaseRowDocSeed(firstRowKey)).not.toBeNull();
    });

    it('clears the seeds of a released database once the grace period ends', async () => {
      jest.useFakeTimers();
      const databaseId = 'database-grace-expired';
      const firstRowKey = `${databaseId}_rows_${FIRST_ROW_ID}`;

      databaseIds.add(databaseId);
      mockedDatabaseBlobDiff
        .mockResolvedValueOnce(rowPage([{ rowId: FIRST_ROW_ID, department: 'HR' }]))
        .mockResolvedValueOnce(rowPage([{ rowId: FIRST_ROW_ID, department: 'HR' }]));

      retain(databaseId);
      await prefetchDatabaseBlobDiff('workspace', databaseId);
      const seedDoc = getDatabaseRowDocFromSeed(firstRowKey);
      const destroyed = jest.fn();

      seedDoc?.on('destroy', destroyed);
      release(databaseId);

      await jest.advanceTimersByTimeAsync(ROW_DOC_SEED_CACHE_RELEASE_GRACE_MS - 1);
      expect(peekDatabaseRowDocSeed(firstRowKey)).not.toBeNull();

      await jest.advanceTimersByTimeAsync(1);
      expect(peekDatabaseRowDocSeed(firstRowKey)).toBeNull();
      expect(destroyed).toHaveBeenCalledTimes(1);

      retain(databaseId);
      const refetch = prefetchDatabaseBlobDiff('workspace', databaseId, { forceFullSync: true });

      await jest.advanceTimersByTimeAsync(0);
      await refetch;
      expect(mockedDatabaseBlobDiff).toHaveBeenCalledTimes(2);
    });

    it('keeps only the most recently released databases during the grace period', async () => {
      jest.useFakeTimers();
      const released = ['database-lru-1', 'database-lru-2', 'database-lru-3'];

      for (const databaseId of released) {
        databaseIds.add(databaseId);
        mockedDatabaseBlobDiff.mockResolvedValueOnce(rowPage([{ rowId: FIRST_ROW_ID, department: 'HR' }]));
        retain(databaseId);
        await prefetchDatabaseBlobDiff('workspace', databaseId);
      }

      released.forEach(release);

      expect(
        released.map((databaseId) => peekDatabaseRowDocSeed(`${databaseId}_rows_${FIRST_ROW_ID}`) !== null)
      ).toEqual([false, true, true]);
    });

    it('clears released seeds on sign-out and skips the grace period until the next sign-in', async () => {
      jest.useFakeTimers();
      const [releasedBefore, openAtSignOut, nextAccount] = ['database-signed-out', 'database-open', 'database-next'];
      const hasSeeds = (databaseId: string) => peekDatabaseRowDocSeed(`${databaseId}_rows_${FIRST_ROW_ID}`) !== null;

      for (const databaseId of [releasedBefore, openAtSignOut, nextAccount]) {
        databaseIds.add(databaseId);
        mockedDatabaseBlobDiff.mockResolvedValueOnce(rowPage([{ rowId: FIRST_ROW_ID, department: 'HR' }]));
        retain(databaseId);
        await prefetchDatabaseBlobDiff('workspace', databaseId);
      }

      release(releasedBefore);
      expect(hasSeeds(releasedBefore)).toBe(true);

      emit(EventType.SESSION_INVALID);
      expect(hasSeeds(releasedBefore)).toBe(false);
      // A view still mounted keeps its seeds; it unmounts after the event.
      expect(hasSeeds(openAtSignOut)).toBe(true);
      release(openAtSignOut);
      expect(hasSeeds(openAtSignOut)).toBe(false);

      emit(EventType.SESSION_VALID);
      release(nextAccount);
      expect(hasSeeds(nextAccount)).toBe(true);
    });
  });
});
