import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn().mockResolvedValue(undefined),
  getCachedProviderDoc: jest.fn(),
  openCollabDB: jest.fn(),
}));

jest.mock('@/application/sync-outbox', () => ({
  deleteOutboxByObjectId: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/application/row-document/lifecycle', () => ({
  ensureRowDocumentView: jest.fn().mockResolvedValue(undefined),
  rowDocumentExists: jest.fn().mockResolvedValue(false),
  rowDocumentIdFromRowId: (rowId: string) => `document-${rowId}`,
  syncRowDocumentViewName: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/application/services/domains', () => ({
  PageService: {
    moveToTrash: jest.fn().mockResolvedValue(undefined),
  },
}));

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { useTrashAwareDeleteRowsDispatch } from '@/application/database-yjs/dispatch/row';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { ensureRowDocumentView } from '@/application/row-document/lifecycle';
import { YDatabase, YDatabaseView, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

function createFixture() {
  const rowId = 'row-1';
  const databaseDoc = new Y.Doc({ guid: 'database-guid' }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number; is_deleted?: boolean }>();
  const rowDoc = new Y.Doc() as YDoc;
  const rowRoot = rowDoc.getMap(YjsEditorKey.data_section);
  const meta = new Y.Map<unknown>();
  const metaKeys = getMetaIdMap(rowId);

  rowOrders.push([{ id: rowId, height: 36 }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set('view-id', view);
  // Intentionally omit YjsDatabaseKey.id to exercise the legacy GUID fallback.
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  meta.set(metaKeys.get(RowMetaKey.IsDocumentEmpty) as string, false);
  rowRoot.set(YjsEditorKey.meta, meta);

  const contextValue: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    databasePageId: 'database-page-id',
    activeViewId: 'view-id',
    rowMap: { [rowId]: rowDoc },
    workspaceId: 'workspace-id',
  };

  return { contextValue, rowId, rowOrders };
}

describe('useTrashAwareDeleteRowsDispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the database document GUID when the database id field is missing', async () => {
    const { contextValue, rowId, rowOrders } = createFixture();
    const { result } = renderHook(() => useTrashAwareDeleteRowsDispatch(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
      ),
    });

    await act(async () => {
      await result.current([rowId]);
    });

    await waitFor(() => {
      expect(ensureRowDocumentView).toHaveBeenCalledWith('workspace-id', expect.any(String), {
        database_id: 'database-guid',
        database_view_id: 'view-id',
        row_id: rowId,
      });
    });
    expect(rowOrders.toJSON()).toEqual([{ id: rowId, height: 36, is_deleted: true }]);
  });
});
