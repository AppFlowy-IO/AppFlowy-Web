import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import {
  useAddSelectOption,
  useClearCellsWithFieldDispatch,
  useCreateCalendarEvent,
  useDeleteGroupColumnDispatch,
  useDeletePropertyDispatch,
  useDeleteSelectOption,
  useMoveCardDispatch,
  useNewPropertyDispatch,
  useSwitchPropertyType,
  useUpdateCellDispatch,
  useUpdateRelationDatabaseId,
  useUpdateRowMetaDispatch,
} from '@/application/database-yjs/dispatch';
import { useUpdateRelationTypeOption } from '@/application/database-yjs/dispatch/relation';
import { useDeleteGroupColumnDispatch as useDeleteGroupColumnDispatchModule } from '@/application/database-yjs/dispatch/group';
import {
  useMoveCardDispatch as useMoveCardDispatchModule,
  useUpdateRowMetaDispatch as useUpdateRowMetaDispatchModule,
} from '@/application/database-yjs/dispatch/row';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import {
  createDatabaseHistoryGroup,
  getOrCreateDatabaseHistoryManager,
  runDatabaseAction,
  useDatabaseHistory,
} from '@/application/database-yjs/history';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';
import { AFConfigContext } from '@/components/main/app.hooks';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YDatabaseFields,
  YDatabaseGroup,
  YDatabaseGroupColumns,
  YDatabaseGroups,
  YDatabaseRow,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YMapFieldTypeOption,
  YSharedRoot,
} from '@/application/types';

import { createRowDoc } from './test-helpers';

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

const databaseId = 'database-id';
const viewId = 'view-id';
const fieldId = 'field-id';
const rowId = 'row-id';

type Fixture = {
  database: YDatabase;
  databaseDoc: YDoc;
  fields: YDatabaseFields;
  rowOrders: Y.Array<{ id: string; height: number }>;
  sharedRoot: YSharedRoot;
  view: YDatabaseView;
};

function createField(id: string, fieldType: FieldType): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, id);
  field.set(YjsDatabaseKey.type, fieldType);
  return field;
}

function createSelectField(id: string, options: { id: string; name: string; color: string }[] = []): YDatabaseField {
  const field = createField(id, FieldType.SingleSelect);
  const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
  const typeOption = new Y.Map() as YMapFieldTypeOption;

  typeOption.set(YjsDatabaseKey.content, JSON.stringify({ disable_color: false, options }));
  typeOptions.set(String(FieldType.SingleSelect), typeOption);
  field.set(YjsDatabaseKey.type_option, typeOptions);
  return field;
}

function createFixture(initialFields: [string, YDatabaseField][] = []): Fixture {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>();
  const fieldOrders = new Y.Array<{ id: string }>();

  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.name, 'Grid');
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, new Y.Map());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.sorts, new Y.Array());
  view.set(YjsDatabaseKey.groups, new Y.Array() as YDatabaseGroups);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);
  initialFields.forEach(([id, field]) => {
    fields.set(id, field);
    fieldOrders.push([{ id }]);
  });
  return { database, databaseDoc, fields, rowOrders, sharedRoot, view };
}

function addSelectGroup(view: YDatabaseView, optionIds: string[] = []) {
  const group = new Y.Map() as YDatabaseGroup;
  const columns = new Y.Array() as YDatabaseGroupColumns;

  columns.push(optionIds.map((id) => ({ id, visible: true })));
  group.set(YjsDatabaseKey.id, 'group-id');
  group.set(YjsDatabaseKey.field_id, fieldId);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.groups, columns);
  view.get(YjsDatabaseKey.groups).push([group]);
  return columns;
}

function getSelectOptionIds(field: YDatabaseField): string[] {
  const content = field.get(YjsDatabaseKey.type_option).get(String(FieldType.SingleSelect)).get(YjsDatabaseKey.content);

  return (JSON.parse(content) as { options: { id: string }[] }).options.map(({ id }) => id);
}

function getCellData(rowDoc: YDoc, id = fieldId) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

  return row.get(YjsDatabaseKey.cells).get(id)?.get(YjsDatabaseKey.data);
}

function createWrapper(
  databaseDoc: YDoc,
  rowMap: Record<string, YDoc> = {},
  overrides: Partial<DatabaseContextState> = {}
) {
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap,
    workspaceId: 'workspace-id',
    ...overrides,
  };

  return ({ children }: { children: ReactNode }) => (
    <AFConfigContext.Provider
      value={{
        isAuthenticated: false,
        updateCurrentUser: async () => undefined,
        openLoginModal: () => undefined,
      }}
    >
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );
}

function prepareRedo(fixture: Fixture) {
  const manager = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

  runDatabaseAction(fixture.databaseDoc, { type: 'database.test-marker' }, () => {
    (fixture.database as Y.Map<unknown>).set('history-marker', true);
  });
  manager.undo();
  expect(manager.canRedo()).toBe(true);
  return manager;
}

function dispatchDatabaseHistoryHotkey(target: HTMLElement, redo = false) {
  const modifier = /Mac|iPod|iPhone|iPad/.test(window.navigator.platform) ? { metaKey: true } : { ctrlKey: true };

  fireEvent.keyDown(target, {
    bubbles: true,
    cancelable: true,
    code: 'KeyZ',
    key: 'z',
    keyCode: 90,
    shiftKey: redo,
    which: 90,
    ...modifier,
  });
}

function BoardMoveHistoryAction() {
  const moveCard = useMoveCardDispatch();

  return (
    <>
      <button
        type='button'
        onClick={() =>
          moveCard({
            rowId,
            fieldId,
            startColumnId: 'start',
            finishColumnId: 'finish',
          })
        }
      >
        Move board card
      </button>
      <span data-testid='board-surface'>Board surface</span>
    </>
  );
}

function CalendarCreateHistoryAction() {
  const createEvent = useCreateCalendarEvent();

  return (
    <button
      type='button'
      onClick={() => {
        void createEvent({ startTimestamp: '100', endTimestamp: '200', includeTime: true });
      }}
    >
      Create calendar event
    </button>
  );
}

describe('database history production dispatch policies', () => {
  it('uses the common focused scope to undo and redo a board move by keyboard', async () => {
    const fixture = createFixture([[fieldId, createSelectField(fieldId)]]);
    const secondRowId = 'second-row-id';
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.SingleSelect, data: 'start' },
    });
    const secondRowDoc = createRowDoc(secondRowId, databaseId, {});

    fixture.rowOrders.push([
      { id: secondRowId, height: 36 },
      { id: rowId, height: 36 },
    ]);
    render(
      <>
        <DatabaseHistoryScope>
          <BoardMoveHistoryAction />
        </DatabaseHistoryScope>
        <button type='button'>Outside database</button>
      </>,
      { wrapper: createWrapper(fixture.databaseDoc, { [rowId]: rowDoc, [secondRowId]: secondRowDoc }) }
    );
    const action = screen.getByRole('button', { name: 'Move board card' });
    const boardSurface = screen.getByTestId('board-surface');
    const outside = screen.getByRole('button', { name: 'Outside database' });

    fireEvent.pointerDown(action);
    fireEvent.click(action);
    expect(getCellData(rowDoc)).toBe('finish');
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([rowId, secondRowId]);

    fireEvent.focus(action);
    act(() => {
      fireEvent.pointerDown(boardSurface);
      fireEvent.blur(action, { relatedTarget: null });
    });
    dispatchDatabaseHistoryHotkey(boardSurface);
    expect(getCellData(rowDoc)).toBe('start');
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([secondRowId, rowId]);
    dispatchDatabaseHistoryHotkey(boardSurface, true);
    expect(getCellData(rowDoc)).toBe('finish');
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([rowId, secondRowId]);
    await act(async () => Promise.resolve());

    fireEvent.focus(action);
    fireEvent.blur(action, { relatedTarget: outside });
    fireEvent.focus(outside);
    dispatchDatabaseHistoryHotkey(outside);
    expect(getCellData(rowDoc)).toBe('finish');
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([rowId, secondRowId]);

    fireEvent.focus(action);
    dispatchDatabaseHistoryHotkey(action);
    expect(getCellData(rowDoc)).toBe('start');
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([secondRowId, rowId]);

    dispatchDatabaseHistoryHotkey(action, true);
    expect(getCellData(rowDoc)).toBe('finish');
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([rowId, secondRowId]);
  });

  it('uses the common focused scope to undo and redo calendar creation by keyboard', async () => {
    const fixture = createFixture();
    const createRow = jest.fn().mockResolvedValue(new Y.Doc() as YDoc);

    fixture.view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Calendar);
    render(
      <DatabaseHistoryScope>
        <CalendarCreateHistoryAction />
      </DatabaseHistoryScope>,
      { wrapper: createWrapper(fixture.databaseDoc, {}, { createRow }) }
    );
    const action = screen.getByRole('button', { name: 'Create calendar event' });

    fireEvent.pointerDown(action);
    fireEvent.click(action);
    await waitFor(() => {
      expect(fixture.fields.size).toBe(1);
      expect(fixture.rowOrders).toHaveLength(1);
    });

    dispatchDatabaseHistoryHotkey(action);
    expect(fixture.fields.size).toBe(0);
    expect(fixture.rowOrders).toHaveLength(0);

    dispatchDatabaseHistoryHotkey(action, true);
    expect(fixture.fields.size).toBe(1);
    expect(fixture.rowOrders).toHaveLength(1);
  });

  it('captures ordinary field creation but skips relation field creation', () => {
    const ordinary = createFixture();
    const ordinaryHook = renderHook(() => useNewPropertyDispatch(), {
      wrapper: createWrapper(ordinary.databaseDoc),
    });
    let ordinaryFieldId = '';

    void act(() => {
      ordinaryFieldId = ordinaryHook.result.current(FieldType.RichText);
    });
    const ordinaryHistory = getOrCreateDatabaseHistoryManager(ordinary.databaseDoc);

    expect(ordinaryHistory.canUndo()).toBe(true);
    void act(() => ordinaryHistory.undo());
    expect(ordinary.fields.has(ordinaryFieldId)).toBe(false);
    void act(() => ordinaryHistory.redo());
    expect(ordinary.fields.has(ordinaryFieldId)).toBe(true);

    const relation = createFixture();
    const relationHistory = prepareRedo(relation);
    const relationHook = renderHook(() => useNewPropertyDispatch(), {
      wrapper: createWrapper(relation.databaseDoc),
    });
    let relationFieldId = '';

    void act(() => {
      relationFieldId = relationHook.result.current(FieldType.Relation);
    });
    expect(relation.fields.has(relationFieldId)).toBe(true);
    expect(relationHistory.canUndo()).toBe(false);
    expect(relationHistory.canRedo()).toBe(true);
  });

  it('captures ordinary field deletion but skips relation field deletion', () => {
    const ordinaryField = createField(fieldId, FieldType.RichText);
    const ordinary = createFixture([[fieldId, ordinaryField]]);
    const ordinaryHook = renderHook(() => useDeletePropertyDispatch(), {
      wrapper: createWrapper(ordinary.databaseDoc),
    });

    void act(() => ordinaryHook.result.current(fieldId));
    const ordinaryHistory = getOrCreateDatabaseHistoryManager(ordinary.databaseDoc);

    expect(ordinaryHistory.canUndo()).toBe(true);
    void act(() => ordinaryHistory.undo());
    expect(ordinary.fields.has(fieldId)).toBe(true);
    void act(() => ordinaryHistory.redo());
    expect(ordinary.fields.has(fieldId)).toBe(false);

    const relation = createFixture([[fieldId, createRelationField(fieldId)]]);
    const relationHistory = prepareRedo(relation);
    const relationHook = renderHook(() => useDeletePropertyDispatch(), {
      wrapper: createWrapper(relation.databaseDoc),
    });

    void act(() => relationHook.result.current(fieldId));
    expect(relation.fields.has(fieldId)).toBe(false);
    expect(relationHistory.canUndo()).toBe(false);
    expect(relationHistory.canRedo()).toBe(true);
  });

  it('captures clearing an ordinary field but skips clearing a relation field', () => {
    const ordinary = createFixture([[fieldId, createField(fieldId, FieldType.RichText)]]);
    const ordinaryRow = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.RichText, data: 'before' },
    });
    const ordinaryHistory = getOrCreateDatabaseHistoryManager(ordinary.databaseDoc);

    ordinaryHistory.registerRowDoc(rowId, ordinaryRow);
    const ordinaryHook = renderHook(() => useClearCellsWithFieldDispatch(), {
      wrapper: createWrapper(ordinary.databaseDoc, { [rowId]: ordinaryRow }),
    });

    void act(() => ordinaryHook.result.current(fieldId));
    expect(ordinaryHistory.canUndo()).toBe(true);
    void act(() => ordinaryHistory.undo());
    expect(getCellData(ordinaryRow)).toBe('before');
    void act(() => ordinaryHistory.redo());
    expect(getCellData(ordinaryRow)).toBeUndefined();

    const relation = createFixture([[fieldId, createRelationField(fieldId)]]);
    const relationData = new Y.Array<string>();
    const relationRow = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.Relation, data: relationData },
    });
    const relationHistory = prepareRedo(relation);

    relationHistory.registerRowDoc(rowId, relationRow);
    const relationHook = renderHook(() => useClearCellsWithFieldDispatch(), {
      wrapper: createWrapper(relation.databaseDoc, { [rowId]: relationRow }),
    });

    void act(() => relationHook.result.current(fieldId));
    expect(getCellData(relationRow)).toBeUndefined();
    expect(relationHistory.canUndo()).toBe(false);
    expect(relationHistory.canRedo()).toBe(true);
  });

  it.each([
    ['main dispatch', useMoveCardDispatch],
    ['modular dispatch', useMoveCardDispatchModule],
  ])('undoes a board card cell change and row reorder as one action through %s', (_name, useMoveCard) => {
    const fixture = createFixture([[fieldId, createSelectField(fieldId)]]);
    const secondRowId = 'second-row-id';
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.SingleSelect, data: 'start' },
    });
    const secondRowDoc = createRowDoc(secondRowId, databaseId, {});

    fixture.rowOrders.push([
      { id: secondRowId, height: 36 },
      { id: rowId, height: 36 },
    ]);
    const hook = renderHook(() => useMoveCard(), {
      wrapper: createWrapper(fixture.databaseDoc, { [rowId]: rowDoc, [secondRowId]: secondRowDoc }),
    });

    void act(() => {
      hook.result.current({
        rowId,
        fieldId,
        startColumnId: 'start',
        finishColumnId: 'finish',
      });
    });
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

    expect(getCellData(rowDoc)).toBe('finish');
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([rowId, secondRowId]);
    void act(() => history.undo());
    expect(getCellData(rowDoc)).toBe('start');
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([secondRowId, rowId]);
    expect(history.canUndo()).toBe(false);
    void act(() => history.redo());
    expect(getCellData(rowDoc)).toBe('finish');
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([rowId, secondRowId]);
  });

  it('groups select option catalog and board-column creation into one action', () => {
    const selectField = createSelectField(fieldId);
    const fixture = createFixture([[fieldId, selectField]]);
    const columns = addSelectGroup(fixture.view);
    const hook = renderHook(() => useAddSelectOption(fieldId), {
      wrapper: createWrapper(fixture.databaseDoc),
    });

    void act(() => hook.result.current({ id: 'new-option', name: 'New option', color: 'Purple' }));
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

    expect(getSelectOptionIds(selectField)).toEqual(['new-option']);
    expect(columns.toJSON().map(({ id }) => id)).toEqual(['new-option']);
    void act(() => history.undo());
    expect(getSelectOptionIds(selectField)).toEqual([]);
    expect(columns.toJSON()).toEqual([]);
    expect(history.canUndo()).toBe(false);
    void act(() => history.redo());
    expect(getSelectOptionIds(selectField)).toEqual(['new-option']);
    expect(columns.toJSON().map(({ id }) => id)).toEqual(['new-option']);
  });

  it('groups select option catalog and board-column deletion into one action', () => {
    const option = { id: 'old-option', name: 'Old option', color: 'Purple' };
    const selectField = createSelectField(fieldId, [option]);
    const fixture = createFixture([[fieldId, selectField]]);
    const columns = addSelectGroup(fixture.view, [option.id]);
    const hook = renderHook(() => useDeleteSelectOption(fieldId), {
      wrapper: createWrapper(fixture.databaseDoc),
    });

    void act(() => hook.result.current(option.id));
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

    expect(getSelectOptionIds(selectField)).toEqual([]);
    expect(columns.toJSON()).toEqual([]);
    void act(() => history.undo());
    expect(getSelectOptionIds(selectField)).toEqual([option.id]);
    expect(columns.toJSON().map(({ id }) => id)).toEqual([option.id]);
    expect(history.canUndo()).toBe(false);
    void act(() => history.redo());
    expect(getSelectOptionIds(selectField)).toEqual([]);
    expect(columns.toJSON()).toEqual([]);
  });

  it.each([
    ['main dispatch', useDeleteGroupColumnDispatch],
    ['modular dispatch', useDeleteGroupColumnDispatchModule],
  ])('groups delete-group-column option cleanup and row removal through %s', (_name, useDeleteGroupColumn) => {
    const option = { id: 'old-option', name: 'Old option', color: 'Purple' };
    const selectField = createSelectField(fieldId, [option]);
    const fixture = createFixture([[fieldId, selectField]]);
    const columns = addSelectGroup(fixture.view, [option.id]);

    fixture.rowOrders.push([{ id: rowId, height: 36 }]);
    const hook = renderHook(() => useDeleteGroupColumn('group-id', option.id, fieldId), {
      wrapper: createWrapper(fixture.databaseDoc),
    });

    void act(() => hook.result.current([rowId]));
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

    expect(getSelectOptionIds(selectField)).toEqual([]);
    expect(columns.toJSON()).toEqual([]);
    expect(fixture.rowOrders).toHaveLength(0);
    void act(() => history.undo());
    expect(getSelectOptionIds(selectField)).toEqual([option.id]);
    expect(columns.toJSON().map(({ id }) => id)).toEqual([option.id]);
    expect(fixture.rowOrders.toJSON().map(({ id }) => id)).toEqual([rowId]);
    expect(history.canUndo()).toBe(false);
    void act(() => history.redo());
    expect(getSelectOptionIds(selectField)).toEqual([]);
    expect(columns.toJSON()).toEqual([]);
    expect(fixture.rowOrders).toHaveLength(0);
  });

  it('groups select-option creation from a cell with the selected cell value', async () => {
    const selectField = createSelectField(fieldId);
    const fixture = createFixture([[fieldId, selectField]]);
    const columns = addSelectGroup(fixture.view);
    const rowDoc = createRowDoc(rowId, databaseId, {});
    const hook = renderHook(
      () => ({
        addOption: useAddSelectOption(fieldId),
        updateCell: useUpdateCellDispatch(rowId, fieldId),
      }),
      { wrapper: createWrapper(fixture.databaseDoc, { [rowId]: rowDoc }) }
    );
    const historyGroup = createDatabaseHistoryGroup();

    await act(async () => {
      hook.result.current.addOption({ id: 'cell-option', name: 'Cell option', color: 'Purple' }, historyGroup);
      hook.result.current.updateCell('cell-option', undefined, { historyGroup });
      await Promise.resolve();
    });
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

    expect(getSelectOptionIds(selectField)).toEqual(['cell-option']);
    expect(columns.toJSON().map(({ id }) => id)).toEqual(['cell-option']);
    expect(getCellData(rowDoc)).toBe('cell-option');
    void act(() => history.undo());
    expect(getSelectOptionIds(selectField)).toEqual([]);
    expect(columns.toJSON()).toEqual([]);
    expect(getCellData(rowDoc)).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    void act(() => history.redo());
    expect(getSelectOptionIds(selectField)).toEqual(['cell-option']);
    expect(columns.toJSON().map(({ id }) => id)).toEqual(['cell-option']);
    expect(getCellData(rowDoc)).toBe('cell-option');
  });

  it('undoes and redoes first-event calendar setup and row insertion as one action', async () => {
    const fixture = createFixture();
    const createdRowDoc = new Y.Doc() as YDoc;
    const createRow = jest.fn().mockResolvedValue(createdRowDoc);
    const secondViewId = 'second-view-id';
    const secondView = new Y.Map() as YDatabaseView;
    const secondFieldOrders = new Y.Array<{ id: string }>();
    const secondFieldSettings = new Y.Map();
    const secondRowOrders = new Y.Array<{ id: string; height: number }>();

    secondView.set(YjsDatabaseKey.id, secondViewId);
    secondView.set(YjsDatabaseKey.name, 'Second view');
    secondView.set(YjsDatabaseKey.field_orders, secondFieldOrders);
    secondView.set(YjsDatabaseKey.field_settings, secondFieldSettings);
    secondView.set(YjsDatabaseKey.row_orders, secondRowOrders);
    fixture.database.get(YjsDatabaseKey.views).set(secondViewId, secondView);

    fixture.view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Calendar);
    const hook = renderHook(() => useCreateCalendarEvent(), {
      wrapper: createWrapper(fixture.databaseDoc, {}, { createRow }),
    });

    await act(async () => {
      await hook.result.current({ startTimestamp: '100', endTimestamp: '200', includeTime: true });
    });
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);
    const createdFieldIds = Array.from(fixture.fields.keys());
    const createdFieldId = createdFieldIds[0];
    const primaryFieldOrders = fixture.view.get(YjsDatabaseKey.field_orders);
    const primaryFieldSettings = fixture.view.get(YjsDatabaseKey.field_settings);

    expect(createdFieldIds).toHaveLength(1);
    expect(fixture.rowOrders).toHaveLength(1);
    expect(secondRowOrders).toHaveLength(1);
    expect(primaryFieldOrders.toJSON()).toEqual([{ id: createdFieldId }]);
    expect(secondFieldOrders.toJSON()).toEqual([{ id: createdFieldId }]);
    expect(primaryFieldSettings.has(createdFieldId)).toBe(true);
    expect(secondFieldSettings.has(createdFieldId)).toBe(true);
    expect(fixture.view.get(YjsDatabaseKey.layout_settings)).toBeDefined();
    void act(() => history.undo());
    expect(fixture.fields.size).toBe(0);
    expect(fixture.rowOrders).toHaveLength(0);
    expect(secondRowOrders).toHaveLength(0);
    expect(primaryFieldOrders).toHaveLength(0);
    expect(secondFieldOrders).toHaveLength(0);
    expect(primaryFieldSettings.has(createdFieldId)).toBe(false);
    expect(secondFieldSettings.has(createdFieldId)).toBe(false);
    expect(fixture.view.get(YjsDatabaseKey.layout_settings)).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    void act(() => history.redo());
    expect(Array.from(fixture.fields.keys())).toEqual(createdFieldIds);
    expect(fixture.rowOrders).toHaveLength(1);
    expect(secondRowOrders).toHaveLength(1);
    expect(primaryFieldOrders.toJSON()).toEqual([{ id: createdFieldId }]);
    expect(secondFieldOrders.toJSON()).toEqual([{ id: createdFieldId }]);
    expect(primaryFieldSettings.has(createdFieldId)).toBe(true);
    expect(secondFieldSettings.has(createdFieldId)).toBe(true);
    expect(fixture.view.get(YjsDatabaseKey.layout_settings)).toBeDefined();
  });

  it('skips relation target changes in the legacy relation hook', () => {
    const fixture = createFixture([[fieldId, createRelationField(fieldId)]]);
    const relationData = new Y.Array<string>();
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.Relation, data: relationData },
    });
    const history = prepareRedo(fixture);

    history.registerRowDoc(rowId, rowDoc);
    const hook = renderHook(() => useUpdateRelationDatabaseId(fieldId), {
      wrapper: createWrapper(fixture.databaseDoc, { [rowId]: rowDoc }),
    });

    void act(() => hook.result.current('related-database-id'));
    expect(getCellData(rowDoc)).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it.each([
    [FieldType.Relation, FieldType.RichText],
    [FieldType.RichText, FieldType.Relation],
  ])('skips field conversion across the relation boundary (%s to %s)', async (sourceType, targetType) => {
    const field = sourceType === FieldType.Relation ? createRelationField(fieldId) : createField(fieldId, sourceType);
    const fixture = createFixture([[fieldId, field]]);
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: {
        fieldType: sourceType,
        data: sourceType === FieldType.Relation ? new Y.Array<string>() : 'value',
      },
    });
    const history = prepareRedo(fixture);

    history.registerRowDoc(rowId, rowDoc);
    const hook = renderHook(() => useSwitchPropertyType(), {
      wrapper: createWrapper(fixture.databaseDoc, { [rowId]: rowDoc }),
    });

    await act(async () => {
      await hook.result.current(fieldId, targetType);
    });

    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId);

    expect(field.get(YjsDatabaseKey.type)).toBe(targetType);
    // Main now keeps ordinary cells in their source encoding and changes only
    // the field presentation type. Relation-boundary switches remain excluded
    // from history regardless of that storage representation.
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(sourceType);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    void act(() => history.redo());
    expect(field.get(YjsDatabaseKey.type)).toBe(targetType);
  });

  it('skips relation type-option mutations', async () => {
    const relationField = createRelationField(fieldId);
    const fixture = createFixture([[fieldId, relationField]]);
    const history = prepareRedo(fixture);
    const hook = renderHook(() => useUpdateRelationTypeOption(fieldId), {
      wrapper: createWrapper(fixture.databaseDoc),
    });

    await act(async () => {
      await hook.result.current({ source_limit: RelationLimit.OneOnly });
    });

    const option = relationField.get(YjsDatabaseKey.type_option).get(String(FieldType.Relation));

    expect(option.get(YjsDatabaseKey.source_limit)).toBe(RelationLimit.OneOnly);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it.each([
    ['main dispatch', useUpdateRowMetaDispatch],
    ['modular dispatch', useUpdateRowMetaDispatchModule],
  ])('skips derived row metadata while capturing icon metadata through %s', (_name, useUpdateRowMeta) => {
    const fixture = createFixture();
    const rowDoc = createRowDoc(rowId, databaseId, {});
    const rowRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const meta = new Y.Map<unknown>();

    rowRoot.set(YjsEditorKey.meta, meta);
    const history = prepareRedo(fixture);

    history.registerRowDoc(rowId, rowDoc);
    const hook = renderHook(() => useUpdateRowMeta(rowId), {
      wrapper: createWrapper(fixture.databaseDoc, { [rowId]: rowDoc }),
    });

    void act(() => hook.result.current(RowMetaKey.IsDocumentEmpty, true));
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    void act(() => hook.result.current(RowMetaKey.IconId, 'star'));
    expect(history.canUndo()).toBe(true);
    void act(() => history.undo());
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IconId) as string)).toBeUndefined();
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty) as string)).toBe(true);
    void act(() => history.redo());
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IconId) as string)).toBe('star');
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty) as string)).toBe(true);

    void act(() => hook.result.current(RowMetaKey.CoverId, '{"data":"cover","cover_type":0}'));
    void act(() => history.undo());
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.CoverId) as string)).toBeUndefined();
    void act(() => history.redo());
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.CoverId) as string)).toBe('{"data":"cover","cover_type":0}');
  });

  it('captures icon and cover updates when the row loads after the main hook renders', () => {
    const fixture = createFixture();
    const rowDoc = createRowDoc(rowId, databaseId, {});
    const rowRoot = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const meta = new Y.Map<unknown>();
    let lateRowMap: Record<string, YDoc> = {};

    rowRoot.set(YjsEditorKey.meta, meta);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createWrapper(fixture.databaseDoc, lateRowMap)({ children });
    const hook = renderHook(
      () => ({
        history: useDatabaseHistory(),
        updateMeta: useUpdateRowMetaDispatch(rowId),
      }),
      { wrapper }
    );

    lateRowMap = { [rowId]: rowDoc };
    hook.rerender();

    void act(() => hook.result.current.updateMeta(RowMetaKey.IconId, 'late-icon'));
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IconId) as string)).toBe('late-icon');
    void act(() => hook.result.current.history.undo());
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IconId) as string)).toBeUndefined();
    void act(() => hook.result.current.history.redo());
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IconId) as string)).toBe('late-icon');

    void act(() => hook.result.current.updateMeta(RowMetaKey.CoverId, '{"data":"late-cover","cover_type":0}'));
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.CoverId) as string)).toBe('{"data":"late-cover","cover_type":0}');
    void act(() => hook.result.current.history.undo());
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.CoverId) as string)).toBeUndefined();
    void act(() => hook.result.current.history.redo());
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.CoverId) as string)).toBe('{"data":"late-cover","cover_type":0}');
  });
});
