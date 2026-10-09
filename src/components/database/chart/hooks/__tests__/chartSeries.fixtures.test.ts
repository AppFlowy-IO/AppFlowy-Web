/**
 * `buildChartSeries` and its derived helpers against
 * `dashboard-parity/series.json` (WP12 §3.1), the cases desktop's
 * `ChartSeriesBuilder` reads too. Only the keys a case lists are compared;
 * numbers within 1e-9, colours in fixture form.
 */
import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { canonicalNumber, ChartYCell } from '@/application/database-yjs/chart-config';
import {
  ChartColorTheme,
  ChartGroupStyle,
  ChartLegendPosition,
  ChartXSort,
} from '@/application/database-yjs/chart-extended-settings';
import { ChartSeriesData, ChartType } from '@/application/database-yjs/chart.type';
import { SelectOptionColor } from '@/application/database-yjs/fields';

import { effectiveGroupStyle } from '../chartGroupBy';
import {
  buildChartSeries,
  chartColorToFixture,
  ChartSeriesGroupField,
  ChartSeriesLimits,
  groupedBarWidth,
  hasSeriesGroupBy,
  legendVisible,
  outermostSegments,
  seriesDataLabels,
  seriesTooltipRows,
  stackTotals,
  truncationCaptionCount,
  valueExtent,
} from '../chartSeries';

interface FixtureGroup {
  key: string;
  label: string;
  optionColor?: string;
  isEmpty?: boolean;
}

interface FixtureField {
  kind: 'select' | 'checkbox' | 'other';
  groups: FixtureGroup[];
}

interface FixtureDataset {
  xField: FixtureField;
  subField: FixtureField | null;
  rows: { id: string; x: string[]; sub: string[]; y: number | null }[];
}

interface FixtureSettings {
  chartType: number;
  aggregation: number;
  groupStyle: ChartGroupStyle;
  cumulative: boolean;
  showEmptyValues: boolean;
  hiddenGroups: string[];
  xSort: ChartXSort;
  colorTheme: ChartColorTheme;
  legendPosition: ChartLegendPosition;
  showDataLabels: boolean;
  limits: ChartSeriesLimits;
}

interface FixtureCase {
  name: string;
  dataset: string;
  subField?: null;
  input: Partial<FixtureSettings>;
  expected: Record<string, unknown>;
}

interface SeriesFixture {
  defaults: FixtureSettings;
  groupedBarWidth: { slot: number; seriesCount: number; width: number }[];
  datasets: Record<string, FixtureDataset>;
  cases: FixtureCase[];
}

const fixture = loadParityFixture<SeriesFixture>('series.json');
const TOLERANCE = 1e-9;

function field(source: FixtureField): ChartSeriesGroupField {
  return {
    kind: source.kind,
    groups: source.groups.map((group) => ({
      key: group.key,
      label: group.label,
      isEmpty: group.isEmpty,
      optionColor: (group.optionColor as SelectOptionColor | undefined) ?? null,
    })),
  };
}

function yCell(y: number | null): ChartYCell | null {
  if (y === null) return { empty: true, tokens: [] };
  return { empty: false, tokens: [canonicalNumber(y)], number: y };
}

/** `actual` in the shape of `expected`, numbers within the tolerance, so a failure prints the case. */
function expectClose(actual: unknown, expected: unknown, path: string) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(actual - expected) > TOLERANCE) expect({ path, actual }).toEqual({ path, actual: expected });
    return;
  }

  if (Array.isArray(expected)) {
    expect({ path, length: Array.isArray(actual) ? actual.length : actual }).toEqual({ path, length: expected.length });
    expected.forEach((item, index) => expectClose((actual as unknown[])[index], item, `${path}[${index}]`));
    return;
  }

  if (expected !== null && typeof expected === 'object') {
    expect({ path, keys: Object.keys((actual ?? {}) as object).sort() }).toEqual({
      path,
      keys: Object.keys(expected).sort(),
    });
    Object.entries(expected).forEach(([key, value]) =>
      expectClose((actual as Record<string, unknown>)[key], value, `${path}.${key}`)
    );
    return;
  }

  expect({ path, actual }).toEqual({ path, actual: expected });
}

function categoriesOf(data: ChartSeriesData) {
  return data.categories.map((category) => ({
    key: category.key,
    label: category.label,
    isEmpty: category.isEmpty,
    color: chartColorToFixture(category.color),
    rowIds: category.rowIds,
  }));
}

function seriesOf(data: ChartSeriesData, expected: Array<Record<string, unknown>>) {
  return data.series.map((entry, index) => {
    const result: Record<string, unknown> = {
      key: entry.key,
      label: entry.label,
      isEmpty: entry.isEmpty,
      color: chartColorToFixture(entry.color),
      values: entry.values,
      rowIds: entry.rowIds,
    };

    // `percents` is compared where a case lists it, and must be absent where it does not.
    if (expected[index] && 'percents' in expected[index]) result.percents = entry.percents;
    else if (entry.percents !== undefined) result.percents = entry.percents;
    return result;
  });
}

describe('buildChartSeries (dashboard-parity/series.json#cases)', () => {
  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const settings: FixtureSettings = { ...fixture.defaults, ...entry.input };
    const dataset = fixture.datasets[entry.dataset];
    const subField = entry.subField === null ? null : dataset.subField;
    const chartType = settings.chartType as ChartType;
    const data = buildChartSeries({
      chartType,
      aggregation: settings.aggregation,
      groupStyle: settings.groupStyle,
      cumulative: settings.cumulative,
      showEmptyValues: settings.showEmptyValues,
      hiddenGroups: settings.hiddenGroups,
      xSort: settings.xSort,
      colorTheme: settings.colorTheme,
      xField: field(dataset.xField),
      subField: subField ? field(subField) : null,
      rows: dataset.rows.map((row) => ({ id: row.id, x: row.x, sub: row.sub, y: yCell(row.y) })),
      limits: settings.limits,
    });
    const style = effectiveGroupStyle(chartType, hasSeriesGroupBy(data), settings.groupStyle);
    const { expected } = entry;

    if ('categories' in expected) expectClose(categoriesOf(data), expected.categories, 'categories');
    if ('series' in expected) {
      expectClose(seriesOf(data, expected.series as Array<Record<string, unknown>>), expected.series, 'series');
    }

    if ('seriesColors' in expected) {
      expect(data.series.map((series) => chartColorToFixture(series.color))).toEqual(expected.seriesColors);
    }

    if ('truncated' in expected) expect(data.truncated).toEqual(expected.truncated);
    if ('captionCount' in expected) expect(truncationCaptionCount(data, settings.limits)).toBe(expected.captionCount);
    if ('stackTotals' in expected) expectClose(stackTotals(data), expected.stackTotals, 'stackTotals');
    if ('outermost' in expected) expect(outermostSegments(data, style)).toEqual(expected.outermost);
    if ('valueExtent' in expected) expectClose(valueExtent(data, chartType, style), expected.valueExtent, 'valueExtent');
    if ('dataLabels' in expected) {
      expectClose(
        seriesDataLabels(data, chartType, style, settings.showDataLabels).map(({ category, series, side, value }) => ({
          category,
          series,
          side,
          value,
        })),
        expected.dataLabels,
        'dataLabels'
      );
    }

    if ('tooltips' in expected) {
      Object.entries(expected.tooltips as Record<string, unknown[]>).forEach(([categoryKey, rows]) => {
        const categoryIndex = data.categories.findIndex((category) => category.key === categoryKey);

        expect({ categoryKey, found: categoryIndex >= 0 }).toEqual({ categoryKey, found: true });
        const actual = seriesTooltipRows(data, categoryIndex, style, Number.POSITIVE_INFINITY).rows.map((row) =>
          row.percent === undefined
            ? { series: row.series, value: row.value }
            : { series: row.series, value: row.value, percent: row.percent }
        );

        expectClose(actual, rows, `tooltips.${categoryKey}`);
      });
    }

    if ('legendVisible' in expected) {
      expect(legendVisible(data, settings.legendPosition, chartType)).toBe(expected.legendVisible);
    }
  });
});

describe('groupedBarWidth (dashboard-parity/series.json#groupedBarWidth)', () => {
  it.each(fixture.groupedBarWidth.map((entry) => [`slot ${entry.slot}, ${entry.seriesCount} series`, entry] as const))(
    '%s',
    (_, entry) => {
      expect(Math.abs(groupedBarWidth(entry.slot, entry.seriesCount) - entry.width)).toBeLessThanOrEqual(TOLERANCE);
    }
  );
});
