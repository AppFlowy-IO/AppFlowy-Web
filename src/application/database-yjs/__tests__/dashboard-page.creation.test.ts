import * as Y from 'yjs';

import { createDatabaseDashboardPageViaGrid, NEW_DASHBOARD_VIEW_NAME } from '@/application/database-yjs/dashboard-page';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { DatabaseViewLayout, ViewLayout, YDatabase, YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

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

describe('createDatabaseDashboardPageViaGrid', () => {
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
