import { measureCategoryLabelWidth } from './chartTextMeasure';
import { truncateChartLabel } from './chartUtils';

/** Room fl_chart reserves left of the plot for the value labels (`reservedSize`). */
export const VALUE_AXIS_WIDTH = 40;
/** Room fl_chart reserves under the plot for upright category labels (`reservedSize`). */
export const CATEGORY_AXIS_HEIGHT = 40;
/** Desktop draws the grid in the body text color at 10%, dashed 5/5. */
export const GRID_LINE_PROPS = { stroke: 'var(--text-primary)', strokeOpacity: 0.1, strokeDasharray: '5 5' };
/** The plot's only border is the bottom one, in the body text color at 20%. */
export const AXIS_LINE_PROPS = { stroke: 'var(--text-primary)', strokeOpacity: 0.2 };
/** Recharts reserves nothing beyond the axes: the plot spans the rest of the chart. */
export const NO_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Class for a plot container that lets the axis labels paint past the chart's
 * `<svg>`, as desktop's titles do: nothing up to the chart page clips them, so
 * the ends of long tilted labels (and wide value-axis numbers) overhang the
 * plot sideways. Recharts pins the SVG's inline style and puts `className` on
 * its wrapper only, so the browser default `overflow: hidden` of
 * `svg:not(:root)` has to be undone from the container.
 */
export const PLOT_SURFACE_OVERFLOW_CLASS = '[&_.recharts-surface]:overflow-visible';

/** Gap `SideTitleWidget` leaves between the plot and a category label. */
const CATEGORY_LABEL_GAP = 8;
/** Line height of the caption style the category labels use (12/18). */
const CATEGORY_LABEL_LINE_HEIGHT = 18;
/** Desktop tilts a category label by -0.5 rad once its slot is too narrow for it upright. */
const CATEGORY_LABEL_TILT = -0.5;
const CATEGORY_LABEL_TILT_DEGREES = (CATEGORY_LABEL_TILT * 180) / Math.PI;
/** Narrowest slot that still fits a bar chart label upright (desktop's `_minHorizontalLabelWidth`). */
const BAR_MIN_UPRIGHT_SLOT = 80;
/** Narrowest slot that still fits a line chart label upright (desktop's `_minBottomTitleSlotWidth`). */
const LINE_MIN_UPRIGHT_SLOT = 100;
/** Room the line chart adds on top of its measured tilted band (desktop's `_tiltedBandPadding`). */
const LINE_TILTED_BAND_PADDING = 8;

/** Measures the rendered width of a category label. */
export type CategoryLabelMeasure = (text: string) => number;

/** How the category labels sit in the band under the plot. */
export interface CategoryAxisLayout {
  tilted: boolean;
  /** Height of the band. */
  height: number;
  /** Distance from the axis to each label's center, which a tilted label rotates about. */
  labelCenter: number;
}

const UPRIGHT_LAYOUT: CategoryAxisLayout = {
  tilted: false,
  height: CATEGORY_AXIS_HEIGHT,
  labelCenter: CATEGORY_LABEL_GAP + CATEGORY_LABEL_LINE_HEIGHT / 2,
};

/** Half the vertical extent of a `width` × line-height label rotated by the tilt. */
function tiltedHalfHeight(width: number) {
  const angle = Math.abs(CATEGORY_LABEL_TILT);

  return (width * Math.sin(angle) + CATEGORY_LABEL_LINE_HEIGHT * Math.cos(angle)) / 2;
}

/**
 * Category band of the bar chart (desktop's `_tiltedLabelGeometry`). The
 * labels tilt once a slot is narrower than 80px. A tilted label rotates about
 * its center, so the gap above it has to keep the rotated top below the axis,
 * and the band has to hold the rotated bottom; both come from the longest label.
 */
export function barCategoryAxisLayout(
  labels: string[],
  slotWidth: number,
  measure: CategoryLabelMeasure = measureCategoryLabelWidth
): CategoryAxisLayout {
  if (labels.length === 0 || slotWidth >= BAR_MIN_UPRIGHT_SLOT) return UPRIGHT_LAYOUT;
  const halfLine = CATEGORY_LABEL_LINE_HEIGHT / 2;
  let gap = 0;
  let height = 0;

  for (const label of labels) {
    const half = tiltedHalfHeight(measure(truncateChartLabel(label)));
    const labelGap = Math.max(0, half - halfLine);

    gap = Math.max(gap, labelGap);
    height = Math.max(height, labelGap + halfLine + half);
  }

  return { tilted: true, height, labelCenter: gap + halfLine };
}

/**
 * Category band of the line chart (desktop's `_resolveBottomAxis`). The
 * labels tilt once a slot is narrower than 100px, and the band then grows to
 * the widest label's rotated height plus 8px, never below 40px. A tilted label
 * is centered in the band under the 8px gap.
 */
export function lineCategoryAxisLayout(
  labels: string[],
  slotWidth: number,
  measure: CategoryLabelMeasure = measureCategoryLabelWidth
): CategoryAxisLayout {
  if (labels.length === 0 || slotWidth >= LINE_MIN_UPRIGHT_SLOT) return UPRIGHT_LAYOUT;
  const widest = labels.reduce((max, label) => Math.max(max, measure(truncateChartLabel(label))), 0);
  const height = Math.max(CATEGORY_AXIS_HEIGHT, 2 * tiltedHalfHeight(widest) + LINE_TILTED_BAND_PADDING);

  return { tilted: true, height, labelCenter: CATEGORY_LABEL_GAP + (height - CATEGORY_LABEL_GAP) / 2 };
}

/** Props Recharts hands a custom `tick` renderer. */
export interface AxisTickProps {
  x?: number;
  y?: number;
  payload?: { value?: number | string };
}

/**
 * Recharts tick for the category labels under the plot (desktop's
 * `_buildBottomTitle`, the same on the bar and line charts): caption 12/18
 * w500 in the tertiary text color, cut after 15 characters. An upright label's
 * line box starts 8px under the axis; a tilted one is rotated -0.5 rad about
 * the center `layout` gives it. The tick values are row indexes.
 */
export function renderCategoryAxisTick(labels: string[], layout: CategoryAxisLayout) {
  return function CategoryAxisTick({ x = 0, y = 0, payload }: AxisTickProps) {
    const label = labels[Number(payload?.value)] ?? '';
    const centerY = y + layout.labelCenter;

    return (
      <text
        x={x}
        y={centerY}
        textAnchor='middle'
        dominantBaseline='central'
        transform={layout.tilted ? `rotate(${CATEGORY_LABEL_TILT_DEGREES} ${x} ${centerY})` : undefined}
        className='fill-text-tertiary text-xs font-medium'
      >
        {truncateChartLabel(label)}
      </text>
    );
  };
}
