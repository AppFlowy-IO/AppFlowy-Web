import { renderHook } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { YDatabase, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  addDashboardWidget,
  balanceRowWidths,
  canAddDashboardWidget,
  countDashboardWidgets,
  createDashboardLayoutStore,
  createDashboardRow,
  createDashboardWidget,
  dashboardSourceDatabaseIds,
  DEFAULT_DASHBOARD_LAYOUT_SETTING,
  duplicateDashboardWidget,
  findDashboardWidget,
  generateDashboardId,
  getDashboardJoinWidth,
  initializeDashboardLayoutSetting,
  moveDashboardRow,
  moveDashboardWidget,
  normalizeDashboardRows,
  readDashboardLayoutSetting,
  removeDashboardWidget,
  replaceDashboardWidgetView,
  resizeDashboardWidget,
  sameDashboardGlobalFilters,
  sameDashboardRows,
  setDashboardRowHeight,
  updateDashboardLayoutSetting,
} from '../dashboard-layout';
import {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_LAYOUT_KEY,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MIN_ROW_HEIGHT,
  DashboardGlobalFilter,
  DashboardRow,
  DashboardWidget,
  resolveExtraFiltersForDatabase,
} from '../dashboard.type';
import { FieldType, FilterType } from '../database.type';

const VIEW_ID = 'dashboard';

function createFixture() {
  const doc = new Y.Doc();
  const database = new Y.Map() as YDatabase;

  doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  database.set(YjsDatabaseKey.views, views);
  views.set(VIEW_ID, view);
  return { doc, database, view, views };
}

function sync(source: Y.Doc, target: Y.Doc) {
  Y.applyUpdate(target, Y.encodeStateAsUpdate(source, Y.encodeStateVector(target)), 'remote');
}

/** Stub the map chain the reader walks so values Yjs cannot author (BigInt) can be fed in. */
function stubDatabase(values: Record<string, unknown>) {
  const setting = { get: (key: string) => values[key] };
  const layouts = { get: (key: string) => (key === DASHBOARD_LAYOUT_KEY ? setting : undefined) };
  const view = { get: (key: string) => (key === YjsDatabaseKey.layout_settings ? layouts : undefined) };
  const views = { get: (viewId: string) => (viewId === VIEW_ID ? view : undefined) };

  return { get: (key: string) => (key === YjsDatabaseKey.views ? views : undefined) } as unknown as YDatabase;
}

function widget(id: string, width = 12, databaseId = 'db-host', viewId = `view-${id}`): DashboardWidget {
  return { id, viewId, databaseId, width };
}

function row(id: string, widgets: DashboardWidget[], height = DASHBOARD_DEFAULT_ROW_HEIGHT): DashboardRow {
  return { id, height, widgets };
}

function widths(target: DashboardRow) {
  return target.widgets.map((item) => item.width);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function layoutShape(rows: DashboardRow[]) {
  return rows.map((item) => item.widgets.map((entry) => entry.id));
}

/** Twelve widgets in three full rows. */
function fullDashboard() {
  return [0, 1, 2].map((rowIndex) =>
    row(
      `r${rowIndex}`,
      [0, 1, 2, 3].map((index) => widget(`w${rowIndex}-${index}`, 3))
    )
  );
}

const textFilter: DashboardGlobalFilter = {
  id: 'gf:1',
  name: 'Status',
  fieldType: FieldType.RichText,
  condition: 2,
  content: 'done',
  targets: { 'db-host': 'field-a', 'db-other': 'field-b' },
};

describe('generateDashboardId / factories', () => {
  it('prefixes ids by kind and keeps them unique', () => {
    const first = generateDashboardId('w');
    const second = generateDashboardId('w');

    expect(first).toMatch(/^w:.{8}$/);
    expect(generateDashboardId('r')).toMatch(/^r:/);
    expect(generateDashboardId('gf')).toMatch(/^gf:/);
    expect(first).not.toBe(second);
  });

  it('creates full-width widgets and balanced default-height rows', () => {
    const created = createDashboardWidget('view', 'db');

    expect(created).toEqual({ id: expect.stringMatching(/^w:/), viewId: 'view', databaseId: 'db', width: 12 });
    expect(createDashboardWidget('view', 'db', 4).width).toBe(4);

    const created2 = createDashboardRow([widget('a', 0), widget('b', 0), widget('c', 0)]);

    expect(created2.id).toMatch(/^r:/);
    expect(created2.height).toBe(DASHBOARD_DEFAULT_ROW_HEIGHT);
    expect(widths(created2)).toEqual([4, 4, 4]);
    expect(createDashboardRow([widget('a')], 600).height).toBe(600);
  });
});

describe('balanceRowWidths', () => {
  it('returns an empty row untouched', () => {
    const empty: DashboardWidget[] = [];

    expect(balanceRowWidths(empty)).toBe(empty);
  });

  it.each([
    [1, [12]],
    [2, [6, 6]],
    [3, [4, 4, 4]],
    [4, [3, 3, 3, 3]],
  ])('splits %i widgets without widths equally', (count, expected) => {
    const result = balanceRowWidths(Array.from({ length: count }, (_, index) => widget(`w${index}`, 0)));

    expect(result.map((item) => item.width)).toEqual(expected);
    expect(sum(result.map((item) => item.width))).toBe(12);
  });

  it.each([
    [
      [4, 8],
      [4, 8],
    ],
    [
      [1, 2],
      [4, 8],
    ],
    [
      [2, 1],
      [8, 4],
    ],
    [
      [6, 6, 6],
      [4, 4, 4],
    ],
    [
      [5, 5, 5, 5],
      [3, 3, 3, 3],
    ],
    [
      [10, 1, 1],
      [10, 1, 1],
    ],
    [
      [3, 4],
      [5, 7],
    ],
    [[12], [12]],
    [[1], [12]],
  ])('scales %j proportionally to %j', (input, expected) => {
    const result = balanceRowWidths(input.map((width, index) => widget(`w${index}`, width)));

    expect(result.map((item) => item.width)).toEqual(expected);
  });

  it('keeps every widget at least one column while still summing to 12', () => {
    const result = balanceRowWidths([widget('a', 100), widget('b', 1), widget('c', 1), widget('d', 1)]);

    expect(result.map((item) => item.width)).toEqual([9, 1, 1, 1]);
  });

  it('treats invalid widths as missing', () => {
    const result = balanceRowWidths([widget('a', Number.NaN), widget('b', -3), widget('c', 6)]);

    expect(result.map((item) => item.width)).toEqual([1, 1, 10]);
    expect(balanceRowWidths([widget('a', Number.NaN), widget('b', 0)]).map((item) => item.width)).toEqual([6, 6]);
  });

  it('keeps widget identity when the width is already right', () => {
    const input = [widget('a', 4), widget('b', 4), widget('c', 2)];
    const result = balanceRowWidths(input);

    expect(result.map((item) => item.width)).toEqual([5, 5, 2]);
    expect(result[2]).toBe(input[2]);
    expect(result[0]).not.toBe(input[0]);
    expect(result[0]).toEqual({ ...input[0], width: 5 });

    const balanced = [widget('x', 6), widget('y', 6)];

    expect(balanceRowWidths(balanced)[0]).toBe(balanced[0]);
  });

  it('always sums to 12 for any width combination of 1..4 widgets', () => {
    const candidates = [0, 1, 2, 5, 7, 11, 12, 30];

    for (let count = 1; count <= 4; count += 1) {
      for (let seed = 0; seed < 64; seed += 1) {
        const input = Array.from({ length: count }, (_, index) =>
          widget(`w${index}`, candidates[(seed * (index + 3) + index) % candidates.length])
        );
        const result = balanceRowWidths(input);

        expect(sum(result.map((item) => item.width))).toBe(12);
        result.forEach((item) => expect(item.width).toBeGreaterThanOrEqual(1));
      }
    }
  });
});

describe('normalizeDashboardRows', () => {
  it('spills rows with more than four widgets into new rows below', () => {
    const input = [
      row(
        'r1',
        Array.from({ length: 6 }, (_, index) => widget(`w${index}`, 2)),
        480
      ),
    ];
    const result = normalizeDashboardRows(input);

    expect(layoutShape(result)).toEqual([
      ['w0', 'w1', 'w2', 'w3'],
      ['w4', 'w5'],
    ]);
    expect(result[0].id).toBe('r1');
    // Derived from the source row, so normalizing the same rows twice agrees.
    expect(result[1].id).toBe('r1:1');
    expect(normalizeDashboardRows(input).map((item) => item.id)).toEqual(['r1', 'r1:1']);
    expect(result.map((item) => item.height)).toEqual([480, 480]);
    expect(widths(result[0])).toEqual([3, 3, 3, 3]);
    expect(widths(result[1])).toEqual([6, 6]);
  });

  it('caps the dashboard at twelve widgets, dropping extras from the end', () => {
    const input = [
      row('r1', [widget('a1'), widget('a2'), widget('a3')]),
      row(
        'r2',
        Array.from({ length: 8 }, (_, index) => widget(`b${index}`))
      ),
      row('r3', [widget('c1'), widget('c2')]),
      row('r4', [widget('d1')]),
    ];
    const result = normalizeDashboardRows(input);

    expect(countDashboardWidgets(result)).toBe(DASHBOARD_MAX_WIDGETS);
    expect(layoutShape(result)).toEqual([
      ['a1', 'a2', 'a3'],
      ['b0', 'b1', 'b2', 'b3'],
      ['b4', 'b5', 'b6', 'b7'],
      ['c1'],
    ]);
  });

  it('drops empty rows and clamps heights', () => {
    const result = normalizeDashboardRows([
      row('empty', []),
      row('low', [widget('a')], 10),
      row('high', [widget('b')], 99999),
      row('nan', [widget('c')], Number.NaN),
      row('fraction', [widget('d')], 400.6),
    ]);

    expect(result.map((item) => item.id)).toEqual(['low', 'high', 'nan', 'fraction']);
    expect(result.map((item) => item.height)).toEqual([
      DASHBOARD_MIN_ROW_HEIGHT,
      DASHBOARD_MAX_ROW_HEIGHT,
      DASHBOARD_DEFAULT_ROW_HEIGHT,
      401,
    ]);
  });

  it('rebalances widths of every row', () => {
    const result = normalizeDashboardRows([row('r1', [widget('a', 12), widget('b', 12)])]);

    expect(widths(result[0])).toEqual([6, 6]);
  });

  it('does not mutate its input', () => {
    const input = [
      row(
        'r1',
        Array.from({ length: 5 }, (_, index) => widget(`w${index}`, 1))
      ),
    ];
    const snapshot = JSON.parse(JSON.stringify(input));

    normalizeDashboardRows(input);
    expect(input).toEqual(snapshot);
  });
});

describe('readDashboardLayoutSetting', () => {
  it('falls back to the default setting when the view or setting is missing', () => {
    const { database } = createFixture();

    expect(readDashboardLayoutSetting(undefined, VIEW_ID)).toBe(DEFAULT_DASHBOARD_LAYOUT_SETTING);
    expect(readDashboardLayoutSetting(database, 'missing')).toBe(DEFAULT_DASHBOARD_LAYOUT_SETTING);
    expect(readDashboardLayoutSetting(database, VIEW_ID)).toEqual({
      rows: [],
      globalFilters: [],
      showWidgetTitles: true,
    });
  });

  it('parses the persisted snake_case JSON and caches it per stored value', () => {
    const { doc, database, view } = createFixture();

    doc.transact(() => {
      const layouts = new Y.Map();
      const setting = new Y.Map();

      view.set(YjsDatabaseKey.layout_settings, layouts as never);
      layouts.set(DASHBOARD_LAYOUT_KEY, setting);
      setting.set(YjsDatabaseKey.dashboard_rows, [
        {
          id: 'r1',
          height: 480,
          widgets: [
            { id: 'w1', view_id: 'v1', database_id: 'db-host', width: 8 },
            { id: 'w2', view_id: 'v2', database_id: 'db-other', width: 4 },
          ],
        },
      ]);
      setting.set(YjsDatabaseKey.dashboard_global_filters, [
        {
          id: 'gf:1',
          name: 'Status',
          ty: FieldType.RichText,
          condition: 2,
          content: 'done',
          targets: { 'db-host': 'f1' },
        },
      ]);
      setting.set(YjsDatabaseKey.show_widget_titles, false);
    });

    const first = readDashboardLayoutSetting(database, VIEW_ID);

    expect(first).toEqual({
      rows: [
        {
          id: 'r1',
          height: 480,
          widgets: [
            { id: 'w1', viewId: 'v1', databaseId: 'db-host', width: 8 },
            { id: 'w2', viewId: 'v2', databaseId: 'db-other', width: 4 },
          ],
        },
      ],
      globalFilters: [
        {
          id: 'gf:1',
          name: 'Status',
          fieldType: FieldType.RichText,
          condition: 2,
          content: 'done',
          targets: { 'db-host': 'f1' },
        },
      ],
      showWidgetTitles: false,
    });

    const second = readDashboardLayoutSetting(database, VIEW_ID);

    expect(second.rows).toBe(first.rows);
    expect(second.globalFilters).toBe(first.globalFilters);
  });

  it('decodes integers written by the server as BigInt', () => {
    const database = stubDatabase({
      [YjsDatabaseKey.dashboard_rows]: [
        {
          id: 'r1',
          height: BigInt(600),
          widgets: [
            { id: 'w1', view_id: 'v1', database_id: 'db', width: BigInt(3) },
            { id: 'w2', view_id: 'v2', database_id: 'db', width: BigInt(9) },
          ],
        },
      ],
      [YjsDatabaseKey.dashboard_global_filters]: [
        {
          id: 'gf:1',
          name: 'Amount',
          ty: BigInt(FieldType.Number),
          condition: BigInt(3),
          content: '5',
          targets: { db: 'amount' },
        },
      ],
      [YjsDatabaseKey.show_widget_titles]: true,
    });
    const setting = readDashboardLayoutSetting(database, VIEW_ID);

    expect(setting.rows).toEqual([
      {
        id: 'r1',
        height: 600,
        widgets: [
          { id: 'w1', viewId: 'v1', databaseId: 'db', width: 3 },
          { id: 'w2', viewId: 'v2', databaseId: 'db', width: 9 },
        ],
      },
    ]);
    expect(setting.globalFilters).toEqual([
      { id: 'gf:1', name: 'Amount', fieldType: FieldType.Number, condition: 3, content: '5', targets: { db: 'amount' } },
    ]);
  });

  it('keeps the stored target order, whatever order the targets object has', () => {
    // Yrs re-encodes a JSON object in hash-map order, so the order comes from `target_order`.
    const database = stubDatabase({
      [YjsDatabaseKey.dashboard_global_filters]: [
        {
          id: 'gf:ordered',
          ty: FieldType.SingleSelect,
          targets: { 'db-tasks': 'stage', 'db-bugs': 'state', 'db-projects': 'status' },
          target_order: ['db-projects', 'missing', 'db-tasks', 'db-projects', 7],
        },
        {
          id: 'gf:legacy',
          ty: FieldType.SingleSelect,
          targets: { 'db-tasks': 'stage', 'db-projects': 'status' },
        },
      ],
    });
    const [ordered, legacy] = readDashboardLayoutSetting(database, VIEW_ID).globalFilters;

    // Listed mappings first, then the unlisted ones in sorted order.
    expect(Object.keys(ordered.targets)).toEqual(['db-projects', 'db-tasks', 'db-bugs']);
    expect(ordered.targets).toEqual({ 'db-projects': 'status', 'db-tasks': 'stage', 'db-bugs': 'state' });
    // Without an order every client sorts the same way.
    expect(Object.keys(legacy.targets)).toEqual(['db-projects', 'db-tasks']);
  });

  it('treats a reordered mapping as a change', () => {
    const filter: DashboardGlobalFilter = { ...textFilter, targets: { 'db-host': 'field-a', 'db-other': 'field-b' } };
    const reordered: DashboardGlobalFilter = {
      ...textFilter,
      targets: { 'db-other': 'field-b', 'db-host': 'field-a' },
    };

    expect(sameDashboardGlobalFilters([filter], [{ ...filter, targets: { ...filter.targets } }])).toBe(true);
    expect(sameDashboardGlobalFilters([filter], [reordered])).toBe(false);
  });

  it('accepts Y.Array / Y.Map containers written by other clients', () => {
    const { doc, database, view } = createFixture();

    doc.transact(() => {
      const layouts = new Y.Map();
      const setting = new Y.Map();
      const rows = new Y.Array<Y.Map<unknown>>();
      const rowMap = new Y.Map<unknown>();
      const widgets = new Y.Array<Y.Map<unknown>>();
      const widgetMap = new Y.Map<unknown>();
      const filters = new Y.Array<Y.Map<unknown>>();
      const filterMap = new Y.Map<unknown>();
      const targets = new Y.Map<unknown>();

      view.set(YjsDatabaseKey.layout_settings, layouts as never);
      layouts.set(DASHBOARD_LAYOUT_KEY, setting);
      setting.set(YjsDatabaseKey.dashboard_rows, rows);
      setting.set(YjsDatabaseKey.dashboard_global_filters, filters);
      rows.push([rowMap]);
      rowMap.set('id', 'r1');
      rowMap.set('height', 300);
      rowMap.set('widgets', widgets);
      widgets.push([widgetMap]);
      widgetMap.set('id', 'w1');
      widgetMap.set('view_id', 'v1');
      widgetMap.set('database_id', 'db');
      widgetMap.set('width', 12);
      filters.push([filterMap]);
      filterMap.set('id', 'gf:1');
      filterMap.set('name', 'Done');
      filterMap.set('ty', FieldType.Checkbox);
      filterMap.set('condition', 0);
      filterMap.set('content', '');
      filterMap.set('targets', targets);
      targets.set('db', 'checkbox');
    });

    expect(readDashboardLayoutSetting(database, VIEW_ID)).toEqual({
      rows: [{ id: 'r1', height: 300, widgets: [{ id: 'w1', viewId: 'v1', databaseId: 'db', width: 12 }] }],
      globalFilters: [
        {
          id: 'gf:1',
          name: 'Done',
          fieldType: FieldType.Checkbox,
          condition: 0,
          content: '',
          targets: { db: 'checkbox' },
        },
      ],
      showWidgetTitles: true,
    });
  });

  it('skips invalid entries and repairs missing ids, widths and heights', () => {
    const database = stubDatabase({
      [YjsDatabaseKey.dashboard_rows]: [
        null,
        'row',
        42,
        {
          // No id, no height, a mix of valid and invalid widgets.
          widgets: [
            null,
            'widget',
            { id: 'no-view', database_id: 'db' },
            { id: 'no-db', view_id: 'v' },
            { id: 'empty-view', view_id: '', database_id: 'db' },
            { view_id: 'v1', database_id: 'db', width: 'wide' },
            { id: 'w2', view_id: 'v2', database_id: 'db', width: 99 },
          ],
        },
        { id: 'only-invalid', widgets: [{ id: 'bad' }] },
        { id: 'no-widgets', height: 500 },
        { id: 'r3', height: 'tall', widgets: [{ id: 'w3', view_id: 'v3', database_id: 'db', width: -4 }] },
      ],
      [YjsDatabaseKey.dashboard_global_filters]: [
        null,
        'filter',
        { id: 'no-type', condition: 1 },
        { id: 'string-type', ty: '1' },
        {
          ty: FieldType.RichText,
          name: 42,
          condition: 'contains',
          content: { text: 'x' },
          targets: { db: 'field', other: '', third: 7, '': 'orphan' },
        },
        { id: 'array-targets', ty: FieldType.Number, targets: ['db'] },
      ],
      [YjsDatabaseKey.show_widget_titles]: 'yes',
    });
    const setting = readDashboardLayoutSetting(database, VIEW_ID);

    expect(setting.rows).toHaveLength(2);
    expect(setting.rows[0]).toEqual({
      id: expect.stringMatching(/^r:/),
      height: DASHBOARD_DEFAULT_ROW_HEIGHT,
      widgets: [
        { id: expect.stringMatching(/^w:/), viewId: 'v1', databaseId: 'db', width: 1 },
        { id: 'w2', viewId: 'v2', databaseId: 'db', width: 11 },
      ],
    });
    expect(setting.rows[1]).toEqual({
      id: 'r3',
      height: DASHBOARD_DEFAULT_ROW_HEIGHT,
      widgets: [{ id: 'w3', viewId: 'v3', databaseId: 'db', width: 12 }],
    });

    expect(setting.globalFilters).toEqual([
      {
        id: expect.stringMatching(/^gf:/),
        name: '',
        fieldType: FieldType.RichText,
        condition: 0,
        content: '',
        targets: { db: 'field' },
      },
      { id: 'array-targets', name: '', fieldType: FieldType.Number, condition: 0, content: '', targets: {} },
    ]);
    expect(setting.showWidgetTitles).toBe(true);
  });

  it('returns the shared empty lists for non-array or fully invalid values', () => {
    const invalid = readDashboardLayoutSetting(
      stubDatabase({
        [YjsDatabaseKey.dashboard_rows]: 'rows',
        [YjsDatabaseKey.dashboard_global_filters]: { id: 'gf' },
      }),
      VIEW_ID
    );
    const allInvalid = readDashboardLayoutSetting(
      stubDatabase({
        [YjsDatabaseKey.dashboard_rows]: [{ id: 'r', widgets: [] }],
        [YjsDatabaseKey.dashboard_global_filters]: [{ id: 'gf' }],
      }),
      VIEW_ID
    );

    expect(invalid.rows).toBe(DEFAULT_DASHBOARD_LAYOUT_SETTING.rows);
    expect(invalid.globalFilters).toBe(DEFAULT_DASHBOARD_LAYOUT_SETTING.globalFilters);
    expect(allInvalid.rows).toBe(DEFAULT_DASHBOARD_LAYOUT_SETTING.rows);
    expect(allInvalid.globalFilters).toBe(DEFAULT_DASHBOARD_LAYOUT_SETTING.globalFilters);
  });

  it('normalizes stored rows that break the invariants', () => {
    const database = stubDatabase({
      [YjsDatabaseKey.dashboard_rows]: [
        {
          id: 'r1',
          height: 360,
          widgets: Array.from({ length: 14 }, (_, index) => ({
            id: `w${index}`,
            view_id: `v${index}`,
            database_id: 'db',
            width: 6,
          })),
        },
      ],
    });
    const { rows } = readDashboardLayoutSetting(database, VIEW_ID);

    expect(rows.map((item) => item.widgets.length)).toEqual([4, 4, 4]);
    rows.forEach((item) => expect(sum(widths(item))).toBe(12));
  });
});

/**
 * Stores the rows / filters as Y types (as a doc decoded from another client
 * may), with entries that lack ids and a row that must spill. `toJSON()`
 * returns a fresh array on every read, so the per-value parse cache misses.
 */
function storeYArrayBackedSetting(doc: Y.Doc, view: YDatabaseView) {
  doc.transact(() => {
    const layouts = new Y.Map();
    const setting = new Y.Map();
    const rows = new Y.Array<unknown>();
    const filters = new Y.Array<unknown>();

    view.set(YjsDatabaseKey.layout_settings, layouts as never);
    layouts.set(DASHBOARD_LAYOUT_KEY, setting);
    setting.set(YjsDatabaseKey.dashboard_rows, rows);
    setting.set(YjsDatabaseKey.dashboard_global_filters, filters);
    rows.push([
      {
        height: 480,
        widgets: Array.from({ length: 5 }, (_, index) => ({ view_id: `v${index}`, database_id: 'db', width: 3 })),
      },
      { id: 'r1', widgets: [{ id: 'w-kept', view_id: 'v5', database_id: 'db', width: 12 }] },
    ]);
    filters.push([
      { name: 'Status', ty: FieldType.RichText, condition: 2, content: 'done', targets: { db: 'status' } },
    ]);
  });
}

describe('fallback ids of Y-backed settings', () => {
  it('are positional, so reading the same value twice gives equal rows and filters', () => {
    const { doc, database, view } = createFixture();

    storeYArrayBackedSetting(doc, view);
    const first = readDashboardLayoutSetting(database, VIEW_ID);
    const second = readDashboardLayoutSetting(database, VIEW_ID);

    expect(first.rows.map((item) => item.id)).toEqual(['r:0', 'r:0:1', 'r1']);
    expect(first.rows.map((item) => item.widgets.map((entry) => entry.id))).toEqual([
      ['w:0:0', 'w:0:1', 'w:0:2', 'w:0:3'],
      ['w:0:4'],
      ['w-kept'],
    ]);
    expect(first.globalFilters.map((filter) => filter.id)).toEqual(['gf:0']);
    expect(sameDashboardRows(first.rows, second.rows)).toBe(true);
    expect(sameDashboardGlobalFilters(first.globalFilters, second.globalFilters)).toBe(true);
  });

  it('keep the layout store snapshot stable, so useSyncExternalStore settles', () => {
    const { doc, view } = createFixture();

    storeYArrayBackedSetting(doc, view);
    const store = createDashboardLayoutStore(doc, VIEW_ID);
    const snapshot = store.getSnapshot();

    expect(store.getSnapshot()).toBe(snapshot);
    expect(store.getSnapshot()).toBe(snapshot);

    const renders = jest.fn();
    const { result } = renderHook(() => {
      renders();
      return useSyncExternalStore(store.subscribe, store.getSnapshot);
    });

    expect(result.current).toBe(snapshot);
    expect(renders).toHaveBeenCalledTimes(1);
  });
});

describe('updateDashboardLayoutSetting / initializeDashboardLayoutSetting', () => {
  it('creates the layout maps on demand and round-trips through a synced doc', () => {
    const { doc, view, database } = createFixture();
    const rows = [
      row('r1', [widget('w1', 8), widget('w2', 4, 'db-other', 'other-view')], 480),
      row('r2', [widget('w3', 12)]),
    ];

    expect(view.get(YjsDatabaseKey.layout_settings)).toBeUndefined();
    doc.transact(() =>
      updateDashboardLayoutSetting(view, { rows, globalFilters: [textFilter], showWidgetTitles: false })
    );

    const stored = view.get(YjsDatabaseKey.layout_settings).get(DASHBOARD_LAYOUT_KEY);

    expect(stored.get(YjsDatabaseKey.dashboard_rows)).toEqual([
      {
        id: 'r1',
        height: 480,
        widgets: [
          { id: 'w1', view_id: 'view-w1', database_id: 'db-host', width: 8 },
          { id: 'w2', view_id: 'other-view', database_id: 'db-other', width: 4 },
        ],
      },
      { id: 'r2', height: 360, widgets: [{ id: 'w3', view_id: 'view-w3', database_id: 'db-host', width: 12 }] },
    ]);
    expect(stored.get(YjsDatabaseKey.dashboard_global_filters)).toEqual([
      {
        id: 'gf:1',
        name: 'Status',
        ty: FieldType.RichText,
        condition: 2,
        content: 'done',
        targets: { 'db-host': 'field-a', 'db-other': 'field-b' },
        target_order: ['db-host', 'db-other'],
      },
    ]);
    expect(readDashboardLayoutSetting(database, VIEW_ID)).toEqual({
      rows,
      globalFilters: [textFilter],
      showWidgetTitles: false,
    });

    const remote = new Y.Doc();

    sync(doc, remote);
    const remoteDatabase = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    expect(readDashboardLayoutSetting(remoteDatabase, VIEW_ID)).toEqual({
      rows,
      globalFilters: [textFilter],
      showWidgetTitles: false,
    });
  });

  it('normalizes rows before writing them', () => {
    const { doc, view, database } = createFixture();

    doc.transact(() =>
      updateDashboardLayoutSetting(view, {
        rows: [
          row(
            'r1',
            Array.from({ length: 5 }, (_, index) => widget(`w${index}`, 12)),
            10
          ),
        ],
      })
    );

    const { rows } = readDashboardLayoutSetting(database, VIEW_ID);

    expect(layoutShape(rows)).toEqual([['w0', 'w1', 'w2', 'w3'], ['w4']]);
    expect(rows.map((item) => item.height)).toEqual([DASHBOARD_MIN_ROW_HEIGHT, DASHBOARD_MIN_ROW_HEIGHT]);
    expect(widths(rows[0])).toEqual([3, 3, 3, 3]);
  });

  it('patches only the keys present in the update', () => {
    const { doc, view, database } = createFixture();
    const rows = [row('r1', [widget('w1')])];

    doc.transact(() => updateDashboardLayoutSetting(view, { rows, globalFilters: [textFilter] }));
    doc.transact(() => updateDashboardLayoutSetting(view, { showWidgetTitles: false }));
    expect(readDashboardLayoutSetting(database, VIEW_ID)).toEqual({
      rows,
      globalFilters: [textFilter],
      showWidgetTitles: false,
    });

    doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: [] }));
    expect(readDashboardLayoutSetting(database, VIEW_ID)).toEqual({ rows, globalFilters: [], showWidgetTitles: false });

    doc.transact(() => updateDashboardLayoutSetting(view, { rows: [] }));
    expect(readDashboardLayoutSetting(database, VIEW_ID).rows).toEqual([]);
  });

  it('keeps other layouts untouched in an existing layout_settings map', () => {
    const { doc, view } = createFixture();

    doc.transact(() => {
      const layouts = new Y.Map();
      const calendar = new Y.Map();

      view.set(YjsDatabaseKey.layout_settings, layouts as never);
      layouts.set('2', calendar);
      calendar.set(YjsDatabaseKey.field_id, 'date');
    });
    const layouts = view.get(YjsDatabaseKey.layout_settings);

    doc.transact(() => updateDashboardLayoutSetting(view, { showWidgetTitles: false }));
    expect(view.get(YjsDatabaseKey.layout_settings)).toBe(layouts);
    expect((layouts.get('2' as never) as Y.Map<unknown>).get(YjsDatabaseKey.field_id)).toBe('date');
    expect(layouts.get(DASHBOARD_LAYOUT_KEY).get(YjsDatabaseKey.show_widget_titles)).toBe(false);
  });

  it('initialize seeds empty lists once and never overwrites existing content', () => {
    const { doc, view, database } = createFixture();

    doc.transact(() => initializeDashboardLayoutSetting(view));
    const setting = view.get(YjsDatabaseKey.layout_settings).get(DASHBOARD_LAYOUT_KEY);

    expect(setting.get(YjsDatabaseKey.dashboard_rows)).toEqual([]);
    expect(setting.get(YjsDatabaseKey.dashboard_global_filters)).toEqual([]);
    expect(setting.has(YjsDatabaseKey.show_widget_titles)).toBe(false);

    const rows = [row('r1', [widget('w1')])];

    doc.transact(() => updateDashboardLayoutSetting(view, { rows, globalFilters: [textFilter] }));
    doc.transact(() => initializeDashboardLayoutSetting(view));
    expect(readDashboardLayoutSetting(database, VIEW_ID)).toEqual({
      rows,
      globalFilters: [textFilter],
      showWidgetTitles: true,
    });
  });
});

describe('createDashboardLayoutStore', () => {
  it('returns stable snapshots and notifies only on relevant changes', () => {
    const { doc, view, views } = createFixture();
    const store = createDashboardLayoutStore(doc, VIEW_ID);
    const notify = jest.fn();
    const unsubscribe = store.subscribe(notify);
    const initial = store.getSnapshot();

    expect(initial).toBe(DEFAULT_DASHBOARD_LAYOUT_SETTING);
    expect(store.getSnapshot()).toBe(initial);

    const rows = [row('r1', [widget('w1', 6), widget('w2', 6)])];

    doc.transact(() => updateDashboardLayoutSetting(view, { rows }));
    expect(notify).toHaveBeenCalledTimes(1);
    const withRows = store.getSnapshot();

    expect(withRows.rows).toEqual(rows);
    expect(store.getSnapshot()).toBe(withRows);

    // Rewriting identical rows (a new stored value) keeps the snapshot.
    doc.transact(() => updateDashboardLayoutSetting(view, { rows: rows.map((item) => ({ ...item })) }));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(withRows);

    // Changing only the title flag keeps the rows / filters identity.
    doc.transact(() => updateDashboardLayoutSetting(view, { showWidgetTitles: false }));
    expect(notify).toHaveBeenCalledTimes(2);
    const withFlag = store.getSnapshot();

    expect(withFlag).not.toBe(withRows);
    expect(withFlag.rows).toBe(withRows.rows);
    expect(withFlag.globalFilters).toBe(withRows.globalFilters);
    expect(withFlag.showWidgetTitles).toBe(false);

    doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: [textFilter] }));
    expect(notify).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().rows).toBe(withRows.rows);
    expect(store.getSnapshot().globalFilters).toEqual([textFilter]);

    // Another layout's setting and another view do not notify.
    doc.transact(() => {
      const calendar = new Y.Map();

      view.get(YjsDatabaseKey.layout_settings).set('2' as never, calendar as never);
      calendar.set(YjsDatabaseKey.field_id, 'date');
    });
    doc.transact(() => {
      const other = new Y.Map() as YDatabaseView;

      views.set('other', other);
      initializeDashboardLayoutSetting(other);
      updateDashboardLayoutSetting(other, { rows: [row('x', [widget('x1')])] });
    });
    expect(notify).toHaveBeenCalledTimes(3);

    unsubscribe();
    doc.transact(() => updateDashboardLayoutSetting(view, { rows: [] }));
    expect(notify).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().rows).toEqual([]);
  });

  it('notifies when a remote update replaces the whole view', () => {
    const { doc } = createFixture();
    const remoteDoc = new Y.Doc();
    const store = createDashboardLayoutStore(doc, VIEW_ID);
    const notify = jest.fn();
    const unsubscribe = store.subscribe(notify);
    const rows = [row('r1', [widget('w1')])];

    sync(doc, remoteDoc);
    remoteDoc.transact(() => {
      const remoteDatabase = remoteDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
      const replacement = new Y.Map() as YDatabaseView;

      remoteDatabase.get(YjsDatabaseKey.views).set(VIEW_ID, replacement);
      updateDashboardLayoutSetting(replacement, { rows });
    });
    sync(remoteDoc, doc);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().rows).toEqual(rows);
    unsubscribe();
  });

  it('notifies when a remote update inserts the database map', () => {
    const doc = new Y.Doc();
    const store = createDashboardLayoutStore(doc, VIEW_ID);
    const notify = jest.fn();
    const unsubscribe = store.subscribe(notify);
    const remote = createFixture();

    remote.doc.transact(() => updateDashboardLayoutSetting(remote.view, { showWidgetTitles: false }));
    sync(remote.doc, doc);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().showWidgetTitles).toBe(false);
    unsubscribe();
  });
});

describe('pure row operations', () => {
  describe('count / find / canAdd', () => {
    it('counts and finds widgets', () => {
      const rows = [row('r1', [widget('a'), widget('b')]), row('r2', [widget('c')])];

      expect(countDashboardWidgets(rows)).toBe(3);
      expect(countDashboardWidgets([])).toBe(0);
      expect(findDashboardWidget(rows, 'c')).toEqual({
        rowIndex: 1,
        index: 0,
        row: rows[1],
        widget: rows[1].widgets[0],
      });
      expect(findDashboardWidget(rows, 'b')).toMatchObject({ rowIndex: 0, index: 1 });
      expect(findDashboardWidget(rows, 'missing')).toBeNull();
    });

    it('refuses additions past the dashboard or row limits', () => {
      const rows = [
        row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)]),
        row('r2', [widget('e')]),
      ];

      expect(canAddDashboardWidget(rows)).toBe(true);
      expect(canAddDashboardWidget(rows, { type: 'new_row' })).toBe(true);
      expect(canAddDashboardWidget(rows, { type: 'existing_row', rowId: 'r2' })).toBe(true);
      expect(canAddDashboardWidget(rows, { type: 'existing_row', rowId: 'r1' })).toBe(false);
      expect(canAddDashboardWidget(rows, { type: 'existing_row', rowId: 'missing' })).toBe(false);
      expect(canAddDashboardWidget(fullDashboard())).toBe(false);
      expect(canAddDashboardWidget(fullDashboard(), { type: 'new_row' })).toBe(false);
    });
  });

  describe('getDashboardJoinWidth', () => {
    it('asks for an equal share of the row', () => {
      expect(getDashboardJoinWidth(row('r', []))).toBe(12);
      expect(getDashboardJoinWidth(row('r', [widget('a', 12)]))).toBe(12);
      expect(getDashboardJoinWidth(row('r', [widget('a', 8), widget('b', 4)]))).toBe(6);
      expect(getDashboardJoinWidth(row('r', [widget('a', 4), widget('b', 4), widget('c', 4)]))).toBe(4);
    });

    it('treats a row without widths as a full row', () => {
      expect(getDashboardJoinWidth(row('r', [widget('a', 0), widget('b', 0)]))).toBe(6);
    });
  });

  describe('addDashboardWidget', () => {
    it('appends a full-width row by default', () => {
      const rows = [row('r1', [widget('a')])];
      const result = addDashboardWidget(rows, widget('b', 4));

      expect(layoutShape(result)).toEqual([['a'], ['b']]);
      expect(widths(result[1])).toEqual([12]);
      expect(result[1].id).toMatch(/^r:/);
      expect(result[1].height).toBe(DASHBOARD_DEFAULT_ROW_HEIGHT);
      expect(layoutShape(rows)).toEqual([['a']]);
    });

    it('inserts a new row at the requested index, clamped to the end', () => {
      const rows = [row('r1', [widget('a')]), row('r2', [widget('b')])];

      expect(layoutShape(addDashboardWidget(rows, widget('x'), { type: 'new_row', rowIndex: 0 }))).toEqual([
        ['x'],
        ['a'],
        ['b'],
      ]);
      expect(layoutShape(addDashboardWidget(rows, widget('x'), { type: 'new_row', rowIndex: 1 }))).toEqual([
        ['a'],
        ['x'],
        ['b'],
      ]);
      expect(layoutShape(addDashboardWidget(rows, widget('x'), { type: 'new_row', rowIndex: 99 }))).toEqual([
        ['a'],
        ['b'],
        ['x'],
      ]);
      expect(layoutShape(addDashboardWidget([], widget('x')))).toEqual([['x']]);
    });

    it('adds into an existing row and rebalances widths', () => {
      const rows = [row('r1', [widget('a', 12)])];
      const appended = addDashboardWidget(rows, widget('b'), { type: 'existing_row', rowId: 'r1' });

      expect(layoutShape(appended)).toEqual([['a', 'b']]);
      expect(sum(widths(appended[0]))).toBe(12);
      expect(appended[0].id).toBe('r1');

      const prepended = addDashboardWidget(appended, widget('c'), { type: 'existing_row', rowId: 'r1', index: 0 });

      expect(layoutShape(prepended)).toEqual([['c', 'a', 'b']]);
      expect(sum(widths(prepended[0]))).toBe(12);

      const clamped = addDashboardWidget(prepended, widget('d'), { type: 'existing_row', rowId: 'r1', index: 42 });

      expect(layoutShape(clamped)).toEqual([['c', 'a', 'b', 'd']]);
      expect(sum(widths(clamped[0]))).toBe(12);
      clamped[0].widgets.forEach((item) => expect(item.width).toBeGreaterThanOrEqual(1));
    });

    it('splits an equal row equally when a widget joins', () => {
      const equalQuarters = [row('r1', [widget('a', 4), widget('b', 4), widget('c', 4)])];

      expect(widths(addDashboardWidget(equalQuarters, widget('d'), { type: 'existing_row', rowId: 'r1' })[0])).toEqual([
        3, 3, 3, 3,
      ]);
    });

    it('gives a joining widget an equal share and keeps the others proportional', () => {
      const rows = [row('r1', [widget('a', 8), widget('b', 4)])];
      const result = addDashboardWidget(rows, widget('c', 12), { type: 'existing_row', rowId: 'r1' });

      expect(widths(result[0])).toEqual([5, 3, 4]);
    });

    it('splits a one-widget row in half when a widget joins', () => {
      const rows = [row('r1', [widget('a', 12)])];

      expect(widths(addDashboardWidget(rows, widget('b', 3), { type: 'existing_row', rowId: 'r1' })[0])).toEqual([6, 6]);
    });

    it('returns the same rows when the placement is refused', () => {
      const full = fullDashboard();
      const fullRow = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)])];

      expect(addDashboardWidget(full, widget('x'))).toBe(full);
      expect(addDashboardWidget(full, widget('x'), { type: 'new_row', rowIndex: 0 })).toBe(full);
      expect(addDashboardWidget(fullRow, widget('x'), { type: 'existing_row', rowId: 'r1' })).toBe(fullRow);
      expect(addDashboardWidget(fullRow, widget('x'), { type: 'existing_row', rowId: 'missing' })).toBe(fullRow);
    });
  });

  describe('removeDashboardWidget', () => {
    it('removes the widget and rebalances its row', () => {
      const rows = [row('r1', [widget('a', 4), widget('b', 4), widget('c', 4)]), row('r2', [widget('d')])];
      const result = removeDashboardWidget(rows, 'b');

      expect(layoutShape(result)).toEqual([['a', 'c'], ['d']]);
      expect(widths(result[0])).toEqual([6, 6]);
      expect(layoutShape(rows)).toEqual([['a', 'b', 'c'], ['d']]);
    });

    it('drops a row that becomes empty', () => {
      const rows = [row('r1', [widget('a')]), row('r2', [widget('b')])];
      const result = removeDashboardWidget(rows, 'a');

      expect(result.map((item) => item.id)).toEqual(['r2']);
      expect(removeDashboardWidget(result, 'b')).toEqual([]);
    });

    it('leaves the layout unchanged for an unknown widget', () => {
      const rows = [row('r1', [widget('a', 6), widget('b', 6)])];

      expect(sameDashboardRows(removeDashboardWidget(rows, 'missing'), rows)).toBe(true);
    });
  });

  describe('duplicateDashboardWidget', () => {
    it('places the copy right after the source in the same row', () => {
      const rows = [row('r1', [widget('a', 6, 'db-other', 'view-x'), widget('b', 6)])];
      const result = duplicateDashboardWidget(rows, 'a');

      expect(result[0].widgets).toHaveLength(3);
      expect(result[0].widgets[0].id).toBe('a');
      expect(result[0].widgets[2].id).toBe('b');
      const copy = result[0].widgets[1];

      expect(copy.id).toMatch(/^w:/);
      expect(copy.id).not.toBe('a');
      expect(copy.viewId).toBe('view-x');
      expect(copy.databaseId).toBe('db-other');
      expect(sum(widths(result[0]))).toBe(12);
    });

    it('starts a new row directly below when the source row is full', () => {
      const rows = [
        row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)]),
        row('r2', [widget('e')]),
      ];
      const result = duplicateDashboardWidget(rows, 'c');

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('r1');
      expect(result[0].widgets).toHaveLength(4);
      expect(result[1].widgets).toHaveLength(1);
      expect(result[1].widgets[0]).toMatchObject({ viewId: 'view-c', databaseId: 'db-host', width: 12 });
      expect(result[2].id).toBe('r2');
    });

    it('refuses on a full dashboard or an unknown widget', () => {
      const full = fullDashboard();
      const rows = [row('r1', [widget('a')])];

      expect(duplicateDashboardWidget(full, 'w0-0')).toBe(full);
      expect(duplicateDashboardWidget(rows, 'missing')).toBe(rows);
    });
  });

  describe('moveDashboardWidget', () => {
    it('moves a widget into another row and removes the emptied source row', () => {
      const rows = [row('r1', [widget('a')]), row('r2', [widget('b')])];
      const result = moveDashboardWidget(rows, 'a', { type: 'existing_row', rowId: 'r2', index: 0 });

      expect(layoutShape(result)).toEqual([['a', 'b']]);
      expect(result[0].id).toBe('r2');
      expect(sum(widths(result[0]))).toBe(12);
      expect(result[0].widgets.map((item) => item.width).every((width) => width >= 1)).toBe(true);
    });

    it('gives a widget joining another row an equal share', () => {
      const rows = [row('r1', [widget('p', 6), widget('n', 6)]), row('r2', [widget('t', 12)])];
      const result = moveDashboardWidget(rows, 't', { type: 'existing_row', rowId: 'r1', index: 2 });

      expect(layoutShape(result)).toEqual([['p', 'n', 't']]);
      expect(widths(result[0])).toEqual([4, 4, 4]);

      const split = moveDashboardWidget(
        [row('r1', [widget('a', 3), widget('b', 9)]), row('r2', [widget('c', 12)])],
        'a',
        { type: 'existing_row', rowId: 'r2', index: 1 }
      );

      expect(layoutShape(split)).toEqual([['b'], ['c', 'a']]);
      expect(widths(split[1])).toEqual([6, 6]);
    });

    it('moves left and right within a row', () => {
      const rows = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 6)])];

      const right = moveDashboardWidget(rows, 'a', { type: 'existing_row', rowId: 'r1', index: 1 });

      expect(layoutShape(right)).toEqual([['b', 'a', 'c']]);
      expect(widths(right[0])).toEqual([3, 3, 6]);

      const left = moveDashboardWidget(rows, 'c', { type: 'existing_row', rowId: 'r1', index: 0 });

      expect(layoutShape(left)).toEqual([['c', 'a', 'b']]);
      expect(widths(left[0])).toEqual([6, 3, 3]);
    });

    it('allows reordering inside a full row', () => {
      const rows = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)])];
      const result = moveDashboardWidget(rows, 'a', { type: 'existing_row', rowId: 'r1' });

      expect(layoutShape(result)).toEqual([['b', 'c', 'd', 'a']]);
    });

    it('refuses moving into a full or missing row and ignores unknown widgets', () => {
      const rows = [
        row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)]),
        row('r2', [widget('e')]),
      ];

      expect(moveDashboardWidget(rows, 'e', { type: 'existing_row', rowId: 'r1' })).toBe(rows);
      expect(moveDashboardWidget(rows, 'e', { type: 'existing_row', rowId: 'missing' })).toBe(rows);
      expect(moveDashboardWidget(rows, 'missing', { type: 'new_row' })).toBe(rows);
    });

    it('moves a widget into its own new row keeping the source row height', () => {
      const rows = [row('r1', [widget('a', 6), widget('b', 6)], 500), row('r2', [widget('c')])];
      const result = moveDashboardWidget(rows, 'a', { type: 'new_row', rowIndex: 0 });

      expect(layoutShape(result)).toEqual([['a'], ['b'], ['c']]);
      expect(result[0].id).toMatch(/^r:/);
      expect(result[0].height).toBe(500);
      expect(widths(result[0])).toEqual([12]);
      expect(widths(result[1])).toEqual([12]);

      const appended = moveDashboardWidget(rows, 'b', { type: 'new_row' });

      expect(layoutShape(appended)).toEqual([['a'], ['c'], ['b']]);
    });

    it('expresses new-row indexes against the original list when the source row disappears', () => {
      const rows = [row('r1', [widget('a')]), row('r2', [widget('b')]), row('r3', [widget('c')])];

      // "Move down": insert before the row that followed the next one.
      expect(layoutShape(moveDashboardWidget(rows, 'a', { type: 'new_row', rowIndex: 2 }))).toEqual([
        ['b'],
        ['a'],
        ['c'],
      ]);
      expect(layoutShape(moveDashboardWidget(rows, 'a', { type: 'new_row', rowIndex: 3 }))).toEqual([
        ['b'],
        ['c'],
        ['a'],
      ]);
      // "Move up": an index before the source needs no adjustment.
      expect(layoutShape(moveDashboardWidget(rows, 'c', { type: 'new_row', rowIndex: 1 }))).toEqual([
        ['a'],
        ['c'],
        ['b'],
      ]);
      expect(layoutShape(moveDashboardWidget(rows, 'c', { type: 'new_row', rowIndex: -5 }))).toEqual([
        ['c'],
        ['a'],
        ['b'],
      ]);

      const shared = [row('r1', [widget('a', 6), widget('d', 6)]), row('r2', [widget('b')]), row('r3', [widget('c')])];

      expect(layoutShape(moveDashboardWidget(shared, 'a', { type: 'new_row', rowIndex: 2 }))).toEqual([
        ['d'],
        ['b'],
        ['a'],
        ['c'],
      ]);
    });

    it('never mutates its input', () => {
      const rows = [row('r1', [widget('a', 6), widget('b', 6)]), row('r2', [widget('c')])];
      const snapshot = JSON.parse(JSON.stringify(rows));

      moveDashboardWidget(rows, 'a', { type: 'existing_row', rowId: 'r2' });
      moveDashboardWidget(rows, 'c', { type: 'new_row', rowIndex: 0 });
      expect(rows).toEqual(snapshot);
    });
  });

  describe('resizeDashboardWidget', () => {
    const rows = [
      row('r1', [widget('a', 6), widget('b', 6)]),
      row('r2', [widget('c', 4), widget('d', 4), widget('e', 4)]),
    ];

    it('returns the same rows for a zero delta', () => {
      expect(resizeDashboardWidget(rows, 'r1', 0, 0)).toBe(rows);
    });

    it('moves columns between neighbours and keeps the row sum', () => {
      const grown = resizeDashboardWidget(rows, 'r1', 0, 2);

      expect(widths(grown[0])).toEqual([8, 4]);
      expect(grown[1]).toBe(rows[1]);

      const shrunk = resizeDashboardWidget(rows, 'r2', 1, -2);

      expect(widths(shrunk[1])).toEqual([4, 2, 6]);
      expect(shrunk[1].widgets[0]).toBe(rows[1].widgets[0]);
      expect(shrunk[0]).toBe(rows[0]);
    });

    it('clamps so both widgets keep at least one column', () => {
      expect(widths(resizeDashboardWidget(rows, 'r1', 0, 10)[0])).toEqual([11, 1]);
      expect(widths(resizeDashboardWidget(rows, 'r1', 0, -10)[0])).toEqual([1, 11]);

      const edge = [row('r1', [widget('a', 11), widget('b', 1)])];

      expect(resizeDashboardWidget(edge, 'r1', 0, 3)[0]).toBe(edge[0]);
    });

    it('ignores the last widget, invalid indexes and unknown rows', () => {
      const lastResult = resizeDashboardWidget(rows, 'r1', 1, 2);

      expect(lastResult[0]).toBe(rows[0]);
      expect(resizeDashboardWidget(rows, 'r1', -1, 2)[0]).toBe(rows[0]);
      expect(sameDashboardRows(resizeDashboardWidget(rows, 'missing', 0, 2), rows)).toBe(true);
    });
  });

  describe('setDashboardRowHeight', () => {
    const rows = [row('r1', [widget('a')], 360), row('r2', [widget('b')], 480)];

    it('updates only the target row', () => {
      const result = setDashboardRowHeight(rows, 'r1', 520);

      expect(result.map((item) => item.height)).toEqual([520, 480]);
      expect(result[1]).toBe(rows[1]);
    });

    it('clamps and rounds heights', () => {
      expect(setDashboardRowHeight(rows, 'r1', 10)[0].height).toBe(DASHBOARD_MIN_ROW_HEIGHT);
      expect(setDashboardRowHeight(rows, 'r1', 10000)[0].height).toBe(DASHBOARD_MAX_ROW_HEIGHT);
      expect(setDashboardRowHeight(rows, 'r1', 400.4)[0].height).toBe(400);
      expect(setDashboardRowHeight(rows, 'r1', Number.NaN)[0].height).toBe(DASHBOARD_DEFAULT_ROW_HEIGHT);
    });

    it('keeps row identity when the height does not change', () => {
      const result = setDashboardRowHeight(rows, 'r2', 480);

      expect(result[1]).toBe(rows[1]);
      expect(sameDashboardRows(result, rows)).toBe(true);
      expect(sameDashboardRows(setDashboardRowHeight(rows, 'missing', 600), rows)).toBe(true);
    });
  });

  describe('moveDashboardRow', () => {
    const rows = [row('r1', [widget('a')]), row('r2', [widget('b')]), row('r3', [widget('c')])];

    it('moves a row and clamps the target index', () => {
      expect(moveDashboardRow(rows, 'r1', 2).map((item) => item.id)).toEqual(['r2', 'r3', 'r1']);
      expect(moveDashboardRow(rows, 'r3', 0).map((item) => item.id)).toEqual(['r3', 'r1', 'r2']);
      expect(moveDashboardRow(rows, 'r1', 99).map((item) => item.id)).toEqual(['r2', 'r3', 'r1']);
      expect(moveDashboardRow(rows, 'r2', -3).map((item) => item.id)).toEqual(['r2', 'r1', 'r3']);
      expect(rows.map((item) => item.id)).toEqual(['r1', 'r2', 'r3']);
    });

    it('returns the same rows for a no-op or unknown row', () => {
      expect(moveDashboardRow(rows, 'r2', 1)).toBe(rows);
      expect(moveDashboardRow(rows, 'r3', 10)).toBe(rows);
      expect(moveDashboardRow(rows, 'missing', 0)).toBe(rows);
    });
  });

  describe('replaceDashboardWidgetView', () => {
    it('swaps the referenced view while keeping id and width', () => {
      const rows = [row('r1', [widget('a', 8), widget('b', 4)]), row('r2', [widget('c')])];
      const result = replaceDashboardWidgetView(rows, 'b', 'new-view', 'db-other');

      expect(result[0].widgets[1]).toEqual({ id: 'b', viewId: 'new-view', databaseId: 'db-other', width: 4 });
      expect(result[0].widgets[0]).toBe(rows[0].widgets[0]);
      expect(result[1]).toBe(rows[1]);
      expect(rows[0].widgets[1].viewId).toBe('view-b');
      expect(sameDashboardRows(replaceDashboardWidgetView(rows, 'missing', 'v', 'd'), rows)).toBe(true);
    });
  });

  describe('dashboardSourceDatabaseIds / sameDashboardRows', () => {
    it('lists unique source databases with the host first', () => {
      const rows = [
        row('r1', [widget('a', 6, 'db-2'), widget('b', 6, 'db-host')]),
        row('r2', [widget('c', 12, 'db-2'), widget('d', 12, 'db-3')]),
      ];

      expect(dashboardSourceDatabaseIds(rows, 'db-host')).toEqual(['db-host', 'db-2', 'db-3']);
      expect(dashboardSourceDatabaseIds(rows)).toEqual(['db-2', 'db-host', 'db-3']);
      expect(dashboardSourceDatabaseIds([], 'db-host')).toEqual(['db-host']);
    });

    it('compares rows structurally', () => {
      const rows = [row('r1', [widget('a', 6), widget('b', 6)])];
      const copy = JSON.parse(JSON.stringify(rows)) as DashboardRow[];

      expect(sameDashboardRows(rows, rows)).toBe(true);
      expect(sameDashboardRows(rows, copy)).toBe(true);
      expect(sameDashboardRows(rows, [{ ...copy[0], height: 400 }])).toBe(false);
      expect(sameDashboardRows(rows, [{ ...copy[0], id: 'other' }])).toBe(false);
      expect(sameDashboardRows(rows, [row('r1', [widget('a', 8), widget('b', 4)])])).toBe(false);
      expect(sameDashboardRows(rows, [row('r1', [widget('a', 6), widget('b', 6, 'db-other')])])).toBe(false);
      expect(sameDashboardRows(rows, [row('r1', [widget('a', 12)])])).toBe(false);
      expect(sameDashboardRows(rows, [])).toBe(false);
    });
  });
});

describe('resolveExtraFiltersForDatabase', () => {
  it('resolves global filters to plain view-filter nodes of mapped databases only', () => {
    const unmapped: DashboardGlobalFilter = { ...textFilter, id: 'gf:2', targets: { 'db-other': 'field-c' } };

    expect(resolveExtraFiltersForDatabase([textFilter, unmapped], 'db-host')).toEqual([
      {
        id: 'gf:1',
        filter_type: FilterType.Data,
        field_id: 'field-a',
        ty: FieldType.RichText,
        condition: 2,
        content: 'done',
      },
    ]);
    expect(resolveExtraFiltersForDatabase([textFilter, unmapped], 'db-other').map((item) => item.field_id)).toEqual([
      'field-b',
      'field-c',
    ]);
    expect(resolveExtraFiltersForDatabase([textFilter], 'db-unknown')).toEqual([]);
  });
});
