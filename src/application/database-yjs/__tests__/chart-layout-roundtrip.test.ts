import * as Y from 'yjs';

import {
  ChartExtendedLayoutKeys,
  DEFAULT_CHART_EXTENDED_SETTINGS,
  parseChartExtendedSettings,
  sameChartExtendedSettings,
  writeChartExtendedValue,
} from '../chart-extended-settings';
import {
  applyChartLayoutUpdate,
  ChartLayoutField,
  ChartLayoutKeys,
  ChartLayoutSetting,
  ChartType,
  parseChartLayoutSettings,
} from '../chart.type';
import { toPlainValue } from '../layout-codec';

import { decodeParityJson, loadParityFixture, normalizeNumbers, seedParityMap } from './dashboard-parity-helpers';

interface ChartCase {
  name: string;
  stored: Record<string, unknown>;
  parsed?: Record<string, unknown>;
  write: Record<string, unknown>;
  writtenKeys: string[];
  expected: Record<string, unknown>;
}

const fixture = loadParityFixture<{ chartCases: ChartCase[]; encoding: { ignoreOnCompare: string[] } }>(
  'layouts/unknown-keys.json'
);
const IGNORED = new Set(fixture.encoding.ignoreOnCompare);
const FIELD_BY_KEY = new Map(
  (Object.entries(ChartLayoutKeys) as [ChartLayoutField, string][]).map(([field, key]) => [key, field])
);

function createChart(entries: Record<string, unknown>) {
  const doc = new Y.Doc();
  const chart = doc.getMap<unknown>('chart');

  doc.transact(() => seedParityMap(chart, decodeParityJson(entries) as Record<string, unknown>));
  return { doc, chart };
}

/** The typed write for the persisted `write` keys (what the settings UI submits). */
function toSettings(write: Record<string, unknown>): Partial<ChartLayoutSetting> {
  const settings: Record<string, unknown> = {};

  Object.entries(write).forEach(([key, value]) => {
    const field = FIELD_BY_KEY.get(key);

    if (!field) throw new Error(`"${key}" is not a chart layout key of this client`);
    settings[field] = value;
  });
  return settings as Partial<ChartLayoutSetting>;
}

function applyAndCollect(chart: Y.Map<unknown>, apply: () => void) {
  const changed = new Set<string>();
  const observer = (event: Y.YMapEvent<unknown>) => event.keysChanged.forEach((key) => changed.add(key));

  chart.observe(observer);
  (chart.doc as Y.Doc).transact(apply);
  chart.unobserve(observer);
  return [...changed].sort();
}

function withoutIgnored(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !IGNORED.has(key)));
}

describe('chart layout round trip (dashboard-parity/layouts/unknown-keys.json)', () => {
  it.each(fixture.chartCases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const { chart } = createChart(entry.stored);

    if (entry.parsed) {
      const parsed = parseChartLayoutSettings(chart) as unknown as Record<string, unknown>;

      Object.entries(entry.parsed).forEach(([key, value]) => {
        const field = FIELD_BY_KEY.get(key);

        expect(field).toBeDefined();
        expect(parsed[field as string]).toEqual(value);
      });
    }

    const written = applyAndCollect(chart, () => applyChartLayoutUpdate(chart, toSettings(entry.write)));

    expect(written.filter((key) => !IGNORED.has(key))).toEqual([...entry.writtenKeys].sort());
    expect(withoutIgnored(normalizeNumbers(toPlainValue(chart)) as Record<string, unknown>)).toEqual(
      withoutIgnored(normalizeNumbers(decodeParityJson(entry.expected)) as Record<string, unknown>)
    );
  });
});

describe('chart layout writes', () => {
  it('writes nothing when the stored value is selected again', () => {
    const { chart } = createChart({
      chart_type: { $bigint: '3' },
      chartType: 3,
      aggregation_type: { $bigint: '1' },
      aggregationType: 1,
      titleText: 'Revenue',
      numberFormat: 'compact',
    });

    expect(
      applyAndCollect(chart, () =>
        applyChartLayoutUpdate(chart, {
          chartType: ChartType.Donut,
          aggregationType: 1,
          titleText: 'Revenue',
          numberFormat: 'compact',
        })
      )
    ).toEqual([]);
    // The desktop bigint is kept, not replaced by an equal JS number.
    expect(chart.get('chart_type')).toBe(BigInt(3));
  });

  it('moves a legacy-only chart onto both spellings on its first edit', () => {
    const { chart } = createChart({ chartType: ChartType.Bar, xFieldId: 'status' });

    expect(applyAndCollect(chart, () => applyChartLayoutUpdate(chart, { chartType: ChartType.Bar }))).toEqual([
      'chart_type',
    ]);
    expect(chart.get('chart_type')).toBe(ChartType.Bar);
    expect(chart.get('chartType')).toBe(ChartType.Bar);
    // A field the write does not name stays on its legacy key only.
    expect(chart.get('x_field_id')).toBeUndefined();
    expect(chart.get('xFieldId')).toBe('status');
  });

  it('rewrites a legacy spelling that disagrees with the collab key', () => {
    const { chart } = createChart({ chart_type: ChartType.Line, chartType: ChartType.Bar });

    expect(applyAndCollect(chart, () => applyChartLayoutUpdate(chart, { chartType: ChartType.Line }))).toEqual([
      'chartType',
    ]);
    expect(chart.get('chartType')).toBe(ChartType.Line);
  });
});

describe('chart extended settings', () => {
  it('registers the WP10 style keys, the WP11 configuration keys and the WP12 Group by keys and reads unknown values as the defaults', () => {
    expect(ChartExtendedLayoutKeys).toEqual({
      decimalPlaces: 'decimal_places',
      colorTheme: 'color_theme',
      showDataLabels: 'show_data_labels',
      legendPosition: 'legend_position',
      xSort: 'x_sort',
      xManualOrder: 'x_manual_order',
      hiddenGroups: 'hidden_groups',
      xNumberBucketSize: 'x_number_bucket_size',
      xNumberBucketMin: 'x_number_bucket_min',
      xNumberBucketMax: 'x_number_bucket_max',
      xTextGrouping: 'x_text_grouping',
      showTitle: 'show_title',
      numberColor: 'number_color',
      numberConditionalColor: 'number_conditional_color',
      groupByFieldId: 'group_by_field_id',
      groupByDateCondition: 'group_by_date_condition',
      groupStyle: 'group_style',
    });
    expect(parseChartExtendedSettings(new Map([['zz_parity_enum', 'neon']]))).toEqual(DEFAULT_CHART_EXTENDED_SETTINGS);
    expect(parseChartLayoutSettings(new Map()).extended).toEqual(DEFAULT_CHART_EXTENDED_SETTINGS);
    expect(sameChartExtendedSettings(undefined, DEFAULT_CHART_EXTENDED_SETTINGS)).toBe(true);
  });

  it('writes only changed values and resets with null only over a stored value', () => {
    const { chart } = createChart({ decimal_places: { $bigint: '2' } });
    const write = (value: unknown) => writeChartExtendedValue(chart, 'decimalPlaces', value);

    expect(write(2)).toBe(false);
    expect(write(3)).toBe(true);
    expect(chart.get('decimal_places')).toBe(3);
    expect(write(null)).toBe(true);
    expect(chart.get('decimal_places')).toBeNull();
    expect(chart.has('decimal_places')).toBe(true);
    // Resetting again, or resetting an absent key, writes nothing.
    expect(write(null)).toBe(false);
    chart.delete('decimal_places');
    expect(write(null)).toBe(false);
    expect(chart.has('decimal_places')).toBe(false);

    expect(applyAndCollect(chart, () => applyChartLayoutUpdate(chart, {}, { decimalPlaces: 4 }))).toEqual([
      'decimal_places',
    ]);
    expect(applyAndCollect(chart, () => applyChartLayoutUpdate(chart, {}, { decimalPlaces: 4 }))).toEqual([]);
    expect(
      sameChartExtendedSettings(
        { ...DEFAULT_CHART_EXTENDED_SETTINGS, decimalPlaces: 1 },
        { ...DEFAULT_CHART_EXTENDED_SETTINGS, decimalPlaces: BigInt(1) as unknown as number }
      )
    ).toBe(true);
    expect(
      sameChartExtendedSettings(
        { ...DEFAULT_CHART_EXTENDED_SETTINGS, decimalPlaces: 1 },
        { ...DEFAULT_CHART_EXTENDED_SETTINGS, decimalPlaces: 2 }
      )
    ).toBe(false);
  });
});
