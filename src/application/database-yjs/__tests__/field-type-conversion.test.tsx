import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import { getCellDataText, parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { useSwitchPropertyType } from '@/application/database-yjs/dispatch';
import { parseSelectOptionTypeOptions, SelectOptionColor } from '@/application/database-yjs/fields';
import { useCellSelector } from '@/application/database-yjs/selector';
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
  const { result } = renderHook(
    () => ({
      cell: useCellSelector({ rowId, fieldId }),
      switchType: useSwitchPropertyType(),
    }),
    { wrapper }
  );

  return { databaseDoc, rowDoc, result, switchType: result.current.switchType };
}

describe('Bug B (fixed) — field-type conversion preserves select values', () => {
  it('baseline: MultiSelect cell renders its option names', () => {
    const { databaseDoc, rowDoc } = setup();

    expect(getCellDataText(getCell(rowDoc), getField(databaseDoc))).toBe('0,60,82');
  });

  it('MultiSelect -> Text: renders the option names as text (resolved by source type)', () => {
    const { databaseDoc, rowDoc, switchType } = setup();

    act(() => {
      void switchType(fieldId, FieldType.RichText);
    });

    const cell = getCell(rowDoc);
    const field = getField(databaseDoc);

    // Raw data is preserved...
    expect(cell.get(YjsDatabaseKey.data)).toBe(CELL_DATA);
    expect(field.get(YjsDatabaseKey.type)).toBe(FieldType.RichText);
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.MultiSelect);
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();

    // ...and now renders, because options are resolved by the cell's source
    // type (MultiSelect) rather than the field's current type (RichText).
    expect(getCellDataText(cell, field)).toBe('0,60,82');
    expect(parseYDatabaseCellToCell(cell, field).data as string).toBe('0,60,82');
  });

  it('round-trip MultiSelect -> Text -> MultiSelect: values stay visible', () => {
    const { databaseDoc, rowDoc, switchType } = setup();

    act(() => {
      void switchType(fieldId, FieldType.RichText);
    });
    act(() => {
      void switchType(fieldId, FieldType.MultiSelect);
    });

    const cell = getCell(rowDoc);
    const field = getField(databaseDoc);

    // Raw data survived the round-trip...
    expect(cell.get(YjsDatabaseKey.data)).toBe(CELL_DATA);

    // ...and the chips render again: the origin type was preserved (not
    // overwritten with the intermediate RichText hop), so the cell is native
    // MultiSelect once more.
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.MultiSelect);
    expect(getCellDataText(cell, field)).toBe('0,60,82');
  });

  it('schema-only switching immediately refreshes the subscribed cell value', async () => {
    const { result, switchType } = setup();

    expect(result.current.cell?.fieldType).toBe(FieldType.MultiSelect);

    act(() => {
      void switchType(fieldId, FieldType.RichText);
    });

    await waitFor(() => {
      expect(result.current.cell?.fieldType).toBe(FieldType.RichText);
      expect(result.current.cell?.data).toBe('0,60,82');
    });
  });

  it('normalizes a legacy Web source marker on the next switch without changing data', () => {
    const { databaseDoc, rowDoc, switchType } = setup();
    const cell = getCell(rowDoc);
    const field = getField(databaseDoc);

    act(() => {
      field.set(YjsDatabaseKey.type, FieldType.RichText);
      cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
      cell.set(YjsDatabaseKey.source_field_type, String(FieldType.MultiSelect));
    });

    act(() => {
      void switchType(fieldId, FieldType.MultiSelect);
    });

    expect(cell.get(YjsDatabaseKey.data)).toBe(CELL_DATA);
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.MultiSelect);
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
    expect(getCellDataText(cell, field)).toBe('0,60,82');
  });

  it('canonicalizes a string cell field_type for Desktop on switch', () => {
    const { rowDoc, switchType } = setup();
    const cell = getCell(rowDoc);

    act(() => {
      cell.set(YjsDatabaseKey.field_type, String(FieldType.MultiSelect));
    });

    act(() => {
      void switchType(fieldId, FieldType.RichText);
    });

    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.MultiSelect);
    expect(cell.get(YjsDatabaseKey.data)).toBe(CELL_DATA);
  });

  it('replaces a stale target select option set from the immediately previous select type', () => {
    const { databaseDoc, rowDoc, switchType } = setup();
    const field = getField(databaseDoc);
    const staleOption = new Y.Map();

    act(() => {
      staleOption.set(
        YjsDatabaseKey.content,
        JSON.stringify({
          disable_color: false,
          options: [{ id: 'stale', name: 'Stale', color: SelectOptionColor.OptionColor1 }],
        })
      );
      field.get(YjsDatabaseKey.type_option).set(String(FieldType.SingleSelect), staleOption);
    });

    act(() => {
      void switchType(fieldId, FieldType.SingleSelect);
    });

    expect(parseSelectOptionTypeOptions(field).options).toEqual(OPTIONS);
    expect(getCellDataText(getCell(rowDoc), field)).toBe('0,60,82');
  });

  it('adds missing Desktop Yes/No options to an existing select target', () => {
    const { databaseDoc, rowDoc, switchType } = setup();
    const field = getField(databaseDoc);
    const cell = getCell(rowDoc);
    const targetOption = new Y.Map();

    act(() => {
      targetOption.set(
        YjsDatabaseKey.content,
        JSON.stringify({
          disable_color: false,
          options: [{ id: 'existing', name: 'Existing', color: SelectOptionColor.OptionColor1 }],
        })
      );
      field.get(YjsDatabaseKey.type_option).set(String(FieldType.SingleSelect), targetOption);
      field.set(YjsDatabaseKey.type, FieldType.Checkbox);
      cell.set(YjsDatabaseKey.field_type, FieldType.Checkbox);
      cell.set(YjsDatabaseKey.data, 'Yes');
    });

    act(() => {
      void switchType(fieldId, FieldType.SingleSelect);
    });

    expect(parseSelectOptionTypeOptions(field).options.map(({ name, color }) => ({ name, color }))).toEqual([
      { name: 'Existing', color: SelectOptionColor.OptionColor1 },
      { name: 'Yes', color: SelectOptionColor.OptionColor7 },
      { name: 'No', color: SelectOptionColor.OptionColor5 },
    ]);
    expect(getCellDataText(cell, field)).toBe('Yes');
  });

  it('merges edited RichText values into a preserved select option set', () => {
    const { databaseDoc, rowDoc, switchType } = setup();
    const field = getField(databaseDoc);
    const cell = getCell(rowDoc);

    act(() => {
      void switchType(fieldId, FieldType.RichText);
    });
    act(() => {
      cell.set(YjsDatabaseKey.data, 'New option');
      cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    });
    act(() => {
      void switchType(fieldId, FieldType.MultiSelect);
    });

    const options = parseSelectOptionTypeOptions(field).options;

    expect(options.slice(0, OPTIONS.length)).toEqual(OPTIONS);
    expect(options.filter(({ name }) => name === 'New option')).toHaveLength(1);
    expect(getCellDataText(cell, field)).toBe('New option');
  });

  it('merges Checklist values without duplicating preserved select options', () => {
    const { databaseDoc, rowDoc, switchType } = setup();
    const field = getField(databaseDoc);
    const cell = getCell(rowDoc);
    const existingTask = {
      id: 'existing-task',
      name: 'Task',
      color: SelectOptionColor.OptionColor1,
    };
    const checklistData = JSON.stringify({
      options: [
        { id: 'check-task', name: 'Task', color: SelectOptionColor.OptionColor2 },
        { id: 'check-new', name: 'New task', color: SelectOptionColor.OptionColor3 },
      ],
      selected_option_ids: ['check-task', 'check-new'],
    });

    act(() => {
      field
        .get(YjsDatabaseKey.type_option)
        .get(String(FieldType.MultiSelect))
        .set(YjsDatabaseKey.content, JSON.stringify({ disable_color: false, options: [existingTask] }));
      field.set(YjsDatabaseKey.type, FieldType.Checklist);
      cell.set(YjsDatabaseKey.field_type, FieldType.Checklist);
      cell.set(YjsDatabaseKey.data, checklistData);
    });
    act(() => {
      void switchType(fieldId, FieldType.MultiSelect);
    });

    const options = parseSelectOptionTypeOptions(field).options;

    expect(options.filter(({ name }) => name === 'Task')).toEqual([existingTask]);
    expect(options.filter(({ name }) => name === 'New task')).toHaveLength(1);
    expect(getCellDataText(cell, field)).toBe('Task,New task');
  });

  it('includes off-screen rows added while RichText-to-select hydration is pending', async () => {
    const databaseDoc = createDatabaseDoc();
    const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const field = getField(databaseDoc);
    const unloadedRowId = 'unloaded-row-id';
    const concurrentlyAddedRowId = 'concurrently-added-row-id';
    const loadedRowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.RichText, data: 'Loaded option' },
    });
    const unloadedRowDoc = createRowDoc(unloadedRowId, databaseId, {
      [fieldId]: { fieldType: FieldType.RichText, data: 'Off-screen option' },
    });
    const concurrentlyAddedRowDoc = createRowDoc(concurrentlyAddedRowId, databaseId, {
      [fieldId]: { fieldType: FieldType.RichText, data: 'Concurrent option' },
    });
    const openedUnloadedRowDoc = new Y.Doc({ guid: unloadedRowId }) as YDoc;
    const unloadedRowUpdate = Y.encodeStateAsUpdate(unloadedRowDoc);
    const rowOrders = new Y.Array<{ id: string; height: number }>();

    rowOrders.push([
      { id: rowId, height: 36 },
      { id: unloadedRowId, height: 36 },
    ]);
    database.get(YjsDatabaseKey.views).get(viewId).set(YjsDatabaseKey.row_orders, rowOrders);
    field.set(YjsDatabaseKey.type, FieldType.RichText);

    const ensureRow = jest.fn(async (requestedRowId: string) => {
      if (requestedRowId === concurrentlyAddedRowId) return concurrentlyAddedRowDoc;

      setTimeout(() => {
        rowOrders.push([{ id: concurrentlyAddedRowId, height: 36 }]);
        Y.applyUpdate(openedUnloadedRowDoc, unloadedRowUpdate);
      }, 0);
      return openedUnloadedRowDoc;
    });
    const contextValue = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: { [rowId]: loadedRowDoc },
      ensureRow,
      workspaceId: 'workspace-id',
    } as unknown as DatabaseContextState;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result } = renderHook(() => useSwitchPropertyType(), { wrapper });

    act(() => {
      void result.current(fieldId, FieldType.SingleSelect);
    });

    await waitFor(() => {
      expect(field.get(YjsDatabaseKey.type)).toBe(FieldType.SingleSelect);
    });

    expect(ensureRow).toHaveBeenCalledWith(unloadedRowId);
    expect(ensureRow).toHaveBeenCalledWith(concurrentlyAddedRowId);
    expect(parseSelectOptionTypeOptions(field).options.map(({ name }) => name)).toEqual([
      'Loaded option',
      'Off-screen option',
      'Concurrent option',
    ]);
    expect(getCellDataText(getCell(openedUnloadedRowDoc), field)).toBe('Off-screen option');
    expect(getCellDataText(getCell(concurrentlyAddedRowDoc), field)).toBe('Concurrent option');
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

  function setupTimestamp(
    type: FieldType,
    meta: { createdAt?: string; lastModified?: string },
    offscreen?: { rowId: string; createdAt?: string; lastModified?: string }
  ) {
    const doc = new Y.Doc({ guid: databaseId }) as YDoc;
    const sharedRoot = doc.getMap(YjsEditorKey.data_section);
    const database = new Y.Map() as YDatabase;
    const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
    const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
    const view = new Y.Map() as YDatabaseView;
    const rowOrders = new Y.Array<{ id: string; height: number }>();

    fields.set(fieldId, createTimestampField(type));
    rowOrders.push([
      { id: rowId, height: 36 },
      ...(offscreen ? [{ id: offscreen.rowId, height: 36 }] : []),
    ]);
    view.set(YjsDatabaseKey.row_orders, rowOrders);
    views.set(viewId, view);
    database.set(YjsDatabaseKey.id, databaseId);
    database.set(YjsDatabaseKey.fields, fields);
    database.set(YjsDatabaseKey.views, views);
    sharedRoot.set(YjsEditorKey.database, database);

    // Row carries the timestamp on its meta and has NO cell for the field
    // (created/last-edited time has no cell data of its own).
    const rowDoc = createRowDoc(rowId, databaseId, {}, meta.createdAt ?? '0', meta.lastModified ?? '0');
    const offscreenRowDoc = offscreen
      ? createRowDoc(
          offscreen.rowId,
          databaseId,
          {},
          offscreen.createdAt ?? '0',
          offscreen.lastModified ?? '0'
        )
      : undefined;
    const ensureRow = offscreenRowDoc ? jest.fn(async () => offscreenRowDoc) : undefined;
    const contextValue = {
      readOnly: false,
      databaseDoc: doc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: { [rowId]: rowDoc },
      ensureRow,
      workspaceId: 'workspace-id',
    } as unknown as DatabaseContextState;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );
    const { result } = renderHook(() => useSwitchPropertyType(), { wrapper });

    return { databaseDoc: doc, rowDoc, offscreenRowDoc, ensureRow, switchType: result.current };
  }

  it('CreatedTime -> DateTime: materializes row.created_at into the cell and renders a date', () => {
    const { databaseDoc, rowDoc, switchType } = setupTimestamp(FieldType.CreatedTime, { createdAt: TIMESTAMP });

    act(() => {
      void switchType(fieldId, FieldType.DateTime);
    });

    const cell = getCell(rowDoc);
    const field = getField(databaseDoc);

    expect(cell.get(YjsDatabaseKey.data)).toBe(TIMESTAMP);
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.CreatedTime);
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
    expect(getCellDataText(cell, field).length).toBeGreaterThan(0);
  });

  it('LastEditedTime -> DateTime: materializes row.last_modified into the cell', () => {
    const { rowDoc, switchType } = setupTimestamp(FieldType.LastEditedTime, { lastModified: TIMESTAMP });

    act(() => {
      void switchType(fieldId, FieldType.DateTime);
    });

    const cell = getCell(rowDoc);

    expect(cell.get(YjsDatabaseKey.data)).toBe(TIMESTAMP);
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.LastEditedTime);
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
  });

  it('selecting the current timestamp type is a no-op', () => {
    const { databaseDoc, rowDoc, switchType } = setupTimestamp(FieldType.CreatedTime, { createdAt: TIMESTAMP });
    const field = getField(databaseDoc);
    const originalLastModified = field.get(YjsDatabaseKey.last_modified);

    act(() => {
      void switchType(fieldId, FieldType.CreatedTime);
    });

    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    expect(row.get(YjsDatabaseKey.cells).get(fieldId)).toBeUndefined();
    expect(field.get(YjsDatabaseKey.last_modified)).toBe(originalLastModified);
  });

  it('loads and materializes off-screen timestamp rows before changing the schema', async () => {
    const offscreenRowId = 'offscreen-timestamp-row';
    const { databaseDoc, offscreenRowDoc, ensureRow, switchType } = setupTimestamp(
      FieldType.CreatedTime,
      { createdAt: TIMESTAMP },
      { rowId: offscreenRowId, createdAt: TIMESTAMP }
    );

    act(() => {
      void switchType(fieldId, FieldType.DateTime);
    });

    await waitFor(() => {
      expect(getField(databaseDoc).get(YjsDatabaseKey.type)).toBe(FieldType.DateTime);
    });

    expect(ensureRow).toHaveBeenCalledWith(offscreenRowId);
    const cell = getCell(offscreenRowDoc as YDoc);

    expect(cell.get(YjsDatabaseKey.data)).toBe(TIMESTAMP);
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.CreatedTime);
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
    ['Checklist <-> MultiSelect', FieldType.Checklist, undefined, checklistData, FieldType.MultiSelect],
    ['DateTime <-> RichText', FieldType.DateTime, {}, '1747180800', FieldType.RichText],
  ];

  it.each(cases)('%s: round-trip restores value and keeps raw data', (_name, typeA, typeOpt, cellData, typeB) => {
    const { fid, result, cellOf, fieldOf } = setup(typeA, typeOpt, cellData);

    const before = getCellDataText(cellOf(), fieldOf());

    expect(before.length).toBeGreaterThan(0);

    act(() => {
      void result.current(fid, typeB);
    });
    act(() => {
      void result.current(fid, typeA);
    });

    expect(getCellDataText(cellOf(), fieldOf())).toBe(before);
    expect(cellOf().get(YjsDatabaseKey.data)).toBe(cellData);
    expect(cellOf().get(YjsDatabaseKey.field_type)).toBe(typeA);
    expect(cellOf().get(YjsDatabaseKey.source_field_type)).toBeUndefined();
  });
});
