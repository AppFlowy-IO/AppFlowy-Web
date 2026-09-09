import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import { useMoveCardDispatch } from '@/application/database-yjs/dispatch';
import { defaultNumberGroupConfiguration, NumberGroupMode } from '@/application/database-yjs/number-grouping';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseGroup,
  YDatabaseGroups,
  YDatabaseRow,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

import type { ReactNode } from 'react';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

describe('useMoveCardDispatch', () => {
  it.each([
    [NumberGroupMode.Range, 'number_interval_0_10', 'number_interval_10_20', '10'],
    [NumberGroupMode.Range, 'number_interval_0_10', 'number_below_0', '-10'],
    [NumberGroupMode.Range, 'number_interval_0_10', 'number_above_100', '110'],
    [NumberGroupMode.Exact, 'number_value_1.25', 'number_value_-0.5', '-0.5'],
    [NumberGroupMode.Legacy, 'number_range_0_100', 'number_range_-100_0', '-100'],
    [NumberGroupMode.Exact, 'amount', 'number_value_1710000000', '1710000000', FieldType.DateTime, '1710000000'],
  ])('writes the numeric representative in mode %s from %s to %s and preserves same-group values', (mode, start, finish, value, storedType = FieldType.Number, rawValue = '1.25') => {
    const databaseId = 'numeric-database';
    const viewId = 'numeric-view';
    const fieldId = 'amount';
    const rowId = 'numeric-row';
    const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
    const database = new Y.Map() as YDatabase;
    const fields = new Y.Map() as YDatabaseFields;
    const field = new Y.Map() as YDatabaseField;
    const views = new Y.Map() as YDatabaseViews;
    const view = new Y.Map() as YDatabaseView;
    const groups = new Y.Array() as YDatabaseGroups;
    const group = new Y.Map() as YDatabaseGroup;

    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.type, FieldType.Number);
    fields.set(fieldId, field);
    group.set(YjsDatabaseKey.field_id, fieldId);
    group.set(YjsDatabaseKey.content, JSON.stringify(defaultNumberGroupConfiguration(mode as NumberGroupMode)));
    groups.push([group]);
    view.set(YjsDatabaseKey.groups, groups);
    view.set(YjsDatabaseKey.row_orders, Y.Array.from([{ id: rowId, height: 36 }]));
    views.set(viewId, view);
    database.set(YjsDatabaseKey.id, databaseId);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    const rowDoc = createRowDoc(rowId, databaseId, { [fieldId]: createCell(storedType, rawValue) });
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId);
    const contextValue = {
      readOnly: false, databaseDoc, databasePageId: viewId, activeViewId: viewId,
      rowMap: { [rowId]: rowDoc }, workspaceId: 'workspace-id',
    } as DatabaseContextState;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result, unmount } = renderHook(useMoveCardDispatch, { wrapper });
    const before = cell.toJSON();

    act(() => result.current({ rowId, fieldId, startColumnId: start as string, finishColumnId: start as string }));
    expect(cell.toJSON()).toEqual(before);
    act(() => result.current({ rowId, fieldId, startColumnId: start as string, finishColumnId: finish as string }));
    expect(cell.get(YjsDatabaseKey.data)).toBe(value);
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.Number);
    act(() => result.current({ rowId, fieldId, startColumnId: finish as string, finishColumnId: fieldId }));
    expect(cell.get(YjsDatabaseKey.data)).toBe('');
    act(() => row.get(YjsDatabaseKey.cells).delete(fieldId));
    act(() => result.current({ rowId, fieldId, startColumnId: fieldId, finishColumnId: finish as string }));
    expect(row.get(YjsDatabaseKey.cells).get(fieldId).get(YjsDatabaseKey.data)).toBe(value);
    unmount();
    rowDoc.destroy(); databaseDoc.destroy();
  });

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
    const wrapper = ({ children }: { children: ReactNode }) => (
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
