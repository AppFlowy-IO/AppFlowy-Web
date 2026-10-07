import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType, SortCondition } from '@/application/database-yjs';
import { useMoveCardDispatch } from '@/application/database-yjs/dispatch/row';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createCell, createRowDoc } from '../../__tests__/test-helpers';

import type { ReactNode } from 'react';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const databaseId = 'board-database';
const viewId = 'board-view';
const statusId = 'status';
const estimateId = 'estimate';

function setup({ sorted }: { sorted: boolean }) {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  const status = new Y.Map() as YDatabaseField;
  const estimate = new Y.Map() as YDatabaseField;
  const typeOptions = new Y.Map();
  const selectOption = new Y.Map();
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const sorts = new Y.Array() as YDatabaseSorts;

  selectOption.set(
    YjsDatabaseKey.content,
    JSON.stringify({
      disable_color: false,
      options: [
        { id: 'todo', name: 'Todo', color: 'Purple' },
        { id: 'doing', name: 'Doing', color: 'Blue' },
      ],
    })
  );
  typeOptions.set(String(FieldType.SingleSelect), selectOption);
  status.set(YjsDatabaseKey.id, statusId);
  status.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  status.set(YjsDatabaseKey.type_option, typeOptions);
  estimate.set(YjsDatabaseKey.id, estimateId);
  estimate.set(YjsDatabaseKey.type, FieldType.Number);
  fields.set(statusId, status);
  fields.set(estimateId, estimate);
  view.set(
    YjsDatabaseKey.row_orders,
    Y.Array.from([
      { id: 'a', height: 36 },
      { id: 'b', height: 36 },
      { id: 'c', height: 36 },
    ])
  );
  view.set(YjsDatabaseKey.sorts, sorts);
  if (sorted) {
    const sort = new Y.Map() as YDatabaseSort;

    sort.set(YjsDatabaseKey.id, 'sort');
    sort.set(YjsDatabaseKey.field_id, estimateId);
    sort.set(YjsDatabaseKey.condition, SortCondition.Descending);
    sorts.push([sort]);
  }

  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rowMap = {
    a: createRowDoc('a', databaseId, { [statusId]: createCell(FieldType.SingleSelect, 'todo') }),
    b: createRowDoc('b', databaseId, { [statusId]: createCell(FieldType.SingleSelect, 'doing') }),
    c: createRowDoc('c', databaseId, { [statusId]: createCell(FieldType.SingleSelect, 'doing') }),
  };
  const contextValue = {
    readOnly: false,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap,
    workspaceId: 'workspace-id',
  } as DatabaseContextState;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
  const hook = renderHook(useMoveCardDispatch, { wrapper });
  const statusOf = (rowId: keyof typeof rowMap) =>
    (rowMap[rowId].getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow)
      .get(YjsDatabaseKey.cells)
      .get(statusId)
      .get(YjsDatabaseKey.data);
  const rowOrder = () => (view.get(YjsDatabaseKey.row_orders).toJSON() as { id: string }[]).map((row) => row.id);

  return {
    ...hook,
    statusOf,
    rowOrder,
    destroy: () => {
      hook.unmount();
      Object.values(rowMap).forEach((doc) => doc.destroy());
      databaseDoc.destroy();
    },
  };
}

describe('useMoveCardDispatch on a sorted board (WP09 §1.4)', () => {
  it('writes only the group cell when a card moves to another column, keeping row_orders', () => {
    const board = setup({ sorted: true });

    act(() =>
      board.result.current({ rowId: 'a', beforeRowId: 'c', fieldId: statusId, startColumnId: 'todo', finishColumnId: 'doing' })
    );
    expect(board.statusOf('a')).toBe('doing');
    expect(board.rowOrder()).toEqual(['a', 'b', 'c']);
    board.destroy();
  });

  it('ignores a move inside the same column', () => {
    const board = setup({ sorted: true });

    act(() =>
      board.result.current({ rowId: 'c', beforeRowId: undefined, fieldId: statusId, startColumnId: 'doing', finishColumnId: 'doing' })
    );
    expect(board.rowOrder()).toEqual(['a', 'b', 'c']);
    expect(board.statusOf('c')).toBe('doing');
    board.destroy();
  });

  it('still reorders rows on an unsorted board', () => {
    const board = setup({ sorted: false });

    act(() =>
      board.result.current({ rowId: 'a', beforeRowId: 'c', fieldId: statusId, startColumnId: 'todo', finishColumnId: 'doing' })
    );
    expect(board.statusOf('a')).toBe('doing');
    expect(board.rowOrder()).toEqual(['b', 'c', 'a']);
    act(() =>
      board.result.current({ rowId: 'c', beforeRowId: undefined, fieldId: statusId, startColumnId: 'doing', finishColumnId: 'doing' })
    );
    expect(board.rowOrder()).toEqual(['c', 'b', 'a']);
    board.destroy();
  });
});
