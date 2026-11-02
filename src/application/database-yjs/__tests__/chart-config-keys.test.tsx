import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs';
import { useUpdateChartSetting } from '@/application/database-yjs/dispatch';
import { type YDatabase, type YDatabaseView, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';

import { effectiveChartAggregation } from '../chart-config';
import {
  ChartExtendedField,
  ChartExtendedLayoutKeys,
  ChartExtendedSettings,
  ChartExtendedSettingsUpdate,
  NumberConditionalColor,
  numberConditionalColorToPersisted,
  parseNumberConditionalColor,
  sameChartExtendedSettings,
  serializeNumberConditionalColor,
  writeChartExtendedUpdate,
} from '../chart-extended-settings';
import { ChartLayoutField, ChartLayoutKeys, ChartLayoutSetting, parseChartLayoutSettings } from '../chart.type';
import { FieldType } from '../database.type';
import { toPlainValue } from '../layout-codec';

import { decodeParityJson, loadParityFixture, normalizeNumbers, seedParityMap } from './dashboard-parity-helpers';

interface ConfigCase {
  name: string;
  stored: Record<string, unknown>;
  parsed?: Record<string, unknown>;
  yFieldType?: string;
  effectiveAggregation?: number;
  write?: Record<string, unknown>;
  writtenKeys?: string[];
  expected?: Record<string, unknown>;
  reparsed?: Record<string, unknown>;
}

const fixture = loadParityFixture<{ chartCases: ConfigCase[] }>('layouts/chart-config.json');
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

/** The parsed settings in the fixture's persisted spelling (snake_case keys, the conditional color's known keys). */
function parsedConfig(map: Y.Map<unknown>): Record<string, unknown> {
  const settings = parseChartLayoutSettings(map);
  const extended = settings.extended as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = { aggregation_type: settings.aggregationType };

  (Object.entries(ChartExtendedLayoutKeys) as [ChartExtendedField, string][]).forEach(([field, key]) => {
    const value = extended[field];

    result[key] =
      field === 'numberConditionalColor' && value ? numberConditionalColorToPersisted(value as NumberConditionalColor) : value;
  });
  return result;
}

/** The typed write the panel submits for the persisted `write` keys. */
function toUpdate(write: Record<string, unknown>) {
  const settings: Record<string, unknown> = {};
  const extended: Record<string, unknown> = {};

  Object.entries(write).forEach(([key, value]) => {
    const layoutField = LAYOUT_FIELD.get(key);
    const extendedField = EXTENDED_FIELD.get(key);

    if (layoutField) settings[layoutField] = value;
    else if (extendedField === 'numberConditionalColor') extended[extendedField] = parseNumberConditionalColor(value);
    else if (extendedField) extended[extendedField] = value;
    else throw new Error(`"${key}" is not a chart key of this client`);
  });
  return { settings: settings as Partial<ChartLayoutSetting>, extended: extended as ChartExtendedSettingsUpdate };
}

function withoutIgnored(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !IGNORED.has(key)));
}

describe('chart configuration keys (dashboard-parity/layouts/chart-config.json)', () => {
  it('covers every WP11 key, an unknown sort, an unknown operator and a rule extra', () => {
    const text = JSON.stringify(fixture);

    ['x_sort', 'x_manual_order', 'hidden_groups', 'x_number_bucket_size', 'x_text_grouping', 'show_title', 'number_color'].forEach(
      (key) => expect(text).toContain(`"${key}"`)
    );
    expect(text).toContain('"by_magic"');
    expect(text).toContain('"approx"');
    expect(text).toContain('"zz_rule_note"');
    expect(text).toContain('"zz_parity_probe"');
  });

  it.each(fixture.chartCases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const { chart, context } = createChart(entry.stored);

    if (entry.parsed) {
      const parsed = parsedConfig(chart);

      Object.entries(entry.parsed).forEach(([key, value]) => expect([key, parsed[key]]).toEqual([key, value]));
    }

    if (entry.effectiveAggregation !== undefined) {
      const type = (FieldType as unknown as Record<string, number>)[entry.yFieldType ?? ''];

      expect(effectiveChartAggregation(parseChartLayoutSettings(chart).aggregationType, type)).toBe(
        entry.effectiveAggregation
      );
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
      const reparsed = parsedConfig(chart);

      Object.entries(entry.reparsed).forEach(([key, value]) => expect([key, reparsed[key]]).toEqual([key, value]));
    }
  });
});

describe('the extended chart writer', () => {
  function map(entries: Record<string, unknown>) {
    const doc = new Y.Doc();
    const chart = doc.getMap<unknown>('chart');

    doc.transact(() => seedParityMap(chart, decodeParityJson(entries) as Record<string, unknown>));
    return chart;
  }

  function keysWritten(chart: Y.Map<unknown>, write: () => void) {
    const changed = new Set<string>();
    const observer = (event: Y.YMapEvent<unknown>) => event.keysChanged.forEach((key) => changed.add(key));

    chart.observe(observer);
    write();
    chart.unobserve(observer);
    return [...changed].sort();
  }

  it('writes nothing when every bucket key reads the same', () => {
    const chart = map({ x_number_bucket_size: 10, x_number_bucket_min: { $bigint: '0' } });

    expect(
      keysWritten(chart, () =>
        writeChartExtendedUpdate(chart, { xNumberBucketSize: 10, xNumberBucketMin: 0, xNumberBucketMax: null })
      )
    ).toEqual([]);
  });

  it('keeps an unknown sort when Default is picked again, and writes a known one', () => {
    const chart = map({ x_sort: 'by_magic' });

    expect(keysWritten(chart, () => writeChartExtendedUpdate(chart, { xSort: 'auto' }))).toEqual([]);
    expect(keysWritten(chart, () => writeChartExtendedUpdate(chart, { xSort: 'value_desc' }))).toEqual(['x_sort']);
    expect(chart.get('x_sort')).toBe('value_desc');
  });

  it('stores arrays as fresh plain arrays, never the caller’s', () => {
    const chart = map({});
    const hidden = ['o-a'];

    writeChartExtendedUpdate(chart, { hiddenGroups: hidden });
    hidden.push('o-b');
    expect(chart.get('hidden_groups')).toEqual(['o-a']);
    expect(chart.get('hidden_groups')).not.toBeInstanceOf(Y.Array);
  });

  it('reads a Y.Array and a Y.Map written by another client', () => {
    const doc = new Y.Doc();
    const chart = doc.getMap<unknown>('chart');
    const list = new Y.Array<string>();
    const color = new Y.Map<unknown>();

    chart.set('hidden_groups', list);
    list.push(['o-a', 'o-b']);
    chart.set('number_conditional_color', color);
    color.set('enabled', true);
    color.set('rules', [{ id: 'r', operator: 'gt', value: BigInt(3), color: 'red' }]);

    const { extended } = parseChartLayoutSettings(chart);

    expect(extended.hiddenGroups).toEqual(['o-a', 'o-b']);
    expect(extended.numberConditionalColor).toEqual({ enabled: true, rules: [{ id: 'r', operator: 'gt', value: 3, color: 'red' }] });
  });

  it('a conditional color reset writes null; a rule without an id is skipped when read', () => {
    const chart = map({ number_conditional_color: { enabled: true, rules: [{ operator: 'gt', value: 1, color: 'red' }] } });

    expect(parseChartLayoutSettings(chart).extended.numberConditionalColor).toEqual({ enabled: true, rules: [] });
    expect(keysWritten(chart, () => writeChartExtendedUpdate(chart, { numberConditionalColor: null }))).toEqual([
      'number_conditional_color',
    ]);
    expect(chart.get('number_conditional_color')).toBeNull();
  });

  it('merges stored extras by rule id, not by position', () => {
    const stored = {
      enabled: true,
      rules: [
        { id: 'a', operator: 'gt', value: 1, color: 'red', note: 'A' },
        { id: 'b', operator: 'lt', value: 0, color: 'blue', note: 'B' },
      ],
      zz: 1,
    };
    const next = serializeNumberConditionalColor(
      {
        enabled: false,
        rules: [
          { id: 'b', operator: 'lt', value: 0, color: 'blue' },
          { id: 'c', operator: 'eq', value: 2, color: 'green' },
        ],
      },
      stored
    );

    expect(next).toEqual({
      zz: 1,
      enabled: false,
      rules: [
        { id: 'b', operator: 'lt', value: 0, color: 'blue', note: 'B' },
        { id: 'c', operator: 'eq', value: 2, color: 'green' },
      ],
    });
  });

  it('compares conditional colors by their known keys', () => {
    const base = parseChartLayoutSettings(map({})).extended;
    const a: ChartExtendedSettings = { ...base, numberConditionalColor: { enabled: true, rules: [] } };
    const b: ChartExtendedSettings = { ...base, numberConditionalColor: { enabled: true, rules: [], elseColor: undefined } };
    const c: ChartExtendedSettings = { ...base, numberConditionalColor: { enabled: true, rules: [], elseColor: 'red' } };

    expect(sameChartExtendedSettings(a, b)).toBe(true);
    expect(sameChartExtendedSettings(a, c)).toBe(false);
    expect(sameChartExtendedSettings(base, { ...base, hiddenGroups: ['x'] })).toBe(false);
  });
});
