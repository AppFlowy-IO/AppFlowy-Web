import { render, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, useRowsByGroup } from '@/application/database-yjs';
import { useCreateBoardGroupingFieldDispatch } from '@/application/database-yjs/dispatch';
import { getOrCreateDatabaseHistoryManager } from '@/application/database-yjs/history';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { Board } from '@/components/database/board/Board';

import { createCell, createRowDoc } from './test-helpers';

const mockBoardNoGroup = jest.fn();

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));
// Rows whose DatabaseRow collab is missing have no local IndexedDB copy either.
jest.mock('@/application/db', () => ({
  ...jest.requireActual('@/application/db'),
  openRowCollabDBWithProvider: jest.fn(() => Promise.reject(new Error('row collab not found'))),
}));
jest.mock('@/components/database/components/board', () => ({
  BoardNoGroup: () => {
    mockBoardNoGroup();
    return <div data-testid='board-no-group' />;
  },
  Group: ({ groupId }: { groupId: string }) => <div data-testid='board-group'>{groupId}</div>,
}));
jest.mock('@/components/database/board/BoardProvider', () => ({
  BoardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const viewId = 'board-view-id';
const inlineViewId = 'inline-view-id';
const groupId = 'status-group-id';
const statusFieldId = 'status-field-id';
const nameFieldId = 'name-field-id';
const todoId = 'todo-id';
const doingId = 'doing-id';
const todoRowId = 'todo-row';
const doingRowId = 'doing-row';
let fixtureCount = 0;

type RowOrder = { id: string; height: number; is_deleted?: boolean };

/**
 * A Board grouped by Status with one To Do and one Doing row. The background
 * row loader shares one store per database id, so each fixture gets its own.
 */
function createFixture({
  boardRowOrders = [] as RowOrder[],
  inlineRowOrders,
  readOnly = false,
  withStatusField = true,
  withGrouping = true,
}: {
  boardRowOrders?: RowOrder[];
  inlineRowOrders?: RowOrder[];
  readOnly?: boolean;
  withStatusField?: boolean;
  withGrouping?: boolean;
} = {}) {
  const databaseId = `board-always-renders-${++fixtureCount}`;
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const createView = (rowOrders: RowOrder[], layout: DatabaseViewLayout, groupSettings: Y.Map<unknown>[] = []) => {
    const view = new Y.Map() as YDatabaseView;
    const orders = new Y.Array<RowOrder>();
    const fieldOrders = new Y.Array<{ id: string }>();
    const groups = new Y.Array<Y.Map<unknown>>();

    orders.push(rowOrders);
    fieldOrders.push([{ id: nameFieldId }, ...(withStatusField ? [{ id: statusFieldId }] : [])]);
    groups.push(groupSettings);
    view.set(YjsDatabaseKey.layout, layout);
    view.set(YjsDatabaseKey.row_orders, orders as never);
    view.set(YjsDatabaseKey.field_orders, fieldOrders as never);
    view.set(YjsDatabaseKey.field_settings, new Y.Map() as never);
    view.set(YjsDatabaseKey.groups, groups as never);

    return view;
  };

  const nameField = new Y.Map() as YDatabaseField;

  nameField.set(YjsDatabaseKey.id, nameFieldId);
  nameField.set(YjsDatabaseKey.name, 'Name');
  nameField.set(YjsDatabaseKey.type, FieldType.RichText);
  nameField.set(YjsDatabaseKey.is_primary, true);
  fields.set(nameFieldId, nameField);

  if (withStatusField) {
    const statusField = new Y.Map() as YDatabaseField;
    const typeOptions = new Y.Map();
    const selectOptions = new Y.Map();

    selectOptions.set(
      YjsDatabaseKey.content,
      JSON.stringify({
        disable_color: false,
        options: [
          { id: todoId, name: 'To Do', color: 'Purple' },
          { id: doingId, name: 'Doing', color: 'Blue' },
        ],
      })
    );
    typeOptions.set(String(FieldType.SingleSelect), selectOptions);
    statusField.set(YjsDatabaseKey.id, statusFieldId);
    statusField.set(YjsDatabaseKey.name, 'Status');
    statusField.set(YjsDatabaseKey.type, FieldType.SingleSelect);
    statusField.set(YjsDatabaseKey.type_option, typeOptions);
    fields.set(statusFieldId, statusField);
  }

  const baseRows: RowOrder[] = [
    { id: todoRowId, height: 36 },
    { id: doingRowId, height: 36 },
  ];
  const group = new Y.Map<unknown>();
  const columns = new Y.Array<{ id: string; visible: boolean }>();

  columns.push([
    { id: statusFieldId, visible: true },
    { id: todoId, visible: true },
    { id: doingId, visible: true },
  ]);
  group.set(YjsDatabaseKey.id, groupId);
  group.set(YjsDatabaseKey.field_id, statusFieldId);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.groups, columns);

  const boardView = createView([...baseRows, ...boardRowOrders], DatabaseViewLayout.Board, withGrouping ? [group] : []);

  views.set(viewId, boardView);
  if (inlineRowOrders) {
    const metas = new Y.Map();

    metas.set(YjsDatabaseKey.iid, inlineViewId);
    database.set(YjsDatabaseKey.metas, metas as never);
    views.set(inlineViewId, createView([...baseRows, ...inlineRowOrders], DatabaseViewLayout.Grid));
  }

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowMap: Record<string, YDoc> = {
    [todoRowId]: createRowDoc(todoRowId, databaseId, { [statusFieldId]: createCell(FieldType.SingleSelect, todoId) }),
    [doingRowId]: createRowDoc(doingRowId, databaseId, { [statusFieldId]: createCell(FieldType.SingleSelect, doingId) }),
  };
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    blobPrefetchComplete: false,
    databaseDoc,
    databasePageId: viewId,
    readOnly,
    rowMap,
    seedsReady: false,
    workspaceId: 'workspace-id',
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );

  return { contextValue, database, databaseDoc, fields, rowMap, view: boardView, wrapper };
}

beforeEach(() => {
  mockBoardNoGroup.mockClear();
});

describe('Board grouping readiness', () => {
  it('settles a row whose data never loads instead of keeping the Board loading', async () => {
    const orphanRowId = 'orphan-row';
    const fixture = createFixture({ boardRowOrders: [{ id: orphanRowId, height: 36 }] });
    // Like Database.ensureRow, resolve the canonical doc, which stays empty when
    // the server has no DatabaseRow data for the row.
    const ensureRow = jest.fn(async (rowId: string) => fixture.rowMap[rowId] ?? (new Y.Doc({ guid: rowId }) as YDoc));

    Object.assign(fixture.contextValue, {
      blobPrefetchComplete: true,
      ensureRow,
      loadRowFromSeed: jest.fn(async () => undefined),
      peekRowDocFromSeed: jest.fn(() => null),
      seedsReady: true,
    });

    const { result, unmount } = renderHook(() => useRowsByGroup(groupId), { wrapper: fixture.wrapper });

    // The first load fails and one retry follows after a second before it settles.
    await waitFor(() => expect(result.current.groupRowsReady).toBe(true), { timeout: 5000 });
    expect(ensureRow).toHaveBeenCalledWith(orphanRowId);
    expect(result.current.groupResult.get(todoId)?.map(({ id }) => id)).toEqual([todoRowId]);
    expect(result.current.groupResult.get(doingId)?.map(({ id }) => id)).toEqual([doingRowId]);
    unmount();
  });

  it('loads a row the inline view keeps visible although the Board view marks it deleted', async () => {
    const revivedRowId = 'revived-row';
    const fixture = createFixture({
      boardRowOrders: [{ id: revivedRowId, height: 36, is_deleted: true }],
      inlineRowOrders: [{ id: revivedRowId, height: 36, is_deleted: false }],
    });
    const revivedRow = createRowDoc(revivedRowId, fixture.databaseDoc.guid, {
      [statusFieldId]: createCell(FieldType.SingleSelect, doingId),
    });

    Object.assign(fixture.contextValue, {
      peekRowDocFromSeed: jest.fn((rowId: string) => (rowId === revivedRowId ? revivedRow : null)),
      seedsReady: true,
    });

    const { result, unmount } = renderHook(() => useRowsByGroup(groupId), { wrapper: fixture.wrapper });

    await waitFor(() => expect(result.current.groupRowsReady).toBe(true));
    expect(result.current.groupResult.get(doingId)?.map(({ id }) => id)).toEqual([doingRowId, revivedRowId]);
    unmount();
  });
});

describe('Board without anything to group by', () => {
  it('groups an editable Board by a new Status property, like Desktop, without an undo step', async () => {
    const fixture = createFixture({ withGrouping: false, withStatusField: false });
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);
    const board = render(<Board />, { wrapper: fixture.wrapper });

    await waitFor(() => expect(fixture.view.get(YjsDatabaseKey.groups).length).toBe(1));
    const group = fixture.view.get(YjsDatabaseKey.groups).get(0);
    const fieldId = group.get(YjsDatabaseKey.field_id);
    const field = fixture.fields.get(fieldId);

    expect(field.get(YjsDatabaseKey.name)).toBe('Status');
    expect(Number(field.get(YjsDatabaseKey.type))).toBe(FieldType.SingleSelect);
    expect(fixture.view.get(YjsDatabaseKey.field_orders).toJSON()).toEqual([{ id: nameFieldId }, { id: fieldId }]);
    await waitFor(() => expect(board.getByTestId('board-group').textContent).toBe(group.get(YjsDatabaseKey.id)));
    expect(mockBoardNoGroup).not.toHaveBeenCalled();
    expect(history.canUndo()).toBe(false);
    board.unmount();
  });

  it('shows readers why the Board is empty and writes nothing', async () => {
    const fixture = createFixture({ readOnly: true, withGrouping: false, withStatusField: false });
    const updates = jest.fn();

    fixture.databaseDoc.on('update', updates);
    const board = render(<Board />, { wrapper: fixture.wrapper });

    expect(board.getByTestId('board-no-group')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updates).not.toHaveBeenCalled();
    expect(board.queryByTestId('board-group')).toBeNull();
  });

  it('renders a grouped Board from the first frame without the no-group state', () => {
    const fixture = createFixture();
    const board = render(<Board />, { wrapper: fixture.wrapper });

    expect(board.getByTestId('board-group').textContent).toBe(groupId);
    expect(mockBoardNoGroup).not.toHaveBeenCalled();
  });

  it('records an explicitly created Status property as an undoable edit', () => {
    const fixture = createFixture({ withGrouping: false, withStatusField: false });
    const history = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);
    const { result } = renderHook(() => useCreateBoardGroupingFieldDispatch(), { wrapper: fixture.wrapper });
    const fieldId = result.current();

    expect(fixture.view.get(YjsDatabaseKey.groups).get(0).get(YjsDatabaseKey.field_id)).toBe(fieldId);
    expect(history.canUndo()).toBe(true);
  });
});
