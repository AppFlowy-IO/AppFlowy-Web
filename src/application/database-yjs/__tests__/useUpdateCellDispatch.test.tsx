import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import { useUpdateCellDispatch, useUpdateStartEndTimeCell } from '@/application/database-yjs/dispatch';
import { useUpdateStartEndTimeCells } from '@/application/database-yjs/dispatch/cell';
import { getOrCreateDatabaseHistoryManager, runDatabaseAction } from '@/application/database-yjs/history';
import {
  RowId,
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createRowDoc } from './test-helpers';

import type { ReactNode } from 'react';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => ({ uid: '42', attributionUid: '42' }),
}));

const databaseId = 'database-id';
const viewId = 'view-id';
const rowId = 'row-id';
const fieldId = 'name-field-id';

function createTextField(fieldType: FieldType = FieldType.RichText): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Name');
  field.set(YjsDatabaseKey.type, fieldType);

  return field;
}

function createDatabaseDoc(fieldType: FieldType = FieldType.RichText): YDoc {
  const doc = new Y.Doc({ guid: databaseId }) as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;

  fields.set(fieldId, createTextField(fieldType));
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function getCellData(rowDoc: YDoc) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);
  const cells = row?.get(YjsDatabaseKey.cells);

  return cells?.get(fieldId)?.get(YjsDatabaseKey.data);
}

function getCell(rowDoc: YDoc) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);
  const cells = row?.get(YjsDatabaseKey.cells);

  return cells?.get(fieldId);
}

function createWrapper(contextValue: DatabaseContextState) {
  return ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
  );
}

describe('useUpdateCellDispatch', () => {
  it('ensures a missing row doc before committing the cell update', async () => {
    const databaseDoc = createDatabaseDoc();
    const rowDoc = createRowDoc(rowId, databaseId, {});
    const ensureRow = jest.fn<Promise<YDoc>, [RowId]>().mockResolvedValue(rowDoc);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      ensureRow,
      workspaceId: 'workspace-id',
    };
    const { result } = renderHook(() => useUpdateCellDispatch(rowId, fieldId), {
      wrapper: createWrapper(contextValue),
    });

    result.current('Recovered value');

    await waitFor(() => {
      expect(getCellData(rowDoc)).toBe('Recovered value');
    });
    expect(ensureRow).toHaveBeenCalledWith(rowId);

    const history = getOrCreateDatabaseHistoryManager(databaseDoc);

    expect(history.canUndo()).toBe(true);
    void act(() => {
      history.undo();
    });
    expect(getCellData(rowDoc)).toBeUndefined();
    void act(() => {
      history.redo();
    });
    expect(getCellData(rowDoc)).toBe('Recovered value');
  });

  it.each([FieldType.Summary, FieldType.Translate])('skips AI-generated %s cell writes', async (fieldType) => {
    const databaseDoc = createDatabaseDoc(fieldType);
    const rowDoc = createRowDoc(rowId, databaseId, {});
    const database = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database) as unknown as Y.Map<unknown>;
    const history = getOrCreateDatabaseHistoryManager(databaseDoc);

    runDatabaseAction(databaseDoc, { type: 'database.test-marker' }, () => {
      database.set('history-marker', true);
    });
    history.undo();
    expect(history.canRedo()).toBe(true);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: { [rowId]: rowDoc },
      workspaceId: 'workspace-id',
    };
    const { result } = renderHook(() => useUpdateCellDispatch(rowId, fieldId), {
      wrapper: createWrapper(contextValue),
    });

    result.current('Generated value', undefined, { policy: 'skip' });

    await waitFor(() => {
      expect(getCellData(rowDoc)).toBe('Generated value');
    });
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    void act(() => {
      history.redo();
    });
    expect(database.get('history-marker')).toBe(true);
    expect(getCellData(rowDoc)).toBe('Generated value');
  });

  it('makes an edited lazy cell native to the current field type', async () => {
    const databaseDoc = createDatabaseDoc();
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.MultiSelect, data: 'opt-a,opt-b' },
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: { [rowId]: rowDoc },
      workspaceId: 'workspace-id',
    };
    const { result } = renderHook(() => useUpdateCellDispatch(rowId, fieldId), {
      wrapper: createWrapper(contextValue),
    });

    result.current('Edited value');

    await waitFor(() => {
      const cell = getCell(rowDoc);

      expect(cell?.get(YjsDatabaseKey.data)).toBe('Edited value');
      expect(cell?.get(YjsDatabaseKey.field_type)).toBe(FieldType.RichText);
      expect(cell?.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
      const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row);

      expect(row?.get(YjsDatabaseKey.last_edited_by)).toBe('42');
      expect(row?.get(YjsDatabaseKey.created_by)).toBeUndefined();
    });
  });
});

describe('useUpdateStartEndTimeCell', () => {
  it('ensures a missing row doc before committing the calendar time update', async () => {
    const databaseDoc = createDatabaseDoc();
    const rowDoc = createRowDoc(rowId, databaseId, {});
    const ensureRow = jest.fn<Promise<YDoc>, [RowId]>().mockResolvedValue(rowDoc);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      ensureRow,
      workspaceId: 'workspace-id',
    };
    const { result } = renderHook(() => useUpdateStartEndTimeCell(), {
      wrapper: createWrapper(contextValue),
    });

    result.current(rowId, fieldId, '100', '200', false);

    await waitFor(() => {
      const cell = getCell(rowDoc);

      expect(cell?.get(YjsDatabaseKey.data)).toBe('100');
      expect(cell?.get(YjsDatabaseKey.end_timestamp)).toBe('200');
      expect(cell?.get(YjsDatabaseKey.include_time)).toBe(true);
    });
    expect(ensureRow).toHaveBeenCalledWith(rowId);

    const history = getOrCreateDatabaseHistoryManager(databaseDoc);

    expect(history.canUndo()).toBe(true);
    void act(() => {
      history.undo();
    });
    expect(getCell(rowDoc)).toBeUndefined();
    void act(() => {
      history.redo();
    });
    expect(getCell(rowDoc)?.get(YjsDatabaseKey.data)).toBe('100');
    expect(getCell(rowDoc)?.get(YjsDatabaseKey.end_timestamp)).toBe('200');
  });

  it('does not commit calendar time updates when the row doc cannot be loaded', async () => {
    const databaseDoc = createDatabaseDoc();
    const ensureRow = jest.fn<Promise<YDoc | undefined>, [RowId]>().mockResolvedValue(undefined);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: {},
      ensureRow,
      workspaceId: 'workspace-id',
    };
    const { result } = renderHook(() => useUpdateStartEndTimeCell(), {
      wrapper: createWrapper(contextValue),
    });

    result.current(rowId, fieldId, '100');

    await waitFor(() => {
      expect(ensureRow).toHaveBeenCalledWith(rowId);
    });
  });

  it('makes an updated converted cell native DateTime data', async () => {
    const databaseDoc = createDatabaseDoc();
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.RichText, data: 'old text' },
    });
    const cell = getCell(rowDoc);

    cell?.set(YjsDatabaseKey.source_field_type, String(FieldType.MultiSelect));

    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: { [rowId]: rowDoc },
      workspaceId: 'workspace-id',
    };
    const { result } = renderHook(() => useUpdateStartEndTimeCell(), {
      wrapper: createWrapper(contextValue),
    });

    result.current(rowId, fieldId, '100', '200', false);

    await waitFor(() => {
      expect(cell?.get(YjsDatabaseKey.data)).toBe('100');
      expect(cell?.get(YjsDatabaseKey.field_type)).toBe(FieldType.DateTime);
      expect(cell?.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
    });
  });
});

describe('grouped date updates', () => {
  function fixture() {
    const databaseDoc = createDatabaseDoc(FieldType.DateTime);
    const root = createRowDoc(rowId, databaseId, {
      [fieldId]: { fieldType: FieldType.DateTime, data: '100' },
      end: { fieldType: FieldType.DateTime, data: '200' },
    });
    const followerSeed = createRowDoc('follower', databaseId, {
      [fieldId]: { fieldType: FieldType.DateTime, data: '300' },
      end: { fieldType: FieldType.DateTime, data: '400' },
    });
    const follower = new Y.Doc() as YDoc;
    let resolveRow!: (doc: YDoc | undefined) => void;
    const pendingRow = new Promise<YDoc | undefined>((resolve) => {
      resolveRow = resolve;
    });
    const ensureRow = jest.fn(() => pendingRow);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: viewId,
      activeViewId: viewId,
      rowMap: { [rowId]: root },
      ensureRow,
      workspaceId: 'workspace-id',
    };
    const history = getOrCreateDatabaseHistoryManager(databaseDoc);
    const hook = renderHook(useUpdateStartEndTimeCells, { wrapper: createWrapper(contextValue) });
    const updates = [
      { rowId, fieldId, startTimestamp: '110' },
      { rowId, fieldId: 'end', startTimestamp: '210' },
      { rowId: 'follower', fieldId, startTimestamp: '310' },
      { rowId: 'follower', fieldId: 'end', startTimestamp: '410' },
    ];

    return { ...hook, databaseDoc, root, follower, followerSeed, ensureRow, resolveRow, history, updates };
  }

  it('waits for every row and its cells, then undoes and redoes all dates together', async () => {
    const { result, root, follower, followerSeed, ensureRow, resolveRow, history, updates } = fixture();
    const pending = result.current(updates);

    expect(getCellData(root)).toBe('100');
    expect(ensureRow).toHaveBeenCalledTimes(1);
    expect(ensureRow).toHaveBeenCalledWith('follower');
    await act(async () => {
      resolveRow(follower);
    });
    expect(getCellData(root)).toBe('100');
    expect(getCellData(follower)).toBeUndefined();
    await act(async () => {
      Y.applyUpdate(follower, Y.encodeStateAsUpdate(followerSeed));
      await pending;
    });
    const endValue = (doc: YDoc) =>
      doc
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database_row)
        ?.get(YjsDatabaseKey.cells)
        .get('end')
        ?.get(YjsDatabaseKey.data);

    expect([getCellData(root), endValue(root), getCellData(follower), endValue(follower)]).toEqual([
      '110',
      '210',
      '310',
      '410',
    ]);
    act(() => {
      history.undo();
    });
    expect([getCellData(root), endValue(root), getCellData(follower), endValue(follower)]).toEqual([
      '100',
      '200',
      '300',
      '400',
    ]);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    act(() => {
      history.redo();
    });
    expect([getCellData(root), endValue(root), getCellData(follower), endValue(follower)]).toEqual([
      '110',
      '210',
      '310',
      '410',
    ]);
  });

  it.each(['undo', 'redo', 'clear', 'unmount'] as const)(
    'cancels the entire pending edit on %s without a late write clearing redo',
    async (command) => {
      const { result, unmount, databaseDoc, root, followerSeed, resolveRow, history, updates } = fixture();

      // Leave an earlier action in redo so delayed writes cannot silently erase it.
      runDatabaseAction(databaseDoc, { type: 'database.test-marker' }, () => {
        databaseDoc.getMap(YjsEditorKey.data_section).set('marker', true);
      });
      history.undo();
      const pending = result.current(updates);

      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(true);
      act(() => {
        if (command === 'unmount') unmount();
        else history[command]();
      });
      await act(async () => {
        resolveRow(followerSeed);
        await pending;
      });
      expect(getCellData(root)).toBe('100');
      expect(getCellData(followerSeed)).toBe('300');
      expect(history.canRedo()).toBe(command === 'undo' || command === 'unmount');
      expect(history.canUndo()).toBe(command === 'redo');
    }
  );

  it('leaves every date unchanged if a follower cannot be hydrated', async () => {
    const { result, root, followerSeed, resolveRow, history, updates } = fixture();
    const pending = result.current(updates);

    await act(async () => {
      resolveRow(undefined);
      await pending;
    });
    expect(getCellData(root)).toBe('100');
    expect(getCellData(followerSeed)).toBe('300');
    expect(history.canUndo()).toBe(false);
  });
});
