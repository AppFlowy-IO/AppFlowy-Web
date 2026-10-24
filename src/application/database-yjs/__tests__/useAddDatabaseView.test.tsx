import { expect } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { atomicRead } from '@/application/atomic-creation';
import {
  DatabaseContext,
  DatabaseContextState,
  FieldType,
  FieldVisibility,
  useAddDatabaseView,
  useDuplicateDatabaseView,
  useUpdateDatabaseLayout,
} from '@/application/database-yjs';
import { createDefaultDatabaseView } from '@/application/database-yjs/creation/create-default-view';
import { readDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import {
  resetDashboardSessionForTests,
  wasDashboardCreatedThisSession,
} from '@/application/database-yjs/dashboard-session';
import { DASHBOARD_LAYOUT_KEY } from '@/application/database-yjs/dashboard.type';
import { getOrCreateDatabaseHistoryManager, runDatabaseAction } from '@/application/database-yjs/history';
import { getView } from '@/application/services/js-services/http/view-api';
import {
  CreateDatabaseViewPayload,
  DatabaseViewLayout,
  UpdatePagePayload,
  View,
  ViewLayout,
  YDatabase,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { AppOutlineContext } from '@/components/app/contexts/AppOutlineContext';
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


jest.mock('@/application/atomic-creation', () => ({
  atomicRead: jest.fn(),
  captureAtomicCreationOwner: (_workspace: string, check: () => void) => ({ assertCurrent: check }),
}));
jest.mock('@/application/database-yjs/creation/create-default-view', () => ({ createDefaultDatabaseView: jest.fn() }));

function getDatabase(databaseDoc: YDoc): Y.Map<unknown> {
  return databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as Y.Map<unknown>;
}

function folder(view_id: string, parent_view_id?: string, extra = {}): View {
  return { view_id, parent_view_id, name: view_id, icon: null, layout: ViewLayout.Grid,
    extra, children: [], is_published: false, is_private: false };
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

describe('database layout conversion admission', () => {
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
      'Use Add view to create Form or Chart views.'
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

  it.each([DatabaseViewLayout.Form, DatabaseViewLayout.Chart])(
    'requires atomic server creation for hosted layout %s even while online', async (layout) => {
      jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      const fixture = setup();

      await expect(fixture.result.current(layout)).rejects.toThrow('Use Add view to create Form or Chart views.');
      expect(getView).not.toHaveBeenCalled();
      expect(Y.encodeStateAsUpdate(fixture.databaseDoc)).toEqual(fixture.before);
      expect(fixture.onUpdate).not.toHaveBeenCalled();
    }
  );

  it.each([DatabaseViewLayout.Form, DatabaseViewLayout.Chart])('keeps existing hosted layout %s usable', (layout) => {
    const fixture = setup();
    const views = getDatabase(fixture.databaseDoc).get(YjsDatabaseKey.views) as Y.Map<Y.Map<unknown>>;

    act(() => { views.get('base-view-id')?.set(YjsDatabaseKey.layout, layout); });
    fixture.onUpdate.mockClear();
    act(() => { void fixture.result.current(layout); });
    expect(fixture.onUpdate).not.toHaveBeenCalled();
  });

});

describe('compact Database view callers', () => {
  beforeEach(() => {
    jest.mocked(createDefaultDatabaseView).mockReset().mockResolvedValue('new-view');
    jest.mocked(atomicRead).mockReset();
  });

  function setup(options: Partial<DatabaseContextState> = {}) {
    const databaseDoc = createDatabaseDoc('database-id');

    addExistingGridView(databaseDoc, 'source');
    const source = folder('source', 'container');
    const container = folder('container', 'space', { is_database_container: true });

    container.children = [source];
    jest.mocked(atomicRead).mockImplementation(async (_owner, url) =>
      (url.endsWith('/source') ? source : container) as never);
    const ensure = jest.fn(async (): Promise<string[]> => []);
    let context = { databaseDoc, databasePageId: 'container', activeViewId: 'source', workspaceId: 'workspace',
      rowMap: {}, readOnly: false, canWrite: true, ...options };
    const hook = renderHook(() => ({ add: useAddDatabaseView(), duplicate: useDuplicateDatabaseView() }), {
      wrapper: ({ children }) => <AppOutlineContext.Provider value={{ outline: [container], ensureViewVisibleInOutline: ensure }}>
        <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
      </AppOutlineContext.Provider>,
    });

    const updateContext = (next: Partial<DatabaseContextState>) => {
      context = { ...context, ...next };
      hook.rerender();
    };

    return { ...hook, databaseDoc, container, source, ensure, updateContext };
  }

  it.each([DatabaseViewLayout.Grid, DatabaseViewLayout.Board, DatabaseViewLayout.Calendar,
    DatabaseViewLayout.Chart, DatabaseViewLayout.List, DatabaseViewLayout.Gallery, DatabaseViewLayout.Feed,
    DatabaseViewLayout.Form, DatabaseViewLayout.Timeline])('routes layout %s as a compact server recipe without local mutation', async (layout) => {
    const f = setup();
    const before = Y.encodeStateAsUpdate(f.databaseDoc);

    await expect(f.result.current.add(layout)).resolves.toBe('new-view');
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({
      databaseId: 'database-id', parentViewId: 'container', layout, sourceViewId: undefined, embedded: false,
    }));
    expect(Y.encodeStateAsUpdate(f.databaseDoc)).toEqual(before);
  });

  it.each([
    ['inline database', { is_database_container: true, embedded: true }, {}, true, 'container'],
    ['linked document block', {}, { embedded: true }, true, 'container'],
    ['legacy standalone view', {}, {}, false, 'container'],
  ])('preserves the Folder parent and embedding of a %s', async (_label, parentExtra, sourceExtra, embedded, parentViewId) => {
    const f = setup();

    f.container.extra = parentExtra;
    f.source.extra = sourceExtra;
    await f.result.current.add(DatabaseViewLayout.List);
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({ parentViewId, embedded }));
  });

  it('uses the authoritative navigation result before the sidebar context rerenders', async () => {
    const f = setup();

    jest.mocked(createDefaultDatabaseView).mockImplementation(async (intent) => {
      await intent.activate?.('created');
      return 'created';
    });
    await expect(f.result.current.add(DatabaseViewLayout.Grid)).rejects.toThrow('missing from the sidebar');
    // React may batch the outline state update until after this promise resolves.
    // The current navigation path proves membership without consulting stale rendered state.
    f.ensure.mockResolvedValue(['space', 'container']);
    await expect(f.result.current.add(DatabaseViewLayout.Grid)).resolves.toBe('created');
    expect(f.container.children?.some((view) => view.view_id === 'created')).toBe(false);
    expect(f.ensure).toHaveBeenCalledTimes(2);
  });

  it('creates directly in a known container without waiting for its parent metadata', async () => {
    const f = setup({ activeViewId: 'container' });

    jest.mocked(atomicRead).mockImplementation(async (_owner, url) => {
      if (url.endsWith('/container')) return f.container as never;
      throw new Error('Parent metadata is unavailable');
    });

    await expect(f.result.current.add(DatabaseViewLayout.Grid)).resolves.toBe('new-view');
    expect(atomicRead).toHaveBeenCalledTimes(1);
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({
      parentViewId: 'container', embedded: false,
    }));
  });

  it('duplicates current source settings through the recipe rather than copying Yjs maps', async () => {
    const f = setup();

    await expect(f.result.current.duplicate('source', 'Copied')).resolves.toBe('new-view');
    expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({ sourceViewId: 'source',
      name: 'Copied', position: { kind: 'index', index: 0 } }));
  });

  it('refuses read-only creation before metadata or mutation', async () => {
    const f = setup({ readOnly: true });

    await expect(f.result.current.add(DatabaseViewLayout.Grid)).rejects.toThrow('Edit access');
    expect(atomicRead).not.toHaveBeenCalled();
    expect(createDefaultDatabaseView).not.toHaveBeenCalled();
  });

  it.each([{ readOnly: true }, { canWrite: false }])(
    'rechecks write access after source metadata loads: %o', async (permissions) => {
      const f = setup({ activeViewId: 'container' });
      let release!: (view: View) => void;

      jest.mocked(atomicRead).mockReturnValue(new Promise<View>((resolve) => { release = resolve; }) as never);
      const pending = f.result.current.add(DatabaseViewLayout.Grid);

      f.updateContext(permissions);
      release(f.container);
      await expect(pending).rejects.toThrow('Edit access');
      expect(createDefaultDatabaseView).not.toHaveBeenCalled();
    }
  );

  it('does not activate a pending view after write access is revoked', async () => {
    const f = setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    f.ensure.mockResolvedValue(['space', 'container']);
    jest.mocked(createDefaultDatabaseView).mockImplementation(async (intent) => {
      await held;
      await intent.activate?.('created');
      return 'created';
    });
    const pending = f.result.current.add(DatabaseViewLayout.Grid);

    await waitFor(() => expect(createDefaultDatabaseView).toHaveBeenCalled());
    f.updateContext({ canWrite: false });
    release();
    await expect(pending).rejects.toThrow('Edit access');
    expect(f.ensure).not.toHaveBeenCalled();
  });

  it('does not activate a late result after the owning component unmounts', async () => {
    const f = setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });

    jest.mocked(createDefaultDatabaseView).mockImplementation(async (intent) => {
      await held;
      intent.assertCurrent?.();
      return 'new-view';
    });
    const pending = f.result.current.add(DatabaseViewLayout.Grid);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    f.unmount();
    release();
    await expect(pending).rejects.toThrow('owner changed');
  });

  describe('Dashboard', () => {
    function renderAddView(databaseDoc: YDoc, createDatabaseView: jest.Mock) {
      const contextValue: DatabaseContextState = {
        readOnly: false,
        databaseDoc,
        databasePageId: 'base-view-id',
        activeViewId: 'base-view-id',
        rowMap: {},
        workspaceId: 'workspace-id',
        createDatabaseView,
        isDocumentBlock: false,
      };

      return renderHook(() => useAddDatabaseView(), {
        wrapper: ({ children }) => <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>,
      });
    }

    it('creates a Dashboard folder view named Dashboard', async () => {
      const databaseId = 'db-dashboard';
      const databaseDoc = createDatabaseDoc(databaseId);
      const createDatabaseView = jest.fn().mockResolvedValue({
        view_id: 'dashboard-view-id',
        database_id: databaseId,
        database_update: createAddViewUpdate(databaseDoc, 'dashboard-view-id'),
      });
      const { result } = renderAddView(databaseDoc, createDatabaseView);
      let createdViewId: string | undefined;

      await act(async () => {
        createdViewId = await result.current(DatabaseViewLayout.Dashboard);
      });

      expect(createdViewId).toBe('dashboard-view-id');
      expect(ViewLayout.Dashboard).toBe(11);
      expect(createDatabaseView).toHaveBeenCalledWith(
        'base-view-id',
        expect.objectContaining({
          database_id: databaseId,
          layout: ViewLayout.Dashboard,
          name: 'Dashboard',
        })
      );
    });

    it('keeps a caller-provided name', async () => {
      const databaseId = 'db-dashboard-name';
      const databaseDoc = createDatabaseDoc(databaseId);
      const createDatabaseView = jest.fn().mockResolvedValue({
        view_id: 'dashboard-view-id',
        database_id: databaseId,
        database_update: createAddViewUpdate(databaseDoc, 'dashboard-view-id'),
      });
      const { result } = renderAddView(databaseDoc, createDatabaseView);

      await act(async () => {
        await result.current(DatabaseViewLayout.Dashboard, 'Sales overview');
      });

      expect(createDatabaseView).toHaveBeenCalledWith(
        'base-view-id',
        expect.objectContaining({ layout: ViewLayout.Dashboard, name: 'Sales overview' })
      );
    });

    it('seeds empty rows and global filters in layout_settings[9] after creation', async () => {
      const databaseId = 'db-dashboard-seed';
      const newViewId = 'dashboard-view-id';
      const databaseDoc = createDatabaseDoc(databaseId);
      const createDatabaseView = jest.fn().mockResolvedValue({
        view_id: newViewId,
        database_id: databaseId,
        database_update: createAddViewUpdate(databaseDoc, newViewId),
      });
      const { result } = renderAddView(databaseDoc, createDatabaseView);

      await act(async () => {
        await result.current(DatabaseViewLayout.Dashboard);
      });

      const database = getDatabase(databaseDoc) as unknown as YDatabase;
      const view = database.get(YjsDatabaseKey.views).get(newViewId);
      const setting = view.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY);

      expect(DASHBOARD_LAYOUT_KEY).toBe(String(DatabaseViewLayout.Dashboard));
      expect(setting).toBeDefined();
      expect(setting.get(YjsDatabaseKey.dashboard_rows)).toEqual([]);
      expect(setting.get(YjsDatabaseKey.dashboard_global_filters)).toEqual([]);
      expect(readDashboardLayoutSetting(database, newViewId)).toEqual({
        rows: [],
        globalFilters: [],
        showWidgetTitles: true,
        showIconsInHeading: false,
      });

      // The seeded setting reaches other clients through the normal update stream.
      const remote = new Y.Doc();

      Y.applyUpdate(remote, Y.encodeStateAsUpdate(databaseDoc));
      const remoteDatabase = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
      const remoteSetting = remoteDatabase
        .get(YjsDatabaseKey.views)
        .get(newViewId)
        .get(YjsDatabaseKey.layout_settings)
        ?.get(DASHBOARD_LAYOUT_KEY);

      expect(remoteSetting?.get(YjsDatabaseKey.dashboard_rows)).toEqual([]);
    });

    it('does not seed a setting on other layouts', async () => {
      const databaseId = 'db-grid-no-dashboard';
      const newViewId = 'grid-view-id';
      const databaseDoc = createDatabaseDoc(databaseId);
      const createDatabaseView = jest.fn().mockResolvedValue({
        view_id: newViewId,
        database_id: databaseId,
        database_update: createAddViewUpdate(databaseDoc, newViewId),
      });

      jest.mocked(atomicRead).mockResolvedValue(folder('base-view-id') as never);
      jest.mocked(createDefaultDatabaseView).mockImplementation(async () => {
        Y.applyUpdate(databaseDoc, new Uint8Array(createAddViewUpdate(databaseDoc, newViewId)));
        return newViewId;
      });
      const { result } = renderAddView(databaseDoc, createDatabaseView);

      await act(async () => {
        await result.current(DatabaseViewLayout.Grid);
      });
      expect(createDefaultDatabaseView).toHaveBeenCalledWith(expect.objectContaining({ layout: DatabaseViewLayout.Grid }));
      expect(createDatabaseView).not.toHaveBeenCalled();

      const database = getDatabase(databaseDoc) as unknown as YDatabase;
      const view = database.get(YjsDatabaseKey.views).get(newViewId);

      expect(view.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY)).toBeUndefined();
    });

    it('returns the view id without seeding when the update omits the created view', async () => {
      const databaseId = 'db-dashboard-missing';
      const databaseDoc = createDatabaseDoc(databaseId);
      const createDatabaseView = jest.fn().mockResolvedValue({
        view_id: 'dashboard-view-id',
        database_id: databaseId,
      });
      const { result } = renderAddView(databaseDoc, createDatabaseView);
      let createdViewId: string | undefined;

      await act(async () => {
        createdViewId = await result.current(DatabaseViewLayout.Dashboard);
      });

      expect(createdViewId).toBe('dashboard-view-id');
      expect(getDatabase(databaseDoc).get(YjsDatabaseKey.views)).toBeUndefined();
    });

    it('seeds the dashboard setting without adding history or clearing redo', async () => {
      const databaseId = 'db-dashboard-history';
      const newViewId = 'dashboard-view-id';
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
      const { result } = renderAddView(databaseDoc, createDatabaseView);

      await act(async () => {
        await result.current(DatabaseViewLayout.Dashboard);
      });

      const view = (database.get(YjsDatabaseKey.views) as Y.Map<YDatabaseView>).get(newViewId);

      expect(view?.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY)).toBeDefined();
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(true);
    });
  });
});

describe('dashboard-owned views and creation marks (WP05)', () => {
  const databaseId = 'db-owned';
  const containerId = 'container-id';

  afterEach(() => {
    resetDashboardSessionForTests();
  });

  /** A server that creates database views and their folder pages, and stores folder `extra`s. */
  function setupServer(databaseDoc: YDoc) {
    const folder = new Map<string, View>();
    const addFolderView = (view: Partial<View> & { view_id: string }) =>
      folder.set(view.view_id, createView({ parent_view_id: containerId, layout: ViewLayout.Grid, ...view }));
    let nextId = 1;

    addFolderView({
      view_id: containerId,
      parent_view_id: undefined,
      extra: { is_space: false, is_database_container: true, database_id: databaseId },
    });
    addFolderView({ view_id: 'base-view-id', name: 'Grid', extra: { is_space: false, database_id: databaseId } });
    const loadViewMeta = jest.fn(async (viewId: string) => {
      const view = folder.get(viewId);

      if (!view) throw new Error('View not found');
      return { ...view, children: Array.from(folder.values()).filter((child) => child.parent_view_id === viewId) };
    });
    const updatePage = jest.fn(async (viewId: string, payload: UpdatePagePayload) => {
      const view = folder.get(viewId);

      if (view) folder.set(viewId, { ...view, name: payload.name, extra: (payload.extra ?? view.extra) as View['extra'] });
    });
    const deletePage = jest.fn(async (viewId: string) => {
      folder.delete(viewId);
    });
    const createDatabaseView = jest.fn(async (_viewId: string, payload: CreateDatabaseViewPayload) => {
      const viewId = `created-${nextId++}`;
      const serverDoc = new Y.Doc();

      Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
      const views = (serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase).get(
        YjsDatabaseKey.views
      );
      const view = new Y.Map<unknown>();
      const layout = Object.entries({
        [DatabaseViewLayout.Grid]: ViewLayout.Grid,
        [DatabaseViewLayout.Board]: ViewLayout.Board,
        [DatabaseViewLayout.Dashboard]: ViewLayout.Dashboard,
      }).find(([, viewLayout]) => viewLayout === payload.layout)?.[0];

      view.set(YjsDatabaseKey.id, viewId);
      view.set(YjsDatabaseKey.name, payload.name ?? '');
      view.set(YjsDatabaseKey.layout, Number(layout));
      view.set(YjsDatabaseKey.field_orders, new Y.Array());
      view.set(YjsDatabaseKey.layout_settings, new Y.Map());
      views.set(viewId, view as unknown as YDatabaseView);
      addFolderView({
        view_id: viewId,
        name: payload.name ?? '',
        layout: payload.layout,
        parent_view_id: payload.parent_view_id,
        extra: { is_space: false, database_id: payload.database_id, embedded: payload.embedded },
      });
      return {
        view_id: viewId,
        database_id: databaseId,
        database_update: Array.from(Y.encodeStateAsUpdate(serverDoc, Y.encodeStateVector(databaseDoc))),
      };
    });

    jest.mocked(atomicRead).mockImplementation(async (_owner, url) =>
      loadViewMeta(url.split('/').at(-1)) as never);
    jest.mocked(createDefaultDatabaseView).mockImplementation(async (intent) => {
      const response = await createDatabaseView('base-view-id', {
        database_id: intent.databaseId,
        parent_view_id: intent.parentViewId,
        name: intent.name,
        layout: intent.layout === DatabaseViewLayout.Board ? ViewLayout.Board : ViewLayout.Grid,
        embedded: intent.embedded,
      });

      Y.applyUpdate(databaseDoc, new Uint8Array(response.database_update));
      return response.view_id;
    });
    const contextValue: DatabaseContextState = {
      readOnly: false,
      canWrite: true,
      databaseDoc,
      databasePageId: containerId,
      activeViewId: 'base-view-id',
      rowMap: {},
      workspaceId: 'workspace-id',
      createDatabaseView,
      loadViewMeta,
      updatePage,
      deletePage,
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
    );

    return { folder, loadViewMeta, updatePage, deletePage, createDatabaseView, wrapper };
  }

  function getViews(databaseDoc: YDoc) {
    return (getDatabase(databaseDoc) as unknown as YDatabase).get(YjsDatabaseKey.views);
  }

  function setup() {
    const databaseDoc = createDatabaseDoc(databaseId);

    addExistingGridView(databaseDoc, 'base-view-id');
    return { databaseDoc, ...setupServer(databaseDoc) };
  }

  it('marks a view created for a dashboard in the collab mirror and the folder extra', async () => {
    const { databaseDoc, folder, updatePage, wrapper } = setup();
    const { result } = renderHook(() => useAddDatabaseView(), { wrapper });
    let viewId = '';

    await act(async () => {
      viewId = await result.current(DatabaseViewLayout.Board, 'Board', { dashboardOwner: 'dashboard-id' });
    });

    expect(getViews(databaseDoc).get(viewId)?.get(YjsDatabaseKey.dashboard_owner)).toBe('dashboard-id');
    expect(updatePage).toHaveBeenCalledWith(viewId, {
      name: 'Board',
      icon: undefined,
      extra: { is_space: false, database_id: databaseId, embedded: false, dashboard_owner: 'dashboard-id' },
    });
    expect(folder.get(viewId)?.extra?.dashboard_owner).toBe('dashboard-id');
  });

  it('writes no owner marker without the option', async () => {
    const { databaseDoc, updatePage, wrapper } = setup();
    const { result } = renderHook(() => useAddDatabaseView(), { wrapper });
    let viewId = '';

    await act(async () => {
      viewId = await result.current(DatabaseViewLayout.Board);
    });

    expect(getViews(databaseDoc).get(viewId)?.get(YjsDatabaseKey.dashboard_owner)).toBeUndefined();
    expect(updatePage).not.toHaveBeenCalled();
  });

  it('marks a Dashboard created from the tab menu as created in this session, but not a duplicated one', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ add: useAddDatabaseView(), duplicate: useDuplicateDatabaseView() }), {
      wrapper,
    });
    let dashboardId = '';
    let boardId = '';
    let duplicateId = '';

    await act(async () => {
      dashboardId = await result.current.add(DatabaseViewLayout.Dashboard);
      boardId = await result.current.add(DatabaseViewLayout.Board);
      duplicateId = await result.current.duplicate(dashboardId);
    });

    expect(wasDashboardCreatedThisSession(dashboardId)).toBe(true);
    expect(wasDashboardCreatedThisSession(boardId)).toBe(false);
    expect(wasDashboardCreatedThisSession(duplicateId)).toBe(false);
  });

  it('converts a view to Dashboard with its owned copy as the first widget and marks it', async () => {
    const { databaseDoc, folder, createDatabaseView, wrapper } = setup();
    const history = getOrCreateDatabaseHistoryManager(databaseDoc);
    const { result } = renderHook(() => useUpdateDatabaseLayout('base-view-id'), { wrapper });

    await act(async () => {
      await result.current(DatabaseViewLayout.Dashboard);
    });

    const copyId = (await createDatabaseView.mock.results[0].value).view_id;
    const views = getViews(databaseDoc);
    const setting = readDashboardLayoutSetting(getDatabase(databaseDoc) as unknown as YDatabase, 'base-view-id');

    expect(createDatabaseView).toHaveBeenCalledTimes(1);
    expect(createDatabaseView).toHaveBeenCalledWith(
      'base-view-id',
      expect.objectContaining({ parent_view_id: containerId, layout: ViewLayout.Grid, name: 'Grid', embedded: false })
    );
    expect(views.get('base-view-id')?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Dashboard);
    expect(setting.rows).toEqual([
      expect.objectContaining({
        height: 360,
        widgets: [expect.objectContaining({ viewId: copyId, databaseId, width: 12 })],
      }),
    ]);
    expect(views.get(copyId)?.get(YjsDatabaseKey.dashboard_owner)).toBe('base-view-id');
    expect(folder.get(copyId)?.extra?.dashboard_owner).toBe('base-view-id');
    expect(wasDashboardCreatedThisSession('base-view-id')).toBe(true);
    // The seed is not an undo step; undoing the conversion keeps it for a redo.
    act(() => {
      history.undo();
    });
    expect(views.get('base-view-id')?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Grid);
    expect(
      readDashboardLayoutSetting(getDatabase(databaseDoc) as unknown as YDatabase, 'base-view-id').rows
    ).toHaveLength(1);
  });

  it('keeps converting after the layout menu that started it closes', async () => {
    const { databaseDoc, createDatabaseView, wrapper } = setup();
    const create = createDatabaseView.getMockImplementation()!;
    let respond!: () => void;

    createDatabaseView.mockImplementationOnce(
      (...args) => new Promise((resolve) => (respond = () => resolve(create(...args))))
    );
    const { result, unmount } = renderHook(() => useUpdateDatabaseLayout('base-view-id'), { wrapper });
    const pending = result.current(DatabaseViewLayout.Dashboard);

    await waitFor(() => expect(createDatabaseView).toHaveBeenCalledTimes(1));
    // Choosing a layout closes the settings menu (and its hook) before the copy exists.
    unmount();
    await act(async () => {
      respond();
      await pending;
    });

    expect(getViews(databaseDoc).get('base-view-id')?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Dashboard);
    expect(
      readDashboardLayoutSetting(getDatabase(databaseDoc) as unknown as YDatabase, 'base-view-id').rows
    ).toHaveLength(1);
  });

  it('drops a pending conversion when a later layout choice is made, even from another menu', async () => {
    const { databaseDoc, createDatabaseView, deletePage, wrapper } = setup();
    const create = createDatabaseView.getMockImplementation()!;
    let respond!: () => void;

    createDatabaseView.mockImplementationOnce(
      (...args) => new Promise((resolve) => (respond = () => resolve(create(...args))))
    );
    const first = renderHook(() => useUpdateDatabaseLayout('base-view-id'), { wrapper });
    const pending = first.result.current(DatabaseViewLayout.Dashboard);

    await waitFor(() => expect(createDatabaseView).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = renderHook(() => useUpdateDatabaseLayout('base-view-id'), { wrapper });

    act(() => {
      void second.result.current(DatabaseViewLayout.Board);
    });
    await act(async () => {
      respond();
      await pending;
    });

    const copyId = (await createDatabaseView.mock.results[0].value).view_id;

    expect(getViews(databaseDoc).get('base-view-id')?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Board);
    expect(getViews(databaseDoc).has(copyId)).toBe(false);
    expect(deletePage).toHaveBeenCalledWith(copyId);
    expect(wasDashboardCreatedThisSession('base-view-id')).toBe(false);
  });

  it('reports a failed copy and leaves the view as it was', async () => {
    const { databaseDoc, createDatabaseView, wrapper } = setup();
    const { result } = renderHook(() => useUpdateDatabaseLayout('base-view-id'), { wrapper });

    createDatabaseView.mockRejectedValueOnce(new Error('Upgrade to Pro'));
    await act(async () => {
      await expect(result.current(DatabaseViewLayout.Dashboard)).rejects.toThrow('Upgrade to Pro');
    });

    expect(getViews(databaseDoc).get('base-view-id')?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Grid);
    expect(wasDashboardCreatedThisSession('base-view-id')).toBe(false);
  });

  it('duplicates a dashboard tab with its own copies of the views its widgets own', async () => {
    const { databaseDoc, folder, createDatabaseView, wrapper } = setup();
    const { result } = renderHook(
      () => ({ convert: useUpdateDatabaseLayout('base-view-id'), duplicate: useDuplicateDatabaseView() }),
      { wrapper }
    );

    await act(async () => {
      await result.current.convert(DatabaseViewLayout.Dashboard);
    });
    const ownedId = (await createDatabaseView.mock.results[0].value).view_id;
    let duplicateId = '';

    await act(async () => {
      duplicateId = await result.current.duplicate('base-view-id');
    });

    const copiedOwnedId = (await createDatabaseView.mock.results[2].value).view_id;
    const views = getViews(databaseDoc);
    const duplicatedRows = readDashboardLayoutSetting(getDatabase(databaseDoc) as unknown as YDatabase, duplicateId).rows;

    expect(createDatabaseView).toHaveBeenCalledTimes(3);
    expect(duplicatedRows[0].widgets[0].viewId).toBe(copiedOwnedId);
    expect(copiedOwnedId).not.toBe(ownedId);
    expect(views.get(copiedOwnedId)?.get(YjsDatabaseKey.name)).toBe('Grid');
    expect(views.get(copiedOwnedId)?.get(YjsDatabaseKey.dashboard_owner)).toBe(duplicateId);
    expect(folder.get(copiedOwnedId)?.extra?.dashboard_owner).toBe(duplicateId);
    // The source dashboard still shows its own view.
    expect(
      readDashboardLayoutSetting(getDatabase(databaseDoc) as unknown as YDatabase, 'base-view-id').rows[0].widgets[0]
        .viewId
    ).toBe(ownedId);
  });
});
