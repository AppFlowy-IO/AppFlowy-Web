import { expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { useDatabaseViewsSelector } from '@/application/database-yjs/selector';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createDatabaseDocWithViews(
  viewIdsInInsertionOrder: Array<string | { viewId: string; createdAt?: string }>
): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();

  viewIdsInInsertionOrder.forEach((input, index) => {
    const viewId = typeof input === 'string' ? input : input.viewId;
    const createdAt =
      typeof input === 'string' ? new Date(Date.UTC(2024, 0, index + 1)).toISOString() : input.createdAt;
    const view = new Y.Map();

    view.set(YjsDatabaseKey.created_at, createdAt);
    views.set(viewId, view);
  });

  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

describe('useDatabaseViewsSelector', () => {
  it('sorts standalone database views by created_at instead of raw Yjs insertion order', () => {
    const gridId = 'grid-id';
    const boardId = 'board-id';
    const calendarId = 'calendar-id';

    const databaseDoc = createDatabaseDocWithViews([
      { viewId: boardId, createdAt: '2024-01-02T00:00:00.000Z' },
      { viewId: gridId, createdAt: '2024-01-01T00:00:00.000Z' },
      { viewId: calendarId, createdAt: '2024-01-03T00:00:00.000Z' },
    ]);

    const contextValue: DatabaseContextState = {
      readOnly: true,
      databaseDoc,
      databasePageId: gridId,
      activeViewId: gridId,
      rowDocMap: null,
      workspaceId: 'workspace-id',
    };

    const { result } = renderHook(
      () => useDatabaseViewsSelector(gridId),
      {
        wrapper: ({ children }) => (
          <DatabaseContext.Provider value={contextValue}>
            {children}
          </DatabaseContext.Provider>
        ),
      }
    );

    expect(result.current.viewIds).toEqual([gridId, boardId, calendarId]);
  });

  it('preserves visibleViewIds ordering (folder/outline order)', () => {
    const gridId = 'grid-id';
    const boardId = 'board-id';
    const calendarId = 'calendar-id';
    const visibleViewIds = [gridId, boardId, calendarId];

    // Simulate an underlying Yjs insertion order that differs from the folder/outline order.
    const databaseDoc = createDatabaseDocWithViews([boardId, gridId, calendarId]);

    const contextValue: DatabaseContextState = {
      readOnly: true,
      databaseDoc,
      databasePageId: gridId,
      activeViewId: gridId,
      rowDocMap: null,
      workspaceId: 'workspace-id',
    };

    const { result } = renderHook(
      () => useDatabaseViewsSelector(gridId, visibleViewIds),
      {
        wrapper: ({ children }) => (
          <DatabaseContext.Provider value={contextValue}>
            {children}
          </DatabaseContext.Provider>
        ),
      }
    );

    expect(result.current.viewIds).toEqual([gridId, boardId, calendarId]);
  });

  describe('dashboard-owned views', () => {
    function setOwner(doc: YDoc, viewId: string, owner: string) {
      const views = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database).get(YjsDatabaseKey.views);

      doc.transact(() => views.get(viewId).set(YjsDatabaseKey.dashboard_owner, owner));
    }

    function renderViews(databaseDoc: YDoc, databasePageId: string, visibleViewIds?: string[]) {
      const contextValue: DatabaseContextState = {
        readOnly: true,
        databaseDoc,
        databasePageId,
        activeViewId: databasePageId,
        rowDocMap: null,
        workspaceId: 'workspace-id',
      };

      return renderHook(() => useDatabaseViewsSelector(databasePageId, visibleViewIds), {
        wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
      });
    }

    it('hides views a dashboard owns from a standalone database', () => {
      const databaseDoc = createDatabaseDocWithViews(['grid-id', 'owned-board-id', 'dashboard-id']);

      setOwner(databaseDoc, 'owned-board-id', 'dashboard-id');
      const { result } = renderViews(databaseDoc, 'grid-id');

      expect(result.current.viewIds).toEqual(['grid-id', 'dashboard-id']);
    });

    it('hides a view as soon as its collab mirror says it is owned', () => {
      const databaseDoc = createDatabaseDocWithViews(['grid-id', 'board-id']);
      const { result } = renderViews(databaseDoc, 'grid-id');

      expect(result.current.viewIds).toEqual(['grid-id', 'board-id']);
      act(() => setOwner(databaseDoc, 'board-id', 'dashboard-id'));
      expect(result.current.viewIds).toEqual(['grid-id']);
    });

    it('shows an opened owned view as the only tab', () => {
      const databaseDoc = createDatabaseDocWithViews(['grid-id', 'owned-board-id']);

      setOwner(databaseDoc, 'owned-board-id', 'dashboard-id');
      const { result } = renderViews(databaseDoc, 'owned-board-id');

      expect(result.current.viewIds).toEqual(['owned-board-id']);
    });

    it('never filters an explicit list (a document block or a widget)', () => {
      const databaseDoc = createDatabaseDocWithViews(['grid-id', 'owned-board-id']);

      setOwner(databaseDoc, 'owned-board-id', 'dashboard-id');
      const { result } = renderViews(databaseDoc, 'grid-id', ['owned-board-id']);

      expect(result.current.viewIds).toEqual(['owned-board-id']);
    });
  });

  describe('events inside a view', () => {
    function renderViews(databaseDoc: YDoc, databasePageId: string) {
      const contextValue: DatabaseContextState = {
        readOnly: true,
        databaseDoc,
        databasePageId,
        activeViewId: databasePageId,
        rowDocMap: null,
        workspaceId: 'workspace-id',
      };

      return renderHook(() => useDatabaseViewsSelector(databasePageId), {
        wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
      });
    }

    function getViews(doc: YDoc) {
      return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database).get(YjsDatabaseKey.views);
    }

    it('never serializes the views to list their ids', () => {
      const databaseDoc = createDatabaseDocWithViews(['grid-id', 'board-id']);
      const views = getViews(databaseDoc);
      const toJSON = jest.spyOn(views, 'toJSON');
      const { result } = renderViews(databaseDoc, 'grid-id');

      act(() => {
        databaseDoc.transact(() => {
          const rowOrders = new Y.Array();

          rowOrders.push([{ id: 'row-1', height: 36 }]);
          views.get('grid-id').set(YjsDatabaseKey.row_orders, rowOrders);
        });
      });
      act(() => {
        databaseDoc.transact(() => {
          views.get('grid-id').get(YjsDatabaseKey.row_orders).push([{ id: 'row-2', height: 36 }]);
        });
      });

      expect(result.current.viewIds).toEqual(['grid-id', 'board-id']);
      expect(toJSON).not.toHaveBeenCalled();
    });

    it('keeps both arrays when an event changes neither the ids nor the views', () => {
      const databaseDoc = createDatabaseDocWithViews(['grid-id', 'board-id']);
      const views = getViews(databaseDoc);
      const { result } = renderViews(databaseDoc, 'grid-id');
      const { viewIds, childViews } = result.current;

      // A row is added and a view is renamed: the tabs stay the same views.
      act(() => {
        databaseDoc.transact(() => {
          const rowOrders = new Y.Array();

          rowOrders.push([{ id: 'row-1', height: 36 }]);
          views.get('board-id').set(YjsDatabaseKey.row_orders, rowOrders);
          views.get('board-id').set(YjsDatabaseKey.name, 'Renamed');
        });
      });

      expect(result.current.viewIds).toBe(viewIds);
      expect(result.current.childViews).toBe(childViews);

      // A new view changes both.
      act(() => {
        databaseDoc.transact(() => {
          const view = new Y.Map();

          view.set(YjsDatabaseKey.created_at, new Date(Date.UTC(2024, 5, 1)).toISOString());
          views.set('calendar-id', view);
        });
      });

      expect(result.current.viewIds).toEqual(['grid-id', 'board-id', 'calendar-id']);
      expect(result.current.viewIds).not.toBe(viewIds);
      expect(result.current.childViews).toHaveLength(3);
      expect(result.current.childViews.slice(0, 2)).toEqual(childViews);
    });
  });
});
