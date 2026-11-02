import * as Y from 'yjs';

import { readDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import {
  createDatabaseDashboardPageViaGrid,
  createLinkedDatabaseDashboardView,
  duplicateLinkedDatabaseDashboardView,
  NEW_DASHBOARD_VIEW_NAME,
} from '@/application/database-yjs/dashboard-page';
import {
  resetDashboardSessionForTests,
  wasDashboardCreatedThisSession,
} from '@/application/database-yjs/dashboard-session';
import { toPlainValue } from '@/application/database-yjs/layout-codec';
import { createLinkedDatabaseViewForLayout } from '@/application/database-yjs/linked-view-creation';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateDatabaseViewPayload,
  DatabaseViewLayout,
  View,
  ViewLayout,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { Log } from '@/utils/log';

import { DASHBOARD_LAYOUT_KEY } from '../dashboard.type';

const DATABASE_ID = 'database-id';
const GRID_VIEW_ID = 'grid-view-id';
const DASHBOARD_VIEW_ID = 'dashboard-view-id';

function createGridDatabaseDoc(): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const views = new Y.Map();
  const gridView = new Y.Map();

  gridView.set(YjsDatabaseKey.id, GRID_VIEW_ID);
  gridView.set(YjsDatabaseKey.name, 'Grid');
  gridView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  gridView.set(YjsDatabaseKey.field_orders, new Y.Array());
  gridView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(GRID_VIEW_ID, gridView);
  database.set(YjsDatabaseKey.id, DATABASE_ID);
  database.set(YjsDatabaseKey.fields, new Y.Map());
  database.set(YjsDatabaseKey.views, views);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function getDatabase(doc: YDoc): YDatabase {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
}

/** What the server sends back: the client's doc plus the new dashboard view. */
function createDashboardUpdate(databaseDoc: YDoc, viewId = DASHBOARD_VIEW_ID): number[] {
  const serverDoc = new Y.Doc();

  Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
  const clientStateVector = Y.encodeStateVector(databaseDoc);
  const views = (serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase).get(
    YjsDatabaseKey.views
  );
  const dashboardView = new Y.Map();

  dashboardView.set(YjsDatabaseKey.id, viewId);
  dashboardView.set(YjsDatabaseKey.name, NEW_DASHBOARD_VIEW_NAME);
  dashboardView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Dashboard);
  dashboardView.set(YjsDatabaseKey.field_orders, new Y.Array());
  dashboardView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(viewId, dashboardView);
  return Array.from(Y.encodeStateAsUpdate(serverDoc, clientStateVector));
}

function createParams(databaseDoc: YDoc) {
  const flush = jest.fn().mockResolvedValue(true);

  return {
    parentViewId: 'document-id',
    name: 'New database',
    addPage: jest.fn().mockResolvedValue({ view_id: GRID_VIEW_ID, database_id: DATABASE_ID }),
    loadView: jest.fn().mockResolvedValue(databaseDoc),
    bindViewSync: jest.fn(() => ({ flush } as unknown as SyncContext)),
    createDatabaseView: jest.fn().mockResolvedValue({
      view_id: DASHBOARD_VIEW_ID,
      database_id: DATABASE_ID,
      database_update: createDashboardUpdate(databaseDoc),
    }),
    deletePage: jest.fn().mockResolvedValue(undefined),
    scheduleDeferredCleanup: jest.fn(),
    flush,
  };
}

afterEach(() => {
  resetDashboardSessionForTests();
});

describe('createDatabaseDashboardPageViaGrid', () => {
  it('marks the new dashboard as created in this session', async () => {
    const databaseDoc = createGridDatabaseDoc();

    await createDatabaseDashboardPageViaGrid(createParams(databaseDoc));

    expect(wasDashboardCreatedThisSession(DASHBOARD_VIEW_ID)).toBe(true);
    expect(wasDashboardCreatedThisSession(GRID_VIEW_ID)).toBe(false);
  });

  it('marks nothing when creating the dashboard fails', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const params = createParams(databaseDoc);

    params.createDatabaseView.mockRejectedValue(new Error('plan required'));
    await expect(createDatabaseDashboardPageViaGrid(params)).rejects.toThrow('plan required');
    expect(wasDashboardCreatedThisSession(DASHBOARD_VIEW_ID)).toBe(false);
  });

  it('creates the grid, adds a dashboard tab under the document and seeds its settings', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const params = createParams(databaseDoc);

    const response = await createDatabaseDashboardPageViaGrid(params);

    expect(params.addPage).toHaveBeenCalledWith('document-id', {
      layout: ViewLayout.Grid,
      name: 'New database',
      prev_view_id: undefined,
    });
    expect(params.createDatabaseView).toHaveBeenCalledWith(GRID_VIEW_ID, {
      parent_view_id: 'document-id',
      prev_view_id: GRID_VIEW_ID,
      database_id: DATABASE_ID,
      layout: ViewLayout.Dashboard,
      name: NEW_DASHBOARD_VIEW_NAME,
      embedded: true,
    });
    // The block shows the dashboard; the grid stays as the data tab.
    expect(response).toEqual({ view_id: DASHBOARD_VIEW_ID, database_id: DATABASE_ID });

    const views = getDatabase(databaseDoc).get(YjsDatabaseKey.views);
    const dashboardSetting = views
      .get(DASHBOARD_VIEW_ID)
      ?.get(YjsDatabaseKey.layout_settings)
      ?.get(DASHBOARD_LAYOUT_KEY);

    expect(views.get(GRID_VIEW_ID)?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Grid);
    expect(views.get(DASHBOARD_VIEW_ID)?.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Dashboard);
    expect(dashboardSetting?.get(YjsDatabaseKey.dashboard_rows)).toEqual([]);
    expect(dashboardSetting?.get(YjsDatabaseKey.dashboard_global_filters)).toEqual([]);
    expect(params.flush).toHaveBeenCalled();
    expect(params.scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
    expect(params.deletePage).not.toHaveBeenCalled();
  });

  it('removes the new database when the server does not return the dashboard view', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const params = createParams(databaseDoc);

    params.createDatabaseView.mockResolvedValue({ view_id: GRID_VIEW_ID, database_id: DATABASE_ID });

    await expect(createDatabaseDashboardPageViaGrid(params)).rejects.toThrow(
      'The server returned invalid metadata for the new Dashboard view'
    );
    expect(params.deletePage).toHaveBeenCalledWith(GRID_VIEW_ID);
    expect(params.scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
  });

  it('removes the dashboard page too when it exists but its metadata is invalid', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const params = createParams(databaseDoc);

    // The view was created, but for another database: the sidebar page must not stay behind.
    params.createDatabaseView.mockResolvedValue({ view_id: DASHBOARD_VIEW_ID, database_id: 'other-database' });

    await expect(createDatabaseDashboardPageViaGrid(params)).rejects.toThrow(
      'The server returned invalid metadata for the new Dashboard view'
    );
    expect(params.deletePage.mock.calls.map(([viewId]) => viewId)).toEqual([DASHBOARD_VIEW_ID, GRID_VIEW_ID]);
  });

  it('removes the new database when adding the dashboard view fails', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const params = createParams(databaseDoc);

    params.createDatabaseView.mockRejectedValue(new Error('plan required'));

    await expect(createDatabaseDashboardPageViaGrid(params)).rejects.toThrow('plan required');
    expect(params.deletePage).toHaveBeenCalledWith(GRID_VIEW_ID);
  });
});

describe('createLinkedDatabaseDashboardView', () => {
  const payload = {
    parent_view_id: 'document-id',
    database_id: DATABASE_ID,
    name: 'View of Tasks',
    embedded: true,
  };

  beforeEach(() => {
    jest.spyOn(Log, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createLinkedParams(databaseDoc: YDoc) {
    const flush = jest.fn().mockResolvedValue(true);

    return {
      requestViewId: 'document-id',
      payload,
      createDatabaseView: jest.fn().mockResolvedValue({
        view_id: DASHBOARD_VIEW_ID,
        database_id: DATABASE_ID,
        database_update: createDashboardUpdate(databaseDoc),
      }),
      loadView: jest.fn().mockResolvedValue(databaseDoc),
      bindViewSync: jest.fn(() => ({ doc: databaseDoc, flush } as unknown as SyncContext)),
      scheduleDeferredCleanup: jest.fn(),
      flush,
    };
  }

  function getDashboardSetting(databaseDoc: YDoc) {
    return getDatabase(databaseDoc)
      .get(YjsDatabaseKey.views)
      .get(DASHBOARD_VIEW_ID)
      ?.get(YjsDatabaseKey.layout_settings)
      ?.get(DASHBOARD_LAYOUT_KEY);
  }

  it('seeds the linked dashboard setting like every other dashboard creation path', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const params = createLinkedParams(databaseDoc);

    const response = await createLinkedDatabaseDashboardView(params);

    expect(params.createDatabaseView).toHaveBeenCalledWith('document-id', {
      ...payload,
      layout: ViewLayout.Dashboard,
    });
    expect(response.view_id).toBe(DASHBOARD_VIEW_ID);
    expect(params.loadView).toHaveBeenCalledWith(DASHBOARD_VIEW_ID, false, false, { databaseId: DATABASE_ID });
    expect(getDashboardSetting(databaseDoc)?.get(YjsDatabaseKey.dashboard_rows)).toEqual([]);
    expect(getDashboardSetting(databaseDoc)?.get(YjsDatabaseKey.dashboard_global_filters)).toEqual([]);
    // A retained owner persists the seed even when the database is already open, and is released.
    expect(params.bindViewSync).toHaveBeenCalledWith(databaseDoc, { retain: true });
    expect(params.flush).toHaveBeenCalled();
    expect(params.scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
  });

  it('keeps the created view when seeding fails', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const params = createLinkedParams(databaseDoc);

    params.loadView.mockRejectedValue(new Error('offline'));

    await expect(createLinkedDatabaseDashboardView(params)).resolves.toMatchObject({ view_id: DASHBOARD_VIEW_ID });
    expect(params.bindViewSync).not.toHaveBeenCalled();
    expect(params.scheduleDeferredCleanup).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      '[Dashboard creation] failed to seed the linked dashboard setting',
      expect.objectContaining({ viewId: DASHBOARD_VIEW_ID })
    );
  });

  it('releases its sync owner when the returned update lacks the dashboard view', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const params = createLinkedParams(databaseDoc);

    params.createDatabaseView.mockResolvedValue({ view_id: DASHBOARD_VIEW_ID, database_id: DATABASE_ID });

    await expect(createLinkedDatabaseDashboardView(params)).resolves.toMatchObject({ view_id: DASHBOARD_VIEW_ID });
    expect(getDashboardSetting(databaseDoc)).toBeUndefined();
    expect(params.flush).not.toHaveBeenCalled();
    expect(params.scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
  });

  it('propagates a failure to create the view', async () => {
    const databaseDoc = createGridDatabaseDoc();
    const params = createLinkedParams(databaseDoc);

    params.createDatabaseView.mockRejectedValue(new Error('plan required'));

    await expect(createLinkedDatabaseDashboardView(params)).rejects.toThrow('plan required');
    expect(params.loadView).not.toHaveBeenCalled();
    expect(wasDashboardCreatedThisSession(DASHBOARD_VIEW_ID)).toBe(false);
  });

  it('marks the linked dashboard as created in this session', async () => {
    const databaseDoc = createGridDatabaseDoc();

    await createLinkedDatabaseDashboardView(createLinkedParams(databaseDoc));

    expect(wasDashboardCreatedThisSession(DASHBOARD_VIEW_ID)).toBe(true);
  });

  describe('duplicating a linked dashboard block (duplicateLinkedDatabaseDashboardView)', () => {
    const SOURCE_DASHBOARD_ID = 'source-dashboard-id';
    const OWNED_VIEW_ID = 'owned-board-id';
    const OWNED_COPY_ID = 'owned-board-copy-id';

    function addView(doc: YDoc, viewId: string, name: string, layout: DatabaseViewLayout) {
      const view = new Y.Map<unknown>();

      view.set(YjsDatabaseKey.id, viewId);
      view.set(YjsDatabaseKey.name, name);
      view.set(YjsDatabaseKey.layout, layout);
      view.set(YjsDatabaseKey.field_orders, new Y.Array());
      view.set(YjsDatabaseKey.layout_settings, new Y.Map());
      getDatabase(doc).get(YjsDatabaseKey.views).set(viewId, view as never);
      return view;
    }

    function createSourceDoc() {
      const databaseDoc = createGridDatabaseDoc();
      const source = addView(databaseDoc, SOURCE_DASHBOARD_ID, 'Dashboard', DatabaseViewLayout.Dashboard);
      const setting = new Y.Map<unknown>();

      addView(databaseDoc, OWNED_VIEW_ID, 'Board', DatabaseViewLayout.Board).set(
        YjsDatabaseKey.dashboard_owner,
        SOURCE_DASHBOARD_ID
      );
      setting.set(YjsDatabaseKey.dashboard_rows, [
        {
          id: 'r:1',
          height: 360,
          widgets: [
            { id: 'w:1', view_id: GRID_VIEW_ID, database_id: DATABASE_ID, width: 6 },
            { id: 'w:2', view_id: OWNED_VIEW_ID, database_id: DATABASE_ID, width: 6, zz_widget: 1 },
          ],
        },
      ]);
      setting.set(YjsDatabaseKey.dashboard_global_filters, []);
      setting.set(YjsDatabaseKey.show_widget_titles, false);
      setting.set('zz_parity_probe', { from: 'newer-app' });
      (source.get(YjsDatabaseKey.layout_settings) as Y.Map<unknown>).set(DASHBOARD_LAYOUT_KEY, setting);
      return databaseDoc;
    }

    /** The server's update that creates `viewId` as a view of the loaded database. */
    function createViewUpdate(databaseDoc: YDoc, viewId: string, payload: CreateDatabaseViewPayload) {
      const serverDoc = new Y.Doc();

      Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(databaseDoc));
      const view = new Y.Map<unknown>();

      view.set(YjsDatabaseKey.id, viewId);
      view.set(YjsDatabaseKey.name, payload.name ?? '');
      view.set(YjsDatabaseKey.layout, payload.layout === ViewLayout.Board ? DatabaseViewLayout.Board : DatabaseViewLayout.Dashboard);
      view.set(YjsDatabaseKey.field_orders, new Y.Array());
      view.set(YjsDatabaseKey.layout_settings, new Y.Map());
      (serverDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
        .get(YjsDatabaseKey.views)
        .set(viewId, view as never);
      return Array.from(Y.encodeStateAsUpdate(serverDoc, Y.encodeStateVector(databaseDoc)));
    }

    function createDuplicateParams(databaseDoc: YDoc) {
      const folder = new Map<string, Partial<View>>([
        ['document-id', { view_id: 'document-id', name: 'Doc', layout: ViewLayout.Document, children: [] }],
        [
          OWNED_VIEW_ID,
          {
            view_id: OWNED_VIEW_ID,
            name: 'Board',
            layout: ViewLayout.Board,
            parent_view_id: 'document-id',
            extra: { embedded: true, dashboard_owner: SOURCE_DASHBOARD_ID },
            children: [],
          },
        ],
      ]);
      const createDatabaseView = jest.fn(async (_viewId: string, payload: CreateDatabaseViewPayload) => {
        const viewId = payload.layout === ViewLayout.Dashboard ? DASHBOARD_VIEW_ID : OWNED_COPY_ID;

        folder.set(viewId, {
          view_id: viewId,
          name: payload.name,
          parent_view_id: payload.parent_view_id,
          extra: { embedded: payload.embedded },
          children: [],
        });
        return { view_id: viewId, database_id: DATABASE_ID, database_update: createViewUpdate(databaseDoc, viewId, payload) };
      });

      return {
        ...createLinkedParams(databaseDoc),
        payload: { ...payload, name: 'Dashboard' },
        sourceViewId: SOURCE_DASHBOARD_ID,
        createDatabaseView,
        loadViewMeta: jest.fn(async (viewId: string) => {
          const view = folder.get(viewId);

          if (!view) throw new Error('View not found');
          return view as View;
        }),
        updatePage: jest.fn(async (viewId: string, update: { extra?: Record<string, unknown> }) => {
          folder.set(viewId, { ...folder.get(viewId), extra: update.extra as View['extra'] });
        }),
        deletePage: jest.fn().mockResolvedValue(undefined),
        folder,
      };
    }

    it('refuses a linked dashboard copy offline before creating or modifying anything', async () => {
      const databaseDoc = createSourceDoc();
      const params = createDuplicateParams(databaseDoc);
      const before = Y.encodeStateAsUpdate(databaseDoc);
      const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      try {
        await expect(duplicateLinkedDatabaseDashboardView(params)).rejects.toThrow(
          'Connect to the internet to create dashboard widget views.'
        );
        expect(params.createDatabaseView).not.toHaveBeenCalled();
        expect(params.loadView).toHaveBeenCalledWith(SOURCE_DASHBOARD_ID, false, false, { databaseId: DATABASE_ID });
        expect(params.updatePage).not.toHaveBeenCalled();
        expect(params.deletePage).not.toHaveBeenCalled();
        expect(Y.encodeStateAsUpdate(databaseDoc)).toEqual(before);
      } finally {
        online.mockRestore();
      }
    });

    it('copies the whole layout and gives the copy its own copies of the owned views', async () => {
      const databaseDoc = createSourceDoc();
      const params = createDuplicateParams(databaseDoc);

      const response = await duplicateLinkedDatabaseDashboardView(params);
      const views = getDatabase(databaseDoc).get(YjsDatabaseKey.views);
      const stored = toPlainValue(views.get(DASHBOARD_VIEW_ID)?.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY));

      expect(response.view_id).toBe(DASHBOARD_VIEW_ID);
      expect(stored).toEqual({
        rows: [
          {
            id: 'r:1',
            height: 360,
            widgets: [
              { id: 'w:1', view_id: GRID_VIEW_ID, database_id: DATABASE_ID, width: 6 },
              { id: 'w:2', view_id: OWNED_COPY_ID, database_id: DATABASE_ID, width: 6, zz_widget: 1 },
            ],
          },
        ],
        global_filters: [],
        show_widget_titles: false,
        zz_parity_probe: { from: 'newer-app' },
      });
      // The owned copy is placed next to its source, under the document, and belongs to the copy.
      expect(params.createDatabaseView).toHaveBeenLastCalledWith(
        OWNED_VIEW_ID,
        expect.objectContaining({ parent_view_id: 'document-id', layout: ViewLayout.Board, name: 'Board', embedded: true })
      );
      expect(views.get(OWNED_COPY_ID)?.get(YjsDatabaseKey.dashboard_owner)).toBe(DASHBOARD_VIEW_ID);
      expect(params.folder.get(OWNED_COPY_ID)?.extra).toEqual({ embedded: true, dashboard_owner: DASHBOARD_VIEW_ID });
      // The source block's dashboard is untouched.
      expect(readDashboardLayoutSetting(getDatabase(databaseDoc), SOURCE_DASHBOARD_ID).rows[0].widgets[1].viewId).toBe(
        OWNED_VIEW_ID
      );
      expect(params.flush).toHaveBeenCalled();
      expect(params.scheduleDeferredCleanup).toHaveBeenCalledWith(databaseDoc.guid);
      // A duplicate opens like any existing dashboard (R-MODE: duplicates are not marked, as on desktop).
      expect(wasDashboardCreatedThisSession(DASHBOARD_VIEW_ID)).toBe(false);
    });

    it('removes the new dashboard and rethrows when copying an owned view fails', async () => {
      const databaseDoc = createSourceDoc();
      const params = createDuplicateParams(databaseDoc);
      const create = params.createDatabaseView.getMockImplementation()!;

      params.createDatabaseView.mockImplementationOnce(create).mockRejectedValueOnce(new Error('quota'));

      await expect(duplicateLinkedDatabaseDashboardView(params)).rejects.toThrow('quota');
      expect(getDatabase(databaseDoc).get(YjsDatabaseKey.views).has(DASHBOARD_VIEW_ID)).toBe(false);
      expect(params.deletePage).toHaveBeenCalledWith(DASHBOARD_VIEW_ID);
      expect(Log.warn).not.toHaveBeenCalledWith(
        '[Dashboard creation] failed to seed the linked dashboard setting',
        expect.anything()
      );
      expect(wasDashboardCreatedThisSession(DASHBOARD_VIEW_ID)).toBe(false);
    });

    it('removes the new dashboard and rethrows when the database cannot be loaded', async () => {
      const databaseDoc = createSourceDoc();
      const params = createDuplicateParams(databaseDoc);

      params.loadView.mockRejectedValue(new Error('offline'));

      await expect(duplicateLinkedDatabaseDashboardView(params)).rejects.toThrow('offline');
      expect(params.deletePage).toHaveBeenCalledWith(DASHBOARD_VIEW_ID);
      expect(params.bindViewSync).not.toHaveBeenCalled();
    });

    it.each(['loadView', 'loadViewMeta', 'updatePage', 'deletePage'] as const)(
      'refuses to duplicate without %s, before the server creates anything',
      async (missing) => {
        const databaseDoc = createSourceDoc();
        const params = createDuplicateParams(databaseDoc);

        await expect(
          createLinkedDatabaseViewForLayout(ViewLayout.Dashboard, { ...params, duplicate: true, [missing]: undefined })
        ).rejects.toThrow('The linked dashboard could not be duplicated right now');
        // All or nothing: no view exists, so there is nothing to remove.
        expect(params.createDatabaseView).not.toHaveBeenCalled();
        expect(getDatabase(databaseDoc).get(YjsDatabaseKey.views).has(DASHBOARD_VIEW_ID)).toBe(false);
      }
    );

    it('goes through the layout table: a duplicated block copies, a new linked block starts empty', async () => {
      const copiedDoc = createSourceDoc();
      const copied = await createLinkedDatabaseViewForLayout(ViewLayout.Dashboard, {
        ...createDuplicateParams(copiedDoc),
        duplicate: true,
      });
      const emptyDoc = createSourceDoc();
      const empty = await createLinkedDatabaseViewForLayout(ViewLayout.Dashboard, {
        ...createDuplicateParams(emptyDoc),
        duplicate: false,
      });

      // Both creators apply the server's update themselves.
      expect(copied.databaseUpdatePending).toBe(false);
      expect(empty.databaseUpdatePending).toBe(false);
      expect(readDashboardLayoutSetting(getDatabase(copiedDoc), DASHBOARD_VIEW_ID).rows).toHaveLength(1);
      expect(readDashboardLayoutSetting(getDatabase(emptyDoc), DASHBOARD_VIEW_ID).rows).toEqual([]);
      expect(getDatabase(emptyDoc).get(YjsDatabaseKey.views).has(OWNED_COPY_ID)).toBe(false);
    });
  });
});
