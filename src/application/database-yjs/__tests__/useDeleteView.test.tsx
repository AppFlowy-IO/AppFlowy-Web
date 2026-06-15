import { expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, useDeleteView } from '@/application/database-yjs';
import { YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createDatabaseDoc(viewId: string): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map<unknown>();
  const views = new Y.Map<unknown>();

  views.set(viewId, new Y.Map<unknown>());
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);

  return doc;
}

function getViewsMap(doc: YDoc): Y.Map<unknown> {
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot.get(YjsEditorKey.database) as Y.Map<unknown>;

  return database.get(YjsDatabaseKey.views) as Y.Map<unknown>;
}

function createContextValue(databaseDoc: YDoc, deletePage: DatabaseContextState['deletePage']): DatabaseContextState {
  return {
    readOnly: false,
    databaseDoc,
    databasePageId: 'database-page-id',
    activeViewId: 'active-view-id',
    rowMap: {},
    workspaceId: 'workspace-id',
    deletePage,
  };
}

describe('useDeleteView', () => {
  it('proceeds with Yjs deletion when deletePage fails with broken space ancestry', async () => {
    const viewId = 'view-broken-ancestry';
    const databaseDoc = createDatabaseDoc(viewId);
    // Matches the actual server error: AppError::Internal (code 1017) with
    // "unable to find space correponds to {view_id}" message.
    const deletePage = jest.fn().mockRejectedValue({
      code: 1017,
      message: `unable to find space correponds to ${viewId} when deleting snapshot [/api/workspace/ws/page-view/${viewId}/move-to-trash]`,
    });
    const contextValue = createContextValue(databaseDoc, deletePage);
    const { result } = renderHook(() => useDeleteView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(viewId);
    });

    expect(deletePage).toHaveBeenCalledWith(viewId);
    expect(getViewsMap(databaseDoc).has(viewId)).toBe(false);
  });

  it('proceeds with Yjs deletion even when deletePage fails with other errors', async () => {
    const viewId = 'view-other-error';
    const databaseDoc = createDatabaseDoc(viewId);
    const deletePage = jest.fn().mockRejectedValue({
      code: 1012,
      message: 'user is not allowed to delete this view',
    });
    const contextValue = createContextValue(databaseDoc, deletePage);
    const { result } = renderHook(() => useDeleteView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(viewId);
    });

    expect(deletePage).toHaveBeenCalledWith(viewId);
    expect(getViewsMap(databaseDoc).has(viewId)).toBe(false);
  });
});
