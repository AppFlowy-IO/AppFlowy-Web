/**
 * The series helpers the renderers use beyond the shared fixture (WP12 §4.3):
 * Recharts rows, drill payloads, category items, the tooltip cap and content
 * equality.
 */
import { CHART_ALL_SERIES_KEY, ChartSeriesData } from '@/application/database-yjs/chart.type';

import {
  chartColorToFixture,
  chartSeriesDataEqual,
  paintChartColor,
  seriesDataKey,
  seriesTooltipRows,
  toCategoryItems,
  toDrillItem,
  toRechartsRows,
} from '../chartSeries';

const hex = (value: string, alpha = 1) => ({ kind: 'hex' as const, hex: value, alpha });

/** Two categories split into two series whose keys contain dots (option ids, text keys). */
function grouped(): ChartSeriesData {
  return {
    categories: [
      { key: 'opt:blog', label: 'Blog', isEmpty: false, color: null, rowIds: ['r1', 'r2', 'r3'] },
      { key: '__empty__', label: 'No Channel', isEmpty: true, color: null, rowIds: ['r4'] },
    ],
    series: [
      {
        key: 't:v1.2',
        label: 'v1.2',
        color: hex('#DE9255'),
        isEmpty: false,
        values: [1, 1],
        rowIds: [['r1'], ['r4']],
        percents: [33.3, 100],
      },
      {
        key: 'opt:s.1',
        label: 'SMB',
        color: hex('#72BC8F', 0.7),
        isEmpty: false,
        values: [2, 0],
        rowIds: [['r2', 'r3'], []],
        percents: [66.7, 0],
      },
    ],
    truncated: { categories: false, series: false },
  };
}

function single(): ChartSeriesData {
  return {
    categories: [{ key: 'a', label: 'A', isEmpty: false, color: hex('#BF8EDA'), rowIds: ['r1', 'r2'] }],
    series: [{ key: CHART_ALL_SERIES_KEY, label: '', color: null, isEmpty: false, values: [2], rowIds: [['r1', 'r2']] }],
    truncated: { categories: false, series: false },
  };
}

const paint = (color: Parameters<typeof paintChartColor>[0]) => paintChartColor(color, false);

describe('toRechartsRows', () => {
  it('exposes the series as s{j} and p{j}, never under their dotted keys', () => {
    const rows = toRechartsRows(grouped(), 'percent');

    expect(rows).toEqual([
      { __c: 0, __key: 'opt:blog', __label: 'Blog', s0: 1, s1: 2, p0: 33.3, p1: 66.7 },
      { __c: 1, __key: '__empty__', __label: 'No Channel', s0: 1, s1: 0, p0: 100, p1: 0 },
    ]);
    expect(Object.keys(rows[0])).not.toContain('t:v1.2');
    expect(toRechartsRows(grouped(), 'stacked')[0]).toEqual({
      __c: 0,
      __key: 'opt:blog',
      __label: 'Blog',
      s0: 1,
      s1: 2,
    });
    expect([seriesDataKey(1, 'stacked'), seriesDataKey(1, 'percent')]).toEqual(['s1', 'p1']);
  });
});

describe('toDrillItem', () => {
  it('opens a segment with its cell and its series', () => {
    expect(toDrillItem(grouped(), { categoryIndex: 0, seriesIndex: 1 }, paint)).toEqual({
      label: 'Blog',
      key: 'opt:blog',
      categoryKey: 'opt:blog',
      isEmptyCategory: false,
      value: 2,
      rowIds: ['r2', 'r3'],
      color: '#9CD0B1',
      seriesKey: 'opt:s.1',
      seriesLabel: 'SMB',
    });
  });

  it('opens the band with the whole category and no series', () => {
    const item = toDrillItem(grouped(), { categoryIndex: 0, seriesIndex: null }, paint);

    expect(item).toEqual({
      label: 'Blog',
      key: 'opt:blog',
      categoryKey: 'opt:blog',
      isEmptyCategory: false,
      value: 3,
      rowIds: ['r1', 'r2', 'r3'],
      color: '#DE9255',
    });
  });

  it('passes no series for the __all__ series of a chart without Group by', () => {
    const item = toDrillItem(single(), { categoryIndex: 0, seriesIndex: 0 }, paint);

    expect(item).toEqual(expect.objectContaining({ label: 'A', value: 2, rowIds: ['r1', 'r2'], color: '#BF8EDA' }));
    expect(item?.seriesKey).toBeUndefined();
    expect(item?.seriesLabel).toBeUndefined();
    expect(toDrillItem(single(), { categoryIndex: 5, seriesIndex: null })).toBeNull();
  });
});

describe('toCategoryItems', () => {
  it('totals every series per category and colours a Group by category by series 0', () => {
    expect(toCategoryItems(grouped(), paint)).toEqual([
      { label: 'Blog', value: 3, rowIds: ['r1', 'r2', 'r3'], key: 'opt:blog', isEmptyCategory: false, color: '#DE9255' },
      { label: 'No Channel', value: 1, rowIds: ['r4'], key: '__empty__', isEmptyCategory: true, color: '#DE9255' },
    ]);
    expect(toCategoryItems(single(), paint)[0].color).toBe('#BF8EDA');
    expect(toCategoryItems(single())[0].color).toBeUndefined();
  });
});

describe('seriesTooltipRows', () => {
  function wide(count: number, zeros = false): ChartSeriesData {
    return {
      categories: [{ key: 'c', label: 'C', isEmpty: false, color: null, rowIds: [] }],
      series: Array.from({ length: count }, (_, index) => ({
        key: `s${index}`,
        label: `S${index}`,
        color: null,
        isEmpty: false,
        values: [zeros ? 0 : index + 1],
        rowIds: [[]],
      })),
      truncated: { categories: false, series: false },
    };
  }

  it('lists at most ten rows and counts the rest', () => {
    const { rows, more } = seriesTooltipRows(wide(12), 0, 'stacked');

    expect(rows.map((row) => row.series)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
    expect(more).toBe(2);
  });

  it('lists every series with 0 when a category is all zeros, and only the non-zero ones otherwise', () => {
    expect(seriesTooltipRows(wide(3, true), 0, 'stacked').rows.map((row) => [row.series, row.value])).toEqual([
      ['s0', 0],
      ['s1', 0],
      ['s2', 0],
    ]);
    expect(seriesTooltipRows(grouped(), 1, 'stacked').rows.map((row) => row.series)).toEqual(['t:v1.2']);
  });

  it('carries the share in percent mode', () => {
    expect(seriesTooltipRows(grouped(), 0, 'percent').rows.map((row) => [row.label, row.value, row.percent])).toEqual([
      ['v1.2', 1, 33.3],
      ['SMB', 2, 66.7],
    ]);
  });
});

describe('chart colours', () => {
  it('reads in fixture form and paints over the card for each theme', () => {
    expect(chartColorToFixture(hex('#de9255'))).toBe('#DE9255');
    expect(chartColorToFixture(hex('#DE9255', 0.5))).toBe('#DE9255/0.5');
    expect(chartColorToFixture({ kind: 'empty' })).toBe('empty');
    expect(chartColorToFixture(null)).toBeNull();
    expect(paintChartColor({ kind: 'empty' }, false)).toBe('#F1F1EF');
    expect(paintChartColor({ kind: 'empty' }, true)).toBe('#FFFFFF1A');
    expect(paintChartColor(hex('#5E9FE8', 0.5), false)).toBe('#AFCFF4');
  });
});

describe('chartSeriesDataEqual', () => {
  it('is true for the same content and false for a swapped row id', () => {
    expect(chartSeriesDataEqual(grouped(), grouped())).toBe(true);
    const swapped = grouped();

    swapped.series[1].rowIds[0] = ['r2', 'r9'];
    expect(chartSeriesDataEqual(grouped(), swapped)).toBe(false);
  });

  it('sees a colour, a percent, a label and a truncation change', () => {
    const base = grouped();

    expect(
      chartSeriesDataEqual(base, {
        ...base,
        series: [{ ...base.series[0], color: hex('#DE9255', 0.7) }, base.series[1]],
      })
    ).toBe(false);
    expect(
      chartSeriesDataEqual(base, { ...base, series: [{ ...base.series[0], percents: [33.4, 100] }, base.series[1]] })
    ).toBe(false);
    expect(
      chartSeriesDataEqual(base, {
        ...base,
        categories: [{ ...base.categories[0], label: 'Blogs' }, base.categories[1]],
      })
    ).toBe(false);
    expect(chartSeriesDataEqual(base, { ...base, truncated: { categories: false, series: true } })).toBe(false);
  });
});
