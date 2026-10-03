import { expect } from '@jest/globals';
import * as Y from 'yjs';

import {
  captureDatabaseStorageFence,
  deleteCollabDB,
  getCachedProviderDoc,
  openCollabDB,
  openCollabDBWithProvider,
} from '@/application/db';
import { getOrCreateRowSubDoc } from '@/application/services/js-services/cache';
import { invalidateViewCache } from '@/application/services/js-services/cached-api';
import { fetchDatabaseCollab, fetchPageCollab, fetchRowDocumentCollab } from '@/application/services/js-services/fetch';
import { enqueueOutboxUpdate } from '@/application/sync-outbox';
import { Types, ViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { getDatabaseIdFromDoc, openRowSubDocument, openView } from '@/application/view-loader';

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
const mockGetOrCreateRowSubDoc = getOrCreateRowSubDoc as jest.MockedFunction<typeof getOrCreateRowSubDoc>;
const mockFetchDatabaseCollab = fetchDatabaseCollab as jest.MockedFunction<typeof fetchDatabaseCollab>;
const mockFetchPageCollab = fetchPageCollab as jest.MockedFunction<typeof fetchPageCollab>;
const mockFetchRowDocumentCollab = fetchRowDocumentCollab as jest.MockedFunction<typeof fetchRowDocumentCollab>;
const mockEnqueueOutboxUpdate = enqueueOutboxUpdate as jest.MockedFunction<typeof enqueueOutboxUpdate>;

function createEmptyDoc(guid: string): YDoc {
  return new Y.Doc({ guid }) as YDoc;
}

function createDatabaseDoc(guid: string, databaseId = guid): YDoc {
  const doc = createEmptyDoc(guid);
  const root = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();

  database.set(YjsDatabaseKey.id, databaseId);
  root.set(YjsEditorKey.database, database);
  return doc;
}

function createCompleteDatabaseDoc(guid: string, databaseId: string, viewId: string): YDoc {
  const doc = createDatabaseDoc(guid, databaseId);
  const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
  const fields = new Y.Map<Y.Map<unknown>>();
  const primaryField = new Y.Map<unknown>();
  const views = new Y.Map<Y.Map<unknown>>();

  primaryField.set(YjsDatabaseKey.is_primary, true);
  fields.set('primary-field', primaryField);
  views.set(viewId, new Y.Map());
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  return doc;
}

function createDocumentDoc(guid: string): YDoc {
  const doc = createEmptyDoc(guid);
  const root = doc.getMap(YjsEditorKey.data_section);

  root.set(YjsEditorKey.document, new Y.Map());
  return doc;
}

function createProvider(doc: YDoc) {
  return {
    doc,
    provider: {
      destroy: jest.fn().mockResolvedValue(undefined),
      synced: true,
    },
  };
}

describe('view-loader database cache identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    jest.mocked(captureDatabaseStorageFence).mockImplementation(async (databaseId) => ({
      databaseId, epoch: null, cacheEpoch: null,
    }));
  });

  it.each(['durable epoch', 'shadow epoch', 'restore during open'])('does not migrate discarded view state after a %s', async (scenario) => {
    const viewId = '00000000-0000-4000-8000-000000000001';
    const databaseId = '00000000-0000-4000-8000-000000000002';
    const canonicalDoc = createCompleteDatabaseDoc(databaseId, databaseId, viewId);
    const legacyDoc = createEmptyDoc(viewId);

    Y.applyUpdate(legacyDoc, Y.encodeStateAsUpdate(canonicalDoc));
    const legacyDatabase = legacyDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);

    legacyDatabase.get(YjsDatabaseKey.views).set('discarded-view', new Y.Map());
    if (scenario !== 'restore during open') {
      jest.mocked(captureDatabaseStorageFence).mockResolvedValue({
        databaseId, epoch: scenario === 'durable epoch' ? 'restore-new' : null,
        cacheEpoch: scenario === 'shadow epoch' ? 'restore-new' : null,
      });
    }

    mockOpenCollabDBWithProvider.mockImplementation(async (name) => {
      if (name === databaseId) return createProvider(canonicalDoc) as never;
      if (scenario === 'restore during open') localStorage.setItem(`af_database_blob_epoch:${databaseId}`, 'restore-new');
      return createProvider(legacyDoc) as never;
    });

    const result = await openView('workspace-id', viewId, ViewLayout.Grid, { databaseId });

    expect(result.doc).toBe(canonicalDoc);
    expect(canonicalDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database)
      .get(YjsDatabaseKey.views).has('discarded-view')).toBe(false);
    expect(mockEnqueueOutboxUpdate).not.toHaveBeenCalled();
    canonicalDoc.destroy();
    legacyDoc.destroy();
  });

  it('opens database views from the canonical databaseId cache and migrates legacy viewId data', async () => {
    const viewId = '00000000-0000-4000-8000-000000000001';
    const databaseId = '00000000-0000-4000-8000-000000000002';
    const canonicalDoc = createEmptyDoc(databaseId);
    const legacyDoc = createDatabaseDoc(viewId, databaseId);
    const docs = new Map([
      [databaseId, canonicalDoc],
      [viewId, legacyDoc],
    ]);

    mockOpenCollabDBWithProvider.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return createProvider(doc) as never;
    });

    const result = await openView('workspace-id', viewId, ViewLayout.Grid, { databaseId });

    expect(result.doc).toBe(canonicalDoc);
    expect(result.fromCache).toBe(true);
    expect(result.collabType).toBe(Types.Database);
    expect(getDatabaseIdFromDoc(canonicalDoc)).toBe(databaseId);
    expect(mockOpenCollabDBWithProvider).toHaveBeenCalledWith(databaseId, { awaitSync: true });
    expect(mockOpenCollabDBWithProvider).toHaveBeenCalledWith(viewId, { skipCache: true });
    expect(mockEnqueueOutboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        objectId: databaseId,
        collabType: Types.Database,
        payload: expect.any(Uint8Array),
      })
    );
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it('opens Form views as canonical database collabs', async () => {
    const viewId = '00000000-0000-4000-8000-000000000021';
    const databaseId = '00000000-0000-4000-8000-000000000022';
    const canonicalDoc = createCompleteDatabaseDoc(databaseId, databaseId, viewId);
    const legacyDoc = createEmptyDoc(viewId);
    const docs = new Map([
      [databaseId, canonicalDoc],
      [viewId, legacyDoc],
    ]);

    mockOpenCollabDBWithProvider.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return createProvider(doc) as never;
    });

    const result = await openView('workspace-id', viewId, ViewLayout.Form, { databaseId });

    expect(result.doc).toBe(canonicalDoc);
    expect(result.collabType).toBe(Types.Database);
    expect(mockOpenCollabDBWithProvider).toHaveBeenCalledWith(databaseId, { awaitSync: true });
    expect(mockOpenCollabDB).not.toHaveBeenCalledWith(viewId);
  });

  it('fetches the database collab into the canonical databaseId cache when local cache is empty', async () => {
    const viewId = '00000000-0000-4000-8000-000000000003';
    const databaseId = '00000000-0000-4000-8000-000000000004';
    const canonicalDoc = createEmptyDoc(databaseId);
    const legacyDoc = createEmptyDoc(viewId);
    const serverDoc = createCompleteDatabaseDoc(databaseId, databaseId, viewId);
    const docs = new Map([
      [databaseId, canonicalDoc],
      [viewId, legacyDoc],
    ]);

    mockOpenCollabDBWithProvider.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return createProvider(doc) as never;
    });
    mockOpenCollabDB.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return doc;
    });
    mockFetchDatabaseCollab.mockResolvedValue({
      data: Y.encodeStateAsUpdate(serverDoc),
    });

    const result = await openView('workspace-id', viewId, ViewLayout.Grid, { databaseId });

    expect(result.doc).toBe(canonicalDoc);
    expect(result.fromCache).toBe(false);
    expect(getDatabaseIdFromDoc(canonicalDoc)).toBe(databaseId);
    // The database is known: its collab is fetched on its own, never the page with every row.
    expect(mockFetchDatabaseCollab).toHaveBeenCalledWith('workspace-id', databaseId);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it('fetches only the canonical database collab for metadata-only relation loads', async () => {
    const viewId = '00000000-0000-4000-8000-000000000013';
    const databaseId = '00000000-0000-4000-8000-000000000014';
    const canonicalDoc = createEmptyDoc(databaseId);
    const legacyDoc = createEmptyDoc(viewId);
    const serverDoc = createCompleteDatabaseDoc(databaseId, databaseId, viewId);
    const docs = new Map([
      [databaseId, canonicalDoc],
      [viewId, legacyDoc],
    ]);

    mockOpenCollabDBWithProvider.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return createProvider(doc) as never;
    });
    mockFetchDatabaseCollab.mockResolvedValue({
      data: Y.encodeStateAsUpdate(serverDoc),
    });

    const result = await openView('workspace-id', viewId, undefined, {
      databaseId,
      databaseMetadataOnly: true,
    });

    expect(result.doc).toBe(canonicalDoc);
    expect(result.fromCache).toBe(false);
    expect(getDatabaseIdFromDoc(canonicalDoc)).toBe(databaseId);
    expect(mockFetchDatabaseCollab).toHaveBeenCalledWith('workspace-id', databaseId);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it('refetches a partial canonical cache for metadata-only relation loads', async () => {
    const viewId = '00000000-0000-4000-8000-000000000015';
    const databaseId = '00000000-0000-4000-8000-000000000016';
    const canonicalDoc = createDatabaseDoc(databaseId);
    const legacyDoc = createEmptyDoc(viewId);
    const serverDoc = createCompleteDatabaseDoc(databaseId, databaseId, viewId);
    const docs = new Map([
      [databaseId, canonicalDoc],
      [viewId, legacyDoc],
    ]);

    mockOpenCollabDBWithProvider.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return createProvider(doc) as never;
    });
    mockFetchDatabaseCollab.mockResolvedValue({
      data: Y.encodeStateAsUpdate(serverDoc),
    });

    const result = await openView('workspace-id', viewId, undefined, {
      databaseId,
      databaseMetadataOnly: true,
    });

    expect(result.doc).toBe(canonicalDoc);
    expect(result.fromCache).toBe(false);
    expect(mockFetchDatabaseCollab).toHaveBeenCalledWith('workspace-id', databaseId);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it('uses the canonical databaseId cache when the database layout was discovered after the first load', async () => {
    const viewId = '00000000-0000-4000-8000-000000000005';
    const databaseId = '00000000-0000-4000-8000-000000000006';
    const canonicalDoc = createEmptyDoc(databaseId);
    const legacyDoc = createDatabaseDoc(viewId, databaseId);
    const docs = new Map([
      [databaseId, canonicalDoc],
      [viewId, legacyDoc],
    ]);

    mockOpenCollabDBWithProvider.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return createProvider(doc) as never;
    });

    const result = await openView('workspace-id', viewId, undefined, { databaseId });

    expect(result.doc).toBe(canonicalDoc);
    expect(result.fromCache).toBe(true);
    expect(getDatabaseIdFromDoc(canonicalDoc)).toBe(databaseId);
  });
});

describe('view-loader shared database fetches', () => {
  const workspaceId = 'workspace-id';

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return { promise, resolve, reject };
  }

  function serveDocs(databaseId: string, viewIds: string[]) {
    const canonicalDoc = createEmptyDoc(databaseId);
    const docs = new Map<string, YDoc>([[databaseId, canonicalDoc]]);

    viewIds.forEach((viewId) => docs.set(viewId, createEmptyDoc(viewId)));
    mockOpenCollabDBWithProvider.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return createProvider(doc) as never;
    });
    mockGetCachedProviderDoc.mockImplementation((name: string) => docs.get(name));
    // Like the provider cache: an eviction destroys the doc, and the next open
    // starts from a fresh one.
    mockDeleteCollabDB.mockImplementation(async (name: string) => {
      docs.get(name)?.destroy();
      docs.set(name, createEmptyDoc(name));
      return true;
    });
    return canonicalDoc;
  }

  // One server-side history, so successive snapshots merge like real ones.
  function createServer(databaseId: string, viewIds: string[]) {
    const doc = createCompleteDatabaseDoc(databaseId, databaseId, viewIds[0]);
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
    const views = database.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;
    const addView = (viewId: string) => views.set(viewId, new Y.Map());

    viewIds.slice(1).forEach(addView);
    return { addView, snapshot: () => ({ data: Y.encodeStateAsUpdate(doc) }) };
  }

  function hasView(doc: YDoc, viewId: string) {
    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;

    return (database.get(YjsDatabaseKey.views) as Y.Map<unknown>).has(viewId);
  }

  // Lets every concurrent open reach its cache check.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchDatabaseCollab.mockReset();
    mockFetchPageCollab.mockReset();
    mockDeleteCollabDB.mockResolvedValue(undefined);
  });

  it('downloads a database once for views of it opened together on a cold cache', async () => {
    const databaseId = '00000000-0000-4000-8000-000000000031';
    const viewA = '00000000-0000-4000-8000-000000000032';
    const viewB = '00000000-0000-4000-8000-000000000033';
    const canonicalDoc = serveDocs(databaseId, [viewA, viewB]);
    const server = createServer(databaseId, [viewA, viewB]);
    const response = deferred<Awaited<ReturnType<typeof fetchDatabaseCollab>>>();

    mockFetchDatabaseCollab.mockReturnValue(response.promise);

    const first = openView(workspaceId, viewA, ViewLayout.Grid, { databaseId });
    const second = openView(workspaceId, viewB, ViewLayout.Chart, { databaseId });

    await settle();
    response.resolve(server.snapshot());
    const [resultA, resultB] = await Promise.all([first, second]);

    expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(1);
    expect(mockFetchDatabaseCollab).toHaveBeenCalledWith(workspaceId, databaseId);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
    expect(resultA.doc).toBe(canonicalDoc);
    expect(resultB.doc).toBe(canonicalDoc);
    expect(resultB.fromCache).toBe(false);
    expect(hasView(canonicalDoc, viewB)).toBe(true);
  });

  it('fetches its own view when the shared download does not contain it', async () => {
    const databaseId = '00000000-0000-4000-8000-000000000034';
    const viewA = '00000000-0000-4000-8000-000000000035';
    const viewB = '00000000-0000-4000-8000-000000000036';
    const canonicalDoc = serveDocs(databaseId, [viewA, viewB]);
    const server = createServer(databaseId, [viewA]);
    // The shared download predates view B.
    const staleSnapshot = server.snapshot();
    const response = deferred<Awaited<ReturnType<typeof fetchDatabaseCollab>>>();

    server.addView(viewB);
    mockFetchDatabaseCollab.mockReturnValueOnce(response.promise).mockImplementation(async () => server.snapshot());

    const first = openView(workspaceId, viewA, ViewLayout.Grid, { databaseId });
    const second = openView(workspaceId, viewB, ViewLayout.Grid, { databaseId });

    await settle();
    expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(1);
    response.resolve(staleSnapshot);
    await Promise.all([first, second]);

    expect(mockFetchDatabaseCollab.mock.calls).toEqual([
      [workspaceId, databaseId],
      [workspaceId, databaseId],
    ]);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
    expect(hasView(canonicalDoc, viewB)).toBe(true);
  });

  it('keeps a failed download to its own caller and never blocks later loads', async () => {
    const databaseId = '00000000-0000-4000-8000-000000000037';
    const viewA = '00000000-0000-4000-8000-000000000038';
    const viewB = '00000000-0000-4000-8000-000000000039';
    const canonicalDoc = serveDocs(databaseId, [viewA, viewB]);
    const server = createServer(databaseId, [viewB]);
    const response = deferred<Awaited<ReturnType<typeof fetchDatabaseCollab>>>();

    mockFetchDatabaseCollab.mockReturnValueOnce(response.promise).mockImplementation(async () => server.snapshot());

    const first = openView(workspaceId, viewA, ViewLayout.Grid, { databaseId });
    const second = openView(workspaceId, viewB, ViewLayout.Grid, { databaseId });
    const firstRejection = expect(first).rejects.toMatchObject({ code: 1012 });

    await settle();
    response.reject({ code: 1012, message: 'user is not allowed to access this view' });
    await firstRejection;
    const resultB = await second;
    const freshDoc = mockGetCachedProviderDoc(databaseId);

    // The refusal destroyed the shared doc: view B loads into a fresh one
    // instead of a doc without persistence or sync.
    expect(mockDeleteCollabDB).toHaveBeenCalledWith(databaseId, { destroyDoc: true });
    expect(resultB.doc).not.toBe(canonicalDoc);
    expect(resultB.doc).toBe(freshDoc);
    expect(hasView(resultB.doc, viewB)).toBe(true);

    // A later load of the refused view asks the server again.
    server.addView(viewA);
    await expect(openView(workspaceId, viewA, ViewLayout.Grid, { databaseId })).resolves.toMatchObject({
      doc: freshDoc,
    });
    expect(mockFetchDatabaseCollab.mock.calls).toEqual([
      [workspaceId, databaseId],
      [workspaceId, databaseId],
      [workspaceId, databaseId],
    ]);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it("never holds a waiting view through the first view's retries", async () => {
    jest.useFakeTimers();

    try {
      const databaseId = '00000000-0000-4000-8000-000000000043';
      const viewA = '00000000-0000-4000-8000-000000000044';
      const viewB = '00000000-0000-4000-8000-000000000045';
      const canonicalDoc = serveDocs(databaseId, [viewA, viewB]);
      const server = createServer(databaseId, [viewA, viewB]);
      const response = deferred<Awaited<ReturnType<typeof fetchDatabaseCollab>>>();

      mockFetchDatabaseCollab.mockReturnValueOnce(response.promise).mockResolvedValue(server.snapshot());

      const first = openView(workspaceId, viewA, ViewLayout.Grid, { databaseId });
      const second = openView(workspaceId, viewB, ViewLayout.Grid, { databaseId });

      await jest.advanceTimersByTimeAsync(0);
      // A database the server has not written yet (a duplication still running):
      // the load that asked retries after a backoff.
      response.reject({ code: -2, message: 'Record not found' });
      await jest.advanceTimersByTimeAsync(0);

      expect(mockFetchDatabaseCollab.mock.calls).toEqual([
        [workspaceId, databaseId],
        [workspaceId, databaseId],
      ]);
      await expect(second).resolves.toMatchObject({ doc: canonicalDoc });
      await jest.runAllTimersAsync();
      await expect(first).resolves.toMatchObject({ doc: canonicalDoc });
      expect(mockFetchPageCollab).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens every view a shared download holds, even one its own request would be refused', async () => {
    const databaseId = '00000000-0000-4000-8000-000000000046';
    const viewA = '00000000-0000-4000-8000-000000000047';
    const viewB = '00000000-0000-4000-8000-000000000048';
    const canonicalDoc = serveDocs(databaseId, [viewA, viewB]);
    const server = createServer(databaseId, [viewA, viewB]);
    const response = deferred<Awaited<ReturnType<typeof fetchDatabaseCollab>>>();

    // Access is per database on this client, as for a cached database: the
    // download of view A holds view B, so B is never asked for separately.
    mockFetchDatabaseCollab.mockReturnValueOnce(response.promise).mockImplementation(async () => {
      throw { code: 1012, message: 'user is not allowed to access this view' };
    });

    const first = openView(workspaceId, viewA, ViewLayout.Grid, { databaseId });
    const second = openView(workspaceId, viewB, ViewLayout.Grid, { databaseId });

    await settle();
    response.resolve(server.snapshot());
    await expect(Promise.all([first, second])).resolves.toMatchObject([{ doc: canonicalDoc }, { doc: canonicalDoc }]);
    await expect(openView(workspaceId, viewB, ViewLayout.Grid, { databaseId })).resolves.toMatchObject({
      doc: canonicalDoc,
      fromCache: true,
    });
    expect(mockFetchDatabaseCollab.mock.calls).toEqual([[workspaceId, databaseId]]);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
    expect(mockDeleteCollabDB).not.toHaveBeenCalled();
  });

  it('never shares a forced load', async () => {
    const databaseId = '00000000-0000-4000-8000-000000000040';
    const viewA = '00000000-0000-4000-8000-000000000041';
    const viewB = '00000000-0000-4000-8000-000000000042';

    serveDocs(databaseId, [viewA, viewB]);
    mockFetchDatabaseCollab.mockResolvedValue(createServer(databaseId, [viewA, viewB]).snapshot());

    await Promise.all([
      openView(workspaceId, viewA, ViewLayout.Grid, { databaseId, forceFetch: true }),
      openView(workspaceId, viewB, ViewLayout.Grid, { databaseId, forceFetch: true }),
    ]);

    expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(2);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });
});

describe('view-loader permission error cache eviction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchDatabaseCollab.mockReset();
    mockFetchPageCollab.mockReset();
    mockDeleteCollabDB.mockResolvedValue(undefined);
  });

  it('evicts the collab and view caches instead of retrying when the fetch is denied', async () => {
    const viewId = '00000000-0000-4000-8000-000000000005';
    const databaseId = '00000000-0000-4000-8000-000000000006';
    const canonicalDoc = createEmptyDoc(databaseId);
    const legacyDoc = createEmptyDoc(viewId);
    const docs = new Map([
      [databaseId, canonicalDoc],
      [viewId, legacyDoc],
    ]);

    mockOpenCollabDBWithProvider.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return createProvider(doc) as never;
    });
    mockOpenCollabDB.mockImplementation(async (name: string) => {
      const doc = docs.get(name);

      if (!doc) throw new Error(`Unexpected open ${name}`);
      return doc;
    });
    mockFetchDatabaseCollab.mockRejectedValue({ code: 1012, message: 'user is not allowed to access this view' });

    await expect(openView('workspace-id', viewId, ViewLayout.Grid, { databaseId })).rejects.toMatchObject({
      code: 1012,
    });

    expect(mockFetchDatabaseCollab).toHaveBeenCalledTimes(1);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
    expect(mockDeleteCollabDB).toHaveBeenCalledWith(databaseId, { destroyDoc: true });
    expect(mockInvalidateViewCache).toHaveBeenCalledWith('workspace-id', viewId);
  });

  it('does not evict caches for non-permission fetch failures', async () => {
    const viewId = '00000000-0000-4000-8000-000000000007';
    const doc = createEmptyDoc(viewId);

    mockOpenCollabDB.mockResolvedValue(doc);
    mockFetchPageCollab.mockRejectedValue({ code: -2, message: 'Record not found' });

    await expect(openView('workspace-id', viewId, ViewLayout.Document)).rejects.toMatchObject({ code: -2 });

    expect(mockDeleteCollabDB).not.toHaveBeenCalled();
    expect(mockInvalidateViewCache).not.toHaveBeenCalled();
  });
});

describe('view-loader row document retry policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockDeleteCollabDB.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches row documents through the contextual collab endpoint', async () => {
    const documentId = '00000000-0000-4000-8000-000000000006';
    const doc = createEmptyDoc(documentId);
    const serverDoc = createDocumentDoc(documentId);
    const rowDocumentSource = {
      database_id: '00000000-0000-4000-8000-000000000003',
      database_view_id: '00000000-0000-4000-8000-000000000004',
      row_id: '00000000-0000-4000-8000-000000000005',
    };

    mockGetOrCreateRowSubDoc.mockResolvedValue(doc);
    mockFetchRowDocumentCollab.mockResolvedValue({ data: Y.encodeStateAsUpdate(serverDoc) });

    const result = await openRowSubDocument('workspace-id', documentId, {
      maxAttempts: 1,
      rowDocumentSource,
    });

    expect(result.doc.getMap(YjsEditorKey.data_section).has(YjsEditorKey.document)).toBe(true);
    expect(mockFetchRowDocumentCollab).toHaveBeenCalledWith('workspace-id', documentId, rowDocumentSource);
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it('keeps the default retry budget for a row document that may still be created', async () => {
    const documentId = '00000000-0000-4000-8000-000000000007';
    const doc = createEmptyDoc(documentId);

    mockGetOrCreateRowSubDoc.mockResolvedValue(doc);
    mockFetchRowDocumentCollab.mockRejectedValue(new Error('row document is not ready'));

    const resultPromise = openRowSubDocument('workspace-id', documentId);

    await jest.runAllTimersAsync();

    const result = await resultPromise;

    expect(result.doc).toBe(doc);
    expect(mockFetchRowDocumentCollab).toHaveBeenCalledTimes(6);
  });

  it('honors a one-attempt limit when existence was already confirmed', async () => {
    const documentId = '00000000-0000-4000-8000-000000000008';
    const doc = createEmptyDoc(documentId);

    mockGetOrCreateRowSubDoc.mockResolvedValue(doc);
    mockFetchRowDocumentCollab.mockRejectedValue(new Error('row document is not registered yet'));

    const result = await openRowSubDocument('workspace-id', documentId, { maxAttempts: 1 });

    expect(result.doc).toBe(doc);
    expect(mockFetchRowDocumentCollab).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects immediately and evicts the cache when a row document fetch is forbidden', async () => {
    const documentId = '00000000-0000-4000-8000-000000000009';
    const doc = createEmptyDoc(documentId);

    mockGetOrCreateRowSubDoc.mockResolvedValue(doc);
    mockFetchRowDocumentCollab.mockRejectedValue({ code: 1012, message: 'user is not allowed to access this view' });

    const rejection = expect(openRowSubDocument('workspace-id', documentId)).rejects.toMatchObject({ code: 1012 });

    await jest.runAllTimersAsync();
    await rejection;

    expect(mockFetchRowDocumentCollab).toHaveBeenCalledTimes(1);
    expect(mockDeleteCollabDB).toHaveBeenCalledWith(documentId, { destroyDoc: true });
    expect(jest.getTimerCount()).toBe(0);
  });
});
