import { expect } from '@jest/globals';
import * as Y from 'yjs';

import { dashboardLoadStats } from '@/application/database-yjs/dashboard-load-stats';
import {
  captureDatabaseStorageFence,
  deleteCollabDB,
  getCachedProviderDoc,
  openCollabDB,
  openCollabDBWithProvider,
} from '@/application/db';
import { invalidateViewCache } from '@/application/services/js-services/cached-api';
import { fetchDatabaseCollab, fetchPageCollab } from '@/application/services/js-services/fetch';
import { ViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { isDatabaseViewNotFoundError, openView } from '@/application/view-loader';

jest.mock('@/application/db', () => ({
  openCollabDB: jest.fn(),
  openCollabDBWithProvider: jest.fn(),
  deleteCollabDB: jest.fn(),
  captureDatabaseStorageFence: jest.fn(),
  getCachedProviderDoc: jest.fn(),
}));

jest.mock('@/application/services/js-services/cached-api', () => ({
  invalidateViewCache: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  getOrCreateRowSubDoc: jest.fn(),
  hasCollabCache: jest.fn((doc: YDoc) => {
    const root = doc.getMap(YjsEditorKey.data_section);

    return root.has(YjsEditorKey.database) || root.has(YjsEditorKey.document);
  }),
}));

jest.mock('@/application/services/js-services/fetch', () => ({
  fetchDatabaseCollab: jest.fn(),
  fetchPageCollab: jest.fn(),
  fetchRowDocumentCollab: jest.fn(),
}));

jest.mock('@/application/sync-outbox', () => ({
  enqueueOutboxUpdate: jest.fn(),
}));

const mockOpenCollabDB = openCollabDB as jest.MockedFunction<typeof openCollabDB>;
const mockOpenCollabDBWithProvider = openCollabDBWithProvider as jest.MockedFunction<typeof openCollabDBWithProvider>;
const mockDeleteCollabDB = deleteCollabDB as jest.MockedFunction<typeof deleteCollabDB>;
const mockGetCachedProviderDoc = getCachedProviderDoc as jest.MockedFunction<typeof getCachedProviderDoc>;
const mockInvalidateViewCache = invalidateViewCache as jest.MockedFunction<typeof invalidateViewCache>;
const mockFetchDatabaseCollab = fetchDatabaseCollab as jest.MockedFunction<typeof fetchDatabaseCollab>;
const mockFetchPageCollab = fetchPageCollab as jest.MockedFunction<typeof fetchPageCollab>;

const workspaceId = 'workspace-id';
const NO_ACCESS = { code: 1012, message: 'user is not allowed to access this view' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/** The server's copy of a database: one history, so successive snapshots merge like real ones. */
function createServer(databaseId: string, viewIds: string[]) {
  const doc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map<unknown>();
  const fields = new Y.Map<Y.Map<unknown>>();
  const primaryField = new Y.Map<unknown>();
  const views = new Y.Map<Y.Map<unknown>>();

  primaryField.set(YjsDatabaseKey.is_primary, true);
  fields.set('primary-field', primaryField);
  viewIds.forEach((viewId) => views.set(viewId, new Y.Map()));
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  return {
    snapshot: () => ({ data: Y.encodeStateAsUpdate(doc) }),
    /** A view created on the server after an earlier snapshot was read. */
    addView: (viewId: string) => views.set(viewId, new Y.Map()),
  };
}

/** The local docs, keyed like the provider cache: an eviction destroys a doc and the next open starts fresh. */
function serveLocalDocs(names: string[]) {
  const docs = new Map<string, YDoc>(names.map((name) => [name, new Y.Doc({ guid: name }) as YDoc]));
  const open = (name: string) => {
    const doc = docs.get(name);

    if (!doc) throw new Error(`Unexpected open ${name}`);
    return doc;
  };

  mockOpenCollabDBWithProvider.mockImplementation(
    async (name: string) => ({ doc: open(name), provider: { destroy: jest.fn(), synced: true } }) as never
  );
  mockOpenCollabDB.mockImplementation(async (name: string) => open(name));
  mockGetCachedProviderDoc.mockImplementation((name: string) => docs.get(name));
  mockDeleteCollabDB.mockImplementation(async (name: string) => {
    docs.get(name)?.destroy();
    docs.set(name, new Y.Doc({ guid: name }) as YDoc);
    return true;
  });

  return docs;
}

function hasView(doc: YDoc, viewId: string) {
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;

  return (database.get(YjsDatabaseKey.views) as Y.Map<unknown>).has(viewId);
}

// Lets every concurrent open reach its cache check.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('opening a database whose id is known', () => {
  const databaseId = '00000000-0000-4000-8000-0000000000d1';
  const viewA = '00000000-0000-4000-8000-0000000000a1';
  const viewB = '00000000-0000-4000-8000-0000000000b1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchDatabaseCollab.mockReset();
    mockFetchPageCollab.mockReset();
    dashboardLoadStats.reset();
    jest.mocked(captureDatabaseStorageFence).mockImplementation(async (id) => ({
      databaseId: id,
      epoch: null,
      cacheEpoch: null,
    }));
  });

  it.each([
    ['Grid', ViewLayout.Grid],
    ['Board', ViewLayout.Board],
    ['Calendar', ViewLayout.Calendar],
    ['Chart', ViewLayout.Chart],
    ['List', ViewLayout.List],
    ['Dashboard', ViewLayout.Dashboard],
    ['an unknown layout', undefined],
  ])('fetches the database collab and never the page with its row_data (%s)', async (_name, layout) => {
    const docs = serveLocalDocs([databaseId, viewA]);

    mockFetchDatabaseCollab.mockResolvedValue(createServer(databaseId, [viewA]).snapshot());

    const result = await openView(workspaceId, viewA, layout, { databaseId });

    expect(result.doc).toBe(docs.get(databaseId));
    expect(result.fromCache).toBe(false);
    expect(hasView(result.doc, viewA)).toBe(true);
    expect(mockFetchDatabaseCollab.mock.calls).toEqual([[workspaceId, databaseId]]);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it('fetches the database collab, not the page, when the cached database lacks the view', async () => {
    const docs = serveLocalDocs([databaseId, viewA, viewB]);

    const server = createServer(databaseId, [viewA]);

    // The local cache was written before view B existed.
    Y.applyUpdate(docs.get(databaseId) as YDoc, server.snapshot().data);
    server.addView(viewB);
    mockFetchDatabaseCollab.mockResolvedValue(server.snapshot());

    const result = await openView(workspaceId, viewB, ViewLayout.Grid, { databaseId });

    expect(result.fromCache).toBe(false);
    expect(hasView(result.doc, viewB)).toBe(true);
    expect(mockFetchDatabaseCollab.mock.calls).toEqual([[workspaceId, databaseId]]);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it('shares one request between a metadata-only load and a view load of the database', async () => {
    const response = deferred<Awaited<ReturnType<typeof fetchDatabaseCollab>>>();

    serveLocalDocs([databaseId, viewA, viewB]);
    mockFetchDatabaseCollab.mockReturnValue(response.promise);

    const metadata = openView(workspaceId, viewA, undefined, { databaseId, databaseMetadataOnly: true });
    const view = openView(workspaceId, viewB, ViewLayout.Board, { databaseId });

    await settle();
    response.resolve(createServer(databaseId, [viewA, viewB]).snapshot());
    await Promise.all([metadata, view]);

    expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(1);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it('still loads a view through its page while its database is not known', async () => {
    const docs = serveLocalDocs([viewA]);

    mockFetchPageCollab.mockResolvedValue({ ...createServer(databaseId, [viewA]).snapshot(), rows: {} });

    const result = await openView(workspaceId, viewA, ViewLayout.Grid);

    expect(result.doc).toBe(docs.get(viewA));
    expect(mockFetchPageCollab.mock.calls).toEqual([[workspaceId, viewA]]);
    expect(mockFetchDatabaseCollab).not.toHaveBeenCalled();
  });

  it('counts one source open for every view of the database opened on it', async () => {
    serveLocalDocs([databaseId, viewA, viewB]);
    mockFetchDatabaseCollab.mockResolvedValue(createServer(databaseId, [viewA, viewB]).snapshot());

    // Twelve widgets on two views of one database.
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        openView(workspaceId, index % 2 === 0 ? viewA : viewB, ViewLayout.Grid, { databaseId })
      )
    );

    expect(dashboardLoadStats.snapshot().sourceOpens).toEqual({ [databaseId]: 1 });
    expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(1);
  });

  describe('access errors surface per view', () => {
    it('refuses only the view whose own request was refused', async () => {
      const response = deferred<Awaited<ReturnType<typeof fetchDatabaseCollab>>>();
      const docs = serveLocalDocs([databaseId, viewA, viewB]);
      const refusedDoc = docs.get(databaseId);

      // Access is granted between the two requests.
      mockFetchDatabaseCollab
        .mockReturnValueOnce(response.promise)
        .mockResolvedValue(createServer(databaseId, [viewA, viewB]).snapshot());

      const first = openView(workspaceId, viewA, ViewLayout.Grid, { databaseId });
      const second = openView(workspaceId, viewB, ViewLayout.Grid, { databaseId });
      const firstRejection = expect(first).rejects.toMatchObject({ code: 1012 });

      await settle();
      response.reject(NO_ACCESS);
      await firstRejection;
      const resultB = await second;

      // The refusal evicted what view A's request loaded into; view B asked for itself.
      expect(mockDeleteCollabDB).toHaveBeenCalledWith(databaseId, { destroyDoc: true });
      expect(mockInvalidateViewCache.mock.calls).toEqual([[workspaceId, viewA]]);
      expect(resultB.doc).not.toBe(refusedDoc);
      expect(hasView(resultB.doc, viewB)).toBe(true);
      expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(2);
      expect(mockFetchPageCollab).not.toHaveBeenCalled();
    });

    it('reports no access to every view when each of their requests is refused', async () => {
      serveLocalDocs([databaseId, viewA, viewB]);
      mockFetchDatabaseCollab.mockRejectedValue(NO_ACCESS);

      const results = await Promise.allSettled([
        openView(workspaceId, viewA, ViewLayout.Grid, { databaseId }),
        openView(workspaceId, viewB, ViewLayout.Chart, { databaseId }),
      ]);

      expect(results).toEqual([
        { status: 'rejected', reason: NO_ACCESS },
        { status: 'rejected', reason: NO_ACCESS },
      ]);
      // Neither is retried, and each cleared its own cached metadata.
      expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(2);
      expect(mockInvalidateViewCache.mock.calls).toEqual([
        [workspaceId, viewA],
        [workspaceId, viewB],
      ]);
      expect(mockFetchPageCollab).not.toHaveBeenCalled();
    });

    describe('a view the database does not hold', () => {
      const NOT_FOUND = { code: -2, message: 'Record not found' };

      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('is reported not found by its own page, while its sibling opens from the same download', async () => {
        const response = deferred<Awaited<ReturnType<typeof fetchDatabaseCollab>>>();
        const docs = serveLocalDocs([databaseId, viewA, viewB]);

        mockFetchDatabaseCollab.mockReturnValue(response.promise);
        mockFetchPageCollab.mockRejectedValue(NOT_FOUND);

        // View A was deleted from the database; a widget still points at it.
        const deleted = openView(workspaceId, viewA, ViewLayout.Grid, { databaseId });
        const sibling = openView(workspaceId, viewB, ViewLayout.Grid, { databaseId });
        const deletedError = deleted.then(
          () => undefined,
          (error: unknown) => error
        );

        await jest.advanceTimersByTimeAsync(0);
        response.resolve(createServer(databaseId, [viewB]).snapshot());
        await jest.advanceTimersByTimeAsync(0);

        // The sibling does not sit out the deleted view's retries.
        await expect(sibling).resolves.toMatchObject({ doc: docs.get(databaseId) });

        await jest.runAllTimersAsync();
        const error = await deletedError;

        expect(isDatabaseViewNotFoundError(error)).toBe(true);
        // The code a page request answers a missing view with.
        expect(error).toMatchObject({ code: -2 });
        // The database is downloaded once: only the view's page is asked again,
        // and a missing view is no reason to drop the database.
        expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(1);
        expect(mockFetchPageCollab.mock.calls).toEqual([
          [workspaceId, viewA],
          [workspaceId, viewA],
          [workspaceId, viewA],
        ]);
        expect(mockDeleteCollabDB).not.toHaveBeenCalled();
      });

      it('opens once its page has it: a view the server was still writing', async () => {
        const docs = serveLocalDocs([databaseId, viewA]);

        const server = createServer(databaseId, [viewB]);

        // The database was read a moment before the new view reached it.
        mockFetchDatabaseCollab.mockResolvedValue(server.snapshot());
        server.addView(viewA);
        mockFetchPageCollab
          .mockRejectedValueOnce(NOT_FOUND)
          .mockResolvedValue({ ...server.snapshot(), rows: {} });

        const created = openView(workspaceId, viewA, ViewLayout.Grid, { databaseId, forceFetch: true });

        await jest.runAllTimersAsync();
        const result = await created;

        expect(result.doc).toBe(docs.get(databaseId));
        expect(hasView(result.doc, viewA)).toBe(true);
        expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(1);
        expect(mockFetchPageCollab).toHaveBeenCalledTimes(2);
      });

      it('is refused when its own page is refused', async () => {
        serveLocalDocs([databaseId, viewA]);
        mockFetchDatabaseCollab.mockResolvedValue(createServer(databaseId, [viewB]).snapshot());
        mockFetchPageCollab.mockRejectedValue(NO_ACCESS);

        const refused = expect(openView(workspaceId, viewA, ViewLayout.Grid, { databaseId })).rejects.toMatchObject({
          code: 1012,
        });

        await jest.runAllTimersAsync();
        await refused;

        // A refusal is not retried, and it evicts what the load wrote.
        expect(mockFetchPageCollab.mock.calls).toEqual([[workspaceId, viewA]]);
        expect(mockDeleteCollabDB).toHaveBeenCalledWith(databaseId, { destroyDoc: true });
        expect(mockInvalidateViewCache.mock.calls).toEqual([[workspaceId, viewA]]);
      });
    });
  });
});
