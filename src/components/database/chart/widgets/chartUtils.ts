import { ChartDataItem } from '@/application/database-yjs/chart.type';

/**
 * Bar slot height of a standalone horizontal bar chart, which scrolls when it
 * has many categories (a dashboard widget fills its card instead).
 */
export function calculateBarHeight(dataCount: number): number {
  if (dataCount <= 5) return 48;
  if (dataCount <= 10) return 40;
  if (dataCount <= 20) return 32;
  return 28;
}

/**
 * Compare two `ChartDataItem` arrays for the fields that affect the rendered
 * chart AND the drilldown popup. Used by the chart widget `React.memo`
 * comparators so Yjs hydration micro-batches that produce the same final
 * chart don't rebuild the recharts SVG tree.
 *
 * The `rowIds` arrays must be compared by content (not just length) — when
 * filtering swaps which rows belong to a category but the count stays the
 * same, the bar's onClick must use the new rowIds, otherwise the drilldown
 * popup shows stale rows.
 */
export function chartDataEqual(a: ChartDataItem[], b: ChartDataItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];

    if (
      x.label !== y.label ||
      x.value !== y.value ||
      x.color !== y.color ||
      x.key !== y.key ||
      x.optionColor !== y.optionColor ||
      x.checkboxState !== y.checkboxState ||
      x.isEmptyCategory !== y.isEmptyCategory ||
      x.rowIds.length !== y.rowIds.length
    ) {
      return false;
    }

    // Per-id check — drilldown correctness depends on this.
    for (let j = 0; j < x.rowIds.length; j++) {
      if (x.rowIds[j] !== y.rowIds[j]) return false;
    }
  }

  return true;
}

/** The category key a chart draws an item under (the label for items built without a key). */
export function chartItemKey(item: ChartDataItem): string {
  return item.key ?? item.label;
}

/** Count-like aggregations (Count, Count values, and WP11's empty / not empty counts) chart whole numbers. */
const COUNT_AGGREGATIONS = new Set([0, 6, 7, 8]);

/**
 * Whether the charted values are counts: the aggregation is count-like, or
 * it needs a Y field the chart does not have (the chart then counts rows).
 */
export function chartValuesAreCounts(aggregationType: number, hasYField: boolean): boolean {
  return !hasYField || COUNT_AGGREGATIONS.has(aggregationType);
}
