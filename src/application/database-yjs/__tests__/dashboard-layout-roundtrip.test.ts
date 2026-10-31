import * as Y from 'yjs';

import { YDatabase, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  indexDashboardRowExtras,
  indexGlobalFilterExtras,
  readDashboardLayoutSetting,
  serializeDashboardGlobalFilters,
  serializeDashboardRows,
  updateDashboardLayoutSetting,
} from '../dashboard-layout';
import { DASHBOARD_LAYOUT_KEY, DashboardLayoutSetting, DashboardLayoutUpdate } from '../dashboard.type';
import { FieldType } from '../database.type';
import { toPlainValue } from '../layout-codec';

import { decodeParityJson, loadParityFixture, normalizeNumbers, seedParityMap } from './dashboard-parity-helpers';

interface DashboardCase {
  name: string;
  stored: Record<string, unknown>;
  parsed?: Record<string, unknown>;
  write: Record<string, unknown>;
  writtenKeys: string[];
  expected: Record<string, unknown>;
}

const VIEW_ID = 'dashboard';
const PROBE = { from: 'newer-app', version: 99, list: ['a', 'b'], nested: { flag: true } };
const { dashboardCases } = loadParityFixture<{ dashboardCases: DashboardCase[] }>('layouts/unknown-keys.json');

function createFixture(entries: Record<string, unknown> = {}) {
  const doc = new Y.Doc();
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const layouts = new Y.Map<unknown>();
  const setting = new Y.Map<unknown>();

  doc.transact(() => {
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
    database.set(YjsDatabaseKey.views, views);
    views.set(VIEW_ID, view);
    view.set(YjsDatabaseKey.layout_settings, layouts as never);
    layouts.set(DASHBOARD_LAYOUT_KEY, setting);
    seedParityMap(setting, decodeParityJson(entries) as Record<string, unknown>);
  });
  return { doc, database, view, setting };
}

/** The typed setting in the persisted snake_case shape (no extras). */
function persisted(setting: DashboardLayoutSetting): Record<string, unknown> {
  return {
    rows: serializeDashboardRows(setting.rows),
    global_filters: serializeDashboardGlobalFilters(setting.globalFilters).map(
      ({ target_order: _order, ...filter }) => filter
    ),
    show_widget_titles: setting.showWidgetTitles,
  };
}

/** The typed update a client submits for the `write` keys, parsed with the same reader. */
function parseWrite(write: Record<string, unknown>): DashboardLayoutUpdate {
  const { database } = createFixture(write);
  const parsed = readDashboardLayoutSetting(database, VIEW_ID);
  const update: DashboardLayoutUpdate = {};

  if (YjsDatabaseKey.dashboard_rows in write) update.rows = parsed.rows;
  if (YjsDatabaseKey.dashboard_global_filters in write) update.globalFilters = parsed.globalFilters;
  if (YjsDatabaseKey.show_widget_titles in write) update.showWidgetTitles = parsed.showWidgetTitles;
  return update;
}

/** Apply `update` in one transaction and report the top-level keys it wrote. */
function applyUpdate(fixture: ReturnType<typeof createFixture>, update: DashboardLayoutUpdate) {
  const changed = new Set<string>();
  const observer = (event: Y.YMapEvent<unknown>) => event.keysChanged.forEach((key) => changed.add(key));

  fixture.setting.observe(observer);
  fixture.doc.transact(() => updateDashboardLayoutSetting(fixture.view, update));
  fixture.setting.unobserve(observer);
  return [...changed].sort();
}

function plainSetting(setting: Y.Map<unknown>) {
  return normalizeNumbers(toPlainValue(setting));
}

describe('dashboard layout round trip (dashboard-parity/layouts/unknown-keys.json)', () => {
  it.each(dashboardCases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const fixture = createFixture(entry.stored);

    if (entry.parsed) {
      const parsed = persisted(readDashboardLayoutSetting(fixture.database, VIEW_ID));

      Object.entries(entry.parsed).forEach(([key, value]) => expect(parsed[key]).toEqual(value));
    }

    expect(applyUpdate(fixture, parseWrite(entry.write))).toEqual([...entry.writtenKeys].sort());
    expect(plainSetting(fixture.setting)).toEqual(normalizeNumbers(decodeParityJson(entry.expected)));
  });

  it('seeds native integers as bigints, as a desktop update carries them', () => {
    const fixture = createFixture({ show_widget_titles: true, zz_parity_probe: { $bigint: '7' } });
    const copy = new Y.Doc();

    Y.applyUpdate(copy, Y.encodeStateAsUpdate(fixture.doc));
    const setting = (copy.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
      .get(YjsDatabaseKey.views)
      .get(VIEW_ID)
      .get(YjsDatabaseKey.layout_settings)
      .get(DASHBOARD_LAYOUT_KEY);

    expect(setting.get('zz_parity_probe' as never)).toBe(BigInt(7));
  });
});

describe('dashboard layout carry-over', () => {
  it('lets the first stored occurrence of an id win', () => {
    const stored = [
      {
        id: 'r:1',
        height: 360,
        zz_parity_probe: { row: 'first' },
        widgets: [{ id: 'w:1', view_id: 'v:1', database_id: 'db:1', width: 12, zz_parity_probe: { widget: 'first' } }],
      },
      {
        id: 'r:1',
        height: 360,
        zz_parity_probe: { row: 'second' },
        widgets: [
          { id: 'w:1', view_id: 'v:1', database_id: 'db:1', width: 6, zz_parity_probe: { widget: 'second' } },
          // The first occurrence of w:2 has no extras, so the later one's are not used.
          { id: 'w:2', view_id: 'v:2', database_id: 'db:1', width: 6 },
        ],
      },
      { id: 'r:2', height: 360, widgets: [{ id: 'w:2', view_id: 'v:2', database_id: 'db:1', width: 12, zz: 1 }] },
    ];
    const extras = indexDashboardRowExtras(stored);

    expect(extras.rows.get('r:1')).toEqual({ zz_parity_probe: { row: 'first' } });
    expect(extras.widgets.get('w:1')).toEqual({ zz_parity_probe: { widget: 'first' } });
    expect(extras.widgets.has('w:2')).toBe(false);

    const filters = indexGlobalFilterExtras([
      { id: 'gf:1', name: 'A', ty: FieldType.Checkbox, condition: 0, zz_parity_probe: { filter: 'first' } },
      { id: 'gf:1', name: 'B', ty: FieldType.Checkbox, condition: 0, zz_parity_probe: { filter: 'second' } },
      // An id-less entry gets its positional id, counting every entry.
      { name: 'C', ty: FieldType.Checkbox, condition: 0, zz_parity_probe: { filter: 'third' } },
    ]);

    expect(filters.get('gf:1')).toEqual({ zz_parity_probe: { filter: 'first' } });
    expect(filters.get('gf:2')).toEqual({ zz_parity_probe: { filter: 'third' } });

    const fixture = createFixture({ rows: stored });

    expect(
      applyUpdate(fixture, {
        rows: [
          {
            id: 'r:1',
            height: 480,
            widgets: [{ id: 'w:1', viewId: 'v:1', databaseId: 'db:1', width: 12 }],
          },
        ],
      })
    ).toEqual(['rows']);
    expect(plainSetting(fixture.setting)).toEqual({
      rows: [
        {
          id: 'r:1',
          height: 480,
          zz_parity_probe: { row: 'first' },
          widgets: [{ id: 'w:1', view_id: 'v:1', database_id: 'db:1', width: 12, zz_parity_probe: { widget: 'first' } }],
        },
      ],
    });
  });

  it('carries the extras of a Y.Array / Y.Map backed value', () => {
    const fixture = createFixture();

    fixture.doc.transact(() => {
      const rows = new Y.Array<unknown>();
      const row = new Y.Map<unknown>();
      const widgets = new Y.Array<unknown>();
      const filters = new Y.Array<unknown>();

      fixture.setting.set(YjsDatabaseKey.dashboard_rows, rows);
      fixture.setting.set(YjsDatabaseKey.dashboard_global_filters, filters);
      rows.push([row, { height: 240, zz_parity_probe: { row: 'r:1' }, widgets: [] }]);
      row.set('id', 'r:kept');
      row.set('height', 480);
      row.set('zz_parity_probe', { row: 'r:kept' });
      row.set('widgets', widgets);
      widgets.push([{ view_id: 'v:1', database_id: 'db:1', width: 12, zz_parity_probe: { widget: 'w:0:0' } }]);
      filters.push([
        { name: 'Urgent', ty: FieldType.Checkbox, condition: 1, content: '', targets: { 'db:1': 'f:1' }, zz: PROBE },
      ]);
    });

    const current = readDashboardLayoutSetting(fixture.database, VIEW_ID);

    // The empty second row is dropped by the reader; its extras go with it.
    expect(current.rows.map((row) => row.id)).toEqual(['r:kept']);
    expect(
      applyUpdate(fixture, {
        rows: current.rows.map((row) => ({ ...row, height: 600 })),
        globalFilters: current.globalFilters.map((filter) => ({ ...filter, condition: 0 })),
      })
    ).toEqual(['global_filters', 'rows']);
    expect(plainSetting(fixture.setting)).toEqual({
      rows: [
        {
          id: 'r:kept',
          height: 600,
          zz_parity_probe: { row: 'r:kept' },
          widgets: [
            { id: 'w:0:0', view_id: 'v:1', database_id: 'db:1', width: 12, zz_parity_probe: { widget: 'w:0:0' } },
          ],
        },
      ],
      global_filters: [
        {
          id: 'gf:0',
          name: 'Urgent',
          ty: FieldType.Checkbox,
          condition: 0,
          content: '',
          targets: { 'db:1': 'f:1' },
          target_order: ['db:1'],
          zz: PROBE,
        },
      ],
    });
  });

  it('keeps an extra a remote client added between the read and the write', () => {
    const local = createFixture({
      rows: [{ id: 'r:1', height: 360, widgets: [{ id: 'w:1', view_id: 'v:1', database_id: 'db:1', width: 12 }] }],
    });
    const remote = new Y.Doc();

    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local.doc));
    // The local client reads the rows it is about to edit.
    const before = readDashboardLayoutSetting(local.database, VIEW_ID);
    // Meanwhile a newer client adds its own keys to the same row and widget.
    const remoteSetting = (remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
      .get(YjsDatabaseKey.views)
      .get(VIEW_ID)
      .get(YjsDatabaseKey.layout_settings)
      .get(DASHBOARD_LAYOUT_KEY);

    remoteSetting.set(
      YjsDatabaseKey.dashboard_rows as never,
      [
        {
          id: 'r:1',
          height: 360,
          zz_parity_probe: PROBE,
          widgets: [{ id: 'w:1', view_id: 'v:1', database_id: 'db:1', width: 12, zz_parity_probe: { widget: 'w:1' } }],
        },
      ] as never
    );
    Y.applyUpdate(local.doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(local.doc)), 'remote');

    expect(applyUpdate(local, { rows: before.rows.map((row) => ({ ...row, height: 720 })) })).toEqual(['rows']);
    expect(plainSetting(local.setting)).toEqual({
      rows: [
        {
          id: 'r:1',
          height: 720,
          zz_parity_probe: PROBE,
          widgets: [{ id: 'w:1', view_id: 'v:1', database_id: 'db:1', width: 12, zz_parity_probe: { widget: 'w:1' } }],
        },
      ],
    });
  });

  it('writes nothing for an identical update, whatever the number encoding', () => {
    const fixture = createFixture({
      rows: [
        {
          id: 'r:1',
          height: { $bigint: '360' },
          widgets: [{ id: 'w:1', view_id: 'v:1', database_id: 'db:1', width: { $bigint: '12' } }],
        },
      ],
      global_filters: [],
      show_widget_titles: true,
    });
    const current = readDashboardLayoutSetting(fixture.database, VIEW_ID);
    const storedRows = fixture.setting.get(YjsDatabaseKey.dashboard_rows);

    expect(
      applyUpdate(fixture, {
        rows: current.rows.map((row) => ({ ...row, widgets: row.widgets.map((widget) => ({ ...widget })) })),
        globalFilters: [],
        showWidgetTitles: true,
      })
    ).toEqual([]);
    expect(fixture.setting.get(YjsDatabaseKey.dashboard_rows)).toBe(storedRows);
  });
});
