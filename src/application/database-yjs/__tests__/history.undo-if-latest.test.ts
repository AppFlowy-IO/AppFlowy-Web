import * as Y from 'yjs';

import {
  createDatabaseHistoryGroup,
  getOrCreateDatabaseHistoryManager,
  runDatabaseAction,
  runDatabaseHistoryGroupForDatabase,
} from '@/application/database-yjs/history';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createDatabaseDoc(id: string) {
  const databaseDoc = new Y.Doc({ guid: id }) as YDoc;
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>();

  view.set(YjsDatabaseKey.id, 'view');
  view.set(YjsDatabaseKey.name, 'Grid');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set('view', view);
  database.set(YjsDatabaseKey.id, id);
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);
  return { databaseDoc, view, rowOrders };
}

describe('DatabaseHistoryManager.undoIfLatest (WP07 toast Undo)', () => {
  it('undoIfLatest undoes the save group only while it is the latest', () => {
    const host = createDatabaseDoc('host');
    const history = getOrCreateDatabaseHistoryManager(host.databaseDoc);
    const save = createDatabaseHistoryGroup();

    runDatabaseHistoryGroupForDatabase(
      host.databaseDoc,
      () => {
        runDatabaseAction(host.databaseDoc, { type: 'dashboard.global-filters' }, () => {
          host.view.set(YjsDatabaseKey.name, 'Saved');
        });
      },
      save
    );
    expect(history.latestUndoGroup()).toBe(save);

    runDatabaseAction(host.databaseDoc, { type: 'view.rename' }, () => {
      host.view.set(YjsDatabaseKey.name, 'Renamed later');
    });
    expect(history.latestUndoGroup()).not.toBe(save);
    // A newer step: the toast's Undo must not undo it.
    expect(history.undoIfLatest(save)).toBe(false);
    expect(host.view.get(YjsDatabaseKey.name)).toBe('Renamed later');

    history.undo();
    expect(history.latestUndoGroup()).toBe(save);
    expect(history.undoIfLatest(save)).toBe(true);
    expect(host.view.get(YjsDatabaseKey.name)).toBe('Grid');
    expect(history.latestUndoGroup()).toBeNull();
  });

  it('returns false when a pending action exists', () => {
    const host = createDatabaseDoc('host');
    const history = getOrCreateDatabaseHistoryManager(host.databaseDoc);
    const save = createDatabaseHistoryGroup();

    runDatabaseHistoryGroupForDatabase(
      host.databaseDoc,
      () => {
        runDatabaseAction(host.databaseDoc, { type: 'dashboard.global-filters' }, () => {
          host.view.set(YjsDatabaseKey.name, 'Saved');
        });
      },
      save
    );
    const cancel = jest.fn();
    const release = history.registerPendingAction(cancel);

    expect(history.undoIfLatest(save)).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(host.view.get(YjsDatabaseKey.name)).toBe('Saved');
    release();
    expect(history.undoIfLatest(save)).toBe(true);
  });

  it('the group passed to runDatabaseHistoryGroupForDatabase owns foreign-doc writes', () => {
    const host = createDatabaseDoc('host');
    const source = createDatabaseDoc('source');
    const hostHistory = getOrCreateDatabaseHistoryManager(host.databaseDoc);
    const sourceHistory = getOrCreateDatabaseHistoryManager(source.databaseDoc);
    const save = createDatabaseHistoryGroup();

    runDatabaseHistoryGroupForDatabase(
      host.databaseDoc,
      () => {
        runDatabaseAction(host.databaseDoc, { type: 'dashboard.global-filters' }, () => {
          host.view.set(YjsDatabaseKey.name, 'Saved filters');
        });
        runDatabaseAction(source.databaseDoc, { type: 'view.conditions' }, () => {
          source.rowOrders.push([{ id: 'saved-condition', height: 36 }]);
        });
      },
      save
    );

    expect(hostHistory.latestUndoGroup()).toBe(save);
    expect(sourceHistory.canUndo()).toBe(false);
    expect(hostHistory.undoIfLatest(save)).toBe(true);
    expect(host.view.get(YjsDatabaseKey.name)).toBe('Grid');
    expect(source.rowOrders.toJSON()).toEqual([]);
  });
});
