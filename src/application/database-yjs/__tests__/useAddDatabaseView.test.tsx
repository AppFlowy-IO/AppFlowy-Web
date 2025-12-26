import { expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, useAddDatabaseView } from '@/application/database-yjs';
import { DatabaseViewLayout, View, ViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

function createDatabaseDoc(databaseId: string): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();

  database.set(YjsDatabaseKey.id, databaseId);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function createView(overrides: Partial<View>): View {
  return {
    view_id: 'view-id',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: { is_space: false },
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

describe('useAddDatabaseView', () => {
  it('creates linked view under database container when parent is container', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const activeViewId = 'active-view-id';
    const containerId = 'container-view-id';

    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'new-view-id',
      database_id: databaseId,
    });

    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === activeViewId) {
        return createView({
          view_id: activeViewId,
          layout: ViewLayout.Board,
          parent_view_id: containerId,
        });
      }

      if (viewId === containerId) {
        return createView({
          view_id: containerId,
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true },
          children: [
            createView({ view_id: baseViewId, layout: ViewLayout.Grid, parent_view_id: containerId }),
          ],
        });
      }

      return null;
    });

    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc: createDatabaseDoc(databaseId),
      databasePageId: baseViewId,
      activeViewId,
      rowDocMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      loadViewMeta,
      isDocumentBlock: false,
    };

    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(DatabaseViewLayout.Calendar, 'Calendar');
    });

    expect(createDatabaseView).toHaveBeenCalledWith(
      activeViewId,
      expect.objectContaining({
        parent_view_id: containerId,
        database_id: databaseId,
        layout: ViewLayout.Calendar,
        name: 'Calendar',
        embedded: false,
      })
    );
  });

  it('creates embedded linked view under document when no container exists', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'linked-view-id';
    const documentId = 'document-id';

    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'new-view-id',
      database_id: databaseId,
    });

    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === baseViewId) {
        return createView({
          view_id: baseViewId,
          layout: ViewLayout.Grid,
          parent_view_id: documentId,
          extra: { is_space: false },
        });
      }

      if (viewId === documentId) {
        return createView({
          view_id: documentId,
          layout: ViewLayout.Document,
        });
      }

      return null;
    });

    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc: createDatabaseDoc(databaseId),
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowDocMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      loadViewMeta,
      isDocumentBlock: true,
    };

    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(DatabaseViewLayout.Board, 'Board');
    });

    expect(createDatabaseView).toHaveBeenCalledWith(
      baseViewId,
      expect.objectContaining({
        parent_view_id: documentId,
        database_id: databaseId,
        layout: ViewLayout.Board,
        name: 'Board',
        embedded: true,
      })
    );
  });

  it('falls back to creating under the current database view for legacy standalone databases', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'legacy-db-view-id';
    const parentId = 'root-id';

    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'new-view-id',
      database_id: databaseId,
    });

    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === baseViewId) {
        return createView({
          view_id: baseViewId,
          layout: ViewLayout.Grid,
          parent_view_id: parentId,
        });
      }

      if (viewId === parentId) {
        return createView({
          view_id: parentId,
          layout: ViewLayout.Document,
        });
      }

      return null;
    });

    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc: createDatabaseDoc(databaseId),
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowDocMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      loadViewMeta,
      isDocumentBlock: false,
    };

    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(DatabaseViewLayout.Grid, 'Grid');
    });

    expect(createDatabaseView).toHaveBeenCalledWith(
      baseViewId,
      expect.objectContaining({
        parent_view_id: baseViewId,
        database_id: databaseId,
        layout: ViewLayout.Grid,
        name: 'Grid',
        embedded: false,
      })
    );
  });
});
