import { expect } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FieldVisibility,
  useAddDatabaseView,
  useDuplicateDatabaseView,
} from '@/application/database-yjs';
import { getOrCreateDatabaseHistoryManager, runDatabaseAction } from '@/application/database-yjs/history';
import {
  DatabaseViewLayout,
  View,
  ViewLayout,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

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

function addExistingGridView(databaseDoc: YDoc, viewId: string): void {
  const database = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database);
  const existingFields = database?.get(YjsDatabaseKey.fields);
  const fields = existingFields ?? new Y.Map();
  const field = new Y.Map();
  const existingViews = database?.get(YjsDatabaseKey.views);
  const views = existingViews ?? new Y.Map();
  const view = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();
  const fieldSettings = new Y.Map();
  const fieldSetting = new Y.Map();

  field.set(YjsDatabaseKey.id, 'primary-field');
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  field.set(YjsDatabaseKey.is_primary, true);
  fields.set('primary-field', field);
  fieldOrders.push([{ id: 'primary-field' }]);
  fieldSetting.set(YjsDatabaseKey.visibility, FieldVisibility.AlwaysHidden);
  fieldSettings.set('primary-field', fieldSetting);
  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.name, 'Grid');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.field_orders, fieldOrders);
  view.set(YjsDatabaseKey.field_settings, fieldSettings);
  view.set(YjsDatabaseKey.groups, new Y.Array());
  view.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(viewId, view);
  if (!existingFields) database?.set(YjsDatabaseKey.fields, fields);
  if (!existingViews) database?.set(YjsDatabaseKey.views, views);
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

function createGalleryUpdate(databaseDoc: YDoc, sourceViewId: string, galleryViewId: string): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const views = database.get(YjsDatabaseKey.views);
  const sourceView = views.get(sourceViewId);
  const galleryView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();

  fieldOrders.push(sourceView.get(YjsDatabaseKey.field_orders).toArray());
  galleryView.set(YjsDatabaseKey.id, galleryViewId);
  galleryView.set(YjsDatabaseKey.name, 'Gallery');
  galleryView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  galleryView.set(YjsDatabaseKey.field_orders, fieldOrders);
  galleryView.set(YjsDatabaseKey.field_settings, new Y.Map());
  galleryView.set(YjsDatabaseKey.groups, new Y.Array());
  galleryView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(galleryViewId, galleryView);
  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
}

function createUpdateWithoutReturnedView(databaseDoc: YDoc, existingViewId: string): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const database = serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

  database.get(YjsDatabaseKey.views).get(existingViewId).set(YjsDatabaseKey.name, 'Unexpected mutation');
  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
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

function createAddViewUpdate(databaseDoc: YDoc, viewId: string): number[] {
  const remoteDoc = new Y.Doc();

  Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(databaseDoc));
  const remoteRoot = remoteDoc.getMap(YjsEditorKey.data_section);
  const remoteDatabase = remoteRoot.get(YjsEditorKey.database) as Y.Map<unknown>;
  let views = remoteDatabase.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>> | undefined;

  if (!views) {
    views = new Y.Map<Y.Map<unknown>>();
    remoteDatabase.set(YjsDatabaseKey.views, views);
  }

  const view = new Y.Map<unknown>();

  view.set(YjsDatabaseKey.id, viewId);
  view.set(YjsDatabaseKey.name, 'Created view');
  view.set(YjsDatabaseKey.field_orders, new Y.Array());
  views.set(viewId, view);

  return Array.from(Y.encodeStateAsUpdate(remoteDoc, Y.encodeStateVector(databaseDoc)));
}

function getDatabase(databaseDoc: YDoc): Y.Map<unknown> {
  return databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
}

describe('useAddDatabaseView', () => {
  it('rejects Form creation before calling the server without canonical write permission', async () => {
    const databaseDoc = createDatabaseDoc('database-id');
    const createDatabaseView = jest.fn();
    const contextValue: DatabaseContextState = {
      readOnly: false,
      canWrite: false,
      canShare: true,
      databaseDoc,
      databasePageId: 'base-view-id',
      activeViewId: 'base-view-id',
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await expect(result.current(DatabaseViewLayout.Form, 'Form')).rejects.toThrow(
      'Edit access is required to create or duplicate a Form view.'
    );
    expect(createDatabaseView).not.toHaveBeenCalled();
  });

  it('allows an editor to create a Form without share-management permission', async () => {
    const databaseDoc = createDatabaseDoc('database-id');
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: 'form-view-id',
      database_id: 'database-id',
      database_update: createAddViewUpdate(databaseDoc, 'form-view-id'),
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      canWrite: true,
      canShare: false,
      databaseDoc,
      databasePageId: 'base-view-id',
      activeViewId: 'base-view-id',
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await expect(result.current(DatabaseViewLayout.Form)).resolves.toBe('form-view-id');
    expect(createDatabaseView).toHaveBeenCalledWith(
      'base-view-id',
      expect.objectContaining({
        database_id: 'database-id',
        layout: ViewLayout.Form,
        name: 'Form builder',
      })
    );
  });

  it('applies created-tab updates without adding history or clearing redo', async () => {
    const databaseId = 'db-history';
    const baseViewId = 'base-view-id';
    const newViewId = 'new-view-id';
    const databaseDoc = createDatabaseDoc(databaseId);
    const database = getDatabase(databaseDoc);
    const history = getOrCreateDatabaseHistoryManager(databaseDoc);

    runDatabaseAction(databaseDoc, { type: 'database.test-marker' }, () => {
      database.set('history-marker', true);
    });
    history.undo();
    expect(history.canRedo()).toBe(true);

    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: newViewId,
      database_id: databaseId,
      database_update: createAddViewUpdate(databaseDoc, newViewId),
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(DatabaseViewLayout.Grid, 'Created view');
    });

    const views = database.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;

    expect(views.has(newViewId)).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    act(() => {
      history.redo();
    });
    expect(database.get('history-marker')).toBe(true);
    expect(views.has(newViewId)).toBe(true);
  });

  it('copies duplicated-tab configuration without adding history or clearing redo', async () => {
    const databaseId = 'db-duplicate-history';
    const baseViewId = 'base-view-id';
    const duplicatedViewId = 'duplicated-view-id';
    const databaseDoc = createDatabaseDoc(databaseId);

    addExistingGridView(databaseDoc, baseViewId);
    const database = getDatabase(databaseDoc);
    const history = getOrCreateDatabaseHistoryManager(databaseDoc);

    runDatabaseAction(databaseDoc, { type: 'database.test-marker' }, () => {
      database.set('history-marker', true);
    });
    history.undo();
    expect(history.canRedo()).toBe(true);

    const createDatabaseView = jest.fn(async () => ({
      view_id: duplicatedViewId,
      database_id: databaseId,
      database_update: createAddViewUpdate(databaseDoc, duplicatedViewId),
    }));
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useDuplicateDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(baseViewId, 'Grid (Copy)');
    });

    const views = database.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;
    const sourceView = views.get(baseViewId);
    const duplicatedView = views.get(duplicatedViewId);

    expect(duplicatedView?.get(YjsDatabaseKey.field_orders)?.toJSON()).toEqual(
      sourceView?.get(YjsDatabaseKey.field_orders)?.toJSON()
    );
    expect(duplicatedView?.get(YjsDatabaseKey.field_settings)?.toJSON()).toEqual(
      sourceView?.get(YjsDatabaseKey.field_settings)?.toJSON()
    );
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    act(() => {
      history.redo();
    });

    expect(database.get('history-marker')).toBe(true);
    expect(views.has(duplicatedViewId)).toBe(true);
  });

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
      rowMap: {},
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

  it('rejects a List response whose update omits the exact returned child', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const returnedViewId = 'missing-list-view-id';
    const databaseDoc = createDatabaseDoc(databaseId);
    const deletePage = jest.fn().mockResolvedValue(undefined);

    addExistingGridView(databaseDoc, baseViewId);
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: returnedViewId,
      database_id: databaseId,
      database_update: Array.from(Y.encodeStateAsUpdate(new Y.Doc())),
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      deletePage,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await expect(result.current(DatabaseViewLayout.List, 'List')).rejects.toThrow(
      'The server did not return the requested List database view'
    );

    const existingView = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(baseViewId);

    expect(existingView?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Grid);
    expect(existingView?.get(YjsDatabaseKey.field_settings)?.get('primary-field')?.get(YjsDatabaseKey.visibility)).toBe(
      FieldVisibility.AlwaysHidden
    );
    expect(deletePage).toHaveBeenCalledWith(returnedViewId);
  });

  it('does not normalize or compensate a pre-existing view ID returned by a stale List response', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const databaseDoc = createDatabaseDoc(databaseId);
    const deletePage = jest.fn().mockResolvedValue(undefined);

    addExistingGridView(databaseDoc, baseViewId);
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: baseViewId,
      database_id: databaseId,
      database_update: Array.from(Y.encodeStateAsUpdate(new Y.Doc())),
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      deletePage,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await expect(result.current(DatabaseViewLayout.List, 'List')).rejects.toThrow(
      'The server did not return the requested List database view'
    );

    const existingView = databaseDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database)
      ?.get(YjsDatabaseKey.views)
      ?.get(baseViewId);

    expect(existingView?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Grid);
    expect(existingView?.get(YjsDatabaseKey.field_settings)?.get('primary-field')?.get(YjsDatabaseKey.visibility)).toBe(
      FieldVisibility.AlwaysHidden
    );
    expect(deletePage).not.toHaveBeenCalled();
  });

  it('rejects a stale existing view ID before applying an untrusted duplicate update', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const existingSiblingId = 'existing-sibling-id';
    const databaseDoc = createDatabaseDoc(databaseId);
    const deletePage = jest.fn().mockResolvedValue(undefined);

    addExistingGridView(databaseDoc, baseViewId);
    addExistingGridView(databaseDoc, existingSiblingId);
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: existingSiblingId,
      database_id: databaseId,
      database_update: createUpdateWithoutReturnedView(databaseDoc, existingSiblingId),
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      deletePage,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useDuplicateDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await expect(result.current(baseViewId, 'Grid (Copy)')).rejects.toThrow(
      'The server did not return the requested Grid database view'
    );

    const views = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database)?.get(YjsDatabaseKey.views);

    expect(views?.get(baseViewId)?.get(YjsDatabaseKey.name)).toBe('Grid');
    expect(views?.get(existingSiblingId)?.get(YjsDatabaseKey.name)).toBe('Grid');
    expect(deletePage).not.toHaveBeenCalled();
  });

  it('prevalidates and normalizes the exact Gallery child returned by the server', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const galleryViewId = 'gallery-view-id';
    const databaseDoc = createDatabaseDoc(databaseId);

    addExistingGridView(databaseDoc, baseViewId);
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: galleryViewId,
      database_id: databaseId,
      database_update: createGalleryUpdate(databaseDoc, baseViewId, galleryViewId),
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await expect(result.current(DatabaseViewLayout.Gallery, 'Gallery')).resolves.toBe(galleryViewId);

    const views = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database)?.get(YjsDatabaseKey.views);

    expect(views?.get(baseViewId)?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Grid);
    expect(views?.get(galleryViewId)?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Gallery);
    expect(views?.get(galleryViewId)?.get(YjsDatabaseKey.field_settings)?.get('primary-field')).toBeDefined();
    expect(views?.get(galleryViewId)?.get(YjsDatabaseKey.layout_settings)?.get('5')).toBeDefined();
  });

  it('rejects an invalid Gallery update before it can mutate the live database', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const returnedViewId = 'missing-gallery-view-id';
    const databaseDoc = createDatabaseDoc(databaseId);
    const deletePage = jest.fn().mockResolvedValue(undefined);

    addExistingGridView(databaseDoc, baseViewId);
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: returnedViewId,
      database_id: databaseId,
      database_update: createUpdateWithoutReturnedView(databaseDoc, baseViewId),
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: baseViewId,
      activeViewId: baseViewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      deletePage,
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await expect(result.current(DatabaseViewLayout.Gallery, 'Gallery')).rejects.toThrow(
      'The server did not return the requested Gallery database view'
    );

    const views = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database)?.get(YjsDatabaseKey.views);

    expect(views?.get(baseViewId)?.get(YjsDatabaseKey.name)).toBe('Grid');
    expect(views?.has(returnedViewId)).toBe(false);
    expect(deletePage).toHaveBeenCalledWith(returnedViewId);
  });

  it('uses the preceding sibling as prev_view_id when inserting before a container child', async () => {
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
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      loadViewMeta,
      isDocumentBlock: false,
    };

    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(DatabaseViewLayout.Calendar, 'Calendar', { insertBeforeViewId: activeViewId });
    });

    expect(createDatabaseView).toHaveBeenCalledWith(
      activeViewId,
      expect.objectContaining({
        parent_view_id: containerId,
        prev_view_id: baseViewId,
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
      rowMap: {},
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
      rowMap: {},
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

  it('omits prev_view_id when inserting before the first container child', async () => {
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
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      loadViewMeta,
      isDocumentBlock: false,
    };

    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await result.current(DatabaseViewLayout.Calendar, 'Calendar', { insertBeforeViewId: firstChildId });
    });

    // The create API has no before-first anchor. DatabaseTabs follows this
    // request with a folder reorder whose prevId is null (covered separately).
    expect(createDatabaseView).toHaveBeenCalledWith(
      containerId,
      expect.objectContaining({
        parent_view_id: containerId,
        prev_view_id: undefined,
        database_id: databaseId,
        layout: ViewLayout.Calendar,
        name: 'Calendar',
        embedded: false,
      })
    );
  });
});
