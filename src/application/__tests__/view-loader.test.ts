import { expect } from '@jest/globals';
import * as Y from 'yjs';

import { openCollabDB, openCollabDBWithProvider } from '@/application/db';
import { fetchPageCollab } from '@/application/services/js-services/fetch';
import { enqueueOutboxUpdate } from '@/application/sync-outbox';
import { Types, ViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { getDatabaseIdFromDoc, openView } from '@/application/view-loader';

jest.mock('@/application/db', () => ({
  openCollabDB: jest.fn(),
  openCollabDBWithProvider: jest.fn(),
}));

jest.mock('@/application/services/js-services/cache', () => ({
  getOrCreateRowSubDoc: jest.fn(),
  hasCollabCache: jest.fn((doc: YDoc) => {
    const root = doc.getMap(YjsEditorKey.data_section);

    return root.has(YjsEditorKey.database) || root.has(YjsEditorKey.document);
  }),
}));

jest.mock('@/application/services/js-services/fetch', () => ({
  fetchPageCollab: jest.fn(),
}));

jest.mock('@/application/sync-outbox', () => ({
  enqueueOutboxUpdate: jest.fn(),
}));

const mockOpenCollabDB = openCollabDB as jest.MockedFunction<typeof openCollabDB>;
const mockOpenCollabDBWithProvider = openCollabDBWithProvider as jest.MockedFunction<typeof openCollabDBWithProvider>;
const mockFetchPageCollab = fetchPageCollab as jest.MockedFunction<typeof fetchPageCollab>;
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
    expect(mockEnqueueOutboxUpdate).toHaveBeenCalledWith(expect.objectContaining({
      objectId: databaseId,
      collabType: Types.Database,
      payload: expect.any(Uint8Array),
    }));
    expect(mockFetchPageCollab).not.toHaveBeenCalled();
  });

  it('fetches by viewId into the canonical databaseId cache when local cache is empty', async () => {
    const viewId = '00000000-0000-4000-8000-000000000003';
    const databaseId = '00000000-0000-4000-8000-000000000004';
    const canonicalDoc = createEmptyDoc(databaseId);
    const legacyDoc = createEmptyDoc(viewId);
    const serverDoc = createDatabaseDoc(databaseId);
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
