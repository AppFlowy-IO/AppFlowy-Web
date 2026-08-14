import { expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FieldVisibility,
  useAddDatabaseView,
} from '@/application/database-yjs';
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

function addServerListViewWithGridDefaults(databaseDoc: YDoc, viewId: string): void {
  const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
  const fields = new Y.Map();
  const views = new Y.Map();
  const view = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();
  const fieldSettings = new Y.Map();
  const fieldIds = ['primary-field', 'field-1', 'field-2', 'field-3'];

  fieldIds.forEach((fieldId, index) => {
    const field = new Y.Map();
    const setting = new Y.Map();

    field.set(YjsDatabaseKey.id, fieldId);
    field.set(YjsDatabaseKey.type, FieldType.RichText);
    field.set(YjsDatabaseKey.is_primary, index === 0);
    fields.set(fieldId, field);
    setting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysShown);
    fieldSettings.set(fieldId, setting);
  });
  fieldOrders.push(fieldIds.map((id) => ({ id })));
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.name, 'List');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.List);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, fieldSettings);
  view.set(YjsDatabaseKey.groups, new Y.Array());
  view.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(viewId, view);
  database?.set(YjsDatabaseKey.fields, fields);
  database?.set(YjsDatabaseKey.views, views);
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
  it('normalizes the Grid field defaults returned for a server-created List tab', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const newViewId = 'new-list-view-id';
    const databaseDoc = createDatabaseDoc(databaseId);
    const emptyServerUpdate = Array.from(Y.encodeStateAsUpdate(new Y.Doc()));
    const createDatabaseView = jest.fn(async () => {
      addServerListViewWithGridDefaults(databaseDoc, newViewId);
      return {
        view_id: newViewId,
        database_id: databaseId,
        database_update: emptyServerUpdate,
      };
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowDocMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(DatabaseViewLayout.List, 'List');
    });

    expect(createDatabaseView).toHaveBeenCalledWith(
      baseViewId,
      expect.objectContaining({
        database_id: databaseId,
        layout: ViewLayout.List,
        name: 'List',
      })
    );

    const listView = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(newViewId);

    expect(listView?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.List);
    expect(listView?.get(YjsDatabaseKey.field_settings)?.get('field-2')?.get(YjsDatabaseKey.visibility)).toBe(
      FieldVisibility.AlwaysShown
    );
    expect(listView?.get(YjsDatabaseKey.field_settings)?.get('field-3')?.get(YjsDatabaseKey.visibility)).toBe(
      FieldVisibility.AlwaysHidden
    );
    expect(listView?.get(YjsDatabaseKey.layout_settings)?.get('4')?.get(YjsDatabaseKey.display_mode)).toBe(1);
  });

  it('appends linked view under database container when parent is container', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const activeViewId = 'active-view-id';
    const lastChildId = 'last-child-id';
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
            createView({ view_id: activeViewId, layout: ViewLayout.Board, parent_view_id: containerId }),
            createView({ view_id: lastChildId, layout: ViewLayout.Calendar, parent_view_id: containerId }),
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
        prev_view_id: lastChildId,
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
    const lastChildId = 'last-document-child-id';
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
          children: [
            createView({ view_id: baseViewId, layout: ViewLayout.Grid, parent_view_id: documentId }),
            createView({ view_id: lastChildId, layout: ViewLayout.Document, parent_view_id: documentId }),
          ],
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
        prev_view_id: lastChildId,
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

    const [, payload] = createDatabaseView.mock.calls[0];

    expect(payload.prev_view_id).toBeUndefined();
  });

  it('uses the container last child as prev_view_id when the current route is the container itself', async () => {
    const databaseId = 'db-1';
    const containerId = 'container-view-id';
    const firstChildId = 'grid-view-id';
    const secondChildId = 'board-view-id';

    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'new-view-id',
      database_id: databaseId,
    });

    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === containerId) {
        return createView({
          view_id: containerId,
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true },
          children: [
            createView({ view_id: firstChildId, layout: ViewLayout.Grid, parent_view_id: containerId }),
            createView({ view_id: secondChildId, layout: ViewLayout.Board, parent_view_id: containerId }),
          ],
        });
      }

      return null;
    });

    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc: createDatabaseDoc(databaseId),
      databasePageId: containerId,
      activeViewId: containerId,
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
      containerId,
      expect.objectContaining({
        parent_view_id: containerId,
        prev_view_id: secondChildId,
        database_id: databaseId,
        layout: ViewLayout.Calendar,
        name: 'Calendar',
        embedded: false,
      })
    );
  });
});
