import * as Y from 'yjs';
import { Types, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { expect } from '@jest/globals';
import {
  collabTypeToDBType,
  getPublishView,
  getPublishViewMeta,
  mergeLegacyRowDocIfExists,
} from '@/application/services/js-services/cache';
import { applyYDoc } from '@/application/ydoc/apply';
import { openCollabDB, openCollabDBWithProvider, collabIndexedDBExists, db } from '@/application/db';
import { StrategyType } from '@/application/services/js-services/cache/types';

jest.mock('@/application/ydoc/apply', () => ({
  applyYDoc: jest.fn(),
}));

jest.mock('@/application/db', () => ({
  openCollabDB: jest.fn(),
  openCollabDBWithProvider: jest.fn(),
  openRowCollabDBWithProvider: jest.fn(),
  collabIndexedDBExists: jest.fn(),
  closeCollabDB: jest.fn(),
  evictProviderCache: jest.fn(),
  db: {
    view_metas: {
      get: jest.fn(),
      put: jest.fn(),
    },
  },
}));

const normalDoc = withTestingYDoc('1');
const mockFetcher = jest.fn();
const mockedApplyYDoc = applyYDoc as jest.MockedFunction<typeof applyYDoc>;
const mockedOpenCollabDBWithProvider = openCollabDBWithProvider as jest.MockedFunction<typeof openCollabDBWithProvider>;
const mockedCollabIndexedDBExists = collabIndexedDBExists as jest.MockedFunction<typeof collabIndexedDBExists>;

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

async function runTestWithStrategy (strategy: StrategyType) {
  return getPublishView(
    mockFetcher,
    {
      namespace: 'appflowy',
      publishName: 'test',
    },
    strategy,
  );
}

async function runGetPublishViewMetaWithStrategy (strategy: StrategyType) {
  return getPublishViewMeta(
    mockFetcher,
    {
      namespace: 'appflowy',
      publishName: 'test',
    },
    strategy,
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
    expect(legacyProvider.destroy).toHaveBeenCalledTimes(1);
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
