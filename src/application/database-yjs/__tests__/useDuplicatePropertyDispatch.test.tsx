import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import { getCellDataText } from '@/application/database-yjs/cell.parse';
import { useDuplicatePropertyDispatch } from '@/application/database-yjs/dispatch';
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

describe('useDuplicatePropertyDispatch', () => {
  it('preserves stored cell types and every retained type option', () => {
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
    const richTextOption = new Y.Map();
    const multiSelectOption = new Y.Map();
    const relationOption = new Y.Map();
    const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
    const view = new Y.Map() as YDatabaseView;
    const fieldOrders = new Y.Array<{ id: string }>();
    const fieldSettings = new Y.Map<Y.Map<unknown>>();

    multiSelectOption.set(
      YjsDatabaseKey.content,
      JSON.stringify({
        disable_color: false,
        options: [{ id: 'opt-a', name: 'Alpha', color: 'Purple' }],
      })
    );
    typeOptions.set(String(FieldType.RichText), richTextOption);
    typeOptions.set(String(FieldType.MultiSelect), multiSelectOption);
    relationOption.set(YjsDatabaseKey.database_id, 'related-database');
    relationOption.set(YjsDatabaseKey.is_two_way, true);
    relationOption.set(YjsDatabaseKey.reciprocal_field_id, 'reciprocal-id');
    relationOption.set(YjsDatabaseKey.reciprocal_field_name, 'Backlink');
    typeOptions.set(String(FieldType.Relation), relationOption);
    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.name, 'Converted');
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    field.set(YjsDatabaseKey.type_option, typeOptions);
    fields.set(fieldId, field);
    fieldOrders.push([{ id: fieldId }]);
    fieldSettings.set(fieldId, new Y.Map());
    view.set(YjsDatabaseKey.field_orders, fieldOrders);
    view.set(YjsDatabaseKey.field_settings, fieldSettings);
    views.set(viewId, view);
    database.set(YjsDatabaseKey.id, databaseId);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    root.set(YjsEditorKey.database, database);

    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.MultiSelect, data: 'opt-a' },
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
    const { result } = renderHook(() => useDuplicatePropertyDispatch(), { wrapper });
    let duplicateFieldId = '';

    act(() => {
      duplicateFieldId = result.current(fieldId);
    });

    const duplicateField = fields.get(duplicateFieldId);
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const duplicateCell = row.get(YjsDatabaseKey.cells).get(duplicateFieldId);

    expect(duplicateField.get(YjsDatabaseKey.type_option).has(String(FieldType.RichText))).toBe(true);
    expect(duplicateField.get(YjsDatabaseKey.type_option).has(String(FieldType.MultiSelect))).toBe(true);
    const duplicateRelationOption = duplicateField.get(YjsDatabaseKey.type_option).get(String(FieldType.Relation));

    expect(duplicateRelationOption.get(YjsDatabaseKey.database_id)).toBe('related-database');
    expect(duplicateRelationOption.get(YjsDatabaseKey.is_two_way)).toBe(false);
    expect(duplicateRelationOption.get(YjsDatabaseKey.reciprocal_field_id)).toBeUndefined();
    expect(duplicateRelationOption.get(YjsDatabaseKey.reciprocal_field_name)).toBeUndefined();
    expect(duplicateCell.get(YjsDatabaseKey.data)).toBe('opt-a');
    expect(duplicateCell.get(YjsDatabaseKey.field_type)).toBe(FieldType.MultiSelect);
    expect(duplicateCell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
    expect(getCellDataText(duplicateCell, duplicateField)).toBe('Alpha');
  });
});
