import { renderHook } from '@testing-library/react';
import { expect } from '@jest/globals';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { useDatabaseViewsSelector } from '@/application/database-yjs/selector';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createDatabaseDocWithViews(viewIdsInInsertionOrder: string[]): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();

  viewIdsInInsertionOrder.forEach((viewId) => {
    const view = new Y.Map();

    view.set('created_at', new Date().toISOString());
    views.set(viewId, view);
  });

  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

describe('useDatabaseViewsSelector', () => {
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
});
