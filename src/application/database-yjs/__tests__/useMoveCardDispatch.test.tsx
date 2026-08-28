import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import { useMoveCardDispatch } from '@/application/database-yjs/dispatch';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
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

describe('useMoveCardDispatch', () => {
  it('transforms a lazy cell before writing the new board group value', () => {
    const databaseId = 'database-id';
    const viewId = 'view-id';
    const fieldId = 'field-id';
    const rowId = 'row-id';
    const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
    const root = databaseDoc.getMap(YjsEditorKey.data_section);
    const database = new Y.Map() as YDatabase;
    const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
    const field = new Y.Map() as YDatabaseField;
    const typeOptions = new Y.Map();
    const selectOption = new Y.Map();
    const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
    const view = new Y.Map() as YDatabaseView;
    const rowOrders = new Y.Array<{ id: string; height: number }>();

    selectOption.set(
      YjsDatabaseKey.content,
      JSON.stringify({
        disable_color: false,
        options: [
          { id: 'alpha-id', name: 'Alpha', color: 'Purple' },
          { id: 'beta-id', name: 'Beta', color: 'Pink' },
          { id: 'gamma-id', name: 'Gamma', color: 'Orange' },
        ],
      })
    );
    typeOptions.set(String(FieldType.MultiSelect), selectOption);
    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.type, FieldType.MultiSelect);
    field.set(YjsDatabaseKey.type_option, typeOptions);
    fields.set(fieldId, field);
    rowOrders.push([{ id: rowId, height: 36 }]);
    view.set(YjsDatabaseKey.row_orders, rowOrders);
    views.set(viewId, view);
    database.set(YjsDatabaseKey.id, databaseId);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    root.set(YjsEditorKey.database, database);

    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.RichText, data: 'Alpha,Gamma' },
    });
    const contextValue = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: { [rowId]: rowDoc },
      workspaceId: 'workspace-id',
    } as DatabaseContextState;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result } = renderHook(() => useMoveCardDispatch(), { wrapper });

    act(() => {
      result.current({
        rowId,
        fieldId,
        startColumnId: 'alpha-id',
        finishColumnId: 'beta-id',
      });
    });

    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId);

    expect(cell.get(YjsDatabaseKey.data)).toBe('beta-id,gamma-id');
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.MultiSelect);
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
  });
});
