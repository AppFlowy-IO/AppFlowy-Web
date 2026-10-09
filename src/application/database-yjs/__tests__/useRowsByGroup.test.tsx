import { act, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  DatabaseSearchQueryContext,
  FieldType,
  haveSameGroupRows,
  Row,
  SortCondition,
  useRowsByGroup,
} from '@/application/database-yjs';
import * as groupModule from '@/application/database-yjs/group';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRowOrders,
  YDatabaseSort,
  YDatabaseSorts,
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

const databaseId = 'database-id';
const viewId = 'board-view-id';
const groupId = 'status-group-id';
const statusFieldId = 'status-field-id';
const todoId = 'todo-id';
const doingId = 'doing-id';
const doneId = 'done-id';
const existingTodoRowId = 'existing-todo-row';
const existingDoingRowId = 'existing-doing-row';
const remoteDoingRowId = 'remote-doing-row';

function createBoardFixture() {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const statusField = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map();
  const selectOptions = new Y.Map();
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>() as YDatabaseRowOrders;
  const groups = new Y.Array<Y.Map<unknown>>();
  const group = new Y.Map<unknown>();
  const columns = new Y.Array<{ id: string; visible: boolean }>();
  const layoutSettings = new Y.Map<Y.Map<unknown>>();
  const boardLayoutSettings = new Y.Map<unknown>();

  selectOptions.set(
    YjsDatabaseKey.content,
    JSON.stringify({
      disable_color: false,
      options: [
        { id: todoId, name: 'To Do', color: 'Purple' },
        { id: doingId, name: 'Doing', color: 'Blue' },
        { id: doneId, name: 'Done', color: 'Green' },
      ],
    })
  );
  typeOptions.set(String(FieldType.SingleSelect), selectOptions);
  statusField.set(YjsDatabaseKey.id, statusFieldId);
  statusField.set(YjsDatabaseKey.name, 'Status');
  statusField.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  statusField.set(YjsDatabaseKey.type_option, typeOptions);
  fields.set(statusFieldId, statusField);

  columns.push([
    { id: statusFieldId, visible: true },
    { id: todoId, visible: true },
    { id: doingId, visible: true },
    { id: doneId, visible: true },
  ]);
  group.set(YjsDatabaseKey.id, groupId);
  group.set(YjsDatabaseKey.field_id, statusFieldId);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);

  rowOrders.push([
    { id: existingTodoRowId, height: 44 },
    { id: existingDoingRowId, height: 44 },
  ]);
  boardLayoutSettings.set(YjsDatabaseKey.hide_empty_groups, true);
  layoutSettings.set('1', boardLayoutSettings);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  view.set(YjsDatabaseKey.groups, groups);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  views.set(viewId, view);

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const existingTodoRowDoc = createRowDoc(existingTodoRowId, databaseId, {
    [statusFieldId]: createCell(FieldType.SingleSelect, todoId),
  });
  const existingDoingRowDoc = createRowDoc(existingDoingRowId, databaseId, {
    [statusFieldId]: createCell(FieldType.SingleSelect, doingId),
  });
  // The database row order can arrive before the independent DatabaseRow
  // collab. Keep this canonical document empty until the test hydrates it.
  const remoteDoingRowDoc = new Y.Doc({ guid: remoteDoingRowId }) as YDoc;
  const rowMap = {
    [existingTodoRowId]: existingTodoRowDoc,
    [existingDoingRowId]: existingDoingRowDoc,
    [remoteDoingRowId]: remoteDoingRowDoc,
  };
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    blobPrefetchComplete: false,
    databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap,
    seedsReady: false,
    workspaceId: 'workspace-id',
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );

  return {
    contextValue,
    databaseDoc,
    existingDoingRowDoc,
    existingTodoRowDoc,
    remoteDoingRowDoc,
    rowOrders,
    wrapper,
  };
}

describe('useRowsByGroup', () => {
  it('publishes first grouping readiness together with the hydrated rows', async () => {
    const fixture = createBoardFixture();
    const hydratedRows = fixture.contextValue.rowMap;
    const committed: { ready: boolean; rowIds: string[] }[] = [];

    fixture.contextValue.rowMap = {};
    const { result, rerender, unmount } = renderHook(
      () => {
        const groupedRows = useRowsByGroup(groupId);

        useLayoutEffect(() => {
          committed.push({
            ready: groupedRows.groupRowsReady,
            rowIds: [...groupedRows.groupResult.values()].flat().map(({ id }) => id).sort(),
          });
        });
        return groupedRows;
      },
      { wrapper: fixture.wrapper }
    );

    expect(result.current.groupRowsReady).toBe(false);
    fixture.contextValue.rowMap = hydratedRows;
    rerender();
    await waitFor(() => expect(result.current.groupRowsReady).toBe(true));
    const readyCommits = committed.filter(({ ready }) => ready);

    expect(readyCommits.length).toBeGreaterThan(0);
    for (const { rowIds } of readyCommits) {
      expect(rowIds).toEqual([existingDoingRowId, existingTodoRowId].sort());
    }

    unmount();
    fixture.remoteDoingRowDoc.destroy();
    fixture.existingDoingRowDoc.destroy();
    fixture.existingTodoRowDoc.destroy();
    fixture.databaseDoc.destroy();
  });

  it('never reveals empty columns while a remotely ordered row is still hydrating', async () => {
    const fixture = createBoardFixture();
    const visibleColumnHistory: string[][] = [];
    const { result, unmount } = renderHook(
      () => {
        const groupedRows = useRowsByGroup(groupId);

        visibleColumnHistory.push(groupedRows.columns.map(({ id }) => id));
        return groupedRows;
      },
      { wrapper: fixture.wrapper }
    );

    await waitFor(() => {
      expect(result.current.groupRowsReady).toBe(true);
      expect(result.current.columns.map(({ id }) => id)).toEqual([todoId, doingId]);
    });

    const transitionStart = visibleColumnHistory.length;

    await act(async () => {
      fixture.rowOrders.push([{ id: remoteDoingRowId, height: 44 }]);
      await Promise.resolve();
    });

    const assertOnlyPopulatedColumnsRendered = () => {
      const transitionSnapshots = visibleColumnHistory.slice(transitionStart);

      expect(transitionSnapshots).not.toHaveLength(0);
      transitionSnapshots.forEach((visibleColumnIds) => {
        expect(visibleColumnIds).toEqual([todoId, doingId]);
      });
    };

    assertOnlyPopulatedColumnsRendered();
    expect(result.current.groupResult.get(doingId)?.map(({ id }) => id)).toEqual([existingDoingRowId]);

    const hydratedRemoteRow = createRowDoc(remoteDoingRowId, databaseId, {
      [statusFieldId]: createCell(FieldType.SingleSelect, doingId),
    });

    act(() => {
      Y.applyUpdate(fixture.remoteDoingRowDoc, Y.encodeStateAsUpdate(hydratedRemoteRow));
    });

    await waitFor(() => {
      expect(result.current.groupResult.get(doingId)?.map(({ id }) => id)).toEqual([
        existingDoingRowId,
        remoteDoingRowId,
      ]);
    });
    assertOnlyPopulatedColumnsRendered();

    unmount();
    hydratedRemoteRow.destroy();
    fixture.remoteDoingRowDoc.destroy();
    fixture.existingDoingRowDoc.destroy();
    fixture.existingTodoRowDoc.destroy();
    fixture.databaseDoc.destroy();
  });

  it('does not reuse grouping readiness after the active view changes', async () => {
    const fixture = createBoardFixture();
    const readinessHistory: boolean[] = [];
    const { result, rerender, unmount } = renderHook(
      () => {
        const groupedRows = useRowsByGroup(groupId);

        readinessHistory.push(groupedRows.groupRowsReady);
        return groupedRows;
      },
      { wrapper: fixture.wrapper }
    );

    await waitFor(() => expect(result.current.groupRowsReady).toBe(true));
    const transitionStart = readinessHistory.length;

    fixture.contextValue.activeViewId = 'cold-board-view-id';
    rerender();

    await waitFor(() => expect(result.current.groupRowsReady).toBe(false));
    expect(readinessHistory.slice(transitionStart)).not.toContain(true);

    unmount();
    fixture.remoteDoingRowDoc.destroy();
    fixture.existingDoingRowDoc.destroy();
    fixture.existingTodoRowDoc.destroy();
    fixture.databaseDoc.destroy();
  });

  it('does not reuse grouping readiness after the database document is replaced with the same ids', async () => {
    const fixture = createBoardFixture();
    const replacement = createBoardFixture();
    const coldTodoRowDoc = new Y.Doc({ guid: existingTodoRowId }) as YDoc;
    const coldDoingRowDoc = new Y.Doc({ guid: existingDoingRowId }) as YDoc;
    const readinessHistory: boolean[] = [];
    const { result, rerender, unmount } = renderHook(
      () => {
        const groupedRows = useRowsByGroup(groupId);

        readinessHistory.push(groupedRows.groupRowsReady);
        return groupedRows;
      },
      { wrapper: fixture.wrapper }
    );

    await waitFor(() => expect(result.current.groupRowsReady).toBe(true));
    const transitionStart = readinessHistory.length;

    Object.assign(fixture.contextValue, replacement.contextValue, {
      rowMap: {
        [existingTodoRowId]: coldTodoRowDoc,
        [existingDoingRowId]: coldDoingRowDoc,
      },
    });
    rerender();

    await waitFor(() => expect(result.current.groupRowsReady).toBe(false));
    expect(readinessHistory.slice(transitionStart)).not.toContain(true);
    expect(result.current.columns.map(({ id }) => id)).toEqual([statusFieldId, todoId, doingId, doneId]);

    act(() => {
      Y.applyUpdate(coldTodoRowDoc, Y.encodeStateAsUpdate(replacement.existingTodoRowDoc));
      Y.applyUpdate(coldDoingRowDoc, Y.encodeStateAsUpdate(replacement.existingDoingRowDoc));
    });

    await waitFor(() => {
      expect(result.current.groupRowsReady).toBe(true);
      expect(result.current.columns.map(({ id }) => id)).toEqual([todoId, doingId]);
    });

    unmount();
    coldTodoRowDoc.destroy();
    coldDoingRowDoc.destroy();
    replacement.remoteDoingRowDoc.destroy();
    replacement.existingDoingRowDoc.destroy();
    replacement.existingTodoRowDoc.destroy();
    replacement.databaseDoc.destroy();
    fixture.remoteDoingRowDoc.destroy();
    fixture.existingDoingRowDoc.destroy();
    fixture.existingTodoRowDoc.destroy();
    fixture.databaseDoc.destroy();
  });

  it('keeps the same group result when a regroup moves no row, and a new one when a row moves', async () => {
    const fixture = createBoardFixture();
    const regroups = jest.spyOn(groupModule, 'groupByField');
    const { result, rerender, unmount } = renderHook(() => useRowsByGroup(groupId), { wrapper: fixture.wrapper });

    await waitFor(() => expect(result.current.groupRowsReady).toBe(true));
    const groupResult = result.current.groupResult;

    // A row doc that loads is a new row map with the same rows: every row is grouped again.
    regroups.mockClear();
    fixture.contextValue.rowMap = { ...fixture.contextValue.rowMap };
    rerender();

    expect(regroups).toHaveBeenCalled();
    expect(result.current.groupResult).toBe(groupResult);

    // A row that moves to another column is a new result.
    const todoCells = fixture.existingTodoRowDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row)
      .get(YjsDatabaseKey.cells);

    act(() => {
      todoCells.get(statusFieldId).set(YjsDatabaseKey.data, doingId);
    });

    await waitFor(() =>
      expect(result.current.groupResult.get(doingId)?.map(({ id }) => id)).toEqual([
        existingTodoRowId,
        existingDoingRowId,
      ])
    );
    expect(result.current.groupResult).not.toBe(groupResult);

    unmount();
    regroups.mockRestore();
    fixture.remoteDoingRowDoc.destroy();
    fixture.existingDoingRowDoc.destroy();
    fixture.existingTodoRowDoc.destroy();
    fixture.databaseDoc.destroy();
  });
});

/** The Projects board of the BDD fixture: Status columns and an Estimate number. */
function createProjectsBoard({ sorted }: { sorted: boolean }) {
  const doc = new Y.Doc({ guid: 'projects' }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const status = new Y.Map() as YDatabaseField;
  const estimate = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map();
  const selectOptions = new Y.Map();
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const groups = new Y.Array<Y.Map<unknown>>();
  const group = new Y.Map<unknown>();
  const columns = new Y.Array<{ id: string; visible: boolean }>();
  const sorts = new Y.Array() as YDatabaseSorts;
  const name = new Y.Map() as YDatabaseField;
  const rows: [string, string, string, number][] = [
    ['website', 'Website launch', doingId, 3],
    ['mobile', 'Mobile app', todoId, 5],
    ['api', 'API cleanup', doneId, 8],
    ['beta', 'Beta test', doingId, 1],
  ];

  selectOptions.set(
    YjsDatabaseKey.content,
    JSON.stringify({
      disable_color: false,
      options: [
        { id: todoId, name: 'Todo', color: 'Purple' },
        { id: doingId, name: 'Doing', color: 'Blue' },
        { id: doneId, name: 'Done', color: 'Green' },
      ],
    })
  );
  typeOptions.set(String(FieldType.SingleSelect), selectOptions);
  status.set(YjsDatabaseKey.id, statusFieldId);
  status.set(YjsDatabaseKey.name, 'Status');
  status.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  status.set(YjsDatabaseKey.type_option, typeOptions);
  estimate.set(YjsDatabaseKey.id, 'estimate');
  estimate.set(YjsDatabaseKey.name, 'Estimate');
  estimate.set(YjsDatabaseKey.type, FieldType.Number);
  name.set(YjsDatabaseKey.id, 'name');
  name.set(YjsDatabaseKey.name, 'Name');
  name.set(YjsDatabaseKey.type, FieldType.RichText);
  name.set(YjsDatabaseKey.is_primary, true);
  fields.set('name', name);
  fields.set(statusFieldId, status);
  fields.set('estimate', estimate);
  columns.push([
    { id: statusFieldId, visible: true },
    { id: todoId, visible: true },
    { id: doingId, visible: true },
    { id: doneId, visible: true },
  ]);
  group.set(YjsDatabaseKey.id, groupId);
  group.set(YjsDatabaseKey.field_id, statusFieldId);
  group.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  group.set(YjsDatabaseKey.groups, columns);
  groups.push([group]);
  if (sorted) {
    const sort = new Y.Map() as YDatabaseSort;

    sort.set(YjsDatabaseKey.id, 'estimate-desc');
    sort.set(YjsDatabaseKey.field_id, 'estimate');
    sort.set(YjsDatabaseKey.condition, SortCondition.Descending);
    sorts.push([sort]);
  }

  view.set(YjsDatabaseKey.row_orders, Y.Array.from(rows.map(([id]) => ({ id, height: 36 }))) as YDatabaseRowOrders);
  view.set(YjsDatabaseKey.groups, groups);
  view.set(YjsDatabaseKey.sorts, sorts);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, 'projects');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowMap = Object.fromEntries(
    rows.map(([id, title, statusId, points]) => [
      id,
      createRowDoc(id, 'projects', {
        name: createCell(FieldType.RichText, title),
        [statusFieldId]: createCell(FieldType.SingleSelect, statusId),
        estimate: createCell(FieldType.Number, String(points)),
      }),
    ])
  );
  const contextValue: DatabaseContextState = {
    activeViewId: viewId,
    blobPrefetchComplete: true,
    databaseDoc: doc,
    databasePageId: viewId,
    readOnly: false,
    rowMap,
    seedsReady: true,
    workspaceId: 'workspace-id',
  };
  const query = { value: '' };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>
      <DatabaseSearchQueryContext.Provider value={query.value}>{children}</DatabaseSearchQueryContext.Provider>
    </DatabaseContext.Provider>
  );

  return { wrapper, query, rowMap, destroy: () => doc.destroy() };
}

const cardIds = (result: Map<string, Row[]>, columnId: string) => result.get(columnId)?.map((row) => row.id);

describe('useRowsByGroup with board sorts and search (WP09)', () => {
  it('orders the cards of each column by the sort and keeps the column order', async () => {
    const board = createProjectsBoard({ sorted: true });
    const { result, unmount } = renderHook(() => useRowsByGroup(groupId), { wrapper: board.wrapper });

    await waitFor(() => expect(cardIds(result.current.groupResult, doingId)).toEqual(['website', 'beta']));
    expect(result.current.columns.map((column) => column.id)).toEqual([statusFieldId, todoId, doingId, doneId]);
    unmount();
    board.destroy();
  });

  it('removes the cards that do not match the search from every column', async () => {
    const board = createProjectsBoard({ sorted: false });

    board.query.value = 'mobile';
    const { result, unmount } = renderHook(() => useRowsByGroup(groupId), { wrapper: board.wrapper });

    await waitFor(() => expect(cardIds(result.current.groupResult, todoId)).toEqual(['mobile']));
    expect(cardIds(result.current.groupResult, doingId) ?? []).toEqual([]);
    expect(cardIds(result.current.groupResult, doneId) ?? []).toEqual([]);
    unmount();
    board.destroy();
  });

  it('exposes the row docs it grouped, for the column calculations', async () => {
    const board = createProjectsBoard({ sorted: false });
    const { result, unmount } = renderHook(() => useRowsByGroup(groupId), { wrapper: board.wrapper });

    await waitFor(() => expect(result.current.groupRowsReady).toBe(true));
    expect(Object.keys(result.current.groupingRows).sort()).toEqual(['api', 'beta', 'mobile', 'website']);
    expect(result.current.groupingRows.mobile).toBe(board.rowMap.mobile);
    unmount();
    board.destroy();
  });
});

describe('haveSameGroupRows', () => {
  const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, height: 44, ...extra });

  it('matches the same columns with equal rows, whatever the row objects', () => {
    const previous = new Map([
      ['todo', [row('a'), row('b')]],
      ['done', [row('c')]],
    ]);

    expect(haveSameGroupRows(previous, previous)).toBe(true);
    expect(
      haveSameGroupRows(
        previous,
        new Map([
          ['todo', [row('a'), row('b')]],
          ['done', [row('c')]],
        ])
      )
    ).toBe(true);
  });

  it('tells apart a row that moved, a row added, a column order and a row that changed', () => {
    const previous = new Map([
      ['todo', [row('a'), row('b')]],
      ['done', [row('c')]],
    ]);

    expect(
      haveSameGroupRows(
        previous,
        new Map([
          ['todo', [row('a')]],
          ['done', [row('b'), row('c')]],
        ])
      )
    ).toBe(false);
    expect(
      haveSameGroupRows(
        previous,
        new Map([
          ['todo', [row('a'), row('b')]],
          ['done', [row('c'), row('d')]],
        ])
      )
    ).toBe(false);
    expect(
      haveSameGroupRows(
        previous,
        new Map([
          ['done', [row('c')]],
          ['todo', [row('a'), row('b')]],
        ])
      )
    ).toBe(false);
    expect(haveSameGroupRows(previous, new Map([['todo', [row('a'), row('b')]]]))).toBe(false);
    expect(
      haveSameGroupRows(
        previous,
        new Map([
          ['todo', [row('a', { height: 60 }), row('b')]],
          ['done', [row('c')]],
        ])
      )
    ).toBe(false);
    expect(
      haveSameGroupRows(
        previous,
        new Map([
          ['todo', [row('a'), row('b', { is_deleted: true })]],
          ['done', [row('c')]],
        ])
      )
    ).toBe(false);
  });
});
