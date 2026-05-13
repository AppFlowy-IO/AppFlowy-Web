import * as Y from 'yjs';

import { deleteCollabDB, listCollabIndexedDBNames, openRowCollabDBWithProvider } from '@/application/db';
import {
  parseLegacyRowDatabaseName,
  recoverLegacyDatabaseRowsForWorkspace,
} from '@/application/local-collab-recovery';
import { mergeLegacyRowDocIfExists } from '@/application/services/js-services/cache';
import { withRetry } from '@/application/services/js-services/http/core';
import { collabFullSyncBatchStrict } from '@/application/services/js-services/http/http_api';
import { Types, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/application/db', () => {
  const records = new Map<string, Record<string, unknown>>();
  const recordKey = (workspaceId: string, objectId: string) => `${workspaceId}:${objectId}`;
  const recoveryTable = {
    get: jest.fn(async ([workspaceId, objectId]: [string, string]) => {
      return records.get(recordKey(workspaceId, objectId));
    }),
    put: jest.fn(async (record: { workspaceId: string; objectId: string }) => {
      records.set(recordKey(record.workspaceId, record.objectId), record);
    }),
    where: jest.fn((indexName: string) => ({
      equals: jest.fn((value: string) => ({
        filter: jest.fn((predicate: (record: Record<string, unknown>) => boolean) => ({
          toArray: jest.fn(async () => {
            return Array.from(records.values()).filter((record) => {
              if (indexName === 'workspaceId' && record.workspaceId !== value) return false;
              return predicate(record);
            });
          }),
        })),
      })),
    })),
  };

  return {
    db: {
      local_collab_recovery: recoveryTable,
    },
    __mockRecords: records,
    listCollabIndexedDBNames: jest.fn(),
    collabIndexedDBExists: jest.fn(),
    openCollabDBWithProvider: jest.fn(),
    openRowCollabDBWithProvider: jest.fn(),
    deleteCollabDB: jest.fn(),
  };
});

jest.mock('@/application/services/js-services/cache', () => ({
  mergeLegacyRowDocIfExists: jest.fn(),
}));

jest.mock('@/application/services/js-services/http/http_api', () => ({
  collabFullSyncBatchStrict: jest.fn(),
}));

jest.mock('@/application/services/js-services/http/core', () => ({
  withRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
}));

const mockedListCollabIndexedDBNames = listCollabIndexedDBNames as jest.MockedFunction<typeof listCollabIndexedDBNames>;
const mockedOpenRowCollabDBWithProvider = openRowCollabDBWithProvider as jest.MockedFunction<
  typeof openRowCollabDBWithProvider
>;
const mockedDeleteCollabDB = deleteCollabDB as jest.MockedFunction<typeof deleteCollabDB>;
const mockedMergeLegacyRowDocIfExists = mergeLegacyRowDocIfExists as jest.MockedFunction<
  typeof mergeLegacyRowDocIfExists
>;
const mockedCollabFullSyncBatchStrict = collabFullSyncBatchStrict as jest.MockedFunction<
  typeof collabFullSyncBatchStrict
>;
const mockedWithRetry = withRetry as jest.MockedFunction<typeof withRetry>;
const mockedDbModule = jest.requireMock('@/application/db') as {
  __mockRecords: Map<string, Record<string, unknown>>;
};

function mockRecordKey(workspaceId: string, objectId: string) {
  return `${workspaceId}:${objectId}`;
}

function createRowDoc(rowId: string, databaseId: string) {
  const doc = new Y.Doc({ guid: rowId }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map();

  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.database_id, databaseId);
  sharedRoot.set(YjsEditorKey.database_row, row);

  return doc;
}

describe('local collab recovery', () => {
  const workspaceId = '82a2fdf6-d985-4112-84b6-86e052ec1ed3';
  const databaseId = '5b6ed219-a7c9-4017-bf6c-b156c27f5cf0';
  const viewId = 'e654058e-dc95-55ff-89d6-68b208faa346';
  const rowId = '0b6e61d4-ed44-4dee-9704-0bcb6b7205b1';
  const rowKey = `${databaseId}_rows_${rowId}`;
  const legacyViewRowKey = `${viewId}_rows_${rowId}`;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDbModule.__mockRecords.clear();
    localStorage.clear();
    mockedListCollabIndexedDBNames.mockResolvedValue(new Set([rowKey]));
    mockedMergeLegacyRowDocIfExists.mockResolvedValue(true);
    mockedCollabFullSyncBatchStrict.mockResolvedValue(undefined);
    mockedDeleteCollabDB.mockResolvedValue(true);
    mockedWithRetry.mockImplementation((fn: () => Promise<unknown>) => fn() as never);
  });

  it('parses legacy row IndexedDB names', () => {
    expect(parseLegacyRowDatabaseName(rowKey)).toEqual({
      databaseId,
      rowId,
      rowKey,
    });
    expect(parseLegacyRowDatabaseName(`${databaseId}_rows_not-a-row-id`)).toBeNull();
  });

  it('deletes the legacy cache after merging into shared row storage', async () => {
    const rowDoc = createRowDoc(rowId, databaseId);
    const provider = { destroy: jest.fn().mockResolvedValue(undefined) };

    mockedOpenRowCollabDBWithProvider.mockResolvedValue({
      doc: rowDoc,
      provider,
    } as never);

    const summary = await recoverLegacyDatabaseRowsForWorkspace({
      workspaceId,
      databaseRelations: {
        [databaseId]: viewId,
      },
    });

    expect(summary.uploaded).toBe(1);
    expect(mockedMergeLegacyRowDocIfExists).toHaveBeenCalledWith(rowKey, rowId, rowDoc, {
      legacyExists: true,
      deleteLegacyCache: false,
    });
    expect(mockedMergeLegacyRowDocIfExists.mock.invocationCallOrder[0]).toBeLessThan(
      mockedDeleteCollabDB.mock.invocationCallOrder[0]
    );
    expect(mockedDeleteCollabDB.mock.invocationCallOrder[0]).toBeLessThan(
      mockedCollabFullSyncBatchStrict.mock.invocationCallOrder[0]
    );
    expect(mockedCollabFullSyncBatchStrict).toHaveBeenCalledWith(
      workspaceId,
      expect.arrayContaining([
        expect.objectContaining({
          objectId: rowId,
          collabType: Types.DatabaseRow,
        }),
      ])
    );
    expect(mockedDeleteCollabDB).toHaveBeenCalledWith(rowKey);
    expect(mockedDbModule.__mockRecords.get(mockRecordKey(workspaceId, rowId))).toMatchObject({
      legacyCacheDeleted: true,
      status: 'legacy_deleted',
    });
  });

  it('recovers legacy rows keyed by database view id', async () => {
    const rowDoc = createRowDoc(rowId, viewId);

    mockedListCollabIndexedDBNames.mockResolvedValue(new Set([legacyViewRowKey]));
    mockedOpenRowCollabDBWithProvider.mockResolvedValue({
      doc: rowDoc,
      provider: { destroy: jest.fn().mockResolvedValue(undefined) },
    } as never);

    const summary = await recoverLegacyDatabaseRowsForWorkspace({
      workspaceId,
      databaseRelations: {
        [databaseId]: viewId,
      },
    });

    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as Y.Map<unknown>;

    expect(summary.uploaded).toBe(1);
    expect(row.get(YjsDatabaseKey.database_id)).toBe(databaseId);
    expect(mockedMergeLegacyRowDocIfExists).toHaveBeenCalledWith(legacyViewRowKey, rowId, rowDoc, {
      legacyExists: true,
      deleteLegacyCache: false,
    });
    expect(mockedDbModule.__mockRecords.get(mockRecordKey(workspaceId, rowId))).toMatchObject({
      databaseId,
      legacyDbName: legacyViewRowKey,
      status: 'legacy_deleted',
    });
    expect(mockedDeleteCollabDB).toHaveBeenCalledWith(legacyViewRowKey);
  });

  it('keeps the recovered row retryable when upload fails', async () => {
    const rowDoc = createRowDoc(rowId, databaseId);

    mockedOpenRowCollabDBWithProvider.mockResolvedValue({
      doc: rowDoc,
      provider: { destroy: jest.fn().mockResolvedValue(undefined) },
    } as never);
    mockedCollabFullSyncBatchStrict.mockRejectedValue(new Error('server rejected batch'));

    const summary = await recoverLegacyDatabaseRowsForWorkspace({
      workspaceId,
      databaseRelations: {
        [databaseId]: viewId,
      },
    });

    expect(summary.failed).toBe(1);
    expect(mockedDeleteCollabDB).toHaveBeenCalledWith(rowKey);
    expect(mockedDbModule.__mockRecords.get(mockRecordKey(workspaceId, rowId))).toMatchObject({
      legacyCacheDeleted: true,
      status: 'failed',
    });
  });
});
