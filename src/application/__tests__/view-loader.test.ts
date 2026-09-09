import { expect } from '@jest/globals';
import * as Y from 'yjs';

import { deleteCollabDB, openCollabDB, openCollabDBWithProvider } from '@/application/db';
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

  it('fetches by viewId into the canonical databaseId cache when local cache is empty', async () => {
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
    mockFetchPageCollab.mockResolvedValue({
      data: Y.encodeStateAsUpdate(serverDoc),
      rows: {},
    });

    const result = await openView('workspace-id', viewId, ViewLayout.Grid, { databaseId });

    expect(result.doc).toBe(canonicalDoc);
    expect(result.fromCache).toBe(false);
    expect(getDatabaseIdFromDoc(canonicalDoc)).toBe(databaseId);
    expect(mockFetchPageCollab).toHaveBeenCalledWith('workspace-id', viewId);
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

describe('view-loader permission error cache eviction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    mockFetchPageCollab.mockRejectedValue({ code: 1012, message: 'user is not allowed to access this view' });

    await expect(openView('workspace-id', viewId, ViewLayout.Grid, { databaseId })).rejects.toMatchObject({
      code: 1012,
    });

    expect(mockFetchPageCollab).toHaveBeenCalledTimes(1);
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
