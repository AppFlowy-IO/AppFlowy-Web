import * as Y from 'yjs';
import {
  releaseDatabaseRowDocs,
  releaseRowDocSyncBinding,
  retainDatabaseRowDocs,
  retainRowDocSyncBinding,
} from '@/application/database-blob/row-doc-retention';
import {
  createDatabaseRowDocSeed,
  invalidateDatabaseRowDocSeedGeneration,
} from '@/application/database-blob/row-seed-fence';
import { FieldType } from '@/application/database-yjs/database.type';
import { Types, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { expect } from '@jest/globals';
import {
  cacheCanonicalRowDoc,
  collabTypeToDBType,
  createRow,
  getCachedRowDoc,
  getPublishView,
  getPublishViewMeta,
  mergeLegacyRowDocIfExists,
  openRowDoc,
} from '@/application/services/js-services/cache';
import { applyYDoc } from '@/application/ydoc/apply';
import {
  openCollabDB,
  openCollabDBWithProvider,
  openRowCollabDBWithProvider,
  collabIndexedDBExists,
  db,
  deleteCollabDB,
  evictProviderCache,
} from '@/application/db';
import { StrategyType } from '@/application/services/js-services/cache/types';

jest.mock('@/application/ydoc/apply', () => ({
  applyYDoc: jest.fn(),
}));

jest.mock('@/application/db', () => ({
  captureDatabaseStorageFence: jest.fn(async (databaseId: string) => ({
    databaseId,
    epoch: localStorage.getItem(`af_database_blob_epoch:${databaseId}`),
    cacheEpoch: localStorage.getItem(`af_database_blob_epoch:${databaseId}`),
  })),
  openCollabDB: jest.fn(),
  openCollabDBWithProvider: jest.fn(),
  openRowCollabDBWithProvider: jest.fn(),
  collabIndexedDBExists: jest.fn(),
  closeCollabDB: jest.fn(),
  deleteCollabDB: jest.fn(),
  evictProviderCache: jest.fn(),
  db: {
    view_metas: {
      get: jest.fn(),
      put: jest.fn(),
    },
    collab_custom: {
      get: jest.fn(),
      put: jest.fn(),
    },
  },
}));

const normalDoc = withTestingYDoc('1');
const mockFetcher = jest.fn();
const mockedApplyYDoc = applyYDoc as jest.MockedFunction<typeof applyYDoc>;
const mockedOpenCollabDBWithProvider = openCollabDBWithProvider as jest.MockedFunction<typeof openCollabDBWithProvider>;
const mockedOpenRowCollabDBWithProvider = openRowCollabDBWithProvider as jest.MockedFunction<
  typeof openRowCollabDBWithProvider
>;
const mockedCollabIndexedDBExists = collabIndexedDBExists as jest.MockedFunction<typeof collabIndexedDBExists>;
const mockedDeleteCollabDB = deleteCollabDB as jest.MockedFunction<typeof deleteCollabDB>;

function createRowDoc(rowId: string, databaseId: string, cells: Record<string, unknown>) {
  const doc = new Y.Doc() as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map();
  const cellMap = new Y.Map();

  sharedRoot.set(YjsEditorKey.database_row, row);
  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.database_id, databaseId);
  row.set(YjsDatabaseKey.cells, cellMap);

  Object.entries(cells).forEach(([fieldId, data]) => {
    const cell = new Y.Map();

    cell.set(YjsDatabaseKey.data, data);
    cellMap.set(fieldId, cell);
  });

  return doc;
}

function getCellData(doc: YDoc, fieldId: string) {
  const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<unknown> | undefined;
  const cells = row?.get(YjsDatabaseKey.cells) as Y.Map<Y.Map<unknown>> | undefined;

  return cells?.get(fieldId)?.get(YjsDatabaseKey.data);
}

async function runTestWithStrategy(strategy: StrategyType) {
  return getPublishView(
    mockFetcher,
    {
      namespace: 'appflowy',
      publishName: 'test',
    },
    strategy
  );
}

async function runGetPublishViewMetaWithStrategy(strategy: StrategyType) {
  return getPublishViewMeta(
    mockFetcher,
    {
      namespace: 'appflowy',
      publishName: 'test',
    },
    strategy
  );
}

describe('Cache functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetcher.mockClear();
    (openCollabDB as jest.Mock).mockClear();
  });

  describe('getPublishView', () => {
    it('should call fetcher when no cache found', async () => {
      (openCollabDB as jest.Mock).mockResolvedValue(normalDoc);
      mockFetcher.mockResolvedValue({ data: [1, 2, 3], meta: { metadata: { view: { id: '1' } } } });
      (db.view_metas.get as jest.Mock).mockResolvedValue(undefined);
      await runTestWithStrategy(StrategyType.CACHE_FIRST);
      expect(mockFetcher).toBeCalledTimes(1);

      await runTestWithStrategy(StrategyType.CACHE_AND_NETWORK);
      expect(mockFetcher).toBeCalledTimes(2);
      await expect(runTestWithStrategy(StrategyType.CACHE_ONLY)).rejects.toThrow('No cache found');
    });
    it('should call fetcher when cache is invalid or strategy is CACHE_AND_NETWORK', async () => {
      (openCollabDB as jest.Mock).mockResolvedValue(normalDoc);
      (db.view_metas.get as jest.Mock).mockResolvedValue({ view_id: '1' });
      mockFetcher.mockResolvedValue({ data: [1, 2, 3], meta: { metadata: { view: { id: '1' } } } });
      await runTestWithStrategy(StrategyType.CACHE_ONLY);
      expect(openCollabDB).toBeCalledTimes(1);

      await runTestWithStrategy(StrategyType.CACHE_FIRST);
      expect(openCollabDB).toBeCalledTimes(2);
      expect(mockFetcher).toBeCalledTimes(0);

      await runTestWithStrategy(StrategyType.CACHE_AND_NETWORK);
      expect(openCollabDB).toBeCalledTimes(3);
      expect(mockFetcher).toBeCalledTimes(1);
    });
  });

  describe('getPublishViewMeta', () => {
    it('should call fetcher when no cache found', async () => {
      mockFetcher.mockResolvedValue({ metadata: { view: { id: '1' }, child_views: [], ancestor_views: [] } });
      (db.view_metas.get as jest.Mock).mockResolvedValue(undefined);
      await runGetPublishViewMetaWithStrategy(StrategyType.CACHE_FIRST);
      expect(mockFetcher).toBeCalledTimes(1);

      await runGetPublishViewMetaWithStrategy(StrategyType.CACHE_AND_NETWORK);
      expect(mockFetcher).toBeCalledTimes(2);

      await expect(runGetPublishViewMetaWithStrategy(StrategyType.CACHE_ONLY)).rejects.toThrow('No cache found');
    });

    it('should call fetcher when cache is invalid or strategy is CACHE_AND_NETWORK', async () => {
      (openCollabDB as jest.Mock).mockResolvedValue(normalDoc);
      (db.view_metas.get as jest.Mock).mockResolvedValue({ view_id: '1' });

      mockFetcher.mockResolvedValue({ metadata: { view: { id: '1' }, child_views: [], ancestor_views: [] } });
      const meta = await runGetPublishViewMetaWithStrategy(StrategyType.CACHE_ONLY);
      expect(openCollabDB).toBeCalledTimes(0);
      expect(meta).toBeDefined();

      await runGetPublishViewMetaWithStrategy(StrategyType.CACHE_FIRST);
      expect(openCollabDB).toBeCalledTimes(0);
      expect(mockFetcher).toBeCalledTimes(0);

      await runGetPublishViewMetaWithStrategy(StrategyType.CACHE_AND_NETWORK);
      expect(openCollabDB).toBeCalledTimes(0);
      expect(mockFetcher).toBeCalledTimes(1);
    });
  });
});

describe('database row legacy cache migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (db.collab_custom.get as jest.Mock).mockResolvedValue(undefined);
    (db.collab_custom.put as jest.Mock).mockResolvedValue(undefined);
    mockedDeleteCollabDB.mockResolvedValue(true);
    mockedApplyYDoc.mockImplementation((doc, state) => {
      Y.applyUpdate(doc, state);
    });
  });

  it('merges legacy row updates even when shared row storage already has row data', async () => {
    const rowId = 'row-legacy-merge';
    const databaseId = 'database-legacy-merge';
    const rowKey = `${databaseId}_rows_${rowId}`;
    const sharedDoc = createRowDoc(rowId, databaseId, { 'server-field': 'server-value' });
    const legacyDoc = createRowDoc(rowId, databaseId, { 'legacy-field': 'legacy-value' });
    const legacyProvider = { destroy: jest.fn().mockResolvedValue(undefined) };

    mockedCollabIndexedDBExists.mockResolvedValue(true);
    mockedOpenCollabDBWithProvider.mockResolvedValue({
      doc: legacyDoc,
      provider: legacyProvider,
    } as never);

    await expect(mergeLegacyRowDocIfExists(rowKey, rowId, sharedDoc)).resolves.toBe(true);

    expect(mockedCollabIndexedDBExists).toHaveBeenCalledWith(rowKey);
    expect(getCellData(sharedDoc, 'server-field')).toBe('server-value');
    expect(getCellData(sharedDoc, 'legacy-field')).toBe('legacy-value');
    expect(db.collab_custom.put).toHaveBeenCalledWith(
      expect.objectContaining({
        objectId: rowId,
        key: `legacy-row-backfill:${rowKey}`,
      })
    );
    expect(mockedDeleteCollabDB).toHaveBeenCalledWith(rowKey);
    expect(legacyProvider.destroy).toHaveBeenCalledTimes(1);
  });

  it('preserves target-only cells while importing legacy edits for existing cells', async () => {
    const rowId = 'row-legacy-existing-cell';
    const databaseId = 'database-legacy-existing-cell';
    const rowKey = `${databaseId}_rows_${rowId}`;
    const sharedDoc = createRowDoc(rowId, databaseId, {
      'same-field': 'server-value',
      'server-field': 'server-value',
    });
    const legacyDoc = createRowDoc(rowId, databaseId, {
      'same-field': 'legacy-local-value',
      'legacy-field': 'legacy-value',
    });
    const legacyProvider = { destroy: jest.fn().mockResolvedValue(undefined) };

    mockedCollabIndexedDBExists.mockResolvedValue(true);
    mockedOpenCollabDBWithProvider.mockResolvedValue({
      doc: legacyDoc,
      provider: legacyProvider,
    } as never);

    await expect(mergeLegacyRowDocIfExists(rowKey, rowId, sharedDoc)).resolves.toBe(true);

    expect(getCellData(sharedDoc, 'same-field')).toBe('legacy-local-value');
    expect(getCellData(sharedDoc, 'server-field')).toBe('server-value');
    expect(getCellData(sharedDoc, 'legacy-field')).toBe('legacy-value');
    expect(db.collab_custom.put).toHaveBeenCalledWith(
      expect.objectContaining({
        objectId: rowId,
        key: `legacy-row-backfill:${rowKey}`,
      })
    );
    expect(mockedDeleteCollabDB).toHaveBeenCalledWith(rowKey);
    expect(legacyProvider.destroy).toHaveBeenCalledTimes(1);
  });

  it('marks the legacy row cache consumed when only existing cells were migrated', async () => {
    const rowId = 'row-legacy-noop';
    const databaseId = 'database-legacy-noop';
    const rowKey = `${databaseId}_rows_${rowId}`;
    const sharedDoc = createRowDoc(rowId, databaseId, { 'same-field': 'current-value' });
    const legacyDoc = createRowDoc(rowId, databaseId, { 'same-field': 'legacy-local-value' });
    const legacyProvider = { destroy: jest.fn().mockResolvedValue(undefined) };

    mockedCollabIndexedDBExists.mockResolvedValue(true);
    mockedOpenCollabDBWithProvider.mockResolvedValue({
      doc: legacyDoc,
      provider: legacyProvider,
    } as never);

    await expect(mergeLegacyRowDocIfExists(rowKey, rowId, sharedDoc)).resolves.toBe(true);

    expect(getCellData(sharedDoc, 'same-field')).toBe('legacy-local-value');
    expect(db.collab_custom.put).toHaveBeenCalledWith(
      expect.objectContaining({
        objectId: rowId,
        key: `legacy-row-backfill:${rowKey}`,
      })
    );
    expect(mockedDeleteCollabDB).toHaveBeenCalledWith(rowKey);
    expect(legacyProvider.destroy).toHaveBeenCalledTimes(1);
  });

  it('skips legacy row migration after the one-time backfill marker exists', async () => {
    const rowId = 'row-legacy-marked';
    const databaseId = 'database-legacy-marked';
    const rowKey = `${databaseId}_rows_${rowId}`;
    const sharedDoc = createRowDoc(rowId, databaseId, { 'same-field': 'current-value' });

    (db.collab_custom.get as jest.Mock).mockResolvedValue({ rowKey, migratedAt: Date.now() });

    await expect(mergeLegacyRowDocIfExists(rowKey, rowId, sharedDoc)).resolves.toBe(false);

    expect(mockedCollabIndexedDBExists).not.toHaveBeenCalled();
    expect(mockedOpenCollabDBWithProvider).not.toHaveBeenCalled();
    expect(db.collab_custom.put).not.toHaveBeenCalled();
    expect(mockedDeleteCollabDB).not.toHaveBeenCalled();
    expect(getCellData(sharedDoc, 'same-field')).toBe('current-value');
  });

  it('never merges a pre-restore legacy cache into a restored row', async () => {
    const databaseId = 'restored-database';
    const rowId = 'row';
    const row = createRowDoc(rowId, databaseId, { field: 'current' });
    localStorage.setItem(`af_database_blob_epoch:${databaseId}`, 'R');

    await expect(
      mergeLegacyRowDocIfExists(`${databaseId}_rows_${rowId}`, rowId, row, { legacyExists: true })
    ).resolves.toBe(false);
    expect(mockedOpenCollabDBWithProvider).not.toHaveBeenCalled();
    expect(getCellData(row, 'field')).toBe('current');
    row.destroy();
  });

  it('rejects a legacy cache open that finishes after another tab restores', async () => {
    const databaseId = 'database-delayed-migration';
    const rowId = 'row';
    const row = createRowDoc(rowId, databaseId, { field: 'current' });
    const legacy = createRowDoc(rowId, databaseId, { field: 'stale legacy' });
    mockedOpenCollabDBWithProvider.mockImplementationOnce(async () => {
      localStorage.setItem(`af_database_blob_epoch:${databaseId}`, 'R');
      return { doc: legacy, provider: { destroy: jest.fn() } } as never;
    });

    await expect(
      mergeLegacyRowDocIfExists(`${databaseId}_rows_${rowId}`, rowId, row, { legacyExists: true })
    ).resolves.toBe(false);
    expect(getCellData(row, 'field')).toBe('current');
    expect(db.collab_custom.put).not.toHaveBeenCalled();
    row.destroy();
  });
});

describe('database row document cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCollabIndexedDBExists.mockResolvedValue(false);
    (db.collab_custom.get as jest.Mock).mockResolvedValue(undefined);
  });

  it('evicts a destroyed row document before the next open', async () => {
    const rowId = 'row-cache-destroyed';
    const rowKey = `database-cache-destroyed_rows_${rowId}`;
    const firstDoc = createRowDoc(rowId, 'database-cache-destroyed', {});
    const secondDoc = createRowDoc(rowId, 'database-cache-destroyed', {});
    const provider = {
      synced: true,
      destroy: jest.fn().mockResolvedValue(undefined),
    };

    mockedOpenRowCollabDBWithProvider
      .mockResolvedValueOnce({ doc: firstDoc, provider } as never)
      .mockResolvedValueOnce({ doc: secondDoc, provider } as never);

    await expect(createRow(rowKey)).resolves.toBe(firstDoc);
    expect(getCachedRowDoc(rowKey)).toBe(firstDoc);

    firstDoc.destroy();

    expect(getCachedRowDoc(rowKey)).toBeUndefined();
    await expect(createRow(rowKey)).resolves.toBe(secondDoc);
    expect(mockedOpenRowCollabDBWithProvider).toHaveBeenCalledTimes(2);

    secondDoc.destroy();
  });

  it('does not apply a row seed invalidated while its canonical doc is opening', async () => {
    const rowId = 'row-cache-reset-seed';
    const rowKey = `database-cache-reset-seed_rows_${rowId}`;
    const canonicalDoc = createRowDoc(rowId, 'database-cache-reset-seed', {});
    const provider = {
      synced: true,
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    const seed = createDatabaseRowDocSeed(rowId, {
      bytes: new Uint8Array([1, 2, 3]),
      encoderVersion: 1,
    });
    let resolveOpen!: (value: Awaited<ReturnType<typeof openRowCollabDBWithProvider>>) => void;
    const pendingOpen = new Promise<Awaited<ReturnType<typeof openRowCollabDBWithProvider>>>((resolve) => {
      resolveOpen = resolve;
    });

    mockedOpenRowCollabDBWithProvider.mockReturnValueOnce(pendingOpen);

    const opening = openRowDoc(rowKey, seed);

    invalidateDatabaseRowDocSeedGeneration(rowId);
    resolveOpen({ doc: canonicalDoc, provider } as never);

    await expect(opening).resolves.toBe(canonicalDoc);
    expect(mockedApplyYDoc).not.toHaveBeenCalled();

    canonicalDoc.destroy();
  });

  it('adopts the canonical row document selected by version reset', () => {
    const rowId = 'row-cache-reset';
    const rowKey = `database-cache-reset_rows_${rowId}`;
    const canonicalDoc = createRowDoc(rowId, 'database-cache-reset', {});

    cacheCanonicalRowDoc(rowId, canonicalDoc);

    expect(getCachedRowDoc(rowKey)).toBe(canonicalDoc);

    canonicalDoc.destroy();
    expect(getCachedRowDoc(rowKey)).toBeUndefined();
  });

  it('normalizes legacy cell field types on a canonical reset document', () => {
    const rowId = 'row-cache-reset-normalizer';
    const rowKey = `database-cache-reset-normalizer_rows_${rowId}`;
    const canonicalDoc = createRowDoc(rowId, 'database-cache-reset-normalizer', { 'field-id': '42' });
    const row = canonicalDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<unknown>;
    const cells = row.get(YjsDatabaseKey.cells) as Y.Map<Y.Map<unknown>>;
    const cell = cells.get('field-id');

    cell?.set(YjsDatabaseKey.field_type, String(FieldType.RichText));
    cell?.set(YjsDatabaseKey.source_field_type, FieldType.Number);

    cacheCanonicalRowDoc(rowId, canonicalDoc);

    expect(getCachedRowDoc(rowKey)).toBe(canonicalDoc);
    expect(cell?.get(YjsDatabaseKey.field_type)).toBe(FieldType.Number);
    expect(cell?.has(YjsDatabaseKey.source_field_type)).toBe(false);

    canonicalDoc.destroy();
  });
});

describe('database row document eviction', () => {
  const mockedEvictProviderCache = evictProviderCache as jest.MockedFunction<typeof evictProviderCache>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCollabIndexedDBExists.mockResolvedValue(false);
    (db.collab_custom.get as jest.Mock).mockResolvedValue(undefined);
  });

  /** Opens a row doc the way a database view does, and reports when it is destroyed. */
  async function openRow(databaseId: string, rowId: string) {
    const doc = createRowDoc(rowId, databaseId, {});
    const destroyed = jest.fn();

    doc.on('destroy', destroyed);
    mockedOpenRowCollabDBWithProvider.mockResolvedValueOnce({
      doc,
      provider: { synced: true, destroy: jest.fn().mockResolvedValue(undefined) },
    } as never);
    await createRow(`${databaseId}_rows_${rowId}`);
    return { doc, destroyed, rowKey: `${databaseId}_rows_${rowId}` };
  }

  it('evicts the row docs of a released database that no sync context references', async () => {
    const databaseId = 'database-evict';
    const seedOnly = await openRow(databaseId, 'row-evict-seed-only');
    const synced = await openRow(databaseId, 'row-evict-synced');
    const otherDatabase = await openRow('database-evict-other', 'row-evict-other');

    // A rendered row has a sync context; the others were only read for filter and sort.
    retainRowDocSyncBinding('row-evict-synced');
    retainDatabaseRowDocs(databaseId);

    // While a view retains the database, a row map may hold any of its docs.
    expect(seedOnly.destroyed).not.toHaveBeenCalled();

    releaseDatabaseRowDocs(databaseId);

    expect(seedOnly.destroyed).toHaveBeenCalledTimes(1);
    expect(getCachedRowDoc(seedOnly.rowKey)).toBeUndefined();
    expect(mockedEvictProviderCache).toHaveBeenCalledWith('row-evict-seed-only');
    expect(synced.destroyed).not.toHaveBeenCalled();
    expect(getCachedRowDoc(synced.rowKey)).toBe(synced.doc);
    expect(otherDatabase.destroyed).not.toHaveBeenCalled();

    // The sync context is unregistered a few seconds after the view unmounted.
    releaseRowDocSyncBinding('row-evict-synced', synced.doc);

    expect(synced.destroyed).toHaveBeenCalledTimes(1);
    expect(getCachedRowDoc(synced.rowKey)).toBeUndefined();

    // The next view opens the row again from storage.
    const reopened = await openRow(databaseId, 'row-evict-seed-only');

    expect(getCachedRowDoc(reopened.rowKey)).toBe(reopened.doc);
    otherDatabase.doc.destroy();
    reopened.doc.destroy();
  });

  it('keeps the row docs of a database that a view retains again', async () => {
    const databaseId = 'database-evict-retained';
    const row = await openRow(databaseId, 'row-evict-retained');

    retainRowDocSyncBinding('row-evict-retained');
    releaseDatabaseRowDocs(databaseId);
    // The dashboard is reopened before the row's sync context is unregistered.
    retainDatabaseRowDocs(databaseId);
    releaseRowDocSyncBinding('row-evict-retained', row.doc);

    expect(row.destroyed).not.toHaveBeenCalled();
    expect(getCachedRowDoc(row.rowKey)).toBe(row.doc);
    row.doc.destroy();
  });

  it('keeps a row doc while another sync provider still binds it', async () => {
    const databaseId = 'database-evict-two-bindings';
    const row = await openRow(databaseId, 'row-evict-two-bindings');

    retainRowDocSyncBinding('row-evict-two-bindings');
    retainRowDocSyncBinding('row-evict-two-bindings');
    releaseDatabaseRowDocs(databaseId);
    releaseRowDocSyncBinding('row-evict-two-bindings', row.doc);
    expect(row.destroyed).not.toHaveBeenCalled();

    releaseRowDocSyncBinding('row-evict-two-bindings', row.doc);
    expect(row.destroyed).toHaveBeenCalledTimes(1);
  });

  it('does not destroy again a doc whose destruction unregistered its sync context', async () => {
    const databaseId = 'database-evict-destroying';
    const row = await openRow(databaseId, 'row-evict-destroying');
    const destroy = jest.spyOn(row.doc, 'destroy');

    retainRowDocSyncBinding('row-evict-destroying');
    releaseDatabaseRowDocs(databaseId);
    releaseRowDocSyncBinding('row-evict-destroying', row.doc, { docDestroyed: true });

    expect(destroy).not.toHaveBeenCalled();
    expect(getCachedRowDoc(row.rowKey)).toBeUndefined();
    destroy.mockRestore();
    row.doc.destroy();
  });

  it('leaves the replacement doc of a row alone when the old one is unbound', async () => {
    const databaseId = 'database-evict-replaced';
    const row = await openRow(databaseId, 'row-evict-replaced');
    const replacement = createRowDoc('row-evict-replaced', databaseId, {});
    const replacementDestroyed = jest.fn();

    replacement.on('destroy', replacementDestroyed);
    retainRowDocSyncBinding('row-evict-replaced');
    releaseDatabaseRowDocs(databaseId);
    // A version reset swapped the cached doc; the old doc's context is unregistered afterwards.
    cacheCanonicalRowDoc('row-evict-replaced', replacement);
    releaseRowDocSyncBinding('row-evict-replaced', row.doc);

    expect(replacementDestroyed).not.toHaveBeenCalled();
    expect(getCachedRowDoc(row.rowKey)).toBe(replacement);
    row.doc.destroy();
    replacement.destroy();
  });
});

describe('collabTypeToDBType', () => {
  it('should return correct DB type', () => {
    expect(collabTypeToDBType(Types.Document)).toBe('document');
    expect(collabTypeToDBType(Types.Folder)).toBe('folder');
    expect(collabTypeToDBType(Types.Database)).toBe('database');
    expect(collabTypeToDBType(Types.WorkspaceDatabase)).toBe('databases');
    expect(collabTypeToDBType(Types.DatabaseRow)).toBe('database_row');
    expect(collabTypeToDBType(Types.UserAwareness)).toBe('user_awareness');
    expect(collabTypeToDBType(Types.Empty)).toBe('');
  });
});
