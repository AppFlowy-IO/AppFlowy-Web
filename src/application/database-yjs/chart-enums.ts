/**
 * The chart enums and limits shared with desktop. Dependency free, so the pure
 * chart modules (`chart-format.ts`, `chart-scale.ts`, which Playwright steps
 * import by relative path) can use them; `chart.type.ts` re-exports them for
 * everything else.
 */

/**
 * Chart type enum matching Flutter's ChartTypePB
 */
export enum ChartType {
  Bar = 0,
  Line = 1,
  HorizontalBar = 2,
  Donut = 3,
  /** Single KPI tile: one aggregated value over all filtered rows. */
  Number = 4,
}

/**
 * Chart aggregation type enum matching Flutter's ChartAggregationTypePB.
 * These are the aggregations this client computes; WP11 adds 7–16 here
 * together with their `computeAggregation` cases.
 */
export enum ChartAggregationType {
  Count = 0,
  Sum = 1,
  Average = 2,
  Min = 3,
  Max = 4,
  Median = 5,
  CountValues = 6,
}

/** The largest `decimal_places` a chart stores; larger values read as auto. */
export const CHART_MAX_DECIMAL_PLACES = 5;

const COMPUTED_AGGREGATIONS: ReadonlySet<number> = new Set([
  ChartAggregationType.Count,
  ChartAggregationType.Sum,
  ChartAggregationType.Average,
  ChartAggregationType.Min,
  ChartAggregationType.Max,
  ChartAggregationType.Median,
  ChartAggregationType.CountValues,
]);

/**
 * The aggregation a chart computes, formats and titles. This is the one place
 * the rule lives:
 * - an aggregation without its Y field counts rows;
 * - so does a stored value this client does not compute yet (another client's
 *   7–16, until WP11 lands), so the value and its format never disagree.
 */
export function resolveEffectiveAggregation(stored: unknown, hasYField: boolean): ChartAggregationType {
  const value = typeof stored === 'bigint' ? Number(stored) : stored;

  if (!hasYField || typeof value !== 'number' || !COMPUTED_AGGREGATIONS.has(value)) {
    return ChartAggregationType.Count;
  }

  return value as ChartAggregationType;
}
