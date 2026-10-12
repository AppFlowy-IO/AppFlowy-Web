import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { getCellDataText } from '@/application/database-yjs/cell.parse';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { useNewPropertyDispatch, useSwitchPropertyType } from '@/application/database-yjs/dispatch';
import { useUpdateAnyCellDispatch } from '@/application/database-yjs/dispatch/cell';
import {
  DatabaseViewLayout,
  type YDatabase,
  type YDatabaseField,
  type YDatabaseRow,
  type YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createRowDoc } from './test-helpers';

import type { ReactNode } from 'react';

/**
 * Regression coverage for https://github.com/AppFlowy-IO/AppFlowy/issues/9052.
 *
 * Older native TypeOptionCellExt requires a type_option["0"] map to construct its
 * Text handler, even though that handler has no settings. Web can display the
 * same cell without it. These tests exercise the real Web creation, switching,
 * editing, and serialization paths and assert the native metadata contract.
 * They do not simulate a native client or establish the reporter's original
 * field-creation history.
 */
const databaseId = 'issue-9052-database';
const viewId = 'issue-9052-grid';
const rowIds = ['issue-9052-row-1', 'issue-9052-row-2'];
const textValues = ['Mayo', 'Fahie'];

function getDatabase(doc: YDoc): YDatabase {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
}

function getField(doc: YDoc, fieldId: string): YDatabaseField {
  return getDatabase(doc).get(YjsDatabaseKey.fields).get(fieldId);
}

function readWebText(rowDoc: YDoc, field: YDatabaseField): string {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
  const cell = row.get(YjsDatabaseKey.cells).get(field.get(YjsDatabaseKey.id));

  return getCellDataText(cell, field);
}

function reloadDoc(doc: YDoc): YDoc {
  const reloaded = new Y.Doc({ guid: doc.guid }) as YDoc;

  Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(doc));
  return reloaded;
}

function setup() {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map();
  const view = new Y.Map();
  const views = new Y.Map();
  const orders = new Y.Array<{ id: string; height: number }>();
  const rowMap = Object.fromEntries(rowIds.map((rowId) => [rowId, createRowDoc(rowId, databaseId, {})]));

  orders.push(rowIds.map((id) => ({ id, height: 36 })));
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.field_orders, new Y.Array());
  view.set(YjsDatabaseKey.field_settings, new Y.Map());
  view.set(YjsDatabaseKey.row_orders, orders);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, new Y.Map());
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const context: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap,
    workspaceId: 'issue-9052-workspace',
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );
  const { result } = renderHook(
    () => ({
      createField: useNewPropertyDispatch(),
      switchType: useSwitchPropertyType(),
      writeCell: useUpdateAnyCellDispatch(),
    }),
    { wrapper }
  );

  function createField(type: FieldType): string {
    let fieldId = '';

    act(() => {
      fieldId = result.current.createField(type);
    });

    expect(getField(databaseDoc, fieldId).get(YjsDatabaseKey.type)).toBe(type);
    return fieldId;
  }

  async function switchType(fieldId: string, type: FieldType): Promise<void> {
    await act(async () => {
      await result.current.switchType(fieldId, type);
    });

    expect(getField(databaseDoc, fieldId).get(YjsDatabaseKey.type)).toBe(type);
  }

  async function writeText(fieldId: string, values = textValues): Promise<void> {
    // Both rows start without a cell for this field, covering fresh cell writes.
    for (const [index, rowId] of rowIds.entries()) {
      await act(async () => {
        expect(await result.current.writeCell(rowId, fieldId, values[index])).toBe('written');
      });
    }
  }

  function reloadField(fieldId: string, values = textValues): YDatabaseField {
    const field = getField(reloadDoc(databaseDoc), fieldId);
    const text = rowIds.map((rowId) => readWebText(reloadDoc(rowMap[rowId]), field));

    // Prove that the Web writes and serialized payloads are intact before
    // checking the separate metadata contract consumed by native clients.
    expect(text).toEqual(values);
    return field;
  }

  return { createField, switchType, writeText, reloadField };
}

function expectNativeTextMetadata(field: YDatabaseField): void {
  expect(field.get(YjsDatabaseKey.type)).toBe(FieldType.RichText);
  expect(field.get(YjsDatabaseKey.type_option)?.toJSON()).toHaveProperty(String(FieldType.RichText), expect.any(Object));
}

describe('issue #9052: Web Text field metadata required by native clients', () => {
  it('control: directly creating Text keeps its values and native metadata after reload', async () => {
    const fixture = setup();
    const fieldId = fixture.createField(FieldType.RichText);

    await fixture.writeText(fieldId);
    expectNativeTextMetadata(fixture.reloadField(fieldId));
  });

  it('creates native Text metadata when a Number field is switched to Text and edited', async () => {
    const fixture = setup();
    const healthyFieldId = fixture.createField(FieldType.RichText);
    const convertedFieldId = fixture.createField(FieldType.Number);

    await fixture.writeText(healthyFieldId, ['ID-1', 'ID-2']);
    await fixture.switchType(convertedFieldId, FieldType.RichText);
    await fixture.writeText(convertedFieldId);

    expectNativeTextMetadata(fixture.reloadField(healthyFieldId, ['ID-1', 'ID-2']));
    expectNativeTextMetadata(fixture.reloadField(convertedFieldId));
  });

  it('keeps native Text metadata after a converted field makes a Text -> Number -> Text round-trip', async () => {
    const fixture = setup();
    const fieldId = fixture.createField(FieldType.Number);

    await fixture.switchType(fieldId, FieldType.RichText);
    await fixture.writeText(fieldId);
    await fixture.switchType(fieldId, FieldType.Number);
    await fixture.writeText(fieldId, ['11', '50']);

    const numberField = fixture.reloadField(fieldId, ['11', '50']);

    expect(numberField.get(YjsDatabaseKey.type_option).get(String(FieldType.Number))).toBeInstanceOf(Y.Map);
    await fixture.switchType(fieldId, FieldType.RichText);
    await fixture.writeText(fieldId);

    expectNativeTextMetadata(fixture.reloadField(fieldId));
  });

  it('control: a fresh replacement Text field accepts the same values with compatible metadata', async () => {
    const fixture = setup();
    const convertedFieldId = fixture.createField(FieldType.Number);

    await fixture.switchType(convertedFieldId, FieldType.RichText);
    await fixture.writeText(convertedFieldId);
    fixture.reloadField(convertedFieldId);

    const replacementFieldId = fixture.createField(FieldType.RichText);

    await fixture.writeText(replacementFieldId);
    expectNativeTextMetadata(fixture.reloadField(replacementFieldId));
  });
});
