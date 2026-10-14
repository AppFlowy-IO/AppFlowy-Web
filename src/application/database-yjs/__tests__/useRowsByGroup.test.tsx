import { act, render, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, useGroupsSelector, useRowsByGroup } from '@/application/database-yjs';
import { resolveDefaultBoardGroup } from '@/application/database-yjs/board-default-group';
import { Board } from '@/components/database/board/Board';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRowOrders,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/components/database/components/board', () => ({
  Group: ({ groupId }: { groupId: string }) => <div data-testid='board-group'>{groupId}</div>,
}));
jest.mock('@/components/database/board/BoardProvider', () => ({
  BoardProvider: ({ children }: { children: React.ReactNode }) => children,
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
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );

  return {
    contextValue,
    databaseDoc,
    existingDoingRowDoc,
    existingTodoRowDoc,
    remoteDoingRowDoc,
    rowOrders,
    view,
    fields,
    groups,
    wrapper,
  };
}

describe('useRowsByGroup', () => {
  it('renders a server-default read-only Board without writing grouping into its collab', async () => {
    const fixture = createBoardFixture();

    fixture.contextValue.readOnly = true;
    fixture.view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    const remoteGroup = fixture.groups.get(0).clone();

    fixture.groups.delete(0, fixture.groups.length);
    const before = Y.encodeStateAsUpdate(fixture.databaseDoc);
    const updates = jest.fn();

    fixture.databaseDoc.on('update', updates);
    const { result } = renderHook(() => {
      const groups = useGroupsSelector();

      return useRowsByGroup(groups[0]);
    }, { wrapper: fixture.wrapper });
    const board = render(<Board />, { wrapper: fixture.wrapper });

    await waitFor(() => {
      expect(result.current.groupRowsReady).toBe(true);
      expect(result.current.fieldId).toBe(statusFieldId);
      expect(result.current.columns.map(({ id }) => id)).toEqual([todoId, doingId]);
      expect(board.getByTestId('board-group').textContent).toBe(`default-board:${statusFieldId}`);
    });
    expect(result.current.groupResult.get(todoId)?.map(({ id }) => id)).toEqual([existingTodoRowId]);
    expect(updates).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(fixture.databaseDoc)).toEqual(before);

    act(() => fixture.groups.push([remoteGroup]));
    await waitFor(() => expect(board.getByTestId('board-group').textContent).toBe(groupId));
    expect(updates).toHaveBeenCalledTimes(1);
    expect(result.current.fieldId).toBe(statusFieldId);
  });

  it('initializes an editable lazy Board once, preserving an explicit group on remount', async () => {
    const fixture = createBoardFixture();
    const filters = new Y.Array<Y.Map<unknown>>();
    const filter = new Y.Map<unknown>();

    filter.set(YjsDatabaseKey.id, 'existing-status-filter');
    filter.set(YjsDatabaseKey.field_id, statusFieldId);
    filters.push([filter]);
    fixture.view.set(YjsDatabaseKey.filters, filters);
    fixture.view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    fixture.groups.delete(0, fixture.groups.length);
    const mounted = render(<Board />, { wrapper: fixture.wrapper });

    await waitFor(() => expect(fixture.groups.length).toBe(1));
    const initializedId = fixture.groups.get(0).get(YjsDatabaseKey.id);

    expect(fixture.groups.get(0).get(YjsDatabaseKey.field_id)).toBe(statusFieldId);
    expect(filters.toJSON()).toEqual([{ id: 'existing-status-filter', field_id: statusFieldId }]);
    expect(resolveDefaultBoardGroup(fixture.view, fixture.fields)).toBeUndefined();
    mounted.unmount();
    render(<Board />, { wrapper: fixture.wrapper });
    expect(fixture.groups.length).toBe(1);
    expect(fixture.groups.get(0).get(YjsDatabaseKey.id)).toBe(initializedId);
  });

  it('never invents optional Grid grouping or overrides a persisted group with a missing field', () => {
    const fixture = createBoardFixture();

    fixture.view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Board);
    fixture.groups.get(0).set(YjsDatabaseKey.field_id, 'deleted-field');
    expect(resolveDefaultBoardGroup(fixture.view, fixture.fields)).toBeUndefined();
    fixture.groups.delete(0, fixture.groups.length);
    fixture.view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
    expect(resolveDefaultBoardGroup(fixture.view, fixture.fields)).toBeUndefined();
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
});
