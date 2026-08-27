import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  useDeleteRowDispatch,
  useDuplicateRowDispatch,
  useNewRowDispatch,
  useReorderRowDispatch,
} from '@/application/database-yjs/dispatch';
import { useDatabaseHistory } from '@/application/database-yjs/history';
import { getRowKey } from '@/application/database-yjs/row_meta';
import {
  DatabaseViewLayout,
  type YDatabase,
  type YDatabaseField,
  type YDatabaseFields,
  type YDatabaseRow,
  type YDatabaseView,
  type YDatabaseViews,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  type YSharedRoot,
} from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import { createCell, createRowDoc } from './test-helpers';

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  openCollabDB: jest.fn(async () => new Y.Doc()),
}));

jest.mock('@/application/sync-outbox', () => ({
  deleteOutboxByObjectId: jest.fn(),
}));

const databaseId = 'database-id';
const databaseDocId = '00000000-0000-4000-8000-000000000001';
const viewId = 'view-id';
const fieldId = 'name-field-id';
const firstRowId = 'first-row-id';
const secondRowId = 'second-row-id';
const thirdRowId = 'third-row-id';

type Fixture = {
  createdRows: Map<string, YDoc>;
  databaseDoc: YDoc;
  rowMap: Record<string, YDoc>;
  rowOrders: Y.Array<{ id: string; height: number }>;
};

function createField(): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Name');
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  return field;
}

function createFixture(rowIds: string[] = [firstRowId, secondRowId, thirdRowId]): Fixture {
  const databaseDoc = new Y.Doc({ guid: databaseDocId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>();
  const rowMap: Record<string, YDoc> = {};
  const createdRows = new Map<string, YDoc>();

  fields.set(fieldId, createField());
  rowOrders.push(rowIds.map((id) => ({ id, height: 36 })));
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.filters, new Y.Array());
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  rowIds.forEach((rowId) => {
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: createCell(FieldType.RichText, `Name for ${rowId}`),
    });

    rowDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.meta, new Y.Map());
    rowMap[rowId] = rowDoc;
  });

  return { createdRows, databaseDoc, rowMap, rowOrders };
}

function createWrapper(fixture: Fixture) {
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    createRow: async (rowKey: string) => {
      const rowDoc = new Y.Doc({ guid: rowKey }) as YDoc;

      fixture.createdRows.set(rowKey, rowDoc);
      return rowDoc;
    },
    databaseDoc: fixture.databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap: fixture.rowMap,
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: ReactNode }) => (
    <AFConfigContext.Provider
      value={{
        isAuthenticated: false,
        openLoginModal: () => undefined,
        updateCurrentUser: async () => undefined,
      }}
    >
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
}

function useRowLifecycleHistory() {
  const createRow = useNewRowDispatch();
  const duplicateRow = useDuplicateRowDispatch();
  const deleteRow = useDeleteRowDispatch();
  const reorderRow = useReorderRowDispatch();
  const history = useDatabaseHistory();

  return { createRow, deleteRow, duplicateRow, history, reorderRow };
}

function getRowOrderIds(fixture: Fixture) {
  return fixture.rowOrders.toArray().map(({ id }) => id);
}

function getCellData(rowDoc: YDoc) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

  return row.get(YjsDatabaseKey.cells).get(fieldId)?.get(YjsDatabaseKey.data);
}

describe('row lifecycle production hooks use database history', () => {
  it('creates a row and undoes and redoes its insertion', async () => {
    const fixture = createFixture([firstRowId, secondRowId]);
    const { result } = renderHook(useRowLifecycleHistory, { wrapper: createWrapper(fixture) });
    let createdRowId: string | null = null;

    await act(async () => {
      createdRowId = await result.current.createRow({});
    });

    expect(createdRowId).not.toBeNull();
    expect(getRowOrderIds(fixture)).toEqual([createdRowId, firstRowId, secondRowId]);
    expect(fixture.createdRows.has(getRowKey(databaseDocId, createdRowId as string))).toBe(true);

    act(() => result.current.history.undo());
    expect(getRowOrderIds(fixture)).toEqual([firstRowId, secondRowId]);

    act(() => result.current.history.redo());
    expect(getRowOrderIds(fixture)).toEqual([createdRowId, firstRowId, secondRowId]);
  });

  it('duplicates a row and undoes and redoes its insertion', async () => {
    const fixture = createFixture([firstRowId, secondRowId]);
    const { result } = renderHook(useRowLifecycleHistory, { wrapper: createWrapper(fixture) });
    let duplicatedRowId = '';

    await act(async () => {
      duplicatedRowId = await result.current.duplicateRow(firstRowId);
    });

    const duplicatedRowDoc = fixture.createdRows.get(getRowKey(databaseDocId, duplicatedRowId));

    expect(getRowOrderIds(fixture)).toEqual([firstRowId, duplicatedRowId, secondRowId]);
    expect(duplicatedRowDoc).toBeDefined();
    expect(getCellData(duplicatedRowDoc as YDoc)).toBe(`Name for ${firstRowId}`);

    act(() => result.current.history.undo());
    expect(getRowOrderIds(fixture)).toEqual([firstRowId, secondRowId]);

    act(() => result.current.history.redo());
    expect(getRowOrderIds(fixture)).toEqual([firstRowId, duplicatedRowId, secondRowId]);
  });

  it('deletes a row and undoes and redoes its removal', () => {
    const fixture = createFixture();
    const { result } = renderHook(useRowLifecycleHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.deleteRow(secondRowId));
    expect(getRowOrderIds(fixture)).toEqual([firstRowId, thirdRowId]);

    act(() => result.current.history.undo());
    expect(getRowOrderIds(fixture)).toEqual([firstRowId, secondRowId, thirdRowId]);

    act(() => result.current.history.redo());
    expect(getRowOrderIds(fixture)).toEqual([firstRowId, thirdRowId]);
  });

  it('reorders a row and undoes and redoes the new order', () => {
    const fixture = createFixture();
    const { result } = renderHook(useRowLifecycleHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.reorderRow(thirdRowId));
    expect(getRowOrderIds(fixture)).toEqual([thirdRowId, firstRowId, secondRowId]);

    act(() => result.current.history.undo());
    expect(getRowOrderIds(fixture)).toEqual([firstRowId, secondRowId, thirdRowId]);

    act(() => result.current.history.redo());
    expect(getRowOrderIds(fixture)).toEqual([thirdRowId, firstRowId, secondRowId]);
  });
});
