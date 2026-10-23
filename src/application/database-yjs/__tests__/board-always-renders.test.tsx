import { act, render, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, useRowsByGroup } from '@/application/database-yjs';
import { useCreateBoardGroupingFieldDispatch } from '@/application/database-yjs/dispatch';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields';
import { groupByField } from '@/application/database-yjs/group';
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
  it.each([
    { missingGroups: false, concurrentField: false },
    { missingGroups: true, concurrentField: false },
    { missingGroups: false, concurrentField: true },
  ])(
    'converges before sync (missing groups: $missingGroups, concurrent field: $concurrentField)',
    async ({ missingGroups, concurrentField }) => {
      const first = createFixture({ withGrouping: false, withStatusField: false, inlineRowOrders: [] });

      if (missingGroups) first.view.delete(YjsDatabaseKey.groups);
      const secondDoc = new Y.Doc({ guid: first.databaseDoc.guid }) as YDoc;

      Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(first.databaseDoc));
      const firstUpdates: Uint8Array[] = [];
      const secondUpdates: Uint8Array[] = [];

      first.databaseDoc.on('update', (update: Uint8Array) => firstUpdates.push(update));
      secondDoc.on('update', (update: Uint8Array) => secondUpdates.push(update));
      const secondDatabase = secondDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
      const secondView = secondDatabase.get(YjsDatabaseKey.views).get(viewId);

      if (concurrentField) {
        const notes = new Y.Map() as YDatabaseField;

        notes.set(YjsDatabaseKey.id, 'notes');
        notes.set(YjsDatabaseKey.name, 'Notes');
        notes.set(YjsDatabaseKey.type, FieldType.RichText);
        secondDatabase.get(YjsDatabaseKey.fields).set('notes', notes);
        secondDatabase.get(YjsDatabaseKey.views).forEach((view) => {
          view.get(YjsDatabaseKey.field_orders).push([{ id: 'notes' }]);
        });
      }

      const secondContext = { ...first.contextValue, databaseDoc: secondDoc };
      const secondWrapper = ({ children }: { children: React.ReactNode }) => (
        <DatabaseContext.Provider value={secondContext}>{children}</DatabaseContext.Provider>
      );
      const firstBoard = render(<Board />, { wrapper: first.wrapper });
      const secondBoard = render(<Board />, { wrapper: secondWrapper });
      const firstGroup = first.view.get(YjsDatabaseKey.groups).get(0);
      const secondGroup = secondView.get(YjsDatabaseKey.groups).get(0);
      const fieldId = firstGroup.get(YjsDatabaseKey.field_id);

      // The editor whose initialization would lose a map conflict still gets to
      // add an option and assign a card before it receives the other editor.
      const editingDatabase = first.databaseDoc.clientID < secondDoc.clientID ? first.database : secondDatabase;
      const editingView = editingDatabase.get(YjsDatabaseKey.views).get(viewId);
      const editingFieldId = editingView.get(YjsDatabaseKey.groups).get(0).get(YjsDatabaseKey.field_id);
      const editingField = editingDatabase.get(YjsDatabaseKey.fields).get(editingFieldId);
      const option = { id: 'new-status', name: 'In progress', color: 'Blue' };
      const row = createRowDoc('edited-row', first.databaseDoc.guid, {
        [editingFieldId]: createCell(FieldType.SingleSelect, option.id),
      });

      act(() => {
        editingField
          .get(YjsDatabaseKey.type_option)
          .get(String(FieldType.SingleSelect))
          .set(YjsDatabaseKey.content, JSON.stringify({ disable_color: false, options: [option] }));
      });

      // Capture both independent updates before delivering either. Replaying the
      // updates must not create more fields, orders, or grouping entries.
      const firstUpdate = Y.mergeUpdates(firstUpdates);
      const secondUpdate = Y.mergeUpdates(secondUpdates);

      act(() => {
        Y.applyUpdate(first.databaseDoc, secondUpdate);
        Y.applyUpdate(secondDoc, firstUpdate);
        Y.applyUpdate(first.databaseDoc, secondUpdate);
        Y.applyUpdate(secondDoc, firstUpdate);
      });

      for (const database of [first.database, secondDatabase]) {
        const fields = database.get(YjsDatabaseKey.fields);
        const view = database.get(YjsDatabaseKey.views).get(viewId);
        const groups = view.get(YjsDatabaseKey.groups);

        expect(fields.size).toBe(concurrentField ? 3 : 2);
        expect(groups.length).toBe(1);
        expect(groups.get(0).get(YjsDatabaseKey.field_id)).toBe(fieldId);
        expect(parseSelectOptionTypeOptions(fields.get(fieldId)).options).toEqual([option]);
        const rows = [{ id: 'edited-row', height: 36 }];
        const groupedRows = groupByField(rows, { 'edited-row': row }, fields.get(fieldId));

        expect(groupedRows.get(option.id)).toEqual(rows);
        expect(groupedRows.get(fieldId)).toEqual([]);
        database.get(YjsDatabaseKey.views).forEach((databaseView) => {
          expect(databaseView.get(YjsDatabaseKey.field_orders).toJSON()).toEqual([
            { id: nameFieldId },
            ...(concurrentField ? [{ id: 'notes' }] : []),
            { id: fieldId },
          ]);
        });
      }

      expect(secondGroup.get(YjsDatabaseKey.field_id)).toBe(fieldId);
      await waitFor(() => {
        expect(firstBoard.container.querySelector('[data-testid="board-group"]')?.textContent).toBe(
          firstGroup.get(YjsDatabaseKey.id)
        );
        expect(secondBoard.container.querySelector('[data-testid="board-group"]')?.textContent).toBe(
          firstGroup.get(YjsDatabaseKey.id)
        );
      });
      expect(first.database.toJSON()).toEqual(secondDatabase.toJSON());
      firstBoard.unmount();
      secondBoard.unmount();
    }
  );

  it('ignores automatic retries and creates a fresh field after the previous default is deleted', () => {
    const fixture = createFixture({ withGrouping: false, withStatusField: false });
    const { result } = renderHook(() => useCreateBoardGroupingFieldDispatch(), { wrapper: fixture.wrapper });
    const fieldId = result.current({ automatic: true });
    const updates = jest.fn();

    fixture.databaseDoc.on('update', updates);
    expect(result.current({ automatic: true })).toBe(fieldId);
    expect(updates).not.toHaveBeenCalled();

    fixture.databaseDoc.transact(() => {
      fixture.fields.delete(fieldId);
      fixture.view.get(YjsDatabaseKey.field_orders).delete(1);
      fixture.view.get(YjsDatabaseKey.groups).delete(0);
    });
    const replacementId = result.current({ automatic: true });

    expect(replacementId).not.toBe(fieldId);
    expect(fixture.fields.size).toBe(2);
    expect(fixture.view.get(YjsDatabaseKey.groups).length).toBe(1);
    expect(fixture.view.get(YjsDatabaseKey.groups).get(0).get(YjsDatabaseKey.field_id)).toBe(replacementId);
    expect(fixture.view.get(YjsDatabaseKey.field_orders).toJSON()).toEqual([{ id: nameFieldId }, { id: replacementId }]);
  });

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
