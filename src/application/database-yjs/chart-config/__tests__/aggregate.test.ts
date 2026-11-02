import { loadParityFixture } from '../../__tests__/dashboard-parity-helpers';
import { ChartAggregationType } from '../../chart-enums';
import { FieldType } from '../../database.type';
import {
  aggregateChartCells,
  calculateMenu,
  CHART_AGGREGATION_META,
  chartValueOfAggregate,
  ChartYCell,
  defaultAggregationFor,
  effectiveChartAggregation,
  isAggregationValidFor,
  supportsCumulative,
} from '../aggregate';
import { canonicalNumber } from '../number-buckets';

import { chartTypeOf, fieldTypeOf } from './fixture-helpers';

interface AggregationsFixture {
  cells: Record<string, unknown[]>;
  cases: { yType: string; agg: number; cellSet: string; expect: number | null; legacy?: boolean }[];
  effective: { agg: number; yType: string | null; expect: number }[];
  defaults: { yType: string; current: number; expect: number }[];
  calculateMenu: { yType: string; chartType: string; expect: { count: number[]; percent: number[]; more: number[] } }[];
  cumulative: { agg: number; chartType: string; expect: boolean }[];
}

const fixture = loadParityFixture<AggregationsFixture>('aggregations.json');

/** The fixture's raw cell as the Y cell model (WP11 §1.9). */
function yCell(type: FieldType, raw: unknown): ChartYCell {
  switch (type) {
    case FieldType.Number:
      return typeof raw === 'number'
        ? { empty: false, tokens: [canonicalNumber(raw)], number: raw }
        : { empty: true, tokens: [] };
    case FieldType.Checkbox: {
      const checked = raw === true;

      return { empty: !checked, tokens: [checked ? 'checked' : 'unchecked'], checked, number: checked ? 1 : 0 };
    }

    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return typeof raw === 'number'
        ? { empty: false, tokens: [String(raw)], timestamp: raw, number: raw / 86400 }
        : { empty: true, tokens: [] };
    case FieldType.RichText:
    case FieldType.URL: {
      const text = typeof raw === 'string' ? raw.trim() : '';

      return { empty: text === '', tokens: text ? [text] : [] };
    }

    default: {
      const ids = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];

      return { empty: ids.length === 0, tokens: ids };
    }
  }
}

describe('aggregateChartCells (dashboard-parity/aggregations.json#cases)', () => {
  it.each(fixture.cases.map((entry) => [`${entry.yType} ${entry.agg} over ${entry.cellSet}`, entry] as const))(
    '%s',
    (_, entry) => {
      const type = fieldTypeOf(entry.yType);
      const cells = fixture.cells[entry.cellSet].map((raw) => yCell(type, raw));
      const value = aggregateChartCells(entry.agg, cells);

      if (entry.expect === null) expect(value).toBeNull();
      else expect(value).toBeCloseTo(entry.expect, 9);
    }
  );

  it('covers every aggregation valid for each Y type', () => {
    ['Number', 'Checkbox', 'DateTime', 'SingleSelect', 'MultiSelect', 'RichText', 'Person', 'Relation'].forEach((name) => {
      const type = fieldTypeOf(name);
      const covered = new Set(fixture.cases.filter((entry) => entry.yType === name).map((entry) => entry.agg));

      for (let agg = 0; agg <= 16; agg++) {
        if (isAggregationValidFor(agg, type)) expect([name, agg, covered.has(agg)]).toEqual([name, agg, true]);
      }
    });
  });
});

describe('effectiveChartAggregation (dashboard-parity/aggregations.json#effective)', () => {
  it.each(fixture.effective.map((entry) => [`${entry.agg} on ${entry.yType}`, entry] as const))('%s', (_, entry) => {
    expect(effectiveChartAggregation(entry.agg, entry.yType === null ? null : fieldTypeOf(entry.yType))).toBe(
      entry.expect
    );
  });

  it('reads a desktop bigint and rejects what is not an integer 0–16', () => {
    expect(effectiveChartAggregation(BigInt(3), FieldType.DateTime)).toBe(ChartAggregationType.Earliest);
    [-1, 1.5, Number.NaN, '1', undefined, null, 17].forEach((stored) =>
      expect(effectiveChartAggregation(stored, FieldType.Number)).toBe(ChartAggregationType.Count)
    );
  });

  it('counts rows for a Y property a chart cannot aggregate', () => {
    expect(effectiveChartAggregation(1, FieldType.Formula)).toBe(ChartAggregationType.Count);
  });
});

describe('defaultAggregationFor (dashboard-parity/aggregations.json#defaults)', () => {
  it.each(fixture.defaults.map((entry) => [`${entry.yType} from ${entry.current}`, entry] as const))('%s', (_, entry) => {
    expect(defaultAggregationFor(fieldTypeOf(entry.yType), entry.current)).toBe(entry.expect);
  });
});

describe('calculateMenu (dashboard-parity/aggregations.json#calculateMenu)', () => {
  it.each(fixture.calculateMenu.map((entry) => [`${entry.yType} on ${entry.chartType}`, entry] as const))(
    '%s',
    (_, entry) => {
      expect(calculateMenu(fieldTypeOf(entry.yType), chartTypeOf(entry.chartType))).toEqual(entry.expect);
    }
  );
});

describe('supportsCumulative (dashboard-parity/aggregations.json#cumulative)', () => {
  it.each(fixture.cumulative.map((entry) => [`${entry.agg} on ${entry.chartType}`, entry] as const))('%s', (_, entry) => {
    expect(supportsCumulative(entry.agg, chartTypeOf(entry.chartType))).toBe(entry.expect);
  });
});

describe('CHART_AGGREGATION_META', () => {
  it('labels every aggregation 0–16, 6 as Count unique values', () => {
    for (let agg = 0; agg <= 16; agg++) expect(CHART_AGGREGATION_META[agg]?.labelKey).toMatch(/^chart\.agg\./);
    expect(CHART_AGGREGATION_META[6].fallback).toBe('Count unique values');
    expect(CHART_AGGREGATION_META[7].fallback).toBe('Count values');
  });

  it('stores Earliest and Latest in days for R-FORMAT', () => {
    expect(chartValueOfAggregate(13, 1717200000)).toBe(1717200000 / 86400);
    expect(chartValueOfAggregate(15, 9)).toBe(9);
    expect(chartValueOfAggregate(14, null)).toBeNull();
  });
});
