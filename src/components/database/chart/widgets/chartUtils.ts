import {
  CHART_COLORS,
  CHART_EMPTY_VALUE_COLOR,
  ChartDataItem,
  DONUT_CHART_COLORS,
} from '@/application/database-yjs/chart.type';
import { getSelectOptionChartFillHex } from '@/components/database/chart/hooks/chartColors';

import { nearestInPalette, readableTone } from './chartPalette';

/**
 * Format value for display (integer if whole number, otherwise 1 decimal)
 */
export function formatValue(value: number): string {
  return value === Math.round(value) ? value.toString() : value.toFixed(1);
}

/** Desktop's `_calculateBarWidth`: 20px bars, 15px once there are more than 20. */
export function calculateBarWidth(dataCount: number): number {
  return dataCount <= 20 ? 20 : 15;
}

/**
 * Desktop's `_validateData` on the bar, line and horizontal bar charts: only
 * finite, non-negative values are plotted (the donut also drops zeros).
 */
export function isPlottableValue(item: ChartDataItem): boolean {
  return Number.isFinite(item.value) && item.value >= 0;
}

/**
 * Fill color for the item at `index` of the list a widget renders (desktop's
 * `ChartColorUtils.resolveColor`): its fixed option / checkbox color, the grey
 * of the "No {field}" category, else the palette color for that index.
 */
export function resolveChartItemColor(item: ChartDataItem, index: number): string {
  if (item.color !== undefined) return item.color;
  if (item.isEmptyCategory) return CHART_EMPTY_VALUE_COLOR;
  return CHART_COLORS[index % CHART_COLORS.length];
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Fill and label colors of a donut section (desktop's `resolveColor` with
 * `palette: donutPalette`). The palette is authoritative: an option fill only
 * picks the hue, snapped to the nearest palette entry; checkbox colors and
 * the "No {field}" grey stay; anything else takes the palette entry for
 * `index`. Labels take the fill's readable tone on the current theme.
 *
 * Desktop snaps the label from the option's tag text color instead, which is
 * white for the ten thick tag colors and lands every one of them on the red
 * end of the ramp; deriving it from the fill keeps a label in its slice's hue.
 */
export function resolveDonutSectionColors(
  item: ChartDataItem,
  index: number,
  isDark: boolean
): { fill: string; text: string } {
  const optionFill = item.color === undefined ? undefined : getSelectOptionChartFillHex(item.color);
  const fill = optionFill
    ? nearestInPalette(optionFill, DONUT_CHART_COLORS)
    : item.color ??
      (item.isEmptyCategory ? CHART_EMPTY_VALUE_COLOR : DONUT_CHART_COLORS[index % DONUT_CHART_COLORS.length]);

  // Any other fixed color has no tone to derive.
  return { fill, text: HEX_COLOR.test(fill) ? readableTone(fill, isDark) : fill };
}

/**
 * Desktop's decade of `value`, `(math.log(value) / math.ln10).floor()`: the
 * `_magnitude` helper of the bar and line charts and the inline expression in
 * the horizontal bar chart's `_computeAxisMax`. Unlike `Math.log10` it lands
 * one decade low at some exact powers of ten (`Math.log(1000) / Math.LN10`
 * is 2.9999999999999996; likewise 1e6, 1e9, 1e12, 1e13 and 1e15), so a
 * horizontal-bar max of 800 gets axis 1000, not 1500. Kept on purpose for
 * desktop parity: an epsilon around `Math.log10` would not drop the same set
 * of decades.
 */
function desktopMagnitude(value: number): number {
  if (value <= 0) return 1;

  return Math.pow(10, Math.floor(Math.log(value) / Math.LN10));
}

/**
 * Desktop's `_calculateYAxisInterval` (bar + line charts): a 1 / 2 / 5 / 10
 * × 10^n step that splits `maxY` into roughly five intervals.
 */
export function calculateAxisInterval(maxY: number): number {
  if (maxY <= 0) return 1;
  const rawInterval = maxY / 5;
  const magnitude = desktopMagnitude(rawInterval);
  const normalized = rawInterval / magnitude;
  let niceInterval: number;

  if (normalized <= 1) niceInterval = 1;
  else if (normalized <= 2) niceInterval = 2;
  else if (normalized <= 5) niceInterval = 5;
  else niceInterval = 10;

  return niceInterval * magnitude;
}

/**
 * Tick values from 0 up to and including `axisMax` in `interval` steps,
 * like fl_chart's side titles. Multiples are rebuilt from the index so float
 * drift never hides an integer tick.
 */
export function axisTicks(axisMax: number, interval: number): number[] {
  if (!(axisMax > 0) || !(interval > 0)) return [0];
  const ticks: number[] = [];
  const count = Math.floor(axisMax / interval + 1e-9);

  for (let i = 0; i <= count; i++) {
    ticks.push(Number((i * interval).toPrecision(12)));
  }

  return ticks;
}

/** Desktop bar chart's `_computeAxisMaxY`: 30% headroom over the tallest bar. */
export function computeBarAxisMax(maxValue: number): number {
  return maxValue <= 0 ? 1 : maxValue * 1.3;
}

/** Desktop line chart's `_computeAxisMaxY`: ~20% headroom rounded to a nice number. */
export function computeLineAxisMax(maxValue: number): number {
  if (maxValue <= 0) return 5;
  const targetMax = maxValue * 1.2;

  for (const nice of [5, 10, 20, 25, 50, 100, 200, 500, 1000]) {
    if (targetMax <= nice) return nice;
  }

  return Math.ceil(targetMax / 500) * 500;
}

/** Desktop horizontal bar chart's `_computeAxisMax`: ~25% headroom rounded to a nice number. */
export function computeHorizontalAxisMax(maxValue: number): number {
  if (maxValue <= 0) return 4;
  const targetMax = maxValue * 1.25;

  for (const nice of [4, 5, 6, 8, 10]) {
    if (targetMax <= nice) return nice;
  }

  const magnitude = desktopMagnitude(targetMax);
  const normalized = targetMax / magnitude;

  if (normalized <= 1.5) return 1.5 * magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 3) return 3 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

/** Desktop horizontal bar chart's `_computeLabelCount` / `_computeGridCount`. */
export function computeHorizontalLabelCount(axisMax: number): number {
  if (axisMax <= 5) return Math.trunc(axisMax);
  if (axisMax <= 10) return 5;
  return 4;
}

/** Desktop axis and row labels cut anything longer than 15 characters. */
export function truncateChartLabel(label: string): string {
  return label.length > 15 ? `${label.substring(0, 15)}...` : label;
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
      // The drill-down builds its filter from these, so a stale item must not survive.
      x.isCheckedCategory !== y.isCheckedCategory ||
      x.sortKey !== y.sortKey ||
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
