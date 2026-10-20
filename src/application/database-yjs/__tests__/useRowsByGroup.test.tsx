import { act, renderHook, waitFor } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, useRowsByGroup } from '@/application/database-yjs';
import {
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
    wrapper,
  };
}

describe('useRowsByGroup', () => {
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
