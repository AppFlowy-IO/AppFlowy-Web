import { ChartDataItem } from '@/application/database-yjs/chart.type';

/**
 * Shared tooltip state interface for all chart types
 */
export interface TooltipState {
  active: boolean;
  item: ChartDataItem | null;
  x: number;
  y: number;
}

/**
 * Extended tooltip state for DonutChart with percentage
 */
export interface DonutTooltipState {
  active: boolean;
  item: (ChartDataItem & { percent?: number }) | null;
  x: number;
  y: number;
}

/**
 * Initial tooltip state
 */
export const INITIAL_TOOLTIP_STATE: TooltipState = {
  active: false,
  item: null,
  x: 0,
  y: 0,
};

/**
 * Format value for display (integer if whole number, otherwise 1 decimal)
 */
export function formatValue(value: number): string {
  return value === Math.round(value) ? value.toString() : value.toFixed(1);
}

/**
 * Generate a small set of "nice" tick values for an axis covering [min, max].
 *
 * Replaces the previous `0..ceil(max)` enumeration which could produce
 * thousands of ticks (one per integer) for Sum/Count aggregations on large
 * datasets, hanging Recharts. Caps at ~`targetCount` ticks with rounded step
 * sizes (1 / 2 / 5 × 10^n).
 *
 * Supports negative `min`, so Sum/Avg/Min on Number fields with negative
 * values doesn't get clipped at zero.
 */
export function generateNiceTicks(min: number, max: number, targetCount = 8): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) {
    if (min === 0) return [0];
    // Single non-zero value — show 0 and the value as ticks.
    return min < 0 ? [min, 0] : [0, min];
  }

  const range = max - min;
  const exp = Math.floor(Math.log10(range / targetCount));
  const fraction = (range / targetCount) / Math.pow(10, exp);
  let niceFraction: number;

  if (fraction < 1.5) niceFraction = 1;
  else if (fraction < 3) niceFraction = 2;
  else if (fraction < 7) niceFraction = 5;
  else niceFraction = 10;

  const step = niceFraction * Math.pow(10, exp);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  const epsilon = step * 1e-9;

  for (let v = niceMin; v <= niceMax + epsilon; v += step) {
    // Avoid float drift accumulated by repeated addition.
    ticks.push(Math.round(v / step) * step);
  }

  return ticks;
}

/**
 * Calculate bar width based on data count (matching Flutter implementation)
 */
export function calculateBarWidth(dataCount: number): number {
  if (dataCount <= 5) return 40;
  if (dataCount <= 10) return 30;
  if (dataCount <= 20) return 20;
  return 15;
}

/**
 * Calculate bar height based on data count for horizontal bar chart
 */
export function calculateBarHeight(dataCount: number): number {
  if (dataCount <= 5) return 48;
  if (dataCount <= 10) return 40;
  if (dataCount <= 20) return 32;
  return 28;
}

/**
 * Compute the axis domain and tick values for a chart's value axis.
 * Always anchors zero in the domain so bars/columns have a meaningful
 * baseline. Supports negative values from Sum / Average / Min on Number
 * fields. Single-pass min/max scan avoids the spread-overflow risk of
 * `Math.min(...arr)` for very large arrays.
 */
export function computeValueAxis(data: ChartDataItem[]): {
  domain: [number, number];
  ticks: number[];
} {
  let dataMin = 0;
  let dataMax = 0;

  for (const item of data) {
    if (item.value < dataMin) dataMin = item.value;
    if (item.value > dataMax) dataMax = item.value;
  }

  const ticks = generateNiceTicks(dataMin, dataMax);

  // `generateNiceTicks` always returns at least one tick (`[0]` for the
  // all-zero case), so direct indexing is safe.
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

/**
 * Compute axis max - extend to ~2x max value for breathing room (matching Flutter)
 */
export function computeAxisMax(maxValue: number): number {
  if (maxValue <= 0) return 4;

  const targetMax = maxValue * 2;

  if (targetMax <= 4) return 4;
  if (targetMax <= 5) return 5;
  if (targetMax <= 10) return 10;

  // For larger values, round up to nearest nice number
  const magnitude = Math.pow(10, Math.floor(Math.log10(targetMax)));
  const normalized = targetMax / magnitude;

  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
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
