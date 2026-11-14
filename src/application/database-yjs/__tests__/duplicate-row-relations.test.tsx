import { act, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { useDuplicateRowDispatch } from '@/application/database-yjs/dispatch/row';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { generateRowMeta, getRowKey } from '@/application/database-yjs/row_meta';
import {
  type YDatabase,
  type YDatabaseCell,
  type YDatabaseRow,
  type YDatabaseView,
  type YDoc,
  YjsDatabaseKey as K,
  YjsEditorKey,
} from '@/application/types';

import { createCloudRow, type CloudRowCreationIntent } from '../creation/create-row';
import { recordCommittedRowCreation } from '../creation/row-creation-history';
import { getOrCreateDatabaseHistoryManager, runDatabaseRowAction } from '../history';

import { createCell, createRowDoc } from './test-helpers';

jest.mock('@/application/db', () => ({
  getCachedProviderDoc: jest.fn(),
  deleteCollabDB: jest.fn(),
  openCollabDB: jest.fn(async () => new Y.Doc()),
}));
jest.mock('../creation/create-row', () => ({
  ...jest.requireActual('../creation/create-row'),
  createCloudRow: jest.fn(),
}));

const databaseId = 'tasks-database';
const viewId = 'tasks-view';
const sourceRowId = 'source-task';
const relationFieldId = 'task-goals';
const reciprocalFieldId = 'goal-tasks';
const goalRowId = 'goal-row';
const goalDatabaseId = 'goals-database';
const titleFieldId = 'title';

beforeEach(() => {
  jest.mocked(createCloudRow).mockReset();
  jest.mocked(createCloudRow).mockImplementation(async (intent: CloudRowCreationIntent) => {
    intent.assertCurrent();
    const row = await intent.registerRow();

    Y.applyUpdate(row, Y.encodeStateAsUpdate(intent.rowDoc));
    const database = intent.databaseDoc.getMap('data').get('database') as YDatabase;

    intent.databaseDoc.transact(() => {
      database.get(K.views).forEach((view) => {
        const orders = view.get(K.row_orders);
        const position = intent.position;
        const index = position.kind === 'after' ? orders.toArray().findIndex((item) => item.id === position.row_id) : -1;

        orders.insert(index + 1, [{ id: intent.rowId, height: 36 }]);
      });
    }, 'remote');
    recordCommittedRowCreation(intent.databaseDoc, intent.rowId, intent.historyGroup);
    return intent.rowId;
  });
});

function createDatabaseDoc(id: string, initialRowId: string): YDoc {
  const doc = new Y.Doc({ guid: id }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const view = new Y.Map() as YDatabaseView;
  const orders = new Y.Array<{ id: string; height: number }>();

  orders.push([{ id: initialRowId, height: 36 }]);
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  database.set(K.id, id);
  database.set(K.fields, new Y.Map());
  database.set(K.views, new Y.Map());
  database.get(K.views).set(viewId, view);
  view.set(K.id, viewId);
  view.set(K.row_orders, orders);
  return doc;
}

function rowOf(doc: YDoc): YDatabaseRow {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
}

function cellOf(doc: YDoc, fieldId: string): YDatabaseCell {
  return rowOf(doc).get(K.cells).get(fieldId);
}

function cloneDoc(doc: YDoc): YDoc {
  const peer = new Y.Doc({ guid: doc.guid }) as YDoc;

  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  return peer;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });

  return { promise, resolve };
}

function createFixture(options: {
  target?: YDoc;
  databaseDoc?: YDoc;
  sourceDoc?: YDoc;
  loadView?: () => Promise<YDoc>;
  loadTarget?: () => Promise<YDoc>;
  reciprocalLimit?: RelationLimit;
  legacyTarget?: boolean;
} = {}) {
  const databaseDoc = options.databaseDoc ?? createDatabaseDoc(databaseId, sourceRowId);
  const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  if (!database.get(K.fields).has(relationFieldId)) {
    database.get(K.fields).set(relationFieldId, createRelationField(relationFieldId, {
      database_id: goalDatabaseId,
      is_two_way: true,
      reciprocal_field_id: reciprocalFieldId,
    }));
  }

  const sourceDoc = options.sourceDoc ?? createRowDoc(sourceRowId, databaseId, {
    [titleFieldId]: createCell(FieldType.RichText, 'Source row'),
    [relationFieldId]: createCell(FieldType.Relation, [goalRowId]),
  });

  if (!options.sourceDoc) {
    sourceDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.meta, new Y.Map(Object.entries(
      generateRowMeta(sourceRowId, { [RowMetaKey.IsDocumentEmpty]: true })
    )));
  }

  const goalDatabaseDoc = createDatabaseDoc(goalDatabaseId, goalRowId);
  const goalDatabase = goalDatabaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  goalDatabase.get(K.fields).set(reciprocalFieldId, createRelationField(reciprocalFieldId, {
    database_id: databaseId,
    is_two_way: true,
    reciprocal_field_id: relationFieldId,
    source_limit: options.reciprocalLimit ?? RelationLimit.NoLimit,
  }));

  // Production stores relation targets in shared arrays. Keep a separate
  // legacy case for the permissive reader and its on-write normalization.
  const reverse = new Y.Array<string>();

  reverse.push([sourceRowId]);
  const target = options.target ?? createRowDoc(goalRowId, goalDatabaseId, {
    [titleFieldId]: createCell(FieldType.RichText, 'Goal row'),
    [reciprocalFieldId]: createCell(FieldType.Relation, options.legacyTarget ? [sourceRowId] : reverse),
  });
  const createdRows = new Map<string, YDoc>();
  const context: DatabaseContextState = {
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    workspaceId: 'workspace-id',
    readOnly: false,
    rowMap: { [sourceRowId]: sourceDoc },
    getViewIdFromDatabaseId: async () => 'goals-view',
    loadView: options.loadView ?? (async () => goalDatabaseDoc),
    bindViewSync: jest.fn(),
    createRow: async (key) => {
      if (key === getRowKey(goalDatabaseDoc.guid, goalRowId)) return options.loadTarget ? options.loadTarget() : target;
      const cached = createdRows.get(key);

      if (cached) return cached;
      const doc = new Y.Doc({ guid: key }) as YDoc;

      createdRows.set(key, doc);
      return doc;
    },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
  );
  const reverseIds = () => getRelationRowIdsFromCell(cellOf(target, reciprocalFieldId));
  const orders = () => database.get(K.views).get(viewId).get(K.row_orders).toArray().map((item) => item.id);

  return { databaseDoc, sourceDoc, goalDatabaseDoc, target, createdRows, wrapper, reverseIds, orders };
}

test.each(['database', 'row'] as const)(
  'does not restore a remotely removed relation while the related %s hydrates',
  async (stage) => {
    const blocked = deferred();
    const loading = deferred();
    const fixture: ReturnType<typeof createFixture> = createFixture({
      loadView: async () => {
        if (stage === 'database') { loading.resolve(); await blocked.promise; }

        return fixture.goalDatabaseDoc;
      },
      loadTarget: async () => {
        if (stage === 'row') { loading.resolve(); await blocked.promise; }

        return fixture.target;
      },
    });
    const { result } = renderHook(() => useDuplicateRowDispatch(), { wrapper: fixture.wrapper });
    let copiedId = '';

    await act(async () => {
      const pending = result.current(sourceRowId);

      await loading.promise;
      const copy = Array.from(fixture.createdRows.values())[0];

      copy.transact(() => cellOf(copy, relationFieldId).set(K.data, new Y.Array<string>()), 'remote');
      blocked.resolve();
      copiedId = await pending;
    });
    const copy = fixture.createdRows.get(getRowKey(databaseId, copiedId))!;

    expect(getRelationRowIdsFromCell(cellOf(copy, relationFieldId))).toEqual([]);
    expect(fixture.reverseIds()).toEqual([sourceRowId]);
  }
);

test('concurrent duplicates retain both reverse links after two replicas synchronize', async () => {
  const left = createFixture();
  const server = cloneDoc(left.databaseDoc);
  const right = createFixture({
    databaseDoc: cloneDoc(left.databaseDoc),
    sourceDoc: cloneDoc(left.sourceDoc),
    target: cloneDoc(left.target),
  });
  const a = renderHook(() => useDuplicateRowDispatch(), { wrapper: left.wrapper });
  const b = renderHook(() => useDuplicateRowDispatch(), { wrapper: right.wrapper });
  let ids: string[] = [];

  await act(async () => { ids = await Promise.all([a.result.current(sourceRowId), b.result.current(sourceRowId)]); });
  const leftUpdate = Y.encodeStateAsUpdate(left.target);
  const rightUpdate = Y.encodeStateAsUpdate(right.target);

  Y.applyUpdate(left.target, rightUpdate);
  Y.applyUpdate(right.target, leftUpdate);
  Y.applyUpdate(server, Y.encodeStateAsUpdate(left.databaseDoc));
  Y.applyUpdate(server, Y.encodeStateAsUpdate(right.databaseDoc));
  const serverDatabase = server.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  expect(serverDatabase.get(K.views).get(viewId).get(K.row_orders).toArray().map((item) => item.id)).toEqual(
    expect.arrayContaining([sourceRowId, ...ids])
  );
  expect(left.reverseIds()).toEqual(right.reverseIds());
  expect(left.reverseIds()).toEqual(expect.arrayContaining([sourceRowId, ...ids]));
});

test('concurrent one-only duplicates keep a single reciprocal selection', async () => {
  const left = createFixture({ reciprocalLimit: RelationLimit.OneOnly });
  const right = createFixture({
    reciprocalLimit: RelationLimit.OneOnly,
    databaseDoc: cloneDoc(left.databaseDoc),
    sourceDoc: cloneDoc(left.sourceDoc),
    target: cloneDoc(left.target),
  });
  const a = renderHook(() => useDuplicateRowDispatch(), { wrapper: left.wrapper });
  const b = renderHook(() => useDuplicateRowDispatch(), { wrapper: right.wrapper });
  let ids: string[] = [];

  await act(async () => { ids = await Promise.all([a.result.current(sourceRowId), b.result.current(sourceRowId)]); });
  const leftUpdate = Y.encodeStateAsUpdate(left.target);
  const rightUpdate = Y.encodeStateAsUpdate(right.target);

  Y.applyUpdate(left.target, rightUpdate);
  Y.applyUpdate(right.target, leftUpdate);
  expect(left.reverseIds()).toEqual(right.reverseIds());
  expect(left.reverseIds()).toHaveLength(1);
  expect(ids).toContain(left.reverseIds()[0]);
});

test('undo during related-row hydration prevents a late reciprocal insertion', async () => {
  const blocked = deferred();
  const loading = deferred();
  const fixture: ReturnType<typeof createFixture> = createFixture({ loadTarget: async () => {
    loading.resolve();
    await blocked.promise;
    return fixture.target;
  } });
  const manager = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);
  const { result } = renderHook(() => useDuplicateRowDispatch(), { wrapper: fixture.wrapper });
  let copiedId = '';

  await act(async () => {
    const pending = result.current(sourceRowId);

    await loading.promise;
    manager.undo();
    blocked.resolve();
    copiedId = await pending;
  });
  expect(fixture.orders()).not.toContain(copiedId);
  expect(fixture.reverseIds()).toEqual([sourceRowId]);
});

test.each([RelationLimit.NoLimit, RelationLimit.OneOnly])(
  'undo and redo include reciprocal links and one-only displacement with target limit %s',
  async (reciprocalLimit) => {
    const fixture = createFixture({ reciprocalLimit });
    const manager = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);
    const { result } = renderHook(() => useDuplicateRowDispatch(), { wrapper: fixture.wrapper });
    let copiedId = '';

    await act(async () => { copiedId = await result.current(sourceRowId); });
    expect(fixture.reverseIds()).toContain(copiedId);
    expect(getRelationRowIdsFromCell(cellOf(fixture.sourceDoc, relationFieldId))).toEqual(
      reciprocalLimit === RelationLimit.OneOnly ? [] : [goalRowId]
    );
    act(() => { manager.undo(); });
    expect(fixture.orders()).not.toContain(copiedId);
    expect(fixture.reverseIds()).toEqual([sourceRowId]);
    expect(getRelationRowIdsFromCell(cellOf(fixture.sourceDoc, relationFieldId))).toEqual([goalRowId]);
    act(() => { manager.redo(); });
    expect(fixture.orders()).toContain(copiedId);
    expect(fixture.reverseIds()).toContain(copiedId);
  }
);

test('late reciprocal completion stays with its creation without consuming a newer edit', async () => {
  const blocked = deferred();
  const loading = deferred();
  const fixture: ReturnType<typeof createFixture> = createFixture({ loadView: async () => {
    loading.resolve();
    await blocked.promise;
    return fixture.goalDatabaseDoc;
  } });
  const manager = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

  manager.registerRowDoc(sourceRowId, fixture.sourceDoc);
  const { result } = renderHook(() => useDuplicateRowDispatch(), { wrapper: fixture.wrapper });
  let copiedId = '';

  await act(async () => {
    const pending = result.current(sourceRowId);

    await loading.promise;
    runDatabaseRowAction(fixture.sourceDoc, { type: 'row.update-cell', fieldId: titleFieldId }, () => {
      cellOf(fixture.sourceDoc, titleFieldId).set(K.data, 'Later edit');
    });
    blocked.resolve();
    copiedId = await pending;
  });
  act(() => { manager.undo(); });
  expect(cellOf(fixture.sourceDoc, titleFieldId).get(K.data)).toBe('Source row');
  expect(fixture.orders()).toContain(copiedId);
  expect(fixture.reverseIds()).toContain(copiedId);
  act(() => { manager.undo(); });
  expect(fixture.orders()).not.toContain(copiedId);
  expect(fixture.reverseIds()).toEqual([sourceRowId]);
  act(() => { manager.redo(); });
  expect(fixture.orders()).toContain(copiedId);
  expect(fixture.reverseIds()).toContain(copiedId);
  act(() => { manager.redo(); });
  expect(cellOf(fixture.sourceDoc, titleFieldId).get(K.data)).toBe('Later edit');
});

test('target database edits retain their own history when duplication is undone', async () => {
  const fixture = createFixture();
  const sourceHistory = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);
  const targetHistory = getOrCreateDatabaseHistoryManager(fixture.goalDatabaseDoc);

  targetHistory.registerRowDoc(goalRowId, fixture.target);
  const { result } = renderHook(() => useDuplicateRowDispatch(), { wrapper: fixture.wrapper });
  let copiedId = '';

  await act(async () => { copiedId = await result.current(sourceRowId); });
  expect(targetHistory.canUndo()).toBe(false);
  runDatabaseRowAction(fixture.target, { type: 'row.update-cell', fieldId: titleFieldId }, () => {
    cellOf(fixture.target, titleFieldId).set(K.data, 'Target edit');
  });
  act(() => { sourceHistory.undo(); });
  expect(fixture.orders()).not.toContain(copiedId);
  expect(fixture.reverseIds()).toEqual([sourceRowId]);
  expect(cellOf(fixture.target, titleFieldId).get(K.data)).toBe('Target edit');
  act(() => { targetHistory.undo(); });
  expect(cellOf(fixture.target, titleFieldId).get(K.data)).toBe('Goal row');
});

test('late reciprocal completion preserves redo for a newer edit undone during hydration', async () => {
  const blocked = deferred();
  const loading = deferred();
  const fixture: ReturnType<typeof createFixture> = createFixture({ loadTarget: async () => {
    loading.resolve();
    await blocked.promise;
    return fixture.target;
  } });
  const manager = getOrCreateDatabaseHistoryManager(fixture.databaseDoc);

  manager.registerRowDoc(sourceRowId, fixture.sourceDoc);
  const { result } = renderHook(() => useDuplicateRowDispatch(), { wrapper: fixture.wrapper });

  await act(async () => {
    const pending = result.current(sourceRowId);

    await loading.promise;
    runDatabaseRowAction(fixture.sourceDoc, { type: 'row.update-cell', fieldId: titleFieldId }, () => {
      cellOf(fixture.sourceDoc, titleFieldId).set(K.data, 'Later edit');
    });
    manager.undo();
    expect(manager.canRedo()).toBe(true);
    blocked.resolve();
    await pending;
  });
  expect(manager.canRedo()).toBe(true);
  act(() => { manager.redo(); });
  expect(cellOf(fixture.sourceDoc, titleFieldId).get(K.data)).toBe('Later edit');
});

test('normalizes a legacy reciprocal cell without losing its original relation', async () => {
  const fixture = createFixture({ legacyTarget: true });
  const { result } = renderHook(() => useDuplicateRowDispatch(), { wrapper: fixture.wrapper });
  let copiedId = '';

  await act(async () => { copiedId = await result.current(sourceRowId); });
  expect(fixture.reverseIds()).toEqual([sourceRowId, copiedId]);
  expect(cellOf(fixture.target, reciprocalFieldId).get(K.data)).toBeInstanceOf(Y.Array);
});
