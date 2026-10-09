import { effectiveChartAggregation } from '../chart-config/aggregate';
import { ChartAggregationType, ChartType } from '../chart-enums';
import { isCountAggregation } from '../chart-format';
import * as chartType from '../chart.type';
import { FieldType } from '../database.type';

describe('isCountAggregation', () => {
  it('is true for the row count and the unique value count', () => {
    expect(isCountAggregation(ChartAggregationType.Count)).toBe(true);
    expect(isCountAggregation(ChartAggregationType.CountUnique)).toBe(true);
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

  it('agrees with the effective aggregation: a chart without a Y property has a whole-number axis', () => {
    expect(isCountAggregation(effectiveChartAggregation(ChartAggregationType.Average, null))).toBe(true);
    expect(isCountAggregation(effectiveChartAggregation(ChartAggregationType.PercentUnchecked, FieldType.Number))).toBe(
      true
    );
  });
});

describe('chart enums', () => {
  it('are the same objects through chart.type, which re-exports them', () => {
    expect(chartType.ChartType).toBe(ChartType);
    expect(chartType.ChartAggregationType).toBe(ChartAggregationType);
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
      ChartAggregationType.CountUnique,
    ]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
