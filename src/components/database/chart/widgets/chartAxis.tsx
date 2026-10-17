import { truncateChartLabel } from './chartUtils';

/** Room fl_chart reserves left of the plot for the value labels (`reservedSize`). */
export const VALUE_AXIS_WIDTH = 40;
/** Room fl_chart reserves under the plot for the category labels (`reservedSize`). */
export const CATEGORY_AXIS_HEIGHT = 40;
/** Desktop draws the grid in the body text color at 10%, dashed 5/5. */
export const GRID_LINE_PROPS = { stroke: 'var(--text-primary)', strokeOpacity: 0.1, strokeDasharray: '5 5' };
/** The plot's only border is the bottom one, in the body text color at 20%. */
export const AXIS_LINE_PROPS = { stroke: 'var(--text-primary)', strokeOpacity: 0.2 };
/** Recharts reserves nothing beyond the axes: the plot spans the rest of the chart. */
export const NO_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Class for a plot container that lets the axis labels paint past the chart's
 * `<svg>`, as desktop's titles do: fl_chart rotates a tilted category label
 * around the middle of its 40px band without clipping, and nothing up to the
 * chart page clips either, so long tilted labels (and wide value-axis numbers)
 * overhang the plot. Recharts pins the SVG's inline style and puts
 * `className` on its wrapper only, so the browser default `overflow: hidden`
 * of `svg:not(:root)` has to be undone from the container.
 */
export const PLOT_SURFACE_OVERFLOW_CLASS = '[&_.recharts-surface]:overflow-visible';

/** Gap `SideTitleWidget` leaves between the plot and a category label. */
const CATEGORY_LABEL_GAP = 8;
/** Line height of the caption style the category labels use (12/18). */
const CATEGORY_LABEL_LINE_HEIGHT = 18;
/** Desktop tilts the category labels by -0.5 rad once there are more than six. */
const CATEGORY_LABEL_TILT_AFTER = 6;
const CATEGORY_LABEL_TILT_DEGREES = (-0.5 * 180) / Math.PI;

/** Props Recharts hands a custom `tick` renderer. */
export interface AxisTickProps {
  x?: number;
  y?: number;
  payload?: { value?: number | string };
}

/**
 * Recharts tick for the category labels under the plot (desktop's
 * `_buildBottomTitle`, the same on the bar and line charts): caption 12/18
 * w500 in the tertiary text color, cut after 15 characters, its line box
 * starting 8px under the axis. With more than six labels each one is tilted
 * -0.5 rad around the middle of the 40px label band, which is where
 * `SideTitleWidget(angle: -0.5)` rotates it. The tick values are row indexes.
 */
export function renderCategoryAxisTick(labels: string[]) {
  const tilt = labels.length > CATEGORY_LABEL_TILT_AFTER;

  return function CategoryAxisTick({ x = 0, y = 0, payload }: AxisTickProps) {
    const label = labels[Number(payload?.value)] ?? '';

    return (
      <text
        x={x}
        y={y + CATEGORY_LABEL_GAP + CATEGORY_LABEL_LINE_HEIGHT / 2}
        textAnchor='middle'
        dominantBaseline='central'
        transform={tilt ? `rotate(${CATEGORY_LABEL_TILT_DEGREES} ${x} ${y + CATEGORY_AXIS_HEIGHT / 2})` : undefined}
        className='fill-text-tertiary text-xs font-medium'
      >
        {truncateChartLabel(label)}
      </text>
    );
  };
}
