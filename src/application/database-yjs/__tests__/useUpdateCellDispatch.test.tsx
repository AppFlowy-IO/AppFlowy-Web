import { renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import {
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const databaseId = 'database-id';
const viewId = 'view-id';
const rowId = 'row-id';
const fieldId = 'name-field-id';

function createTextField(): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Name');
  field.set(YjsDatabaseKey.type, FieldType.RichText);

  return field;
}

function createDatabaseDoc(): YDoc {
  const doc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;

  fields.set(fieldId, createTextField());
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function getCellData(rowDoc: YDoc) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);
  const cells = row?.get(YjsDatabaseKey.cells);

  return cells?.get(fieldId)?.get(YjsDatabaseKey.data);
}

function createWrapper(contextValue: DatabaseContextState) {
  return ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useUpdateCellDispatch', () => {
  it('ensures a missing row doc before committing the cell update', async () => {
    const databaseDoc = createDatabaseDoc();
    const rowDoc = createRowDoc(rowId, databaseId, {});
    const ensureRow = jest.fn<Promise<YDoc>, [RowId]>().mockResolvedValue(rowDoc);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      ensureRow,
      workspaceId: 'workspace-id',
    };
    const { result } = renderHook(() => useUpdateCellDispatch(rowId, fieldId), {
      wrapper: createWrapper(contextValue),
    });

    result.current('Recovered value');

    await waitFor(() => {
      expect(getCellData(rowDoc)).toBe('Recovered value');
    });
    expect(ensureRow).toHaveBeenCalledWith(rowId);
  });
});
