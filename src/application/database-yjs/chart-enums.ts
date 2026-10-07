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
 * Chart aggregation type enum matching Flutter's ChartAggregationTypePB
 * (`dashboard-parity/aggregations.json`). WP11 computes every value 0–16 in
 * `chart-config/aggregate.ts`; `effectiveChartAggregation` there decides what a
 * chart computes, formats and titles.
 */
export enum ChartAggregationType {
  Count = 0,
  Sum = 1,
  Average = 2,
  Min = 3,
  Max = 4,
  Median = 5,
  /** "Count unique values": the distinct values of the Y property. */
  CountUnique = 6,
  /** "Count values": rows whose Y cell is not empty. */
  CountNotEmpty = 7,
  CountEmpty = 8,
  PercentEmpty = 9,
  PercentNotEmpty = 10,
  PercentChecked = 11,
  PercentUnchecked = 12,
  Earliest = 13,
  Latest = 14,
  DateRange = 15,
  Range = 16,
}

/** The largest `decimal_places` a chart stores; larger values read as auto. */
export const CHART_MAX_DECIMAL_PLACES = 5;
