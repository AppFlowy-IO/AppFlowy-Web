import 'fake-indexeddb/auto';
import { deserialize, serialize } from 'v8';

import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { readPersistedDatabaseSource } from '@/application/database-yjs/creation/source-readiness';
import { readDashboardLayoutSetting, updateDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { db } from '@/application/db';
import { readCollabStates } from '@/application/services/js-services/http/collab-api';
import { initAPIService, getAxios } from '@/application/services/js-services/http/core';
import { saveGoTrueAuth } from '@/application/session/token';
import { DatabaseViewLayout, Types, type View, type YDatabase, type YDatabaseView, type YDoc, YjsDatabaseKey } from '@/application/types';
import { useOwnedWidgetViews } from '@/components/database/dashboard/hooks/useOwnedWidgetViews';
import { updateServerInfo } from '@/utils/server-info';

import type { InternalAxiosRequestConfig } from 'axios';

const SERVER = 'https://test.appflowy.cloud';
const WORKSPACE = '00000000-0000-4000-8000-000000000010';
const DATABASE = '00000000-0000-4000-8000-000000000011';
const CONTAINER = '00000000-0000-4000-8000-000000000012';
const DASHBOARD = '00000000-0000-4000-8000-000000000013';
const SOURCE = '00000000-0000-4000-8000-000000000014';
const SOURCE_OWNER = '00000000-0000-4000-8000-000000000015';
const RESTORE = '00000000-0000-0000-0000-000000000000';
const USER = 'owned-clone-test';
const COPY_PATH = '/v2/page-view/database-view/default';
const LAYOUTS = [1, 2, 3, 5, 6, 7, 8, 9, 10];

jest.mock('@/application/sync-outbox', () => ({
  getCurrentOutboxSession: () => ({ userId: 'owned-clone-test' }),
  getCurrentOutboxSessionGeneration: () => 1,
}));
jest.mock('@/application/services/js-services/http/collab-api', () => ({ readCollabStates: jest.fn() }));
jest.mock('@/application/database-yjs/creation/source-readiness', () => ({
  ...jest.requireActual('@/application/database-yjs/creation/source-readiness'), readPersistedDatabaseSource: jest.fn(),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@atlaskit/pragmatic-drag-and-drop-live-region', () => ({ announce: jest.fn(), cleanup: jest.fn() }));
jest.mock('@/utils/log', () => ({ Log: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() } }));

function database(doc: YDoc) { return (doc as Y.Doc).getMap('data').get('database') as YDatabase; }

function view(doc: YDoc, id: string) { return database(doc).get(YjsDatabaseKey.views).get(id); }

function dataReply(config: InternalAxiosRequestConfig, data: unknown, code = 0) {
  return { config, status: 200, statusText: 'OK', headers: {}, data: { data, code, message: code ? 'retry the same request' : 'OK' } };
}

beforeAll(() => {
  Object.assign(globalThis, { structuredClone: (value: unknown) => deserialize(serialize(value)) });
  initAPIService({ baseURL: SERVER, gotrueURL: SERVER + '/gotrue', wsURL: 'wss://test.appflowy.cloud/ws' });
});
beforeEach(async () => {
  jest.clearAllMocks();
  saveGoTrueAuth(JSON.stringify({ access_token: 'test-owned-token', refresh_token: 'test-owned-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: USER } }));
  updateServerInfo(SERVER, { status: 'available', info: { enable_page_history: true, enable_atomic_creation: true, enable_atomic_creation_defaults: true } });
  await db.open();
  await db.atomic_creation.clear();
});
afterAll(() => db.close());

function fixture(layout: DatabaseViewLayout) {
  const doc = new Y.Doc({ guid: DATABASE }) as YDoc;
  const root = new Y.Map();
  const views = new Y.Map<YDatabaseView>();
  const source = new Y.Map() as YDatabaseView;
  const dashboard = new Y.Map() as YDatabaseView;

  root.set('id', DATABASE); root.set('views', views);
  (doc as Y.Doc).getMap('data').set('database', root);
  source.set(YjsDatabaseKey.id, SOURCE); source.set(YjsDatabaseKey.database_id, DATABASE);
  source.set(YjsDatabaseKey.layout, layout); source.set(YjsDatabaseKey.name, 'Source');
  source.set(YjsDatabaseKey.dashboard_owner, SOURCE_OWNER);
  source.set(YjsDatabaseKey.field_orders, Y.Array.from([{ id: 'name' }]));
  source.set(YjsDatabaseKey.row_orders, Y.Array.from([{ id: 'row', height: 60 }]));
  // Nonempty settings make a default view or a later local copy observably wrong.
  const authored = {
    filters: [{ id: 'filter', field_id: 'name', field_type: 0, condition: 0, content: 'alpha' }],
    sorts: [{ id: 'sort', field_id: 'name', field_type: 0, condition: 1 }],
    groups: [{ id: 'group', field_id: 'status', ty: 3, groups: [{ id: 'ready', visible: true }] }],
    field_settings: { name: { width: 281, visibility: 0, wrap_cell_content: true } },
    calculations: [{ id: 'footer', field_id: 'done', calculation_type: 9 }],
    form_field_settings: { name: { required: true }, __form_description__: { description: 'Required details' } },
    layout_settings: { [String(layout)]: { chart_type: 'number', calculation: 'percent_checked', number_format: 'percent',
      date_field_id: 'date', end_date_field_id: 'end', first_day_of_week: 1, show_weekends: false } },
  };

  Object.entries(authored).forEach(([key, value]) => (source as Y.Map<unknown>).set(key, value));
  dashboard.set(YjsDatabaseKey.id, DASHBOARD);
  dashboard.set(YjsDatabaseKey.layout, DatabaseViewLayout.Dashboard);
  views.set(SOURCE, source); views.set(DASHBOARD, dashboard);
  updateDashboardLayoutSetting(dashboard, { rows: [{ id: 'row-1', height: 360, widgets: [
    { id: 'original-widget', viewId: SOURCE, databaseId: DATABASE, width: 12 },
  ] }] });
  const remote = new Y.Doc() as YDoc;

  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(remote, update, 'test-owned-sync');
  });
  const folder = new Map<string, View>([
    [SOURCE, { view_id: SOURCE, name: 'Source', parent_view_id: CONTAINER, extra: { database_id: DATABASE } } as View],
    [CONTAINER, { view_id: CONTAINER, name: 'Database', extra: { database_id: DATABASE, is_database_container: true }, children: [] } as unknown as View],
  ]);
  const commands: string[] = [];
  const committedRequests = new Map<string, string>();
  let committedId = '';
  let commits = 0;
  let refuse = true;
  let loseAck = true;
  let ownerAtCommit: unknown;

  jest.mocked(readPersistedDatabaseSource).mockImplementation(async () => Y.encodeStateAsUpdate(doc));
  jest.mocked(readCollabStates).mockImplementation(async () => [{ objectId: DATABASE, collabType: Types.Database,
    missingUpdate: Y.encodeStateAsUpdate(remote), serverStateVector: Y.encodeStateVector(remote) }]);
  getAxios()!.defaults.adapter = async (config) => {
    if (config.url?.endsWith('/restore-state')) return dataReply(config, { database_restore_id: null, version: null });
    if (config.method === 'get' && config.url?.includes('/view/')) return dataReply(config, folder.get(config.url.split('/').pop()!));
    if (!config.url?.endsWith(COPY_PATH)) throw new Error('Unexpected request ' + config.url);
    commands.push(config.data as string);
    const command = JSON.parse(config.data as string);

    if (refuse) { refuse = false; return dataReply(config, undefined, -5); }

    if (!committedRequests.has(command.request_id)) {
      committedId = command.view.view_id;
      committedRequests.set(command.request_id, committedId);
      const copy = view(remote, SOURCE).clone() as YDatabaseView;

      copy.set(YjsDatabaseKey.id, committedId); copy.set(YjsDatabaseKey.name, command.view.name);
      // Server settings exclude the source's owner. Folder owns the new copy immediately.
      copy.delete(YjsDatabaseKey.dashboard_owner);
      database(remote).get(YjsDatabaseKey.views).set(committedId, copy);
      folder.set(committedId, { view_id: committedId, parent_view_id: CONTAINER, name: command.view.name,
        layout: LAYOUTS[layout], extra: { database_id: DATABASE, ...command.extra } } as View);
      if (command.view.responses_view_id) {
        const responses = new Y.Map() as YDatabaseView;

        responses.set(YjsDatabaseKey.id, command.view.responses_view_id);
        responses.set(YjsDatabaseKey.database_id, DATABASE);
        responses.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
        database(remote).get(YjsDatabaseKey.views).set(command.view.responses_view_id, responses);
        folder.set(command.view.responses_view_id, { view_id: command.view.responses_view_id, parent_view_id: CONTAINER,
          layout: 1, extra: { database_id: DATABASE } } as View);
      }

      ownerAtCommit = folder.get(committedId)?.extra?.dashboard_owner;
      commits += 1;
    }

    if (loseAck) { loseAck = false; throw new Error('Committed reply lost'); }

    return dataReply(config, { request_id: command.request_id, outcome: 'already_applied', result: {
      view_id: committedId, view_ids: [committedId, ...(command.view.responses_view_id ? [command.view.responses_view_id] : [])],
      database_id: DATABASE, database_restore_id: RESTORE, database_version: null,
      database_update_v1: 'AQ==', update_batch_id: '00000000-0000-4000-8000-000000000099',
    } });
  };

  // The legacy path reproduces the real failure: creation may commit before its error, with no owner.
  const legacy = jest.fn(async () => {
    committedId = 'legacy-unowned-copy';
    const orphan = view(remote, SOURCE).clone() as YDatabaseView;

    orphan.set(YjsDatabaseKey.id, committedId);
    orphan.delete(YjsDatabaseKey.dashboard_owner);
    database(remote).get(YjsDatabaseKey.views).set(committedId, orphan);
    folder.set(committedId, { view_id: committedId, parent_view_id: CONTAINER, extra: { database_id: DATABASE } } as View);
    commits += 1;
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'remote');
    throw new Error('Internal server error (1017)');
  });
  const context: DatabaseContextState = { databaseDoc: doc, databasePageId: CONTAINER, activeViewId: DASHBOARD,
    workspaceId: WORKSPACE, rowMap: {}, readOnly: false, canWrite: true, createDatabaseView: legacy,
    loadViewMeta: async (id) => folder.get(id)!, deletePage: jest.fn(), updatePage: jest.fn() };
  const { result, unmount } = renderHook(() => useOwnedWidgetViews({ dashboardViewId: DASHBOARD, hostDatabaseId: DATABASE,
    canEdit: true, mobileContext: false, getRows: () => readDashboardLayoutSetting(database(doc), DASHBOARD).rows,
    updateRows: (update) => {
      updateDashboardLayoutSetting(dashboard, { rows: update(readDashboardLayoutSetting(database(doc), DASHBOARD).rows) });
      return true;
    }, ownerOfNow: (id) => id === committedId ? DASHBOARD : null, getSourceDoc: () => doc,
  }), { wrapper: ({ children }) => <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider> });

  return { doc, remote, result, unmount, folder, commands, legacy, authored, committed: () => ({ id: committedId, commits, ownerAtCommit }) };
}

it.each([0, 1, 2, 3, 4, 5, 6, 7, 8] as const)('recovers one owned widget of layout %s after RetryLater and a lost ACK without resetting its configuration', async (layout) => {
  const f = fixture(layout);

  try {
    await act(async () => f.result.current.duplicateWidget('original-widget'));
    expect(f.committed()).toMatchObject({ commits: 1, ownerAtCommit: DASHBOARD });
    expect(f.legacy).not.toHaveBeenCalled();
    expect(f.commands).toHaveLength(2);
    expect(readDashboardLayoutSetting(database(f.doc), DASHBOARD).rows.flatMap((row) => row.widgets)).toHaveLength(1);
    expect((await db.atomic_creation.toArray()).map((record) => record.state)).toEqual(['pending']);
    const id = f.committed().id;

    // Realtime can reveal the committed numbered name before receipt recovery.
    // A collaborator's subsequent change must survive: the client must not copy old source settings over it.
    (view(f.remote, id) as Y.Map<unknown>).set('filters', [{ id: 'later-filter', content: 'later edit' }]);
    Y.applyUpdate(f.doc, Y.encodeStateAsUpdate(f.remote), 'remote');
    await act(async () => f.result.current.duplicateWidget('original-widget'));
    expect(new Set(f.commands).size).toBe(1);
    expect(f.commands).toHaveLength(3);
    expect(f.committed()).toMatchObject({ commits: 1, ownerAtCommit: DASHBOARD });
    const copy = view(f.doc, id);

    expect(copy.get(YjsDatabaseKey.name)).toBe('Source (1)');
    expect(copy.get(YjsDatabaseKey.dashboard_owner)).toBe(DASHBOARD);
    expect(view(f.doc, SOURCE).get(YjsDatabaseKey.dashboard_owner)).toBe(SOURCE_OWNER);
    const settings = copy.toJSON() as Record<string, unknown>;

    expect(settings.filters).toEqual([{ id: 'later-filter', content: 'later edit' }]);
    Object.entries(f.authored).filter(([key]) => key !== 'filters').forEach(([key, value]) => expect(settings[key]).toEqual(value));
    const widgets = readDashboardLayoutSetting(database(f.doc), DASHBOARD).rows.flatMap((row) => row.widgets);

    expect(widgets.map((widget) => widget.viewId)).toEqual([SOURCE, id]);
    expect(await db.atomic_creation.count()).toBe(0);
    expect(f.legacy).not.toHaveBeenCalled();
    const command = JSON.parse(f.commands[0]);

    expect(command.view.source_view_id).toBe(SOURCE);
    expect(command.extra).toEqual({ dashboard_owner: DASHBOARD });
    if (layout === DatabaseViewLayout.Form) {
      expect(command.view.responses_view_id).toEqual(expect.any(String));
      expect(view(f.doc, command.view.responses_view_id).get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Grid);
    }

    expect(f.commands[0]).not.toMatch(/filters|sorts|groups|calculations|layout_settings|field_settings/);
    // Completed receipts are retired. Separate later user actions must make fresh copies.
    for (const number of [2, 3]) {
      await act(async () => f.result.current.duplicateWidget('original-widget'));
      const nextId = f.committed().id;

      expect(nextId).not.toBe(id);
      expect(view(f.doc, nextId).get(YjsDatabaseKey.name)).toBe(`Source (${number})`);
      expect(view(f.doc, nextId).get(YjsDatabaseKey.dashboard_owner)).toBe(DASHBOARD);
      expect(await db.atomic_creation.count()).toBe(0);
    }

    const completed = readDashboardLayoutSetting(database(f.doc), DASHBOARD).rows.flatMap((row) => row.widgets);

    expect(completed).toHaveLength(4);
    expect(new Set(completed.map((widget) => widget.viewId)).size).toBe(4);
    expect(new Set(f.commands).size).toBe(3);
    expect(f.committed().commits).toBe(3);
  } finally { f.unmount(); f.doc.destroy(); f.remote.destroy(); }
});
