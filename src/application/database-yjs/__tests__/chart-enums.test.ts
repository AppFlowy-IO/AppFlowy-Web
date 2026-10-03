import { ChartAggregationType, ChartType, resolveEffectiveAggregation } from '../chart-enums';
import { isCountAggregation } from '../chart-format';
import * as chartType from '../chart.type';

describe('resolveEffectiveAggregation', () => {
  const computed = [
    ChartAggregationType.Count,
    ChartAggregationType.Sum,
    ChartAggregationType.Average,
    ChartAggregationType.Min,
    ChartAggregationType.Max,
    ChartAggregationType.Median,
    ChartAggregationType.CountValues,
  ];

  it.each(computed)('keeps the computed aggregation %p when it has its Y field', (aggregation) => {
    expect(resolveEffectiveAggregation(aggregation, true)).toBe(aggregation);
  });

  it.each(computed)('counts rows for %p without a Y field', (aggregation) => {
    expect(resolveEffectiveAggregation(aggregation, false)).toBe(ChartAggregationType.Count);
  });

  // WP11 adds 7–16; until then web computes none of them, so they must not be
  // formatted as percentages, dates or days either.
  it.each([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 99, -1, 1.5, Number.NaN])(
    'maps the unknown stored value %p to Count',
    (stored) => {
      expect(resolveEffectiveAggregation(stored, true)).toBe(ChartAggregationType.Count);
    }
  );

  it('reads a desktop bigint and rejects values that are not numbers', () => {
    expect(resolveEffectiveAggregation(BigInt(ChartAggregationType.Median), true)).toBe(ChartAggregationType.Median);
    expect(resolveEffectiveAggregation(BigInt(12), true)).toBe(ChartAggregationType.Count);
    expect(resolveEffectiveAggregation('1', true)).toBe(ChartAggregationType.Count);
    expect(resolveEffectiveAggregation(undefined, true)).toBe(ChartAggregationType.Count);
    expect(resolveEffectiveAggregation(null, true)).toBe(ChartAggregationType.Count);
  });
});

describe('isCountAggregation', () => {
  it('is true for the row count and the value count', () => {
    expect(isCountAggregation(ChartAggregationType.Count)).toBe(true);
    expect(isCountAggregation(ChartAggregationType.CountValues)).toBe(true);
  });

  it.each([
    ChartAggregationType.Sum,
    ChartAggregationType.Average,
    ChartAggregationType.Min,
    ChartAggregationType.Max,
    ChartAggregationType.Median,
  ])('is false for the value aggregation %p', (aggregation) => {
    expect(isCountAggregation(aggregation)).toBe(false);
  });

  it('agrees with the effective aggregation: a chart without a Y field has a whole-number axis', () => {
    expect(isCountAggregation(resolveEffectiveAggregation(ChartAggregationType.Average, false))).toBe(true);
    expect(isCountAggregation(resolveEffectiveAggregation(12, true))).toBe(true);
  });
});

describe('chart enums', () => {
  it('are the same objects through chart.type, which re-exports them', () => {
    expect(chartType.ChartType).toBe(ChartType);
    expect(chartType.ChartAggregationType).toBe(ChartAggregationType);
    expect(chartType.resolveEffectiveAggregation).toBe(resolveEffectiveAggregation);
  });

  it('keep the ints desktop stores', () => {
    expect([ChartType.Bar, ChartType.Line, ChartType.HorizontalBar, ChartType.Donut, ChartType.Number]).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect([
      ChartAggregationType.Count,
      ChartAggregationType.Sum,
      ChartAggregationType.Average,
      ChartAggregationType.Min,
      ChartAggregationType.Max,
      ChartAggregationType.Median,
      ChartAggregationType.CountValues,
    ]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
