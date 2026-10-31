/**
 * The WP12 Group by keys against `dashboard-parity/layouts/chart-series-keys.json`
 * (WP12 §3.2), the same cases Rust and desktop read: how `group_by_field_id`,
 * `group_by_date_condition` and `group_style` parse, which keys a write
 * touches (through `useUpdateChartSetting`, one transaction per write), and
 * that the probe and every unread value survive.
 */
import { act, renderHook } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs';
import { useUpdateChartSetting } from '@/application/database-yjs/dispatch';
import { type YDatabase, type YDatabaseView, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  ChartExtendedField,
  ChartExtendedLayoutKeys,
  ChartExtendedSettingsUpdate,
  DEFAULT_CHART_EXTENDED_SETTINGS,
  sameChartExtendedSettings,
} from '../chart-extended-settings';
import { ChartLayoutField, ChartLayoutKeys, ChartLayoutSetting, parseChartLayoutSettings } from '../chart.type';
import { toPlainValue } from '../layout-codec';

import { decodeParityJson, loadParityFixture, normalizeNumbers, seedParityMap } from './dashboard-parity-helpers';

interface SeriesKeysCase {
  name: string;
  stored: Record<string, unknown>;
  parsed: Record<string, unknown>;
  write: Record<string, unknown>;
  writtenKeys: string[];
  expected: Record<string, unknown>;
}

const fixture = loadParityFixture<{ encoding: { ignoreOnCompare: string[] }; chartCases: SeriesKeysCase[] }>(
  'layouts/chart-series-keys.json'
);
const IGNORED = new Set(fixture.encoding.ignoreOnCompare);
const GROUP_KEYS: Record<string, ChartExtendedField> = {
  group_by_field_id: 'groupByFieldId',
  group_by_date_condition: 'groupByDateCondition',
  group_style: 'groupStyle',
};
const LAYOUT_FIELD = new Map(
  (Object.entries(ChartLayoutKeys) as [ChartLayoutField, string][]).map(([field, key]) => [key, field])
);
const EXTENDED_FIELD = new Map(
  (Object.entries(ChartExtendedLayoutKeys) as [ChartExtendedField, string][]).map(([field, key]) => [key, field])
);
const viewId = 'chart-view';

function createChart(stored: Record<string, unknown>) {
  const databaseDoc = new Y.Doc() as unknown as YDoc;
  const database = new Y.Map() as YDatabase;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;
  const layoutSettings = new Y.Map();
  const chart = new Y.Map<unknown>();

  layoutSettings.set('3', chart);
  view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  views.set(viewId, view);
  database.set(YjsDatabaseKey.views, views);
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);
  databaseDoc.transact(() => seedParityMap(chart, decodeParityJson(stored) as Record<string, unknown>));

  const context: DatabaseContextState = {
    activeViewId: viewId,
    databaseDoc,
    databasePageId: viewId,
    readOnly: false,
    rowMap: null,
    workspaceId: 'workspace',
  };

  return { chart, context, databaseDoc };
}

/** The typed write a client submits for the persisted `write` keys. */
function toUpdate(write: Record<string, unknown>) {
  const settings: Record<string, unknown> = {};
  const extended: Record<string, unknown> = {};

  Object.entries(write).forEach(([key, value]) => {
    const layoutField = LAYOUT_FIELD.get(key);
    const extendedField = EXTENDED_FIELD.get(key);

    if (layoutField) settings[layoutField] = value;
    else if (extendedField) extended[extendedField] = value;
    else throw new Error(`"${key}" is not a chart key of this client`);
  });
  return { settings: settings as Partial<ChartLayoutSetting>, extended: extended as ChartExtendedSettingsUpdate };
}

function withoutIgnored(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !IGNORED.has(key)));
}

describe('chart Group by keys (dashboard-parity/layouts/chart-series-keys.json)', () => {
  it('covers the seven WP12 cases and carries the probe in every stored map', () => {
    expect(fixture.chartCases).toHaveLength(7);
    fixture.chartCases.forEach((entry) =>
      expect(entry.stored.zz_parity_probe).toEqual({ from: 'newer-app', version: 99 })
    );
  });

  it.each(fixture.chartCases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const { chart, context, databaseDoc } = createChart(entry.stored);
    const extended = parseChartLayoutSettings(chart).extended as unknown as Record<string, unknown>;

    Object.entries(entry.parsed).forEach(([key, value]) => {
      const field = GROUP_KEYS[key];

      if (field) expect([key, extended[field]]).toEqual([key, value]);
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(DatabaseContext.Provider, { value: context }, children);
    const { result } = renderHook(() => useUpdateChartSetting(), { wrapper });
    const changed = new Set<string>();
    let transactions = 0;

    chart.observe((event) => event.keysChanged.forEach((key) => changed.add(key)));
    (databaseDoc as unknown as Y.Doc).on('afterTransaction', () => (transactions += 1));
    const { settings, extended: update } = toUpdate(entry.write);

    act(() => result.current(settings, update));

    expect([...changed].filter((key) => !IGNORED.has(key)).sort()).toEqual([...entry.writtenKeys].sort());
    // One write is one transaction, so picking the Group by field as X is one undo step.
    expect(transactions).toBe(1);
    expect(withoutIgnored(normalizeNumbers(toPlainValue(chart)) as Record<string, unknown>)).toEqual(
      withoutIgnored(normalizeNumbers(decodeParityJson(entry.expected)) as Record<string, unknown>)
    );
  });
});

describe('the Group by keys in the parsed settings', () => {
  it('reads the documented defaults when nothing is stored', () => {
    expect(DEFAULT_CHART_EXTENDED_SETTINGS).toMatchObject({
      groupByFieldId: '',
      groupByDateCondition: 3,
      groupStyle: 'stacked',
    });
  });

  it('reads a fraction, a negative or a too-large date grouping as Month', () => {
    [1.5, -1, 5, '2', null].forEach((value) => {
      const chart = new Y.Doc().getMap<unknown>('chart');

      chart.set('group_by_date_condition', value);
      expect([value, parseChartLayoutSettings(chart).extended.groupByDateCondition]).toEqual([value, 3]);
    });
  });

  it('sees a change of each Group by key, so the chart re-renders', () => {
    const base = DEFAULT_CHART_EXTENDED_SETTINGS;

    expect(sameChartExtendedSettings(base, { ...base, groupByFieldId: 'f:audience' })).toBe(false);
    expect(sameChartExtendedSettings(base, { ...base, groupByDateCondition: 1 })).toBe(false);
    expect(sameChartExtendedSettings(base, { ...base, groupStyle: 'percent' })).toBe(false);
    expect(sameChartExtendedSettings(base, { ...base })).toBe(true);
  });
});
