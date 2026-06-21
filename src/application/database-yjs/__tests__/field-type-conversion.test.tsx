import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import { getCellDataText, parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { useSwitchPropertyType } from '@/application/database-yjs/dispatch';
import {
  YDatabase,
  YDatabaseCell,
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

import type React from 'react';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const databaseId = 'database-id';
const viewId = 'view-id';
const rowId = 'row-id';
const fieldId = 'measurements-field-id';

// Mirrors what the buggy import produced: a MultiSelect field whose options are
// named after the original text values, with the cell storing option IDs.
const OPTIONS = [
  { id: 'opt_a', name: '0', color: 'Purple' },
  { id: 'opt_b', name: '60', color: 'Pink' },
  { id: 'opt_c', name: '82', color: 'Orange' },
];
const CELL_DATA = 'opt_a,opt_b,opt_c'; // option IDs, renders as "0,60,82"

function createMultiSelectField(): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;
  const now = '1000';

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Rsh measurements');
  field.set(YjsDatabaseKey.type, FieldType.MultiSelect);
  // created_at !== last_modified so the hook does not auto-rename the field.
  field.set(YjsDatabaseKey.created_at, now);
  field.set(YjsDatabaseKey.last_modified, '2000');

  const typeOptionMap = new Y.Map();
  const option = new Y.Map();

  option.set(YjsDatabaseKey.content, JSON.stringify({ disable_color: false, options: OPTIONS }));
  typeOptionMap.set(String(FieldType.MultiSelect), option);
  field.set(YjsDatabaseKey.type_option, typeOptionMap);

  return field;
}

function createDatabaseDoc(): YDoc {
  const doc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;

  fields.set(fieldId, createMultiSelectField());
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function getField(databaseDoc: YDoc): YDatabaseField {
  const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  return database.get(YjsDatabaseKey.fields).get(fieldId);
}

function getCell(rowDoc: YDoc): YDatabaseCell {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

  return row.get(YjsDatabaseKey.cells).get(fieldId);
}

function setup() {
  const databaseDoc = createDatabaseDoc();
  const rowDoc = createRowDoc(rowId, databaseId, {
    [fieldId]: { fieldType: FieldType.MultiSelect, data: CELL_DATA },
  });
  const contextValue = {
    readOnly: false,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: { [rowId]: rowDoc },
    workspaceId: 'workspace-id',
  } as unknown as DatabaseContextState;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
  const { result } = renderHook(() => useSwitchPropertyType(), { wrapper });

  return { databaseDoc, rowDoc, switchType: result.current };
}

describe('Bug B (fixed) — field-type conversion preserves select values', () => {
  it('baseline: MultiSelect cell renders its option names', () => {
    const { databaseDoc, rowDoc } = setup();

    expect(getCellDataText(getCell(rowDoc), getField(databaseDoc))).toBe('0,60,82');
  });

  it('MultiSelect -> Text: renders the option names as text (resolved by source type)', () => {
    const { databaseDoc, rowDoc, switchType } = setup();

    act(() => {
      switchType(fieldId, FieldType.RichText);
    });

    const cell = getCell(rowDoc);
    const field = getField(databaseDoc);

    // Raw data is preserved...
    expect(cell.get(YjsDatabaseKey.data)).toBe(CELL_DATA);

    // ...and now renders, because options are resolved by the cell's source
    // type (MultiSelect) rather than the field's current type (RichText).
    expect(getCellDataText(cell, field)).toBe('0,60,82');
    expect(parseYDatabaseCellToCell(cell, field).data as string).toBe('0,60,82');
  });

  it('round-trip MultiSelect -> Text -> MultiSelect: values stay visible', () => {
    const { databaseDoc, rowDoc, switchType } = setup();

    act(() => {
      switchType(fieldId, FieldType.RichText);
    });
    act(() => {
      switchType(fieldId, FieldType.MultiSelect);
    });

    const cell = getCell(rowDoc);
    const field = getField(databaseDoc);

    // Raw data survived the round-trip...
    expect(cell.get(YjsDatabaseKey.data)).toBe(CELL_DATA);

    // ...and the chips render again: the origin type was preserved (not
    // overwritten with the intermediate RichText hop), so the cell is native
    // MultiSelect once more.
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
    expect(getCellDataText(cell, field)).toBe('0,60,82');
  });
});

describe('Created/LastEditedTime -> DateTime (desktop parity: materialize timestamp)', () => {
  const TIMESTAMP = '1747180800'; // unix seconds

  function createTimestampField(type: FieldType): YDatabaseField {
    const field = new Y.Map() as YDatabaseField;

    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.name, 'Created');
    field.set(YjsDatabaseKey.type, type);
    field.set(YjsDatabaseKey.created_at, '1000');
    field.set(YjsDatabaseKey.last_modified, '2000');

    return field;
  }

  function setupTimestamp(type: FieldType, meta: { createdAt?: string; lastModified?: string }) {
    const doc = new Y.Doc({ guid: databaseId }) as YDoc;
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = new Y.Map() as YDatabase;
    const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
    const views = new Y.Map<YDatabaseView>() as YDatabaseViews;

    fields.set(fieldId, createTimestampField(type));
    views.set(viewId, new Y.Map() as YDatabaseView);
    database.set(YjsDatabaseKey.id, databaseId);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    sharedRoot.set(YjsEditorKey.database, database);

    // Row carries the timestamp on its meta and has NO cell for the field
    // (created/last-edited time has no cell data of its own).
    const rowDoc = createRowDoc(rowId, databaseId, {}, meta.createdAt ?? '0', meta.lastModified ?? '0');
    const contextValue = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: { [rowId]: rowDoc },
      workspaceId: 'workspace-id',
    } as unknown as DatabaseContextState;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result } = renderHook(() => useSwitchPropertyType(), { wrapper });

    return { databaseDoc: doc, rowDoc, switchType: result.current };
  }

  it('CreatedTime -> DateTime: materializes row.created_at into the cell and renders a date', () => {
    const { databaseDoc, rowDoc, switchType } = setupTimestamp(FieldType.CreatedTime, { createdAt: TIMESTAMP });

    act(() => {
      switchType(fieldId, FieldType.DateTime);
    });

    const cell = getCell(rowDoc);
    const field = getField(databaseDoc);

    expect(cell.get(YjsDatabaseKey.data)).toBe(TIMESTAMP);
    expect(getCellDataText(cell, field).length).toBeGreaterThan(0);
  });

  it('LastEditedTime -> DateTime: materializes row.last_modified into the cell', () => {
    const { rowDoc, switchType } = setupTimestamp(FieldType.LastEditedTime, { lastModified: TIMESTAMP });

    act(() => {
      switchType(fieldId, FieldType.DateTime);
    });

    expect(getCell(rowDoc).get(YjsDatabaseKey.data)).toBe(TIMESTAMP);
  });
});

// Mirrors desktop's real_data_transform_test.rs: A -> B -> A must restore the
// original displayed value AND leave the raw cell data untouched (only a user
// edit may change it). Each case is fully isolated (unique ids) to avoid any
// cross-case state bleed.
describe('round-trip A -> B -> A preserves cell data (desktop parity)', () => {
  let seq = 0;

  const selectContent = {
    disable_color: false,
    options: [
      { id: 'o1', name: 'Red', color: 'Purple' },
      { id: 'o2', name: 'Blue', color: 'Pink' },
    ],
  };
  const checklistData = JSON.stringify({
    options: [{ id: 'c1', name: 'Task', color: 0 }],
    selected_option_ids: ['c1'],
  });

  function setup(type: FieldType, typeOptionContent: unknown, cellData: string) {
    seq += 1;
    const guid = `rt-db-${seq}`;
    const fid = `rt-field-${seq}`;
    const rid = `rt-row-${seq}`;
    const vid = `rt-view-${seq}`;

    const field = new Y.Map() as YDatabaseField;

    field.set(YjsDatabaseKey.id, fid);
    field.set(YjsDatabaseKey.name, 'F');
    field.set(YjsDatabaseKey.type, type);
    field.set(YjsDatabaseKey.created_at, '1000');
    field.set(YjsDatabaseKey.last_modified, '2000');

    if (typeOptionContent !== undefined) {
      const typeOptionMap = new Y.Map();
      const option = new Y.Map();

      option.set(YjsDatabaseKey.content, JSON.stringify(typeOptionContent));
      typeOptionMap.set(String(type), option);
      field.set(YjsDatabaseKey.type_option, typeOptionMap);
    }

    const doc = new Y.Doc({ guid }) as YDoc;
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = new Y.Map() as YDatabase;
    const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
    const views = new Y.Map<YDatabaseView>() as YDatabaseViews;

    fields.set(fid, field);
    views.set(vid, new Y.Map() as YDatabaseView);
    database.set(YjsDatabaseKey.id, guid);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    sharedRoot.set(YjsEditorKey.database, database);

    const rowDoc = createRowDoc(rid, guid, { [fid]: { fieldType: type, data: cellData } });
    const contextValue = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: vid,
      activeViewId: vid,
      rowMap: { [rid]: rowDoc },
      workspaceId: 'workspace-id',
    } as unknown as DatabaseContextState;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result } = renderHook(() => useSwitchPropertyType(), { wrapper });

    const cellOf = () =>
      (rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow)
        .get(YjsDatabaseKey.cells)
        .get(fid);
    const fieldOf = () =>
      (doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
        .get(YjsDatabaseKey.fields)
        .get(fid);

    return { fid, result, cellOf, fieldOf };
  }

  const cases: Array<[string, FieldType, unknown, string, FieldType]> = [
    ['SingleSelect <-> MultiSelect', FieldType.SingleSelect, selectContent, 'o1', FieldType.MultiSelect],
    ['SingleSelect <-> RichText', FieldType.SingleSelect, selectContent, 'o1', FieldType.RichText],
    ['MultiSelect <-> RichText', FieldType.MultiSelect, selectContent, 'o1,o2', FieldType.RichText],
    ['Checkbox <-> RichText', FieldType.Checkbox, undefined, 'Yes', FieldType.RichText],
    ['Number <-> RichText', FieldType.Number, { format: 0 }, '42', FieldType.RichText],
    ['URL <-> RichText', FieldType.URL, undefined, 'http://example.com', FieldType.RichText],
    ['Checklist <-> RichText', FieldType.Checklist, undefined, checklistData, FieldType.RichText],
    ['DateTime <-> RichText', FieldType.DateTime, {}, '1747180800', FieldType.RichText],
  ];

  it.each(cases)('%s: round-trip restores value and keeps raw data', (_name, typeA, typeOpt, cellData, typeB) => {
    const { fid, result, cellOf, fieldOf } = setup(typeA, typeOpt, cellData);

    const before = getCellDataText(cellOf(), fieldOf());

    expect(before.length).toBeGreaterThan(0);

    act(() => {
      result.current(fid, typeB);
    });
    act(() => {
      result.current(fid, typeA);
    });

    expect(getCellDataText(cellOf(), fieldOf())).toBe(before);
    expect(cellOf().get(YjsDatabaseKey.data)).toBe(cellData);
  });
});
