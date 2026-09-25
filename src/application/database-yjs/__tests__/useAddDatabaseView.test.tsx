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
  useUpdateDatabaseLayout,
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
import { getView } from '@/application/services/js-services/http/view-api';
import { updateServerInfo } from '@/utils/server-info';

jest.mock('@/application/services/js-services/http/view-api', () => ({ getView: jest.fn() }));

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

describe('online Chart layout conversion', () => {
  beforeEach(() => {
    updateServerInfo('https://test.appflowy.cloud', {
      status: 'available', info: { enable_page_history: true, self_hosted: false },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(getView).mockReset();
  });

  function setup() {
    const databaseDoc = createDatabaseDoc('database-id');

    addExistingGridView(databaseDoc, 'base-view-id');
    const before = Y.encodeStateAsUpdate(databaseDoc);
    const onUpdate = jest.fn();

    databaseDoc.on('update', onUpdate);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      canWrite: true,
      databaseDoc,
      databasePageId: 'base-view-id',
      rowMap: {},
      workspaceId: 'workspace-id',
    };
    const hook = renderHook(() => useUpdateDatabaseLayout('base-view-id'), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    return { ...hook, databaseDoc, before, onUpdate };
  }

  it('does not mutate or enqueue a Chart conversion while offline', async () => {
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fixture = setup();

    await expect(fixture.result.current(DatabaseViewLayout.Chart)).rejects.toThrow(
      'Connect to the internet to create Form or Chart views.'
    );
    expect(getView).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(fixture.databaseDoc)).toEqual(fixture.before);
    expect(fixture.onUpdate).not.toHaveBeenCalled();
  });

  it.each([DatabaseViewLayout.Form, DatabaseViewLayout.Chart])('allows self-hosted layout %s conversion offline without a billing reachability read', (layout) => {
    updateServerInfo('https://test.appflowy.cloud', {
      status: 'available', info: { enable_page_history: true, self_hosted: true },
    });
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fixture = setup();

    act(() => { void fixture.result.current(layout); });

    const views = getDatabase(fixture.databaseDoc).get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;

    expect(views.get('base-view-id')?.get(YjsDatabaseKey.layout)).toBe(layout);
    expect(getView).not.toHaveBeenCalled();
    expect(fixture.onUpdate).toHaveBeenCalled();
  });

  it('requires the server creation path for Forms instead of converting an existing view', async () => {
    const fixture = setup();

    await expect(fixture.result.current(DatabaseViewLayout.Form)).rejects.toThrow('Use Add view to create a Form.');
    expect(getView).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(fixture.databaseDoc)).toEqual(fixture.before);
    expect(fixture.onUpdate).not.toHaveBeenCalled();
  });

  it('does not trust navigator.onLine when the server is unreachable', async () => {
    jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const error = { code: -1, message: 'Network Error' };

    jest.mocked(getView).mockRejectedValue(error);
    const fixture = setup();

    await expect(fixture.result.current(DatabaseViewLayout.Chart)).rejects.toBe(error);
    expect(getView).toHaveBeenCalledWith('workspace-id', 'base-view-id', 0);
    expect(Y.encodeStateAsUpdate(fixture.databaseDoc)).toEqual(fixture.before);
    expect(fixture.onUpdate).not.toHaveBeenCalled();
  });

  it('waits for a fresh server read before applying a Chart conversion', async () => {
    let acceptRead!: (view: View) => void;

    jest.mocked(getView).mockImplementation(() => new Promise<View>((resolve) => { acceptRead = resolve; }));
    const fixture = setup();
    const pending = fixture.result.current(DatabaseViewLayout.Chart);

    await act(async () => { await Promise.resolve(); });
    expect(getView).toHaveBeenCalledTimes(1);
    expect(fixture.onUpdate).not.toHaveBeenCalled();
    await act(async () => {
      acceptRead(createView({ view_id: 'base-view-id', layout: ViewLayout.Grid }));
      await pending;
    });

    const views = getDatabase(fixture.databaseDoc).get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;

    expect(views.get('base-view-id')?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Chart);
  });

  it('does not let a pending Chart conversion replace a later layout choice', async () => {
    let acceptRead!: (view: View) => void;

    jest.mocked(getView).mockImplementation(() => new Promise<View>((resolve) => { acceptRead = resolve; }));
    const fixture = setup();
    const pending = fixture.result.current(DatabaseViewLayout.Chart);

    await act(async () => { await Promise.resolve(); });
    act(() => { void fixture.result.current(DatabaseViewLayout.Grid); });
    await act(async () => {
      acceptRead(createView({ view_id: 'base-view-id', layout: ViewLayout.Grid }));
      await pending;
    });

    expect(Y.encodeStateAsUpdate(fixture.databaseDoc)).toEqual(fixture.before);
    expect(fixture.onUpdate).not.toHaveBeenCalled();
  });
});

describe('useAddDatabaseView', () => {
  it.each([DatabaseViewLayout.Form, DatabaseViewLayout.Chart])(
    'waits for server acceptance before adding layout %s to the local database',
    async (layout) => {
      const databaseDoc = createDatabaseDoc('database-id');

      addExistingGridView(databaseDoc, 'base-view-id');
      const before = Y.encodeStateAsUpdate(databaseDoc);
      const databaseUpdate = createAddViewUpdate(databaseDoc, 'accepted-view-id');
      let acceptRequest!: (response: { view_id: string; database_id: string; database_update: number[] }) => void;
      const createDatabaseView = jest.fn(
        () => new Promise<{ view_id: string; database_id: string; database_update: number[] }>((resolve) => {
          acceptRequest = resolve;
        })
      );
      const contextValue: DatabaseContextState = {
        readOnly: false,
        canWrite: true,
        databaseDoc,
        databasePageId: 'base-view-id',
        rowMap: {},
        workspaceId: 'workspace-id',
        createDatabaseView,
      };
      const { result } = renderHook(() => useAddDatabaseView(), {
        wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
      });
      const pending = result.current(layout);

      // Resolving folder placement must not create a provisional Yjs view or
      // enqueue a mutation while the server's entitlement check is pending.
      await act(async () => { await Promise.resolve(); });
      expect(createDatabaseView).toHaveBeenCalledTimes(1);
      expect(Y.encodeStateAsUpdate(databaseDoc)).toEqual(before);

      await act(async () => {
        acceptRequest({ view_id: 'accepted-view-id', database_id: 'database-id', database_update: databaseUpdate });
        await expect(pending).resolves.toBe('accepted-view-id');
      });

      expect(getDatabase(databaseDoc).get(YjsDatabaseKey.views)).toHaveProperty('size', 2);
    }
  );

  it.each([
    [DatabaseViewLayout.Form, { code: 1076, message: 'Free workspaces can have one form. Upgrade to Pro.' }],
    [DatabaseViewLayout.Chart, { code: 1076, message: 'Upgrade to Pro to use this chart type.' }],
    [DatabaseViewLayout.Form, new Error('Network Error')],
    [DatabaseViewLayout.Chart, new Error('Network Error')],
  ] as const)('does not create a local view or enqueue updates when layout %s is rejected', async (layout, error) => {
    const databaseDoc = createDatabaseDoc('database-id');

    addExistingGridView(databaseDoc, 'base-view-id');
    const before = Y.encodeStateAsUpdate(databaseDoc);
    const onUpdate = jest.fn();

    databaseDoc.on('update', onUpdate);
    const createDatabaseView = jest.fn().mockRejectedValue(error);
    const contextValue: DatabaseContextState = {
      readOnly: false,
      canWrite: true,
      databaseDoc,
      databasePageId: 'base-view-id',
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
    };
    const { result } = renderHook(() => useAddDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await expect(result.current(layout)).rejects.toBe(error);
    expect(Y.encodeStateAsUpdate(databaseDoc)).toEqual(before);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(createDatabaseView).toHaveBeenCalledTimes(1);
  });

  it.each([
    { embedded: true, isDocumentBlock: false, activeChild: true },
    { embedded: true, isDocumentBlock: false, activeChild: false },
    { embedded: false, isDocumentBlock: true, activeChild: true },
    { embedded: false, isDocumentBlock: true, activeChild: false },
  ])(
    'creates Calendar with saved container scope $embedded despite document presentation $isDocumentBlock (active child: $activeChild)',
    async ({ embedded, isDocumentBlock, activeChild }) => {
      const databaseId = 'database-id';
      const containerId = 'container-id';
      const gridId = 'grid-id';
      const grid = createView({
        view_id: gridId,
        layout: ViewLayout.Grid,
        parent_view_id: containerId,
        extra: { is_space: false, embedded },
      });
      const container = createView({
        view_id: containerId,
        layout: ViewLayout.Grid,
        extra: { is_space: false, is_database_container: true, embedded },
        children: [grid],
      });
      const createDatabaseView = jest.fn().mockResolvedValue({
        view_id: 'calendar-id',
        database_id: databaseId,
      });
      const contextValue: DatabaseContextState = {
        readOnly: false,
        databaseDoc: createDatabaseDoc(databaseId),
        databasePageId: containerId,
        activeViewId: activeChild ? gridId : containerId,
        rowMap: {},
        workspaceId: 'workspace-id',
        createDatabaseView,
        loadViewMeta: jest.fn(async (viewId: string) => (viewId === containerId ? container : grid)),
        isDocumentBlock,
      };
      const { result } = renderHook(() => useAddDatabaseView(), {
        wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
      });

      await act(async () => {
        await result.current(DatabaseViewLayout.Calendar);
      });

      expect(createDatabaseView).toHaveBeenCalledWith(
        activeChild ? gridId : containerId,
        expect.objectContaining({ parent_view_id: containerId, embedded, layout: ViewLayout.Calendar })
      );
    }
  );

  it('resolves the known container when the active child metadata cannot be loaded', async () => {
    const containerId = 'container-id';
    const activeViewId = 'grid-id';
    const precedingViewId = 'board-id';
    const container = createView({
      view_id: containerId,
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true, embedded: true },
      children: [precedingViewId, activeViewId].map((viewId) =>
        createView({ view_id: viewId, layout: ViewLayout.Grid, parent_view_id: containerId })
      ),
    });
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === containerId) return container;
      throw new Error('Child metadata unavailable');
    });
    const createDatabaseView = jest.fn().mockResolvedValue({ view_id: 'calendar-id', database_id: 'database-id' });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc: createDatabaseDoc('database-id'),
      databasePageId: containerId,
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
        prev_view_id: precedingViewId,
        embedded: true,
      })
    );
    expect(loadViewMeta).toHaveBeenCalledWith(containerId);
  });

  it.each([false, true])(
    'keeps a containerless embedded view under its document when opened full-page (legacy container marker: %s)',
    async (legacyContainerMarker) => {
      const linkedView = createView({
        view_id: 'linked-view-id',
        layout: ViewLayout.Grid,
        parent_view_id: 'document-id',
        extra: { is_space: false, embedded: true, is_database_container: legacyContainerMarker },
      });
      const document = createView({
        view_id: 'document-id',
        layout: ViewLayout.Document,
        children: [linkedView],
      });
      const createDatabaseView = jest.fn().mockResolvedValue({ view_id: 'calendar-id', database_id: 'database-id' });
      const contextValue: DatabaseContextState = {
        readOnly: false,
        databaseDoc: createDatabaseDoc('database-id'),
        databasePageId: linkedView.view_id,
        activeViewId: linkedView.view_id,
        rowMap: {},
        workspaceId: 'workspace-id',
        createDatabaseView,
        loadViewMeta: jest.fn(async (viewId: string) => (viewId === document.view_id ? document : linkedView)),
        isDocumentBlock: false,
      };
      const { result } = renderHook(() => useAddDatabaseView(), {
        wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
      });

      await act(async () => {
        await result.current(DatabaseViewLayout.Calendar);
      });

      expect(createDatabaseView).toHaveBeenCalledWith(
        linkedView.view_id,
        expect.objectContaining({ parent_view_id: document.view_id, embedded: true })
      );
    }
  );

  it('duplicates an embedded Calendar opened full-page without changing its persisted scope', async () => {
    const databaseId = 'database-id';
    const sourceViewId = 'calendar-id';
    const duplicatedViewId = 'calendar-copy-id';
    const databaseDoc = createDatabaseDoc(databaseId);

    addExistingGridView(databaseDoc, sourceViewId);
    const views = getDatabase(databaseDoc).get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;
    const sourceView = views.get(sourceViewId)!;

    sourceView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Calendar);
    sourceView.set(YjsDatabaseKey.embedded, true);
    const sourceMeta = createView({
      view_id: sourceViewId,
      layout: ViewLayout.Calendar,
      parent_view_id: 'container-id',
      extra: { is_space: false, embedded: true },
    });
    const containerMeta = createView({
      view_id: 'container-id',
      layout: ViewLayout.Grid,
      extra: { is_space: false, is_database_container: true, embedded: true },
      children: [sourceMeta],
    });
    const createDatabaseView = jest.fn(async (_viewId: string, payload: { embedded?: boolean }) => {
      if (!payload.embedded) throw new Error('linked database view embedded state must match its container');
      const remoteDoc = new Y.Doc();

      Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(databaseDoc));
      const remoteDatabase = remoteDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
      const remoteViews = remoteDatabase.get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;
      const duplicate = new Y.Map<unknown>();

      duplicate.set(YjsDatabaseKey.id, duplicatedViewId);
      duplicate.set(YjsDatabaseKey.layout, DatabaseViewLayout.Calendar);
      duplicate.set(YjsDatabaseKey.embedded, payload.embedded);
      duplicate.set(YjsDatabaseKey.field_orders, new Y.Array());
      remoteViews.set(duplicatedViewId, duplicate);
      return {
        view_id: duplicatedViewId,
        database_id: databaseId,
        database_update: Array.from(Y.encodeStateAsUpdate(remoteDoc, Y.encodeStateVector(databaseDoc))),
      };
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      databaseDoc,
      databasePageId: containerMeta.view_id,
      activeViewId: sourceViewId,
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      loadViewMeta: jest.fn(async (viewId: string) => (viewId === sourceViewId ? sourceMeta : containerMeta)),
      isDocumentBlock: false,
    };
    const { result } = renderHook(() => useDuplicateDatabaseView(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
    });

    await act(async () => {
      await expect(result.current(sourceViewId, 'Calendar (Copy)')).resolves.toBe(duplicatedViewId);
    });

    expect(createDatabaseView).toHaveBeenCalledWith(
      sourceViewId,
      expect.objectContaining({ parent_view_id: containerMeta.view_id, embedded: true })
    );
    expect(views.get(duplicatedViewId)?.get(YjsDatabaseKey.embedded)).toBe(true);
    expect(sourceView.get(YjsDatabaseKey.embedded)).toBe(true);
  });

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

  it('prevalidates and normalizes the exact Feed child returned by the server', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const feedViewId = 'feed-view-id';
    const databaseDoc = createDatabaseDoc(databaseId);

    addExistingGridView(databaseDoc, baseViewId);
    const createDatabaseView = jest.fn().mockResolvedValue({
      view_id: feedViewId,
      database_id: databaseId,
      database_update: createGalleryUpdate(databaseDoc, baseViewId, feedViewId),
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

    await expect(result.current(DatabaseViewLayout.Feed, 'Feed')).resolves.toBe(feedViewId);

    expect(createDatabaseView).toHaveBeenCalledWith(
      baseViewId,
      expect.objectContaining({ layout: ViewLayout.Feed, name: 'Feed' })
    );

    const views = databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database)?.get(YjsDatabaseKey.views);
    const fieldSettings = views?.get(feedViewId)?.get(YjsDatabaseKey.field_settings);

    expect(views?.get(baseViewId)?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Grid);
    expect(views?.get(feedViewId)?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Feed);
    expect(fieldSettings?.get('primary-field')?.get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);
  });

  it('rejects an invalid Feed update before it can mutate the live database', async () => {
    const databaseId = 'db-1';
    const baseViewId = 'base-view-id';
    const returnedViewId = 'missing-feed-view-id';
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

    await expect(result.current(DatabaseViewLayout.Feed, 'Feed')).rejects.toThrow(
      'The server did not return the requested Feed database view'
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
