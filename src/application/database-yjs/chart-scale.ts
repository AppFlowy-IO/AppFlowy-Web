import { ChartType } from './chart-enums';
import { formatShare } from './chart-format';
import { DASHBOARD_CHART_GEOMETRY, DASHBOARD_TYPOGRAPHY } from './dashboard-geometry';

import type { ChartLegendPosition } from './chart-extended-settings';

/**
 * Scales, axes, label fitting, donut geometry and legend layout (WP10 §1.3,
 * §1.5). Pure: text widths come from an injected measurer, so the same
 * vectors (`dashboard-parity/chart-geometry.json`, 6px per character at 12px
 * and 5px at 10px) drive these functions and desktop's `chart_scale.dart`.
 */

/** Width in px of a text in the chart font (12px, or 10px for donut labels). */
export type TextMeasurer = (text: string) => number;

const { axis, bar, donut, legend } = DASHBOARD_CHART_GEOMETRY;
const { donutTotal, donutOutsideLabel } = DASHBOARD_TYPOGRAPHY;

// Layout values the chart components draw with and these functions reserve
// room for. They are exported so both sides read one value; `tokens.json` has
// no entry for them yet (they move there with the next chart token change).
/** Height of a category or value axis with horizontal labels. */
export const CHART_AXIS_HEIGHT = 24;
/** Room above the tallest mark: a data label's line when labels are on, else this. */
export const CHART_PLOT_TOP = 4;
/** A data label sits this far past the value end of its mark. */
export const CHART_DATA_LABEL_OFFSET = 4;
/** Padding between the plot and the legend. */
export const CHART_LEGEND_PADDING_TOP = 8;
/** Gap between a legend item's glyph and its label. */
export const CHART_LEGEND_GLYPH_GAP = 6;
/** Gap between the legend items and the pager row. */
export const CHART_LEGEND_PAGER_GAP = 4;
/** Height of the pager row (`▲ n/N ▼`). */
export const CHART_LEGEND_PAGER_HEIGHT = 16;
/** The donut's centre text may be this wide, in inner radii. */
export const CHART_DONUT_CENTER_WIDTH_FACTOR = 1.6;

const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Up to `maxTicks` round tick values covering [min, max] (steps 1, 2, 2.5, 5 × 10^n). */
export function niceTicks(min: number, max: number, maxTicks: number = axis.maxTicks, integerOnly = false): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max - min <= 0) return [0, 1];
  const raw = (max - min) / (maxTicks - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const steps = integerOnly && magnitude <= 1 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const nice = steps.find((candidate) => normalized <= candidate + EPSILON) ?? 10;
  let step = nice * magnitude;

  if (integerOnly) step = Math.max(1, Math.ceil(step - EPSILON));
  const low = Math.floor(min / step + EPSILON) * step;
  const high = Math.ceil(max / step - EPSILON) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + EPSILON)) + (nice === 2.5 ? 1 : 0);
  const count = Math.round((high - low) / step);
  const ticks: number[] = [];

  for (let index = 0; index <= count; index += 1) {
    // `+ 0` turns a -0 into 0.
    ticks.push(Number((low + index * step).toFixed(decimals)) + 0);
  }

  return ticks;
}

export interface ValueDomain {
  ticks: number[];
  domain: [number, number];
}

/**
 * The value axis: zero is always inside, 8% headroom past the extreme values,
 * then nice ticks. `integerOnly` for counts. Every value is kept (negatives
 * included).
 */
export function computeValueDomain(values: readonly number[], integerOnly: boolean): ValueDomain {
  let low = 0;
  let high = 0;

  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }

  if (high === low) return { ticks: [0, 1], domain: [0, 1] };
  const range = high - low;
  const padHigh = high > 0 ? high + axis.headroom * range : 0;
  const padLow = low < 0 ? low - axis.headroom * range : 0;
  const ticks = niceTicks(padLow, padHigh, axis.maxTicks, integerOnly);

  return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] };
}

/** Width of the value-axis column: the widest tick text plus the 8px gap to the plot. */
export function computeYAxisWidth(tickTexts: readonly string[], measure: TextMeasurer): number {
  const widest = tickTexts.reduce((max, text) => Math.max(max, measure(text)), 0);

  return Math.ceil(widest) + axis.tickGap;
}

/** `text`, or its longest prefix plus "…" that fits `maxWidth` (by code point; "…" alone when nothing fits). */
export function truncateToWidth(text: string, maxWidth: number, measure: TextMeasurer): string {
  if (measure(text) <= maxWidth) return text;
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;

  // The longest prefix length whose "prefix…" fits.
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (measure(`${chars.slice(0, middle).join('')}…`) <= maxWidth) low = middle;
    else high = middle - 1;
  }

  return `${chars.slice(0, low).join('')}…`;
}

/**
 * Indices of thinned labels: every `step`-th from 0, and the last one, which
 * replaces the previous kept label when they would sit closer than half a step.
 */
export function thinLabelIndices(count: number, step: number): number[] {
  if (count <= 0) return [];
  const shown: number[] = [];

  for (let index = 0; index < count; index += Math.max(1, step)) shown.push(index);
  const last = shown[shown.length - 1];

  if (last !== count - 1) {
    if (count - 1 - last < Math.ceil(step / 2) && last !== 0) shown[shown.length - 1] = count - 1;
    else shown.push(count - 1);
  }

  return shown;
}

export interface CategoryLabelFit {
  mode: 'horizontal' | 'rotated';
  /** Indices of the labels that are drawn; the others keep their text in the tooltip and the data table. */
  shown: number[];
}

/** Horizontal when every label fits its slot, else −45°, thinned when slots are narrower than 24px. */
export function fitCategoryLabels(widths: readonly number[], slot: number): CategoryLabelFit {
  const count = widths.length;

  if (count === 0) return { mode: 'horizontal', shown: [] };
  const all = widths.map((_, index) => index);

  if (Math.max(...widths) <= slot - 4) return { mode: 'horizontal', shown: all };
  if (slot >= axis.minSlotForRotation) return { mode: 'rotated', shown: all };
  return { mode: 'rotated', shown: thinLabelIndices(count, Math.ceil(axis.minLabelSpacing / slot)) };
}

/** Height of the category axis: 24 for horizontal labels, the rotated label's vertical extent plus 8 otherwise. */
export function computeXAxisHeight(mode: CategoryLabelFit['mode'], widestLabel: number): number {
  if (mode === 'horizontal') return CHART_AXIS_HEIGHT;
  return Math.ceil(0.7071 * Math.min(widestLabel, axis.rotatedMaxLabel) + 0.7071 * 16) + 8;
}

/** The category column of a horizontal bar chart: the widest label, at least 24, at most min(160, 35% of the width). */
export function computeHorizontalLabelWidth(widths: readonly number[], innerWidth: number): number {
  const widest = widths.length ? Math.max(...widths) : 0;

  return clamp(widest, 24, Math.min(legend.maxLabelWidth, 0.35 * innerWidth));
}

/** Thin bars: 35% of the slot, 8–16px, never wider than 80% of the slot. */
export function computeBarWidth(plotLength: number, count: number): number {
  if (count <= 0 || plotLength <= 0) return 0;
  const slot = plotLength / count;

  return Math.min(clamp(bar.slotFraction * slot, bar.minWidth, bar.maxWidth), Math.max(1, 0.8 * slot));
}

export interface DonutGeometry {
  outer: number;
  inner: number;
  thickness: number;
  labelsOn: boolean;
  totalFont: number;
  showCaption: boolean;
  showTotal: boolean;
}

/** Ring size for a `width × height` frame with `legendHeight` reserved below it. */
export function computeDonutGeometry(
  width: number,
  height: number,
  legendHeight: number,
  labelsWanted: boolean
): DonutGeometry {
  const available = Math.min(width, height - legendHeight - (legendHeight > 0 ? 8 : 0));
  const base = available / 2 - 2;
  const labelsOn = labelsWanted && base - donut.labelGutter >= donut.minOuterForLabels;
  const outer = Math.min(base - (labelsOn ? donut.labelGutter : 0), donut.maxOuter);
  const thickness = Math.max(donut.minThickness, donut.thicknessFactor * outer);
  const inner = outer - thickness;

  return {
    outer,
    inner,
    thickness,
    labelsOn,
    totalFont: clamp(donutTotal.radiusFactor * outer, donutTotal.minSize, donutTotal.maxSize),
    showCaption: inner >= 28,
    showTotal: inner >= 16,
  };
}

export interface DonutSliceInput {
  name: string;
  value: number;
  /** The value as R-FORMAT `label` prints it. */
  valueText: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface DonutLabelLayout {
  visible: boolean;
  side: 'left' | 'right';
  /** `Name value (share)`, the name truncated to fit; empty when hidden. */
  text: string;
  textX: number;
  textY: number;
  /** Leader: radial from `leader[0]` to `leader[1]`, then horizontal to `leader[2]`. */
  leader: [Point, Point, Point];
  /** Middle of the slice on the ring (hover and click target). */
  anchor: Point;
}

/**
 * Outside labels of a donut whose slices start at 12 o'clock and run
 * clockwise. A label shows when labels are on, the share is at least 3%, it
 * has 40px or more up to the box edge, at least one character of its name
 * fits beside the value, and it sits 14px or more below the previous visible
 * label on its side.
 */
export function layoutDonutLabels(
  slices: readonly DonutSliceInput[],
  geometry: { cx: number; cy: number; outer: number; inner: number; labelsOn: boolean },
  box: { width: number; height: number },
  measure10: TextMeasurer
): DonutLabelLayout[] {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const { cx, cy, outer, inner } = geometry;
  const polar = (radius: number, angle: number): Point => ({
    x: cx + radius * Math.sin(angle),
    y: cy - radius * Math.cos(angle),
  });
  let start = 0;
  const layouts = slices.map((slice) => {
    const span = total > 0 ? (slice.value / total) * Math.PI * 2 : 0;
    const angle = start + span / 2;

    start += span;
    const right = Math.sin(angle) >= 0;
    const p1 = polar(outer + 2, angle);
    const p2 = polar(outer + 2 + donut.leaderRadial, angle);
    const p3 = { x: p2.x + (right ? donut.leaderHorizontal : -donut.leaderHorizontal), y: p2.y };
    const textX = right ? p3.x + 4 : p3.x - 4;
    const available = right ? box.width - textX : textX;
    const share = total > 0 ? (slice.value / total) * 100 : 0;
    const suffix = ` ${slice.valueText} (${formatShare(slice.value, total)})`;
    const fits = geometry.labelsOn && share >= donut.minShareForLabel && available >= 40;
    const name = fits ? truncateToWidth(slice.name, Math.max(0, available - measure10(suffix)), measure10) : '';
    // A label that cannot keep one character of its name is hidden (it would also overflow the box).
    const visible = fits && (name !== '…' || slice.name === '…');

    return {
      visible,
      side: right ? 'right' : 'left',
      text: visible ? `${name}${suffix}` : '',
      textX,
      textY: p2.y,
      leader: [p1, p2, p3],
      anchor: polar((outer + inner) / 2, angle),
    } satisfies DonutLabelLayout;
  });

  (['left', 'right'] as const).forEach((side) => {
    let previousY: number | null = null;

    layouts
      .filter((layout) => layout.side === side && layout.visible)
      .sort((a, b) => a.textY - b.textY)
      .forEach((layout) => {
        if (previousY !== null && layout.textY - previousY < donutOutsideLabel.lineHeight) {
          layout.visible = false;
          layout.text = '';
          return;
        }

        previousY = layout.textY;
      });
  });

  return layouts;
}

/** Width of one legend item: the 8px swatch (12px line glyph), a 6px gap and the label (at most 160px). */
export function legendItemWidth(labelWidth: number, glyph: 'square' | 'line'): number {
  return (
    (glyph === 'line' ? legend.lineGlyph[0] : legend.swatch) +
    CHART_LEGEND_GLYPH_GAP +
    Math.min(labelWidth, legend.maxLabelWidth)
  );
}

export interface LegendPagination {
  /** Item indices per page. */
  pages: number[][];
  /** Lines on a page (the most any page holds). */
  lines: number;
  /** Height the legend takes below the plot. */
  height: number;
}

/** Height of a legend with `lines` lines per page, plus the pager row when there is more than one page. */
export function computeLegendHeight(lines: number, pages: number): number {
  if (lines <= 0) return 0;
  return (
    lines * legend.lineHeight +
    (lines - 1) * legend.gapY +
    CHART_LEGEND_PADDING_TOP +
    (pages > 1 ? CHART_LEGEND_PAGER_GAP + CHART_LEGEND_PAGER_HEIGHT : 0)
  );
}

/**
 * Greedy line fill with 16px between items. Two lines or fewer: one page.
 * Narrower than 160px: one item per page. Otherwise pages of two lines.
 */
export function paginateLegend(
  itemWidths: readonly number[],
  width: number,
  maxLines: number = legend.maxLines
): LegendPagination {
  if (itemWidths.length === 0) return { pages: [], lines: 0, height: 0 };
  if (width < legend.narrowWidth) {
    const pages = itemWidths.map((_, index) => [index]);

    return { pages, lines: 1, height: computeLegendHeight(1, pages.length) };
  }

  const lines: number[][] = [];
  let lineWidth = 0;

  itemWidths.forEach((itemWidth, index) => {
    const current = lines[lines.length - 1];

    if (current && lineWidth + legend.gapX + itemWidth <= width) {
      current.push(index);
      lineWidth += legend.gapX + itemWidth;
      return;
    }

    lines.push([index]);
    lineWidth = itemWidth;
  });

  if (lines.length <= maxLines) {
    return { pages: [lines.flat()], lines: lines.length, height: computeLegendHeight(lines.length, 1) };
  }

  const pages: number[][] = [];

  for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines).flat());
  return { pages, lines: maxLines, height: computeLegendHeight(maxLines, pages.length) };
}

export interface ResolvedLegend {
  /** What the items are: the categories (donut, single-series bars) or the series (lines, several series). */
  content: 'categories' | 'series';
  glyph: 'square' | 'line';
}

/** Whether a chart shows a legend, and what it lists (`legend_position`, WP10 §1.5). */
export function resolveLegend(
  chartType: ChartType,
  seriesCount: number,
  position: ChartLegendPosition
): ResolvedLegend | null {
  if (chartType === ChartType.Number || position === 'off') return null;
  const isLine = chartType === ChartType.Line;
  const shown = position === 'bottom' || chartType === ChartType.Donut || isLine || seriesCount > 1;

  if (!shown) return null;
  return {
    content: isLine || seriesCount > 1 ? 'series' : 'categories',
    glyph: isLine ? 'line' : 'square',
  };
}
