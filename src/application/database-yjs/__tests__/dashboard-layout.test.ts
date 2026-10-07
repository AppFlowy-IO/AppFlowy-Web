import { renderHook } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import * as Y from 'yjs';

import { YDatabase, YDatabaseView, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  addDashboardWidget,
  balanceRowWidths,
  canAddDashboardWidget,
  classifyDashboardMove,
  countDashboardWidgets,
  createDashboardLayoutStore,
  createDashboardRow,
  createDashboardWidget,
  dashboardSourceDatabaseIds,
  DEFAULT_DASHBOARD_LAYOUT_SETTING,
  duplicateDashboardWidget,
  findDashboardWidget,
  generateDashboardId,
  getDashboardAddToNewRowState,
  getDashboardRowControls,
  initializeDashboardLayoutSetting,
  moveDashboardRow,
  moveDashboardWidget,
  normalizeDashboardRows,
  observeLocalDashboardRowsChanges,
  readDashboardLayoutSetting,
  readStoredDashboardWidgets,
  removeDashboardWidget,
  replaceDashboardWidgetView,
  resizeDashboardWidget,
  sameDashboardGlobalFilters,
  sameDashboardRows,
  serializeDashboardRows,
  setDashboardRowHeight,
  shareDashboardGlobalFilters,
  shareDashboardRows,
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

import { decodeParityJson, loadParityFixture, seedParityMap } from './dashboard-parity-helpers';

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
    // WP06 §1.1: the add flow's pending slot and the persisted widget share the id generated at the click.
    expect(createDashboardWidget('view', 'db', 12, 'w:pending1')).toEqual({
      id: 'w:pending1',
      viewId: 'view',
      databaseId: 'db',
      width: 12,
    });

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
      showIconsInHeading: false,
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
      showIconsInHeading: false,
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
      showIconsInHeading: false,
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
    filters.push([{ name: 'Status', ty: FieldType.RichText, condition: 2, content: 'done', targets: { db: 'status' } }]);
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

describe('structural sharing of layout snapshots', () => {
  const statusFilter: DashboardGlobalFilter = {
    id: 'gf:status',
    name: 'Status',
    fieldType: FieldType.SingleSelect,
    condition: 0,
    content: 'todo',
    targets: { 'db-host': 'status', 'db-other': 'stage' },
  };
  const ownerFilter: DashboardGlobalFilter = {
    id: 'gf:owner',
    name: 'Owner',
    fieldType: FieldType.RichText,
    condition: 0,
    content: 'ann',
    targets: { 'db-host': 'owner' },
  };

  it('keeps every unchanged row and widget of the previous rows', () => {
    const previous = [row('r1', [widget('w1', 6), widget('w2', 6)]), row('r2', [widget('w3')])];
    const next = [
      row('r1', [widget('w1', 4), widget('w2', 8)]),
      row('r2', [widget('w3')], 480),
      row('r3', [widget('w4')]),
    ];
    const shared = shareDashboardRows(previous, next);

    expect(shared).toEqual(next);
    // Resized widgets are new; the moved-height row keeps its unchanged widget.
    expect(shared[0]).not.toBe(previous[0]);
    expect(shared[0].widgets[0]).not.toBe(previous[0].widgets[0]);
    expect(shared[1]).not.toBe(previous[1]);
    expect(shared[1].widgets[0]).toBe(previous[1].widgets[0]);
    expect(shared[2]).toBe(next[2]);
    expect(
      shareDashboardRows(
        previous,
        previous.map((item) => ({ ...item, widgets: [...item.widgets] }))
      )
    ).toBe(previous);
  });

  it('keeps a widget that moved to another row', () => {
    const previous = [row('r1', [widget('w1', 6), widget('w2', 6)]), row('r2', [widget('w3')])];
    const next = [row('r1', [widget('w1')]), row('r2', [widget('w3', 6), widget('w2', 6)])];
    const shared = shareDashboardRows(previous, next);

    expect(shared[1].widgets[1]).toBe(previous[0].widgets[1]);
    expect(shared[0].widgets[0]).not.toBe(previous[0].widgets[0]);
  });

  it('keeps every unchanged filter, and the targets of a renamed one', () => {
    const previous = [statusFilter, ownerFilter];
    const renamed = { ...statusFilter, name: 'Stage', targets: { ...statusFilter.targets } };
    const shared = shareDashboardGlobalFilters(previous, [
      renamed,
      { ...ownerFilter, targets: { ...ownerFilter.targets } },
    ]);

    expect(shared[0]).toEqual(renamed);
    expect(shared[0].targets).toBe(statusFilter.targets);
    expect(shared[1]).toBe(ownerFilter);

    const reordered = { ...statusFilter, targets: { 'db-other': 'stage', 'db-host': 'status' } };

    // Target order is meaningful (the first mapping is the primary one).
    expect(shareDashboardGlobalFilters(previous, [reordered, ownerFilter])[0].targets).toBe(reordered.targets);
    expect(shareDashboardGlobalFilters(previous, [{ ...statusFilter }, { ...ownerFilter }])).toBe(previous);
  });

  it('lets the layout store hand out the untouched rows of a changed layout', () => {
    const { doc, view } = createFixture();

    doc.transact(() =>
      updateDashboardLayoutSetting(view, {
        rows: [row('r1', [widget('w1')]), row('r2', [widget('w2')])],
        globalFilters: [statusFilter, ownerFilter],
      })
    );
    const store = createDashboardLayoutStore(doc, VIEW_ID);
    const before = store.getSnapshot();

    doc.transact(() =>
      updateDashboardLayoutSetting(view, {
        rows: [row('r1', [widget('w1')], 480), row('r2', [widget('w2')])],
        globalFilters: [statusFilter, { ...ownerFilter, content: 'bob' }],
      })
    );
    const after = store.getSnapshot();

    expect(after.rows).not.toBe(before.rows);
    expect(after.rows[0].height).toBe(480);
    expect(after.rows[0].widgets[0]).toBe(before.rows[0].widgets[0]);
    expect(after.rows[1]).toBe(before.rows[1]);
    expect(after.globalFilters[0]).toBe(before.globalFilters[0]);
    expect(after.globalFilters[1].content).toBe('bob');
    expect(after.globalFilters[1].targets).toBe(before.globalFilters[1].targets);
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
      showIconsInHeading: false,
    });

    const remote = new Y.Doc();

    sync(doc, remote);
    const remoteDatabase = remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;

    expect(readDashboardLayoutSetting(remoteDatabase, VIEW_ID)).toEqual({
      rows,
      globalFilters: [textFilter],
      showWidgetTitles: false,
      showIconsInHeading: false,
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
      showIconsInHeading: false,
    });

    doc.transact(() => updateDashboardLayoutSetting(view, { globalFilters: [] }));
    expect(readDashboardLayoutSetting(database, VIEW_ID)).toEqual({
      rows,
      globalFilters: [],
      showWidgetTitles: false,
      showIconsInHeading: false,
    });

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
      showIconsInHeading: false,
    });
  });
});

describe('a stored layout over the widget limit', () => {
  /** What another client stored: `count` widgets in rows of `perRow`, each with an unknown key. */
  function storedWidget(index: number, extra: Record<string, unknown> = { zz_probe: index }) {
    return { id: `w${index}`, view_id: `view-${index}`, database_id: 'db-host', width: 3, ...extra };
  }

  function storeRows(view: YDatabaseView, rows: unknown[]) {
    const layouts = new Y.Map();
    const setting = new Y.Map();

    setting.set(YjsDatabaseKey.dashboard_rows, rows);
    layouts.set(DASHBOARD_LAYOUT_KEY, setting);
    view.set(YjsDatabaseKey.layout_settings, layouts as never);
  }

  function storedRows(view: YDatabaseView) {
    return view.get(YjsDatabaseKey.layout_settings).get(DASHBOARD_LAYOUT_KEY).get(YjsDatabaseKey.dashboard_rows) as {
      id: string;
      widgets: { id: string }[];
    }[];
  }

  function storedWidgetIds(view: YDatabaseView) {
    return storedRows(view).flatMap((item) => item.widgets.map((entry) => entry.id));
  }

  /** 14 widgets: three full rows and a fourth row with two. */
  function fourteenWidgets() {
    return [0, 1, 2, 3].map((rowIndex) => ({
      id: `r${rowIndex}`,
      height: 360,
      zz_row: rowIndex,
      widgets: [0, 1, 2, 3]
        .map((index) => rowIndex * 4 + index)
        .filter((index) => index < 14)
        .map((index) => storedWidget(index)),
    }));
  }

  it('renders the first twelve of fourteen widgets and leaves storage alone', () => {
    const { doc, view, database } = createFixture();

    doc.transact(() => storeRows(view, fourteenWidgets()));
    const { rows } = readDashboardLayoutSetting(database, VIEW_ID);

    expect(countDashboardWidgets(rows)).toBe(DASHBOARD_MAX_WIDGETS);
    expect(layoutShape(rows)).toEqual([
      ['w0', 'w1', 'w2', 'w3'],
      ['w4', 'w5', 'w6', 'w7'],
      ['w8', 'w9', 'w10', 'w11'],
    ]);
    // Reading never writes.
    expect(storedWidgetIds(view)).toHaveLength(14);
    expect(readStoredDashboardWidgets(database, VIEW_ID).map((item) => item.id)).toEqual(
      Array.from({ length: 14 }, (_, index) => `w${index}`)
    );
  });

  it('keeps all fourteen in storage when the shown rows are rewritten', () => {
    const { doc, view, database } = createFixture();

    doc.transact(() => storeRows(view, fourteenWidgets()));
    const shown = readDashboardLayoutSetting(database, VIEW_ID).rows;

    // The user swaps the first two rows; the editor only knows the twelve it shows.
    doc.transact(() => updateDashboardLayoutSetting(view, { rows: moveDashboardRow(shown, 'r0', 1) }));

    expect(storedRows(view).map((item) => item.id)).toEqual(['r1', 'r0', 'r2', 'r3']);
    expect(storedWidgetIds(view)).toEqual([
      ...['w4', 'w5', 'w6', 'w7'],
      ...['w0', 'w1', 'w2', 'w3'],
      ...['w8', 'w9', 'w10', 'w11'],
      ...['w12', 'w13'],
    ]);
    // The hidden row is the stored object: its unknown keys and its widgets' survive.
    expect(storedRows(view)[3]).toEqual({
      id: 'r3',
      height: 360,
      zz_row: 3,
      widgets: [storedWidget(12), storedWidget(13)],
    });
    // Still twelve on screen, and a second rewrite still keeps fourteen.
    expect(countDashboardWidgets(readDashboardLayoutSetting(database, VIEW_ID).rows)).toBe(DASHBOARD_MAX_WIDGETS);
    doc.transact(() =>
      updateDashboardLayoutSetting(view, {
        rows: setDashboardRowHeight(readDashboardLayoutSetting(database, VIEW_ID).rows, 'r1', 480),
      })
    );
    expect(storedWidgetIds(view)).toHaveLength(14);
  });

  it('shows a hidden widget again once a shown one is removed', () => {
    const { doc, view, database } = createFixture();

    doc.transact(() => storeRows(view, fourteenWidgets()));
    doc.transact(() =>
      updateDashboardLayoutSetting(view, {
        rows: removeDashboardWidget(readDashboardLayoutSetting(database, VIEW_ID).rows, 'w0'),
      })
    );

    expect(storedWidgetIds(view)).toHaveLength(13);
    const { rows } = readDashboardLayoutSetting(database, VIEW_ID);

    expect(countDashboardWidgets(rows)).toBe(DASHBOARD_MAX_WIDGETS);
    expect(layoutShape(rows)).toEqual([
      ['w1', 'w2', 'w3'],
      ['w4', 'w5', 'w6', 'w7'],
      ['w8', 'w9', 'w10', 'w11'],
      ['w12'],
    ]);
  });

  it('gives the hidden rest of a partly shown row its own row id', () => {
    const { doc, view, database } = createFixture();
    // Rows of 4, 4, 3 and 3: the twelfth widget sits in the middle of the last row.
    const stored = [
      { id: 'r0', height: 360, widgets: [0, 1, 2, 3].map((index) => storedWidget(index)) },
      { id: 'r1', height: 360, widgets: [4, 5, 6, 7].map((index) => storedWidget(index)) },
      { id: 'r2', height: 360, widgets: [8, 9, 10].map((index) => storedWidget(index)) },
      { id: 'r3', height: 400, zz_row: 'keep', widgets: [11, 12, 13].map((index) => storedWidget(index)) },
    ];

    doc.transact(() => storeRows(view, stored));
    const shown = readDashboardLayoutSetting(database, VIEW_ID).rows;

    expect(layoutShape(shown)[3]).toEqual(['w11']);
    doc.transact(() => updateDashboardLayoutSetting(view, { rows: setDashboardRowHeight(shown, 'r0', 480) }));

    const rows = storedRows(view);

    expect(rows.map((item) => item.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r3:rest']);
    expect(new Set(rows.map((item) => item.id)).size).toBe(rows.length);
    expect(rows[4]).toEqual({
      id: 'r3:rest',
      height: 400,
      zz_row: 'keep',
      widgets: [storedWidget(12), storedWidget(13)],
    });
    expect(storedWidgetIds(view)).toHaveLength(14);
    // Unchanged on screen.
    expect(layoutShape(readDashboardLayoutSetting(database, VIEW_ID).rows)).toEqual(layoutShape(shown));
  });

  it('writes out the positional ids of hidden entries that stored none', () => {
    const { doc, view, database } = createFixture();
    const stored = [
      ...fourteenWidgets().slice(0, 3),
      { height: 360, widgets: [{ view_id: 'view-12', database_id: 'db-host', width: 6 }, 'not a widget'] },
    ];

    doc.transact(() => storeRows(view, stored));
    doc.transact(() =>
      updateDashboardLayoutSetting(view, {
        rows: moveDashboardRow(readDashboardLayoutSetting(database, VIEW_ID).rows, 'r0', 1),
      })
    );

    // The ids the entries had where they were read, so they cannot change with the new position.
    expect(storedRows(view)[3]).toEqual({
      id: 'r:3',
      height: 360,
      widgets: [{ id: 'w:3:0', view_id: 'view-12', database_id: 'db-host', width: 6 }],
    });
  });

  it('adds nothing to a layout within the limit', () => {
    const { doc, view, database } = createFixture();

    doc.transact(() => updateDashboardLayoutSetting(view, { rows: fullDashboard() }));
    doc.transact(() =>
      updateDashboardLayoutSetting(view, {
        // Down twice: to the end.
        rows: moveDashboardRow(moveDashboardRow(readDashboardLayoutSetting(database, VIEW_ID).rows, 'r0', 1), 'r0', 1),
      })
    );

    expect(storedRows(view).map((item) => item.id)).toEqual(['r1', 'r2', 'r0']);
    expect(storedWidgetIds(view)).toHaveLength(DASHBOARD_MAX_WIDGETS);
  });
});

describe('observeLocalDashboardRowsChanges', () => {
  it('reports the writes, undo and redo of this client with every stored widget before and after', () => {
    const { doc, view } = createFixture();
    const listener = jest.fn();
    const stop = observeLocalDashboardRowsChanges(doc, VIEW_ID, listener);
    const one = [row('r1', [widget('w1')])];
    const two = [row('r1', [widget('w1', 6), widget('w2', 6)])];
    const undo = new Y.UndoManager(doc.getMap(YjsEditorKey.data_section), { trackedOrigins: new Set(['local']) });

    doc.transact(() => updateDashboardLayoutSetting(view, { rows: one }), 'local');
    undo.stopCapturing();
    doc.transact(() => updateDashboardLayoutSetting(view, { rows: two }), 'local');
    expect(listener.mock.calls.map(([before, after]) => [before, after].map((list) => list.map((item: DashboardWidget) => item.viewId)))).toEqual([
      [[], ['view-w1']],
      [['view-w1'], ['view-w1', 'view-w2']],
    ]);

    undo.undo();
    expect(listener.mock.calls[2][1].map((item: DashboardWidget) => item.viewId)).toEqual(['view-w1']);
    undo.redo();
    expect(listener.mock.calls[3][1].map((item: DashboardWidget) => item.viewId)).toEqual(['view-w1', 'view-w2']);
    stop();
    doc.transact(() => updateDashboardLayoutSetting(view, { rows: one }), 'local');
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('never reports remote changes, and moves its baseline with them', () => {
    const local = createFixture();
    const remote = new Y.Doc();
    const listener = jest.fn();

    sync(local.doc, remote);
    observeLocalDashboardRowsChanges(local.doc, VIEW_ID, listener);
    const remoteView = (remote.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase)
      .get(YjsDatabaseKey.views)
      .get(VIEW_ID);

    remote.transact(() => updateDashboardLayoutSetting(remoteView, { rows: [row('r1', [widget('w1')])] }));
    sync(remote, local.doc);
    expect(listener).not.toHaveBeenCalled();

    local.doc.transact(() => updateDashboardLayoutSetting(local.view, { rows: [] }));
    expect(listener.mock.calls[0][0].map((item: DashboardWidget) => item.viewId)).toEqual(['view-w1']);
    expect(listener.mock.calls[0][1]).toEqual([]);
  });

  it('ignores writes to another view', () => {
    const { doc, views } = createFixture();
    const other = new Y.Map() as YDatabaseView;
    const listener = jest.fn();

    views.set('other', other);
    observeLocalDashboardRowsChanges(doc, VIEW_ID, listener);
    doc.transact(() => updateDashboardLayoutSetting(other, { rows: [row('r1', [widget('w1')])] }));
    expect(listener).not.toHaveBeenCalled();
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

    // Writing identical rows writes nothing (the stored value is kept), so the snapshot is kept.
    const storedBefore = view
      .get(YjsDatabaseKey.layout_settings)
      .get(DASHBOARD_LAYOUT_KEY)
      .get(YjsDatabaseKey.dashboard_rows);

    doc.transact(() => updateDashboardLayoutSetting(view, { rows: rows.map((item) => ({ ...item })) }));
    expect(view.get(YjsDatabaseKey.layout_settings).get(DASHBOARD_LAYOUT_KEY).get(YjsDatabaseKey.dashboard_rows)).toBe(
      storedBefore
    );
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

  it('changes the snapshot identity only when the icons flag changes', () => {
    const { doc, view } = createFixture();
    const store = createDashboardLayoutStore(doc, VIEW_ID);
    const before = store.getSnapshot();

    expect(before.showIconsInHeading).toBe(false);
    doc.transact(() => updateDashboardLayoutSetting(view, { showIconsInHeading: false }));
    expect(store.getSnapshot()).toBe(before);

    doc.transact(() => updateDashboardLayoutSetting(view, { showIconsInHeading: true }));
    const after = store.getSnapshot();

    expect(after).not.toBe(before);
    expect(after.showIconsInHeading).toBe(true);
    expect(after.rows).toBe(before.rows);
    expect(store.getSnapshot()).toBe(after);
  });
});

/** `dashboard-parity/layouts/show-icons-in-heading.json` (WP03), shared with desktop and Rust. */
interface ShowIconsInHeadingFixture {
  cases: { name: string; stored: Record<string, unknown>; read: boolean }[];
  write: {
    before: Record<string, unknown>;
    update: { show_icons_in_heading: boolean };
    after: Record<string, unknown>;
  };
}

describe('show_icons_in_heading (layouts/show-icons-in-heading.json)', () => {
  const fixture = loadParityFixture<ShowIconsInHeadingFixture>('layouts/show-icons-in-heading.json');

  function seededView(stored: Record<string, unknown>) {
    const { doc, view, database } = createFixture();

    doc.transact(() => {
      const layouts = new Y.Map();
      const setting = new Y.Map();

      view.set(YjsDatabaseKey.layout_settings, layouts as never);
      layouts.set(DASHBOARD_LAYOUT_KEY, setting);
      seedParityMap(setting as Y.Map<unknown>, stored);
    });
    return { doc, view, database };
  }

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('reads the %s case', (_name, entry) => {
    const { database } = seededView(entry.stored);

    expect(readDashboardLayoutSetting(database, VIEW_ID).showIconsInHeading).toBe(entry.read);
  });

  it('writes only that key on a toggle and keeps every other key', () => {
    const { doc, view, database } = seededView(fixture.write.before);

    doc.transact(() =>
      updateDashboardLayoutSetting(view, { showIconsInHeading: fixture.write.update.show_icons_in_heading })
    );

    const setting = view.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY) as unknown as Y.Map<unknown>;

    expect(decodeParityJson(setting.toJSON())).toEqual(fixture.write.after);
    expect(readDashboardLayoutSetting(database, VIEW_ID).showIconsInHeading).toBe(true);
  });

  it('never writes an unchanged flag (absent reads as false)', () => {
    const { doc, view } = createFixture();
    doc.transact(() => updateDashboardLayoutSetting(view, { showIconsInHeading: false }));
    expect(
      view.get(YjsDatabaseKey.layout_settings)?.get(DASHBOARD_LAYOUT_KEY)?.get(YjsDatabaseKey.show_icons_in_heading)
    ).toBeUndefined();
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

    it('splits the row equally when a widget joins, discarding custom widths (R-SPLIT)', () => {
      const rows = [row('r1', [widget('a', 8), widget('b', 4)])];
      const result = addDashboardWidget(rows, widget('c', 12), { type: 'existing_row', rowId: 'r1' });

      expect(widths(result[0])).toEqual([4, 4, 4]);
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

    // WP05 §1.4: the copy shows the source view's owned copy, split 6 / 6.
    it('points the copy at the given view copy', () => {
      const rows = [row('r1', [widget('a', 12, 'db-other', 'view-x')])];
      const result = duplicateDashboardWidget(rows, 'a', { viewId: 'view-x-copy', databaseId: 'db-other' });

      expect(widths(result[0])).toEqual([6, 6]);
      expect(result[0].widgets[0]).toMatchObject({ id: 'a', viewId: 'view-x' });
      expect(result[0].widgets[1]).toMatchObject({ viewId: 'view-x-copy', databaseId: 'db-other' });
      expect(result[0].widgets[1].id).not.toBe('a');
      expect(duplicateDashboardWidget(fullDashboard(), 'w0-0', { viewId: 'copy', databaseId: 'db' })).toEqual(
        fullDashboard()
      );
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
      expect(widths(split[0])).toEqual([12]);
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

    it('keeps both neighbours at the resize minimum of the measured row (WP02)', () => {
      const three = [row('r1', [widget('a', 4), widget('b', 4), widget('c', 4)])];

      expect(widths(resizeDashboardWidget(three, 'r1', 0, 2, 3)[0])).toEqual([5, 3, 4]);
      expect(widths(resizeDashboardWidget(three, 'r1', 0, -3, 3)[0])).toEqual([3, 5, 4]);
      // The default minimum of one column is unchanged.
      expect(widths(resizeDashboardWidget(three, 'r1', 0, 2)[0])).toEqual([6, 2, 4]);
    });

    it('never forces a widget below the minimum to grow, nor shrinks it further', () => {
      const narrow = [row('r1', [widget('a', 8), widget('b', 2), widget('c', 2)])];

      expect(resizeDashboardWidget(narrow, 'r1', 1, 1, 3)[0]).toBe(narrow[0]);
      expect(resizeDashboardWidget(narrow, 'r1', 1, -1, 3)[0]).toBe(narrow[0]);
      expect(widths(resizeDashboardWidget(narrow, 'r1', 0, -1, 3)[0])).toEqual([7, 3, 2]);
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
    const rows = [
      row('r1', [widget('a', 8), widget('b', 4)], 360),
      row('r2', [widget('c')], 480),
      row('r3', [widget('d')], 240),
    ];

    it('swaps a row with its neighbour above or below', () => {
      expect(moveDashboardRow(rows, 'r1', 1).map((item) => item.id)).toEqual(['r2', 'r1', 'r3']);
      expect(moveDashboardRow(rows, 'r2', 1).map((item) => item.id)).toEqual(['r1', 'r3', 'r2']);
      expect(moveDashboardRow(rows, 'r3', -1).map((item) => item.id)).toEqual(['r1', 'r3', 'r2']);
      expect(moveDashboardRow(rows, 'r2', -1).map((item) => item.id)).toEqual(['r2', 'r1', 'r3']);
    });

    it('keeps the row objects (ids, heights, widths) and never mutates the input', () => {
      const result = moveDashboardRow(rows, 'r1', 1);

      expect(result[1]).toBe(rows[0]);
      expect(result[0]).toBe(rows[1]);
      expect(result[2]).toBe(rows[2]);
      expect(result.map((item) => item.height)).toEqual([480, 360, 240]);
      expect(widths(result[1])).toEqual([8, 4]);
      expect(rows.map((item) => item.id)).toEqual(['r1', 'r2', 'r3']);
    });

    it('returns the same rows at either end, for a single row or an unknown row', () => {
      const single = [row('r1', [widget('a')])];

      expect(moveDashboardRow(rows, 'r1', -1)).toBe(rows);
      expect(moveDashboardRow(rows, 'r3', 1)).toBe(rows);
      expect(moveDashboardRow(single, 'r1', -1)).toBe(single);
      expect(moveDashboardRow(single, 'r1', 1)).toBe(single);
      expect(moveDashboardRow(rows, 'missing', 1)).toBe(rows);
      expect(moveDashboardRow(rows, 'r2', 2 as 1)).toBe(rows);
    });
  });

  describe('classifyDashboardMove', () => {
    const rows = [row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)]), row('r2', [widget('e')])];

    it('allows a move that changes the layout', () => {
      expect(classifyDashboardMove(rows, 'a', { type: 'existing_row', rowId: 'r1', index: 2 })).toBe('allowed');
      expect(classifyDashboardMove(rows, 'a', { type: 'existing_row', rowId: 'r2', index: 0 })).toBe('allowed');
      expect(classifyDashboardMove(rows, 'a', { type: 'new_row', rowIndex: 2 })).toBe('allowed');
    });

    it('blocks a widget joining a full row of another', () => {
      expect(classifyDashboardMove(rows, 'e', { type: 'existing_row', rowId: 'r1', index: 0 })).toBe('blocked');
    });

    it('calls a move that changes nothing, or an unknown widget or row, a no-op', () => {
      expect(classifyDashboardMove(rows, 'a', { type: 'existing_row', rowId: 'r1', index: 0 })).toBe('noop');
      expect(classifyDashboardMove(rows, 'e', { type: 'new_row', rowIndex: 1 })).toBe('noop');
      expect(classifyDashboardMove(rows, 'e', { type: 'new_row', rowIndex: 2 })).toBe('noop');
      expect(classifyDashboardMove(rows, 'missing', { type: 'new_row' })).toBe('noop');
      expect(classifyDashboardMove(rows, 'a', { type: 'existing_row', rowId: 'missing' })).toBe('noop');
    });
  });

  describe('getDashboardRowControls / getDashboardAddToNewRowState', () => {
    it('offers the moves a row can make, and none for a single row', () => {
      const rows = [row('r1', [widget('a')]), row('r2', [widget('b')]), row('r3', [widget('c')])];

      expect(getDashboardRowControls(rows, 'r1')).toEqual({ moveUp: false, moveDown: true, addToRow: 'enabled' });
      expect(getDashboardRowControls(rows, 'r2')).toEqual({ moveUp: true, moveDown: true, addToRow: 'enabled' });
      expect(getDashboardRowControls(rows, 'r3')).toEqual({ moveUp: true, moveDown: false, addToRow: 'enabled' });
      expect(getDashboardRowControls([rows[0]], 'r1')).toEqual({ moveUp: false, moveDown: false, addToRow: 'enabled' });
      expect(getDashboardRowControls(rows, 'missing')).toEqual({ moveUp: false, moveDown: false, addToRow: 'hidden' });
    });

    it('hides the add control of a full row and disables the others on a full dashboard', () => {
      const partial = [
        row('r1', [widget('a', 3), widget('b', 3), widget('c', 3), widget('d', 3)]),
        row('r2', [widget('e')]),
      ];
      const full = [
        ...fullDashboard().slice(0, 2),
        row('r3', [widget('x1', 4), widget('x2', 4), widget('x3', 4)]),
        row('r4', [widget('x4')]),
      ];

      expect(getDashboardRowControls(partial, 'r1').addToRow).toBe('hidden');
      expect(getDashboardRowControls(partial, 'r2').addToRow).toBe('enabled');
      expect(getDashboardAddToNewRowState(partial)).toBe('enabled');
      expect(countDashboardWidgets(full)).toBe(DASHBOARD_MAX_WIDGETS);
      expect(getDashboardRowControls(full, 'r3').addToRow).toBe('disabled');
      expect(getDashboardRowControls(full, 'r4').addToRow).toBe('disabled');
      expect(getDashboardAddToNewRowState(full)).toBe('disabled');
      expect(getDashboardAddToNewRowState(fullDashboard())).toBe('disabled');
    });
  });

  describe('serializeDashboardRows after a cross-row move', () => {
    it('keeps the unknown keys of a widget that moved into another row (matched by widget id)', () => {
      const stored = [
        {
          id: 'r1',
          height: 360,
          zz_row: 'one',
          widgets: [
            { id: 'a', view_id: 'view-a', database_id: 'db-host', width: 6, zz_widget: { pinned: true } },
            { id: 'b', view_id: 'view-b', database_id: 'db-host', width: 6 },
          ],
        },
        { id: 'r2', height: 480, widgets: [{ id: 'c', view_id: 'view-c', database_id: 'db-host', width: 12 }] },
      ];
      const rows = [row('r1', [widget('a', 6), widget('b', 6)], 360), row('r2', [widget('c', 12)], 480)];
      const moved = moveDashboardWidget(rows, 'a', { type: 'existing_row', rowId: 'r2', index: 1 });

      expect(serializeDashboardRows(moved, stored)).toEqual([
        {
          id: 'r1',
          height: 360,
          zz_row: 'one',
          widgets: [{ id: 'b', view_id: 'view-b', database_id: 'db-host', width: 12 }],
        },
        {
          id: 'r2',
          height: 480,
          widgets: [
            { id: 'c', view_id: 'view-c', database_id: 'db-host', width: 6 },
            { id: 'a', view_id: 'view-a', database_id: 'db-host', width: 6, zz_widget: { pinned: true } },
          ],
        },
      ]);
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
