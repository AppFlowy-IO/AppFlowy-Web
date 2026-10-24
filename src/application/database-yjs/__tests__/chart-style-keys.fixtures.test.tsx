import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs';
import { useUpdateChartSetting } from '@/application/database-yjs/dispatch';
import { type YDatabase, type YDatabaseView, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import {
  ChartExtendedField,
  ChartExtendedLayoutKeys,
  ChartExtendedSettingsUpdate,
  writeChartExtendedValue,
} from '../chart-extended-settings';
import { ChartLayoutField, ChartLayoutKeys, ChartLayoutSetting, parseChartLayoutSettings } from '../chart.type';
import { toPlainValue } from '../layout-codec';

import { decodeParityJson, loadParityFixture, normalizeNumbers, seedParityMap } from './dashboard-parity-helpers';

interface StyleCase {
  name: string;
  stored: Record<string, unknown>;
  parsed?: Record<string, unknown>;
  write?: Record<string, unknown>;
  writtenKeys?: string[];
  expected?: Record<string, unknown>;
  reparsed?: Record<string, unknown>;
}

const fixture = loadParityFixture<{ chartCases: StyleCase[] }>('layouts/chart-style-keys.json');
// WP01's rule: the legacy camelCase mirrors the web writes are not compared.
const IGNORED = new Set(
  loadParityFixture<{ encoding: { ignoreOnCompare: string[] } }>('layouts/unknown-keys.json').encoding.ignoreOnCompare
);
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

  return { chart, context };
}

/** A parsed setting as the fixture spells it (snake_case keys, `null` for auto decimal places). */
function parsedStyle(map: Y.Map<unknown>): Record<string, unknown> {
  const { extended } = parseChartLayoutSettings(map);

  return Object.fromEntries(
    (Object.entries(ChartExtendedLayoutKeys) as [ChartExtendedField, string][]).map(([field, key]) => [key, extended[field]])
  );
}

/** The typed write the settings UI submits for the persisted `write` keys. */
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

describe('chart style keys (dashboard-parity/layouts/chart-style-keys.json)', () => {
  it.each(fixture.chartCases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const { chart, context } = createChart(entry.stored);

    if (entry.parsed) {
      const parsed = parsedStyle(chart);

      Object.entries(entry.parsed).forEach(([key, value]) => expect(parsed[key]).toEqual(value));
    }

    if (!entry.write) return;
    const { result } = renderHook(() => useUpdateChartSetting(), {
      wrapper: ({ children }) => <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>,
    });
    const changed = new Set<string>();

    chart.observe((event) => event.keysChanged.forEach((key) => changed.add(key)));
    const { settings, extended } = toUpdate(entry.write);

    act(() => result.current(settings, extended));

    expect([...changed].filter((key) => !IGNORED.has(key)).sort()).toEqual([...(entry.writtenKeys ?? [])].sort());
    expect(withoutIgnored(normalizeNumbers(toPlainValue(chart)) as Record<string, unknown>)).toEqual(
      withoutIgnored(normalizeNumbers(decodeParityJson(entry.expected)) as Record<string, unknown>)
    );

    if (entry.reparsed) {
      const reparsed = parsedStyle(chart);

      Object.entries(entry.reparsed).forEach(([key, value]) => expect(reparsed[key]).toEqual(value));
    }
  });
});

describe('writeChartExtendedValue', () => {
  function map(entries: Record<string, unknown>) {
    const doc = new Y.Doc();
    const chart = doc.getMap<unknown>('chart');

    doc.transact(() => seedParityMap(chart, decodeParityJson(entries) as Record<string, unknown>));
    return chart;
  }

  it('compares the values as they read, like Rust write_changed_to', () => {
    const chart = map({ color_theme: 'neon', decimal_places: 9, legend_position: 'side', show_data_labels: 'no' });

    expect(writeChartExtendedValue(chart, 'colorTheme', 'auto')).toBe(false);
    expect(writeChartExtendedValue(chart, 'decimalPlaces', null)).toBe(false);
    expect(writeChartExtendedValue(chart, 'legendPosition', 'bottom')).toBe(false);
    expect(writeChartExtendedValue(chart, 'showDataLabels', true)).toBe(false);
    expect(toPlainValue(chart)).toEqual({ color_theme: 'neon', decimal_places: 9, legend_position: 'side', show_data_labels: 'no' });

    expect(writeChartExtendedValue(chart, 'colorTheme', 'blue')).toBe(true);
    expect(writeChartExtendedValue(chart, 'legendPosition', 'off')).toBe(true);
    expect(writeChartExtendedValue(chart, 'showDataLabels', false)).toBe(true);
    expect(writeChartExtendedValue(chart, 'decimalPlaces', 2)).toBe(true);
    expect(toPlainValue(chart)).toEqual({ color_theme: 'blue', decimal_places: 2, legend_position: 'off', show_data_labels: false });
  });

  it('keeps a desktop bigint that equals the picked number', () => {
    const chart = map({ decimal_places: { $bigint: '2' } });

    expect(writeChartExtendedValue(chart, 'decimalPlaces', 2)).toBe(false);
    expect(chart.get('decimal_places')).toBe(BigInt(2));
  });

  it('resets with null only over a value that reads differently', () => {
    const chart = map({ decimal_places: 3 });

    expect(writeChartExtendedValue(chart, 'decimalPlaces', null)).toBe(true);
    expect(chart.get('decimal_places')).toBeNull();
    expect(chart.has('decimal_places')).toBe(true);
    expect(writeChartExtendedValue(chart, 'decimalPlaces', null)).toBe(false);
    chart.delete('decimal_places');
    expect(writeChartExtendedValue(chart, 'decimalPlaces', null)).toBe(false);
    expect(chart.has('decimal_places')).toBe(false);
  });

  it('does not write a default over an absent key', () => {
    const chart = map({});

    expect(writeChartExtendedValue(chart, 'colorTheme', 'auto')).toBe(false);
    expect(writeChartExtendedValue(chart, 'showDataLabels', true)).toBe(false);
    expect(writeChartExtendedValue(chart, 'legendPosition', 'auto')).toBe(false);
    expect(chart.size).toBe(0);
  });
});
