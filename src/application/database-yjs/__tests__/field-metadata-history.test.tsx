import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  useDuplicatePropertyDispatch,
  useReorderColumnDispatch,
  useUpdateNumberTypeOption,
  useUpdatePropertyIconDispatch,
  useUpdatePropertyNameDispatch,
} from '@/application/database-yjs/dispatch';
import { NumberFormat } from '@/application/database-yjs/fields';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { useDatabaseHistory } from '@/application/database-yjs/history';
import {
  type YDatabase,
  type YDatabaseField,
  type YDatabaseFieldOrders,
  type YDatabaseFields,
  type YDatabaseFieldSetting,
  type YDatabaseFieldSettings,
  type YDatabaseFieldTypeOption,
  type YDatabaseRow,
  type YDatabaseView,
  type YDatabaseViews,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  type YMapFieldTypeOption,
  type YSharedRoot,
} from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

const databaseId = 'database-id';
const viewId = 'view-id';
const rowId = 'row-id';
const textFieldId = 'text-field-id';
const secondTextFieldId = 'second-text-field-id';
const numberFieldId = 'number-field-id';
const relationFieldId = 'relation-field-id';

type Fixture = {
  databaseDoc: YDoc;
  fieldOrders: YDatabaseFieldOrders;
  fields: YDatabaseFields;
  fieldSettings: YDatabaseFieldSettings;
  rowDoc: YDoc;
  rowMap: Record<string, YDoc>;
};

function createField(id: string, name: string, fieldType: FieldType, icon: string): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;

  if (fieldType === FieldType.Number) {
    typeOption.set(YjsDatabaseKey.format, NumberFormat.Num);
  }

  typeOptions.set(String(fieldType), typeOption);
  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, fieldType);
  field.set(YjsDatabaseKey.icon, icon);
  field.set(YjsDatabaseKey.is_primary, false);
  field.set(YjsDatabaseKey.created_at, '1');
  field.set(YjsDatabaseKey.last_modified, '1');
  field.set(YjsDatabaseKey.type_option, typeOptions);
  return field;
}

function createFieldSetting(width: string): YDatabaseFieldSetting {
  const setting = new Y.Map() as YDatabaseFieldSetting;

  setting.set(YjsDatabaseKey.visibility, 'AlwaysShown');
  setting.set(YjsDatabaseKey.wrap, false);
  setting.set(YjsDatabaseKey.width, width);
  return setting;
}

function createFixture(): Fixture {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const fieldOrders = new Y.Array<{ id: string }>() as YDatabaseFieldOrders;
  const fieldSettings = new Y.Map() as YDatabaseFieldSettings;
  const relationData = new Y.Array<string>();
  const relationField = createRelationField(relationFieldId, {
    database_id: 'related-database-id',
    is_two_way: true,
    name: 'Links',
    reciprocal_field_id: 'reciprocal-field-id',
    reciprocal_field_name: 'Backlinks',
    source_limit: RelationLimit.OneOnly,
    target_limit: RelationLimit.NoLimit,
  });

  relationField.set(YjsDatabaseKey.icon, 'relation-icon');

  fields.set(textFieldId, createField(textFieldId, 'Text', FieldType.RichText, 'text-icon'));
  fields.set(secondTextFieldId, createField(secondTextFieldId, 'Notes', FieldType.RichText, 'notes-icon'));
  fields.set(numberFieldId, createField(numberFieldId, 'Amount', FieldType.Number, 'number-icon'));
  fields.set(relationFieldId, relationField);

  fieldOrders.push([
    { id: textFieldId },
    { id: secondTextFieldId },
    { id: numberFieldId },
    { id: relationFieldId },
  ]);
  fieldSettings.set(textFieldId, createFieldSetting('240'));
  fieldSettings.set(secondTextFieldId, createFieldSetting('180'));
  fieldSettings.set(numberFieldId, createFieldSetting('160'));
  fieldSettings.set(relationFieldId, createFieldSetting('220'));
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, fieldSettings);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  relationData.push(['related-row-id']);
  const rowDoc = createRowDoc(rowId, databaseId, {
    [textFieldId]: createCell(FieldType.RichText, 'Text value'),
    [secondTextFieldId]: createCell(FieldType.RichText, 'Notes value'),
    [numberFieldId]: createCell(FieldType.Number, '42'),
    [relationFieldId]: createCell(FieldType.Relation, relationData),
  });
  const rowMap = { [rowId]: rowDoc };

  return { databaseDoc, fieldOrders, fields, fieldSettings, rowDoc, rowMap };
}

function createWrapper(fixture: Fixture) {
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc: fixture.databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap: fixture.rowMap,
    workspaceId: 'workspace-id',
  };

  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

function useFieldMetadataHistory() {
  const updateName = useUpdatePropertyNameDispatch(textFieldId);
  const updateIcon = useUpdatePropertyIconDispatch(textFieldId);
  const updateRelationName = useUpdatePropertyNameDispatch(relationFieldId);
  const updateRelationIcon = useUpdatePropertyIconDispatch(relationFieldId);
  const reorderField = useReorderColumnDispatch();
  const duplicateField = useDuplicatePropertyDispatch();
  const updateNumberTypeOption = useUpdateNumberTypeOption();
  const history = useDatabaseHistory();

  return {
    duplicateField,
    history,
    reorderField,
    updateIcon,
    updateName,
    updateNumberTypeOption,
    updateRelationIcon,
    updateRelationName,
  };
}

function getFieldOrderIds(fixture: Fixture) {
  return fixture.fieldOrders.toArray().map(({ id }) => id);
}

function getRow(fixture: Fixture) {
  return fixture.rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
}

function getCellData(fixture: Fixture, fieldId: string) {
  return getRow(fixture).get(YjsDatabaseKey.cells).get(fieldId)?.get(YjsDatabaseKey.data);
}

function getNumberFormat(fixture: Fixture) {
  return fixture.fields
    .get(numberFieldId)
    .get(YjsDatabaseKey.type_option)
    .get(String(FieldType.Number))
    .get(YjsDatabaseKey.format);
}

function expectOrdinaryDuplicate(fixture: Fixture, duplicatedFieldId: string) {
  const field = fixture.fields.get(duplicatedFieldId);

  expect(field).toBeDefined();
  expect(field.get(YjsDatabaseKey.name)).toBe('Text (copy)');
  expect(field.get(YjsDatabaseKey.type)).toBe(FieldType.RichText);
  expect(field.get(YjsDatabaseKey.icon)).toBe('text-icon');
  expect(getFieldOrderIds(fixture)).toEqual([
    textFieldId,
    duplicatedFieldId,
    secondTextFieldId,
    numberFieldId,
    relationFieldId,
  ]);
  expect(fixture.fieldSettings.get(duplicatedFieldId)?.get(YjsDatabaseKey.width)).toBe('240');
  expect(getCellData(fixture, duplicatedFieldId)).toBe('Text value');
}

function expectRelationDuplicate(fixture: Fixture, duplicatedFieldId: string) {
  const field = fixture.fields.get(duplicatedFieldId);
  const rawOption = field.get(YjsDatabaseKey.type_option).get(String(FieldType.Relation));
  const relationData = getCellData(fixture, duplicatedFieldId) as Y.Array<string>;

  expect(field.get(YjsDatabaseKey.name)).toBe('Links (copy)');
  expect(field.get(YjsDatabaseKey.type)).toBe(FieldType.Relation);
  expect(field.get(YjsDatabaseKey.icon)).toBe('relation-icon');
  expect(parseRelationTypeOption(field)).toEqual({
    database_id: 'related-database-id',
    is_two_way: false,
    reciprocal_field_id: undefined,
    reciprocal_field_name: undefined,
    source_limit: RelationLimit.OneOnly,
    target_limit: RelationLimit.NoLimit,
  });
  expect(rawOption.has(YjsDatabaseKey.is_two_way)).toBe(false);
  expect(rawOption.has(YjsDatabaseKey.reciprocal_field_id)).toBe(false);
  expect(rawOption.has(YjsDatabaseKey.reciprocal_field_name)).toBe(false);
  expect(getFieldOrderIds(fixture)).toEqual([
    textFieldId,
    secondTextFieldId,
    numberFieldId,
    relationFieldId,
    duplicatedFieldId,
  ]);
  expect(fixture.fieldSettings.get(duplicatedFieldId)?.get(YjsDatabaseKey.width)).toBe('220');
  expect(relationData.toArray()).toEqual(['related-row-id']);
}

describe('field metadata production hooks use database history', () => {
  it('renames a field and undoes and redoes the name', () => {
    const fixture = createFixture();
    const { result } = renderHook(useFieldMetadataHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.updateName('Renamed text'));
    expect(fixture.fields.get(textFieldId).get(YjsDatabaseKey.name)).toBe('Renamed text');

    act(() => result.current.history.undo());
    expect(fixture.fields.get(textFieldId).get(YjsDatabaseKey.name)).toBe('Text');

    act(() => result.current.history.redo());
    expect(fixture.fields.get(textFieldId).get(YjsDatabaseKey.name)).toBe('Renamed text');
  });

  it('updates a field icon and undoes and redoes the icon', () => {
    const fixture = createFixture();
    const { result } = renderHook(useFieldMetadataHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.updateIcon('updated-icon'));
    expect(fixture.fields.get(textFieldId).get(YjsDatabaseKey.icon)).toBe('updated-icon');

    act(() => result.current.history.undo());
    expect(fixture.fields.get(textFieldId).get(YjsDatabaseKey.icon)).toBe('text-icon');

    act(() => result.current.history.redo());
    expect(fixture.fields.get(textFieldId).get(YjsDatabaseKey.icon)).toBe('updated-icon');
  });

  it('renames a Relation field and undoes and redoes the local name', () => {
    const fixture = createFixture();
    const { result } = renderHook(useFieldMetadataHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.updateRelationName('Linked records'));
    expect(fixture.fields.get(relationFieldId).get(YjsDatabaseKey.name)).toBe('Linked records');

    act(() => result.current.history.undo());
    expect(fixture.fields.get(relationFieldId).get(YjsDatabaseKey.name)).toBe('Links');

    act(() => result.current.history.redo());
    expect(fixture.fields.get(relationFieldId).get(YjsDatabaseKey.name)).toBe('Linked records');
  });

  it('updates a Relation field icon and undoes and redoes the local icon', () => {
    const fixture = createFixture();
    const { result } = renderHook(useFieldMetadataHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.updateRelationIcon('updated-relation-icon'));
    expect(fixture.fields.get(relationFieldId).get(YjsDatabaseKey.icon)).toBe('updated-relation-icon');

    act(() => result.current.history.undo());
    expect(fixture.fields.get(relationFieldId).get(YjsDatabaseKey.icon)).toBe('relation-icon');

    act(() => result.current.history.redo());
    expect(fixture.fields.get(relationFieldId).get(YjsDatabaseKey.icon)).toBe('updated-relation-icon');
  });

  it('reorders a field and undoes and redoes the order', () => {
    const fixture = createFixture();
    const { result } = renderHook(useFieldMetadataHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.reorderField(relationFieldId));
    expect(getFieldOrderIds(fixture)).toEqual([
      relationFieldId,
      textFieldId,
      secondTextFieldId,
      numberFieldId,
    ]);

    act(() => result.current.history.undo());
    expect(getFieldOrderIds(fixture)).toEqual([
      textFieldId,
      secondTextFieldId,
      numberFieldId,
      relationFieldId,
    ]);

    act(() => result.current.history.redo());
    expect(getFieldOrderIds(fixture)).toEqual([
      relationFieldId,
      textFieldId,
      secondTextFieldId,
      numberFieldId,
    ]);
  });

  it('duplicates a non-relation field atomically and undoes and redoes every local copy', () => {
    const fixture = createFixture();
    const { result } = renderHook(useFieldMetadataHistory, { wrapper: createWrapper(fixture) });
    let duplicatedFieldId = '';

    act(() => {
      duplicatedFieldId = result.current.duplicateField(textFieldId);
    });
    expectOrdinaryDuplicate(fixture, duplicatedFieldId);

    act(() => result.current.history.undo());
    expect(fixture.fields.has(duplicatedFieldId)).toBe(false);
    expect(fixture.fieldSettings.has(duplicatedFieldId)).toBe(false);
    expect(getFieldOrderIds(fixture)).not.toContain(duplicatedFieldId);
    expect(getRow(fixture).get(YjsDatabaseKey.cells).has(duplicatedFieldId)).toBe(false);

    act(() => result.current.history.redo());
    expectOrdinaryDuplicate(fixture, duplicatedFieldId);
  });

  it('duplicates a Relation field as one-way and undoes and redoes every local copy', () => {
    const fixture = createFixture();
    const { result } = renderHook(useFieldMetadataHistory, { wrapper: createWrapper(fixture) });
    let duplicatedFieldId = '';

    act(() => {
      duplicatedFieldId = result.current.duplicateField(relationFieldId);
    });
    expectRelationDuplicate(fixture, duplicatedFieldId);

    act(() => result.current.history.undo());
    expect(fixture.fields.has(duplicatedFieldId)).toBe(false);
    expect(fixture.fieldSettings.has(duplicatedFieldId)).toBe(false);
    expect(getFieldOrderIds(fixture)).not.toContain(duplicatedFieldId);
    expect(getRow(fixture).get(YjsDatabaseKey.cells).has(duplicatedFieldId)).toBe(false);
    expect(parseRelationTypeOption(fixture.fields.get(relationFieldId)).is_two_way).toBe(true);

    act(() => result.current.history.redo());
    expectRelationDuplicate(fixture, duplicatedFieldId);
  });

  it('updates a non-relation number type option and undoes and redoes the format', () => {
    const fixture = createFixture();
    const { result } = renderHook(useFieldMetadataHistory, { wrapper: createWrapper(fixture) });

    act(() => result.current.updateNumberTypeOption(numberFieldId, NumberFormat.USD));
    expect(getNumberFormat(fixture)).toBe(NumberFormat.USD);

    act(() => result.current.history.undo());
    expect(getNumberFormat(fixture)).toBe(NumberFormat.Num);

    act(() => result.current.history.redo());
    expect(getNumberFormat(fixture)).toBe(NumberFormat.USD);
  });
});
