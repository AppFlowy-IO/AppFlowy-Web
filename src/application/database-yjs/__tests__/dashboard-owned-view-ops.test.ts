import { expect } from '@jest/globals';
import * as Y from 'yjs';

import {
  convertViewToDashboard,
  createOwnedDatabaseView,
  DASHBOARD_OWNER_RETRY_DELAYS_MS,
  duplicateDashboardOwnedWidgets,
  duplicateOwnedDatabaseView,
  markDashboardOwnedView,
  renameDatabaseViewInDoc,
  repairDashboardOwnerMarkers,
} from '@/application/database-yjs/dashboard-owned-view-ops';
import { readDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { DASHBOARD_LAYOUT_KEY } from '@/application/database-yjs/dashboard.type';
import { DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT, DatabaseViewDocDeps } from '@/application/database-yjs/dispatch';
import { executeDatabaseOperations, getOrCreateDatabaseHistoryManager, runDatabaseAction } from '@/application/database-yjs/history';
import { toPlainValue } from '@/application/database-yjs/layout-codec';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateDatabaseViewPayload,
  DatabaseViewLayout,
  UpdatePagePayload,
  View,
  ViewLayout,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';
import { Log } from '@/utils/log';

import { normalizeNumbers, setParityValue } from './dashboard-parity-helpers';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

const HOST_DB = 'db:host';
const FOREIGN_DB = 'db:tasks';
const CONTAINER = 'c:projects';
const FOREIGN_CONTAINER = 'c:tasks';

const VIEW_LAYOUT_TO_DATABASE_LAYOUT = new Map(
  Object.entries(DATABASE_VIEW_LAYOUT_TO_VIEW_LAYOUT).map(([layout, viewLayout]) => [viewLayout, Number(layout)])
);

function getDatabase(doc: YDoc) {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
}

function getView(doc: YDoc, viewId: string) {
  return getDatabase(doc).get(YjsDatabaseKey.views).get(viewId);
}

function createDatabaseDoc(databaseId: string, views: { id: string; name: string; layout: DatabaseViewLayout }[]) {
  const doc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map<unknown>();
  const viewMap = new Y.Map<Y.Map<unknown>>();

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.views, viewMap);
  views.forEach(({ id, name, layout }) => {
    const view = new Y.Map<unknown>();

    view.set(YjsDatabaseKey.id, id);
    view.set(YjsDatabaseKey.name, name);
    view.set(YjsDatabaseKey.layout, layout);
    view.set(YjsDatabaseKey.field_orders, Y.Array.from([{ id: 'f:name' }]));
    view.set(YjsDatabaseKey.layout_settings, new Y.Map());
    viewMap.set(id, view);
  });
  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  return doc;
}

/**
 * A server that owns the folder: creating a database view adds a folder view
 * and returns the database update that creates it; `updatePage` replaces the
 * `extra` like the real server does.
 */
class FakeWorkspace {
  folder = new Map<string, View>();

  docs = new Map<string, YDoc>();

  private nextId = 1;

  addFolderView(view: Partial<View> & { view_id: string; parent_view_id?: string }) {
    this.folder.set(view.view_id, {
      name: view.view_id,
      icon: null,
      layout: ViewLayout.Grid,
      children: [],
      is_published: false,
      is_private: false,
      extra: {},
      ...view,
    } as View);
  }

  meta = (viewId: string): View => {
    const view = this.folder.get(viewId);

    if (!view) throw new Error(`View not found: ${viewId}`);
    const children = Array.from(this.folder.values()).filter((child) => child.parent_view_id === viewId);

    return { ...view, extra: view.extra ? { ...view.extra } : view.extra, children };
  };

  loadViewMeta = jest.fn(async (viewId: string) => this.meta(viewId));

  updatePage = jest.fn(async (viewId: string, payload: UpdatePagePayload) => {
    const view = this.folder.get(viewId);

    if (!view) throw new Error('not found');
    this.folder.set(viewId, {
      ...view,
      name: payload.name,
      ...(payload.extra !== undefined ? { extra: payload.extra as View['extra'] } : {}),
    });
  });

  deletePage = jest.fn(async (viewId: string) => {
    this.folder.delete(viewId);
  });

  createDatabaseView = jest.fn(async (_requestViewId: string, payload: CreateDatabaseViewPayload) => {
    const doc = this.docs.get(payload.database_id);

    if (!doc) throw new Error('database not found');
    const viewId = `v:new-${this.nextId++}`;
    const server = new Y.Doc();

    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    const views = (server.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase).get(
      YjsDatabaseKey.views
    );
    const view = new Y.Map<unknown>();

    view.set(YjsDatabaseKey.id, viewId);
    view.set(YjsDatabaseKey.name, payload.name ?? '');
    view.set(YjsDatabaseKey.layout, VIEW_LAYOUT_TO_DATABASE_LAYOUT.get(payload.layout));
    view.set(YjsDatabaseKey.field_orders, Y.Array.from([{ id: 'f:name' }]));
    views.set(viewId, view as never);
    this.addFolderView({
      view_id: viewId,
      name: payload.name ?? '',
      layout: payload.layout,
      parent_view_id: payload.parent_view_id,
      extra: { database_id: payload.database_id, embedded: payload.embedded, server_managed: 'keep-me' },
    });
    return {
      view_id: viewId,
      database_id: payload.database_id,
      database_update: Array.from(Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc))),
    };
  });

  flush = jest.fn(async () => true);

  loadView = jest.fn(async (_viewId: string, _sub?: boolean, _awareness?: boolean, options?: { databaseId?: string | null }) => {
    const doc = options?.databaseId ? this.docs.get(options.databaseId) : undefined;

    if (!doc) throw new Error('no doc');
    return doc;
  });

  bindViewSync = jest.fn((doc: YDoc) => ({ doc, flush: this.flush } as unknown as SyncContext));

  scheduleDeferredCleanup = jest.fn();

  deps(hostDoc: YDoc, overrides: Partial<DatabaseViewDocDeps> = {}): DatabaseViewDocDeps {
    return {
      databaseDoc: hostDoc,
      databasePageId: CONTAINER,
      activeViewId: 'v:dash',
      readOnly: false,
      canWrite: true,
      createDatabaseView: this.createDatabaseView,
      deletePage: this.deletePage,
      loadViewMeta: this.loadViewMeta,
      updatePage: this.updatePage,
      loadView: this.loadView,
      bindViewSync: this.bindViewSync,
      scheduleDeferredCleanup: this.scheduleDeferredCleanup,
      ...overrides,
    };
  }
}

function setup() {
  const workspace = new FakeWorkspace();
  const hostDoc = createDatabaseDoc(HOST_DB, [
    { id: 'v:grid', name: 'Projects Grid', layout: DatabaseViewLayout.Grid },
    { id: 'v:board', name: 'Board', layout: DatabaseViewLayout.Board },
    { id: 'v:dash', name: 'Dashboard', layout: DatabaseViewLayout.Dashboard },
  ]);
  const foreignDoc = createDatabaseDoc(FOREIGN_DB, [{ id: 'v:tasks', name: 'Tasks Grid', layout: DatabaseViewLayout.Grid }]);

  workspace.docs.set(HOST_DB, hostDoc);
  workspace.docs.set(FOREIGN_DB, foreignDoc);
  workspace.addFolderView({ view_id: CONTAINER, name: 'Projects', extra: { is_database_container: true, database_id: HOST_DB } });
  workspace.addFolderView({ view_id: FOREIGN_CONTAINER, name: 'Tasks', extra: { is_database_container: true, database_id: FOREIGN_DB } });
  workspace.addFolderView({ view_id: 'v:grid', name: 'Projects Grid', parent_view_id: CONTAINER, extra: { database_id: HOST_DB } });
  workspace.addFolderView({ view_id: 'v:board', name: 'Board', parent_view_id: CONTAINER, layout: ViewLayout.Board, extra: { database_id: HOST_DB } });
  workspace.addFolderView({ view_id: 'v:dash', name: 'Dashboard', parent_view_id: CONTAINER, layout: ViewLayout.Dashboard, extra: { database_id: HOST_DB } });
  workspace.addFolderView({ view_id: 'v:tasks', name: 'Tasks Grid', parent_view_id: FOREIGN_CONTAINER, extra: { database_id: FOREIGN_DB } });
  return { workspace, hostDoc, foreignDoc };
}

function setDashboardRows(doc: YDoc, viewId: string, rows: unknown[], extra: Record<string, unknown> = {}) {
  const setting = new Y.Map<unknown>();

  setting.set(YjsDatabaseKey.dashboard_rows, rows);
  setting.set(YjsDatabaseKey.dashboard_global_filters, []);
  Object.entries(extra).forEach(([key, value]) => setting.set(key, value));
  getView(doc, viewId).get(YjsDatabaseKey.layout_settings).set(DASHBOARD_LAYOUT_KEY, setting as never);
}

function widget(id: string, viewId: string, databaseId: string, width = 6) {
  return { id, view_id: viewId, database_id: databaseId, width };
}

function prepareRedo(doc: YDoc) {
  const manager = getOrCreateDatabaseHistoryManager(doc);

  runDatabaseAction(doc, { type: 'database.test-marker' }, () => {
    getDatabase(doc).set('history-marker' as never, true as never);
  });
  manager.undo();
  expect(manager.canRedo()).toBe(true);
  return manager;
}

const noSleep = () => Promise.resolve();

beforeEach(() => {
  jest.spyOn(Log, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('markDashboardOwnedView', () => {
  it('writes the collab mirror first, then merges the owner into the fresh folder extra', async () => {
    const { workspace, hostDoc } = setup();
    const manager = prepareRedo(hostDoc);

    workspace.folder.set('v:board', {
      ...workspace.meta('v:board'),
      icon: { ty: 0, value: '📋' },
      extra: { database_id: HOST_DB, embedded: false, future_key: { a: 1 } },
    } as View);
    const written = await markDashboardOwnedView(workspace.deps(hostDoc), 'v:board', 'v:dash');

    expect(written).toBe(true);
    expect(getView(hostDoc, 'v:board').get(YjsDatabaseKey.dashboard_owner)).toBe('v:dash');
    expect(workspace.loadViewMeta).toHaveBeenCalledWith('v:board', undefined, { authoritative: true });
    expect(workspace.updatePage).toHaveBeenCalledWith('v:board', {
      name: 'Board',
      icon: { ty: 0, value: '📋' },
      extra: { database_id: HOST_DB, embedded: false, future_key: { a: 1 }, dashboard_owner: 'v:dash' },
    });
    // The mirror is not an undo step and keeps the redo stack.
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(true);
  });

  it('retries the folder write and resolves once a later attempt succeeds', async () => {
    const { workspace, hostDoc } = setup();
    const sleep = jest.fn(noSleep);

    workspace.updatePage.mockRejectedValueOnce(new Error('502')).mockRejectedValueOnce(new Error('502'));
    await expect(markDashboardOwnedView(workspace.deps(hostDoc), 'v:board', 'v:dash', { sleep })).resolves.toBe(true);
    expect(workspace.updatePage).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(DASHBOARD_OWNER_RETRY_DELAYS_MS.slice(0, 2));
    expect(workspace.folder.get('v:board')?.extra?.dashboard_owner).toBe('v:dash');
  });

  it('keeps the mirror and logs when every folder attempt fails', async () => {
    const { workspace, hostDoc } = setup();
    const sleep = jest.fn(noSleep);

    workspace.updatePage.mockRejectedValue(new Error('offline'));
    await expect(markDashboardOwnedView(workspace.deps(hostDoc), 'v:board', 'v:dash', { sleep })).resolves.toBe(false);
    expect(workspace.updatePage).toHaveBeenCalledTimes(DASHBOARD_OWNER_RETRY_DELAYS_MS.length + 1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 1000, 4000]);
    expect(getView(hostDoc, 'v:board').get(YjsDatabaseKey.dashboard_owner)).toBe('v:dash');
    expect(Log.warn).toHaveBeenCalledWith(
      '[Dashboard] failed to write the owner marker to the folder',
      expect.objectContaining({ viewId: 'v:board', owner: 'v:dash' })
    );
  });

  it('skips a folder write that is already in place', async () => {
    const { workspace, hostDoc } = setup();

    workspace.folder.set('v:board', { ...workspace.meta('v:board'), extra: { dashboard_owner: 'v:dash' } } as View);
    await expect(markDashboardOwnedView(workspace.deps(hostDoc), 'v:board', 'v:dash')).resolves.toBe(true);
    expect(workspace.updatePage).not.toHaveBeenCalled();
  });
});

describe('repairDashboardOwnerMarkers', () => {
  it('rewrites the missing copy of each marker of this dashboard, in the host and a widget source', async () => {
    const { workspace, hostDoc, foreignDoc } = setup();

    // Mirror only (the folder PATCH failed): the folder gets the marker.
    executeDatabaseOperations(hostDoc.getMap(YjsEditorKey.data_section) as YSharedRoot, [
      () => getView(hostDoc, 'v:board').set(YjsDatabaseKey.dashboard_owner, 'v:dash'),
    ], 'test');
    // Folder only (an older copy dropped the mirror): the mirror gets it.
    workspace.folder.set('v:tasks', { ...workspace.meta('v:tasks'), extra: { database_id: FOREIGN_DB, dashboard_owner: 'v:dash' } } as View);
    // Owned by another dashboard: untouched.
    workspace.folder.set('v:grid', { ...workspace.meta('v:grid'), extra: { dashboard_owner: 'v:other' } } as View);

    const rows = readDashboardLayoutSetting(undefined, 'none').rows;
    const repaired = await repairDashboardOwnerMarkers(
      workspace.deps(hostDoc),
      'v:dash',
      [
        ...rows,
        {
          id: 'r:1',
          height: 360,
          widgets: [
            { id: 'w:1', viewId: 'v:board', databaseId: HOST_DB, width: 4 },
            { id: 'w:2', viewId: 'v:tasks', databaseId: FOREIGN_DB, width: 4 },
            { id: 'w:3', viewId: 'v:grid', databaseId: HOST_DB, width: 4 },
          ],
        },
      ],
      { sleep: noSleep }
    );

    expect(repaired).toBe(2);
    expect(workspace.folder.get('v:board')?.extra?.dashboard_owner).toBe('v:dash');
    expect(getView(foreignDoc, 'v:tasks').get(YjsDatabaseKey.dashboard_owner)).toBe('v:dash');
    expect(getView(hostDoc, 'v:grid').get(YjsDatabaseKey.dashboard_owner)).toBeUndefined();
    expect(workspace.bindViewSync).toHaveBeenCalledWith(foreignDoc, { retain: true });
    expect(workspace.scheduleDeferredCleanup).toHaveBeenCalledWith(foreignDoc.guid);
  });
});

describe('createOwnedDatabaseView', () => {
  it('creates a numbered, owned view next to its anchor in the host database', async () => {
    const { workspace, hostDoc } = setup();
    const viewId = await createOwnedDatabaseView(workspace.deps(hostDoc), {
      databaseId: HOST_DB,
      anchorViewId: 'v:grid',
      layout: DatabaseViewLayout.Board,
      baseName: 'Board',
      owner: 'v:dash',
    });

    expect(workspace.createDatabaseView).toHaveBeenCalledWith(
      'v:grid',
      expect.objectContaining({ parent_view_id: CONTAINER, layout: ViewLayout.Board, name: 'Board (1)', embedded: false })
    );
    expect(getView(hostDoc, viewId).get(YjsDatabaseKey.dashboard_owner)).toBe('v:dash');
    expect(workspace.folder.get(viewId)?.extra).toEqual({
      database_id: HOST_DB,
      embedded: false,
      server_managed: 'keep-me',
      dashboard_owner: 'v:dash',
    });
  });

  it('opens a widget source database with a retained sync owner and releases it', async () => {
    const { workspace, hostDoc, foreignDoc } = setup();
    const viewId = await createOwnedDatabaseView(workspace.deps(hostDoc), {
      databaseId: FOREIGN_DB,
      anchorViewId: 'v:tasks',
      layout: DatabaseViewLayout.Board,
      baseName: 'Board',
      owner: 'v:dash',
    });

    expect(workspace.loadView).toHaveBeenCalledWith('v:tasks', false, false, { databaseId: FOREIGN_DB });
    expect(workspace.createDatabaseView).toHaveBeenCalledWith(
      'v:tasks',
      expect.objectContaining({ parent_view_id: FOREIGN_CONTAINER, database_id: FOREIGN_DB, name: 'Board' })
    );
    expect(getView(foreignDoc, viewId).get(YjsDatabaseKey.dashboard_owner)).toBe('v:dash');
    expect(getDatabase(hostDoc).get(YjsDatabaseKey.views).has(viewId)).toBe(false);
    expect(workspace.flush).toHaveBeenCalled();
    expect(workspace.scheduleDeferredCleanup).toHaveBeenCalledWith(foreignDoc.guid);
  });
});

describe('duplicateOwnedDatabaseView', () => {
  it('copies the whole configuration, never the source owner, and appends the copy', async () => {
    const { workspace, hostDoc } = setup();
    const source = getView(hostDoc, 'v:board');
    const filters = new Y.Array<Y.Map<unknown>>();
    const filter = new Y.Map<unknown>();
    const sorts = new Y.Array<Y.Map<unknown>>();
    const sort = new Y.Map<unknown>();
    const groups = new Y.Array<Y.Map<unknown>>();
    const group = new Y.Map<unknown>();
    const chart = new Y.Map<unknown>();

    hostDoc.transact(() => {
      filter.set(YjsDatabaseKey.id, 'filter-1');
      filter.set(YjsDatabaseKey.field_id, 'f:status');
      filters.push([filter]);
      sort.set(YjsDatabaseKey.id, 'sort-1');
      sorts.push([sort]);
      group.set(YjsDatabaseKey.field_id, 'f:status');
      groups.push([group]);
      chart.set('chart_type', 1);
      chart.set('zz_parity_probe', { from: 'newer-app' });
      source.set(YjsDatabaseKey.filters, filters);
      source.set(YjsDatabaseKey.sorts, sorts);
      source.set(YjsDatabaseKey.groups, groups);
      source.get(YjsDatabaseKey.layout_settings).set('3', chart as never);
      source.set(YjsDatabaseKey.dashboard_owner, 'v:old-owner');
    });

    const copyId = await duplicateOwnedDatabaseView(workspace.deps(hostDoc), {
      sourceViewId: 'v:board',
      owner: 'v:dash',
      name: 'Board',
    });
    const copy = getView(hostDoc, copyId);

    expect(workspace.createDatabaseView).toHaveBeenCalledWith(
      'v:dash',
      // Appended after the last child, not inserted before the source.
      expect.objectContaining({ name: 'Board', prev_view_id: 'v:dash', layout: ViewLayout.Board })
    );
    expect(toPlainValue(copy.get(YjsDatabaseKey.filters))).toEqual(toPlainValue(filters));
    expect(toPlainValue(copy.get(YjsDatabaseKey.sorts))).toEqual(toPlainValue(sorts));
    expect(toPlainValue(copy.get(YjsDatabaseKey.groups))).toEqual(toPlainValue(groups));
    expect(toPlainValue(copy.get(YjsDatabaseKey.layout_settings).get('3'))).toEqual({
      chart_type: 1,
      zz_parity_probe: { from: 'newer-app' },
    });
    expect(copy.get(YjsDatabaseKey.dashboard_owner)).toBe('v:dash');
    expect(source.get(YjsDatabaseKey.dashboard_owner)).toBe('v:old-owner');
  });
});

describe('duplicateOwnedDatabaseView with settings a native client wrote', () => {
  it('copies integers stored as bigints (Yjs refuses to author those directly)', async () => {
    const { workspace, hostDoc } = setup();
    const source = getView(hostDoc, 'v:board');
    const fieldSettings = new Y.Map<Y.Map<unknown>>();
    const setting = new Y.Map<unknown>();
    const groups = new Y.Array<Y.Map<unknown>>();
    const group = new Y.Map<unknown>();

    hostDoc.transact(() => {
      source.set(YjsDatabaseKey.field_settings, fieldSettings);
      fieldSettings.set('f:name', setting);
      setParityValue(setting, 'width', BigInt(150));
      setParityValue(setting, 'visibility', BigInt(1));
      source.set(YjsDatabaseKey.groups, groups);
      groups.push([group]);
      setParityValue(group, 'ty', BigInt(3));
      group.set(YjsDatabaseKey.field_id, 'f:status');
    });
    expect(typeof setting.get('width')).toBe('bigint');

    const copyId = await duplicateOwnedDatabaseView(workspace.deps(hostDoc), {
      sourceViewId: 'v:board',
      owner: 'v:dash',
      name: 'Board',
    });
    const copy = getView(hostDoc, copyId);

    expect(normalizeNumbers(toPlainValue(copy.get(YjsDatabaseKey.field_settings)))).toEqual({
      'f:name': { width: 150, visibility: 1 },
    });
    expect(normalizeNumbers(toPlainValue(copy.get(YjsDatabaseKey.groups)))).toEqual([{ ty: 3, field_id: 'f:status' }]);
  });
});

describe('renameDatabaseViewInDoc', () => {
  it('renames the folder view and the collab view, and ignores empty or unchanged names', async () => {
    const { workspace, hostDoc } = setup();
    const params = { doc: hostDoc, viewId: 'v:board', updatePage: workspace.updatePage };

    await expect(renameDatabaseViewInDoc({ ...params, name: '  Pipeline  ' })).resolves.toBe(true);
    expect(workspace.updatePage).toHaveBeenCalledWith('v:board', { name: 'Pipeline' });
    expect(getView(hostDoc, 'v:board').get(YjsDatabaseKey.name)).toBe('Pipeline');
    await expect(renameDatabaseViewInDoc({ ...params, name: '   ' })).resolves.toBe(false);
    await expect(renameDatabaseViewInDoc({ ...params, name: 'Pipeline' })).resolves.toBe(false);
    expect(workspace.updatePage).toHaveBeenCalledTimes(1);
  });
});

describe('convertViewToDashboard', () => {
  function applyDashboardLayout(doc: YDoc, viewId: string) {
    return jest.fn(() => {
      executeDatabaseOperations(doc.getMap(YjsEditorKey.data_section) as YSharedRoot, [
        () => getView(doc, viewId).set(YjsDatabaseKey.layout, DatabaseViewLayout.Dashboard),
      ], 'updateDatabaseLayout');
    });
  }

  it('creates the owned copy, seeds it as the first widget outside undo, then switches the layout', async () => {
    const { workspace, hostDoc } = setup();
    const manager = getOrCreateDatabaseHistoryManager(hostDoc);
    const applyLayout = applyDashboardLayout(hostDoc, 'v:board');

    await expect(convertViewToDashboard(workspace.deps(hostDoc), { viewId: 'v:board', applyLayout })).resolves.toBe(true);

    const copyId = workspace.createDatabaseView.mock.results[0] && (await workspace.createDatabaseView.mock.results[0].value).view_id;
    const setting = readDashboardLayoutSetting(getDatabase(hostDoc), 'v:board');

    expect(applyLayout).toHaveBeenCalledTimes(1);
    expect(getView(hostDoc, 'v:board').get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Dashboard);
    expect(setting.rows).toHaveLength(1);
    expect(setting.rows[0].height).toBe(360);
    expect(setting.rows[0].widgets).toEqual([
      expect.objectContaining({ viewId: copyId, databaseId: HOST_DB, width: 12 }),
    ]);
    expect(getView(hostDoc, copyId).get(YjsDatabaseKey.name)).toBe('Board');
    expect(getView(hostDoc, copyId).get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Board);
    expect(getView(hostDoc, copyId).get(YjsDatabaseKey.dashboard_owner)).toBe('v:board');
    expect(workspace.folder.get(copyId)?.extra?.dashboard_owner).toBe('v:board');

    // Only the layout change is an undo step: undo restores the Board and keeps the seed.
    manager.undo();
    expect(getView(hostDoc, 'v:board').get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Board);
    expect(readDashboardLayoutSetting(getDatabase(hostDoc), 'v:board').rows).toHaveLength(1);
  });

  it('only switches a view converted before, without a new copy', async () => {
    const { workspace, hostDoc } = setup();
    const applyLayout = applyDashboardLayout(hostDoc, 'v:board');

    setDashboardRows(hostDoc, 'v:board', [{ id: 'r:1', height: 360, widgets: [widget('w:1', 'v:grid', HOST_DB, 12)] }]);
    await expect(convertViewToDashboard(workspace.deps(hostDoc), { viewId: 'v:board', applyLayout })).resolves.toBe(true);
    expect(workspace.createDatabaseView).not.toHaveBeenCalled();
    expect(applyLayout).toHaveBeenCalledTimes(1);
    expect(readDashboardLayoutSetting(getDatabase(hostDoc), 'v:board').rows[0].widgets[0].viewId).toBe('v:grid');
  });

  it('deletes the copy and undoes the seed when the layout change fails', async () => {
    const { workspace, hostDoc } = setup();
    const applyLayout = jest.fn(() => {
      throw new Error('layout failed');
    });

    await expect(convertViewToDashboard(workspace.deps(hostDoc), { viewId: 'v:board', applyLayout })).rejects.toThrow(
      'layout failed'
    );
    const copyId = (await workspace.createDatabaseView.mock.results[0].value).view_id;

    expect(workspace.deletePage).toHaveBeenCalledWith(copyId);
    expect(getDatabase(hostDoc).get(YjsDatabaseKey.views).has(copyId)).toBe(false);
    expect(readDashboardLayoutSetting(getDatabase(hostDoc), 'v:board').rows).toEqual([]);
    expect(getView(hostDoc, 'v:board').get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Board);
  });

  it('changes nothing when creating the copy fails', async () => {
    const { workspace, hostDoc } = setup();
    const applyLayout = jest.fn();

    workspace.createDatabaseView.mockRejectedValueOnce(new Error('Upgrade to Pro'));
    await expect(convertViewToDashboard(workspace.deps(hostDoc), { viewId: 'v:board', applyLayout })).rejects.toThrow(
      'Upgrade to Pro'
    );
    expect(applyLayout).not.toHaveBeenCalled();
    expect(getView(hostDoc, 'v:board').get(YjsDatabaseKey.layout_settings).get(DASHBOARD_LAYOUT_KEY)).toBeUndefined();
  });

  it('removes the copy and keeps the layout when a later choice superseded the conversion', async () => {
    const { workspace, hostDoc } = setup();
    const applyLayout = jest.fn();

    await expect(
      convertViewToDashboard(workspace.deps(hostDoc), { viewId: 'v:board', applyLayout, isCurrent: () => false })
    ).resolves.toBe(false);
    const copyId = (await workspace.createDatabaseView.mock.results[0].value).view_id;

    expect(applyLayout).not.toHaveBeenCalled();
    expect(getDatabase(hostDoc).get(YjsDatabaseKey.views).has(copyId)).toBe(false);
    expect(workspace.deletePage).toHaveBeenCalledWith(copyId);
  });
});

describe('duplicateDashboardOwnedWidgets', () => {
  function seedOwnedDashboard(workspace: FakeWorkspace, hostDoc: YDoc, foreignDoc: YDoc) {
    // v:board (host) and v:tasks (foreign) belong to v:dash; v:grid is shared.
    hostDoc.transact(() => getView(hostDoc, 'v:board').set(YjsDatabaseKey.dashboard_owner, 'v:dash'));
    workspace.folder.set('v:tasks', {
      ...workspace.meta('v:tasks'),
      extra: { database_id: FOREIGN_DB, dashboard_owner: 'v:dash' },
    } as View);
    void foreignDoc;
    const rows = [
      { id: 'r:1', height: 360, zz_row: 1, widgets: [widget('w:1', 'v:grid', HOST_DB), widget('w:2', 'v:board', HOST_DB)] },
      { id: 'r:2', height: 360, widgets: [{ ...widget('w:3', 'v:tasks', FOREIGN_DB, 12), zz_widget: true }] },
    ];

    setDashboardRows(hostDoc, 'v:dash', rows, { show_widget_titles: false, zz_parity_probe: 'keep' });
    // The duplicate already holds a full copy of the source's layout setting.
    hostDoc.transact(() => {
      const copy = new Y.Map<unknown>();

      copy.set(YjsDatabaseKey.id, 'v:dash-copy');
      copy.set(YjsDatabaseKey.layout, DatabaseViewLayout.Dashboard);
      copy.set(YjsDatabaseKey.layout_settings, new Y.Map());
      getDatabase(hostDoc).get(YjsDatabaseKey.views).set('v:dash-copy', copy as never);
    });
    setDashboardRows(hostDoc, 'v:dash-copy', rows, { show_widget_titles: false, zz_parity_probe: 'keep' });
    workspace.addFolderView({ view_id: 'v:dash-copy', name: 'Dashboard (Copy)', parent_view_id: CONTAINER, layout: ViewLayout.Dashboard });
  }

  it('copies the owned views for the new dashboard, remaps its widgets and keeps shared views', async () => {
    const { workspace, hostDoc, foreignDoc } = setup();

    seedOwnedDashboard(workspace, hostDoc, foreignDoc);
    const viewIdMap = await duplicateDashboardOwnedWidgets(workspace.deps(hostDoc), {
      sourceDashboardViewId: 'v:dash',
      targetDashboardViewId: 'v:dash-copy',
    });

    expect(Object.keys(viewIdMap).sort()).toEqual(['v:board', 'v:tasks']);
    const boardCopy = viewIdMap['v:board'];
    const tasksCopy = viewIdMap['v:tasks'];
    const stored = toPlainValue(getView(hostDoc, 'v:dash-copy').get(YjsDatabaseKey.layout_settings).get(DASHBOARD_LAYOUT_KEY)) as {
      rows: { widgets: { view_id: string; database_id: string }[] }[];
    };

    expect(stored).toEqual(
      expect.objectContaining({
        rows: [
          { id: 'r:1', height: 360, zz_row: 1, widgets: [widget('w:1', 'v:grid', HOST_DB), widget('w:2', boardCopy, HOST_DB)] },
          { id: 'r:2', height: 360, widgets: [{ ...widget('w:3', tasksCopy, FOREIGN_DB, 12), zz_widget: true }] },
        ],
        show_widget_titles: false,
        zz_parity_probe: 'keep',
      })
    );
    // The source dashboard is untouched.
    expect(readDashboardLayoutSetting(getDatabase(hostDoc), 'v:dash').rows[0].widgets[1].viewId).toBe('v:board');
    expect(getView(hostDoc, boardCopy).get(YjsDatabaseKey.name)).toBe('Board');
    expect(getView(hostDoc, boardCopy).get(YjsDatabaseKey.dashboard_owner)).toBe('v:dash-copy');
    expect(getView(foreignDoc, tasksCopy).get(YjsDatabaseKey.name)).toBe('Tasks Grid');
    expect(getView(foreignDoc, tasksCopy).get(YjsDatabaseKey.dashboard_owner)).toBe('v:dash-copy');
    expect(workspace.folder.get(tasksCopy)?.parent_view_id).toBe(FOREIGN_CONTAINER);
    expect(getView(hostDoc, 'v:grid').get(YjsDatabaseKey.dashboard_owner)).toBeUndefined();
    expect(workspace.createDatabaseView).toHaveBeenCalledTimes(2);
  });

  it('deletes every copy it made and rethrows when one copy fails', async () => {
    const { workspace, hostDoc, foreignDoc } = setup();

    seedOwnedDashboard(workspace, hostDoc, foreignDoc);
    const create = workspace.createDatabaseView.getMockImplementation()!;

    workspace.createDatabaseView
      .mockImplementationOnce(create)
      .mockImplementationOnce(async () => {
        throw new Error('quota');
      });

    await expect(
      duplicateDashboardOwnedWidgets(workspace.deps(hostDoc), {
        sourceDashboardViewId: 'v:dash',
        targetDashboardViewId: 'v:dash-copy',
      })
    ).rejects.toThrow('quota');
    const firstCopy = (await workspace.createDatabaseView.mock.results[0].value).view_id;

    expect(getDatabase(hostDoc).get(YjsDatabaseKey.views).has(firstCopy)).toBe(false);
    expect(workspace.folder.has(firstCopy)).toBe(false);
    expect(readDashboardLayoutSetting(getDatabase(hostDoc), 'v:dash-copy').rows[0].widgets[1].viewId).toBe('v:board');
    expect(workspace.scheduleDeferredCleanup).toHaveBeenCalledWith(foreignDoc.guid);
  });

  it('copies nothing for a dashboard without owned views', async () => {
    const { workspace, hostDoc } = setup();

    setDashboardRows(hostDoc, 'v:dash', [{ id: 'r:1', height: 360, widgets: [widget('w:1', 'v:grid', HOST_DB, 12)] }]);
    await expect(
      duplicateDashboardOwnedWidgets(workspace.deps(hostDoc), { sourceDashboardViewId: 'v:other', targetDashboardViewId: 'v:dash' })
    ).resolves.toEqual({});
    expect(workspace.createDatabaseView).not.toHaveBeenCalled();
  });
});
