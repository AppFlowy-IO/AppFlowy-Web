import { act, renderHook } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';

import {
  executeDatabaseOperations,
  getDatabaseHistoryPolicy,
  getOrCreateDatabaseHistoryManager,
  useDatabaseRowHistory,
  useDatabaseHistory,
  getDatabaseRowHistoryPolicy,
  getOrCreateDatabaseRowHistoryController,
  runDatabaseAction,
  runDatabaseRowAction,
} from '@/application/database-yjs/history';
import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseCell,
  YDatabaseRow,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';

import { createRowDoc } from './test-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const databaseId = 'database-id';
const rowId = 'row-id';
const textFieldId = 'text-field-id';
const relationFieldId = 'relation-field-id';
const viewId = 'view-id';

function getCell(rowDoc: YDoc, fieldId: string): YDatabaseCell | undefined {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

  return row.get(YjsDatabaseKey.cells).get(fieldId);
}

function setCellData(rowDoc: YDoc, fieldId: string, data: string) {
  getCell(rowDoc, fieldId)?.set(YjsDatabaseKey.data, data);
}

function createDatabaseDoc() {
  const databaseDoc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>();

  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.name, 'Grid');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.fields, new Y.Map());
  sharedRoot.set(YjsEditorKey.database, database);

  return {
    database,
    databaseDoc,
    rowOrders,
    sharedRoot,
    view,
  };
}

function createContextValue(databaseDoc: YDoc, rowMap: Record<string, YDoc>): DatabaseContextState {
  return {
    activeViewId: viewId,
    databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap,
    workspaceId: 'workspace-id',
  };
}

function createWrapper(contextValue: DatabaseContextState) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(DatabaseContext.Provider, { value: contextValue }, children);
}

describe('database row history', () => {
  it('captures normal row cell actions and supports undo/redo', () => {
    const rowDoc = createRowDoc(rowId, databaseId, {
      [textFieldId]: {
        fieldType: FieldType.RichText,
        data: 'before',
      },
    });

    runDatabaseRowAction(
      rowDoc,
      { type: 'cell.update', rowId, fieldId: textFieldId, fieldType: FieldType.RichText },
      () => {
        getCell(rowDoc, textFieldId)?.set(YjsDatabaseKey.data, 'after');
      }
    );

    const history = getOrCreateDatabaseRowHistoryController(rowDoc);

    expect(history?.canUndo()).toBe(true);
    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('after');

    history?.undo();
    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('before');
    expect(history?.canRedo()).toBe(true);

    history?.redo();
    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('after');
  });

  it('skips relation cell actions', () => {
    const rowDoc = createRowDoc(rowId, databaseId, {
      [relationFieldId]: {
        fieldType: FieldType.Relation,
        data: new Y.Array<string>(),
      },
    });

    const relationData = new Y.Array<string>();

    relationData.push(['related-row-id']);

    runDatabaseRowAction(
      rowDoc,
      { type: 'relation.update-cell', rowId, fieldId: relationFieldId, fieldType: FieldType.Relation },
      () => {
        getCell(rowDoc, relationFieldId)?.set(YjsDatabaseKey.data, relationData);
      }
    );

    const history = getOrCreateDatabaseRowHistoryController(rowDoc);

    expect(history?.canUndo()).toBe(false);
    expect((getCell(rowDoc, relationFieldId)?.get(YjsDatabaseKey.data) as Y.Array<string>).toArray()).toEqual([
      'related-row-id',
    ]);
  });

  it('allows non-relation actions to opt out explicitly', () => {
    const rowDoc = createRowDoc(rowId, databaseId, {
      [textFieldId]: {
        fieldType: FieldType.RichText,
        data: 'before',
      },
    });

    runDatabaseRowAction(
      rowDoc,
      { type: 'cell.update', rowId, fieldId: textFieldId, fieldType: FieldType.RichText, policy: 'skip' },
      () => {
        getCell(rowDoc, textFieldId)?.set(YjsDatabaseKey.data, 'after');
      }
    );

    const history = getOrCreateDatabaseRowHistoryController(rowDoc);

    expect(history?.canUndo()).toBe(false);
    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('after');
  });

  it('does not allow relation actions to force capture', () => {
    expect(
      getDatabaseRowHistoryPolicy({
        type: 'cell.update',
        fieldType: FieldType.Relation,
        policy: 'capture',
      })
    ).toBe('skip');
  });

  it('exposes undo and redo state through useDatabaseRowHistory', () => {
    const rowDoc = createRowDoc(rowId, databaseId, {
      [textFieldId]: {
        fieldType: FieldType.RichText,
        data: 'before',
      },
    });
    const contextValue: DatabaseContextState = {
      activeViewId: 'view-id',
      databaseDoc: new Y.Doc({ guid: databaseId }) as YDoc,
      databasePageId: 'view-id',
      readOnly: false,
      rowMap: { [rowId]: rowDoc },
      workspaceId: 'workspace-id',
    };
    const { result } = renderHook(() => useDatabaseRowHistory(rowId), {
      wrapper: createWrapper(contextValue),
    });

    act(() => {
      result.current.runAction(
        { type: 'cell.update', rowId, fieldId: textFieldId, fieldType: FieldType.RichText },
        () => {
          getCell(rowDoc, textFieldId)?.set(YjsDatabaseKey.data, 'after');
        }
      );
    });

    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });

    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('before');
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.redo();
    });

    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('after');
  });

  it('exposes database-scoped row history across rows', () => {
    const { databaseDoc } = createDatabaseDoc();
    const firstRowDoc = createRowDoc('first-row-id', databaseId, {
      [textFieldId]: {
        fieldType: FieldType.RichText,
        data: 'before',
      },
    });
    const secondRowDoc = createRowDoc('second-row-id', databaseId, {
      [textFieldId]: {
        fieldType: FieldType.RichText,
        data: '',
      },
    });
    const contextValue = createContextValue(databaseDoc, {
      'first-row-id': firstRowDoc,
      'second-row-id': secondRowDoc,
    });
    const { result } = renderHook(() => useDatabaseHistory(), {
      wrapper: createWrapper(contextValue),
    });

    act(() => {
      runDatabaseRowAction(
        firstRowDoc,
        { type: 'cell.update', rowId: 'first-row-id', fieldId: textFieldId, fieldType: FieldType.RichText },
        () => {
          getCell(firstRowDoc, textFieldId)?.set(YjsDatabaseKey.data, 'after');
        }
      );
    });

    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });

    expect(getCell(firstRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('before');
    expect(getCell(secondRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('');
    expect(result.current.canRedo).toBe(true);
  });

  it('tracks database document actions in the same manager', () => {
    const { databaseDoc, rowOrders, sharedRoot } = createDatabaseDoc();
    const manager = getOrCreateDatabaseHistoryManager(databaseDoc);

    executeDatabaseOperations(
      sharedRoot,
      [
        () => {
          rowOrders.push([{ id: rowId, height: 36 }]);
        },
      ],
      'appendRowOrder'
    );

    expect(manager.canUndo()).toBe(true);
    expect(rowOrders.toJSON()).toEqual([{ id: rowId, height: 36 }]);

    manager.undo();
    expect(rowOrders.toJSON()).toEqual([]);
    expect(manager.canRedo()).toBe(true);

    manager.redo();
    expect(rowOrders.toJSON()).toEqual([{ id: rowId, height: 36 }]);
  });

  it('undoes and redoes row and database document actions in global order', () => {
    const { databaseDoc, rowOrders } = createDatabaseDoc();
    const firstRowDoc = createRowDoc('first-row-id', databaseId, {
      [textFieldId]: {
        fieldType: FieldType.RichText,
        data: '',
      },
    });
    const secondRowDoc = createRowDoc('second-row-id', databaseId, {
      [textFieldId]: {
        fieldType: FieldType.RichText,
        data: '',
      },
    });
    const manager = getOrCreateDatabaseHistoryManager(databaseDoc);

    manager.registerRowDoc('first-row-id', firstRowDoc);
    manager.registerRowDoc('second-row-id', secondRowDoc);

    runDatabaseRowAction(
      firstRowDoc,
      { type: 'cell.update', rowId: 'first-row-id', fieldId: textFieldId, fieldType: FieldType.RichText },
      () => setCellData(firstRowDoc, textFieldId, 'first')
    );
    runDatabaseAction(databaseDoc, { type: 'database.add-row-order' }, () => {
      rowOrders.push([{ id: 'first-row-id', height: 36 }]);
    });
    runDatabaseRowAction(
      secondRowDoc,
      { type: 'cell.update', rowId: 'second-row-id', fieldId: textFieldId, fieldType: FieldType.RichText },
      () => setCellData(secondRowDoc, textFieldId, 'second')
    );

    expect(getCell(firstRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('first');
    expect(getCell(secondRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('second');
    expect(rowOrders.toJSON()).toEqual([{ id: 'first-row-id', height: 36 }]);

    manager.undo();
    expect(getCell(secondRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('');
    expect(rowOrders.toJSON()).toEqual([{ id: 'first-row-id', height: 36 }]);

    manager.undo();
    expect(rowOrders.toJSON()).toEqual([]);
    expect(getCell(firstRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('first');

    manager.undo();
    expect(getCell(firstRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('');

    manager.redo();
    expect(getCell(firstRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('first');
    expect(rowOrders.toJSON()).toEqual([]);

    manager.redo();
    expect(rowOrders.toJSON()).toEqual([{ id: 'first-row-id', height: 36 }]);
    expect(getCell(secondRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('');

    manager.redo();
    expect(getCell(secondRowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('second');
  });

  it('keeps repeated edits on the same row undoable through the database manager', () => {
    const { databaseDoc } = createDatabaseDoc();
    const rowDoc = createRowDoc(rowId, databaseId, {
      [textFieldId]: {
        fieldType: FieldType.RichText,
        data: '',
      },
    });
    const manager = getOrCreateDatabaseHistoryManager(databaseDoc);

    manager.registerRowDoc(rowId, rowDoc);

    runDatabaseRowAction(
      rowDoc,
      { type: 'cell.update', rowId, fieldId: textFieldId, fieldType: FieldType.RichText },
      () => setCellData(rowDoc, textFieldId, 'one')
    );
    runDatabaseRowAction(
      rowDoc,
      { type: 'cell.update', rowId, fieldId: textFieldId, fieldType: FieldType.RichText },
      () => setCellData(rowDoc, textFieldId, 'two')
    );

    manager.undo();
    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('one');

    manager.undo();
    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('');

    manager.redo();
    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('one');

    manager.redo();
    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('two');
  });

  it('allows database document actions to opt out explicitly', () => {
    const { databaseDoc, rowOrders } = createDatabaseDoc();
    const manager = getOrCreateDatabaseHistoryManager(databaseDoc);

    runDatabaseAction(databaseDoc, { type: 'database.add-row-order', policy: 'skip' }, () => {
      rowOrders.push([{ id: rowId, height: 36 }]);
    });

    expect(manager.canUndo()).toBe(false);
    expect(rowOrders.toJSON()).toEqual([{ id: rowId, height: 36 }]);
  });

  it('exposes database-scoped history through useDatabaseHistory', () => {
    const { databaseDoc, rowOrders } = createDatabaseDoc();
    const rowDoc = createRowDoc(rowId, databaseId, {
      [textFieldId]: {
        fieldType: FieldType.RichText,
        data: '',
      },
    });
    const contextValue = createContextValue(databaseDoc, { [rowId]: rowDoc });
    const { result } = renderHook(() => useDatabaseHistory(), {
      wrapper: createWrapper(contextValue),
    });

    act(() => {
      runDatabaseRowAction(
        rowDoc,
        { type: 'cell.update', rowId, fieldId: textFieldId, fieldType: FieldType.RichText },
        () => setCellData(rowDoc, textFieldId, 'value')
      );
      runDatabaseAction(databaseDoc, { type: 'database.add-row-order' }, () => {
        rowOrders.push([{ id: rowId, height: 36 }]);
      });
    });

    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
    });

    expect(rowOrders.toJSON()).toEqual([]);
    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('value');

    act(() => {
      result.current.undo();
    });

    expect(getCell(rowDoc, textFieldId)?.get(YjsDatabaseKey.data)).toBe('');
  });

  it('keeps relation policy shared between row and database actions', () => {
    expect(
      getDatabaseHistoryPolicy({
        type: 'relation.update-cell',
        policy: 'capture',
      })
    ).toBe('skip');
  });
});
