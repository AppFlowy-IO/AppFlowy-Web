import { memo, useId, useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Customized,
  LabelList,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { resolveSeriesColor } from '@/application/database-yjs/chart-colors';
import { CHART_GRID_DASH, ChartDataItem, ChartSeriesData, ChartType } from '@/application/database-yjs/chart.type';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { seriesDataKey } from '@/components/database/chart/hooks/chartSeries';
import { useChartContext } from '@/components/database/chart/useChartContext';

import { layoutVerticalCartesian } from './cartesianLayout';
import { CategoryAnchors, CategoryTick, HoverBandCursor, ValueTick } from './ChartAxisParts';
import { ChartFrame } from './ChartFrame';
import { CHART_ENTRY_ANIMATION_MS } from './chartUtils';
import { useChartMeasure } from './measureText';
import { CartesianPlotProps, useCartesianChartModel } from './useCartesianChartModel';
import { useDataLabelRenderer } from './useDataLabelRenderer';
import { useChartAnimation } from './useReducedMotion';

interface LineChartWidgetProps {
  /** The series build (WP12): one `__all__` series without a Group by. */
  data: ChartSeriesData;
  /** Opens the drill-down of the clicked point or category. */
  onItemClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone 400px height. */
  fill?: boolean;
}

const { axis, line } = DASHBOARD_CHART_GEOMETRY;

const renderNoTooltip = () => null;
/** A click this close to a point opens the point's cell (WP12 §2.10). */
const POINT_HIT_RADIUS = 8;

/** The props Recharts passes to an active dot renderer. */
interface RechartsDotProps {
  cx?: number;
  cy?: number;
  index?: number;
}

/**
 * The hovered point of one line of a chart with several series: the 4px dot
 * and an 8px hit circle; a click on it opens that series' cell.
 */
function seriesActiveDot(
  seriesIndex: number,
  color: string,
  onPick: (categoryIndex: number, seriesIndex: number, event?: unknown) => void
) {
  function SeriesActiveDot(props: unknown) {
    const { cx, cy, index } = (props ?? {}) as RechartsDotProps;

    if (cx === undefined || cy === undefined || index === undefined) return <g />;
    // The point answers the click first; the chart's band click then ignores it (`useChartHover.tap`).
    const pick = (event: unknown) => onPick(index, seriesIndex, event);

    return (
      <g className='recharts-active-dot' data-series-index={seriesIndex}>
        <circle cx={cx} cy={cy} fill='transparent' onClick={pick} r={POINT_HIT_RADIUS} />
        <circle
          cx={cx}
          cy={cy}
          fill={color}
          onClick={pick}
          r={line.activeDotRadius}
          stroke='var(--dash-card-bg)'
          strokeWidth={2}
        />
      </g>
    );
  }

  return SeriesActiveDot;
}

/**
 * The Recharts tree of the line chart. Memoized like the bar plots: a pointer
 * move does not render it, and its layout, ticks, label renderer, margin,
 * cursor and active dots keep their identity between renders.
 */
const LinePlot = memo(function LinePlot({
  data,
  items,
  chartRows,
  seriesStyle,
  fills,
  width,
  height,
  domain,
  formatAxis,
  valueAxisWidth,
  dataLabelTexts,
  hoverActive,
  tooltipTrigger,
  clickable,
  onClick,
  onSegmentClick,
  onMouseMove,
  onMouseLeave,
}: CartesianPlotProps & { valueAxisWidth: number }) {
  const { measure12 } = useChartMeasure();
  // No animation while the widget box resizes, nor after it until the data changes (W21).
  const animation = useChartAnimation(chartRows);
  const gradientId = useId().replace(/:/g, '');
  const single = data.series.length === 1;
  const color = fills[0] ?? '';
  const layout = useMemo(
    () => layoutVerticalCartesian(items, { width, height }, valueAxisWidth, dataLabelTexts, measure12),
    [items, width, height, valueAxisWidth, dataLabelTexts, measure12]
  );
  const margin = useMemo(() => ({ top: layout.marginTop, right: 0, bottom: 0, left: 0 }), [layout.marginTop]);
  // The points sit in the middle of their slots, like the bars of a bar chart.
  const padding = useMemo(() => ({ left: layout.slot / 2, right: layout.slot / 2 }), [layout.slot]);
  const categoryTick = useMemo(
    () => <CategoryTick orientation='bottom' rotated={layout.rotated} ticks={layout.ticks} />,
    [layout.rotated, layout.ticks]
  );
  const valueTick = useMemo(() => <ValueTick format={formatAxis} orientation='left' />, [formatAxis]);
  const anchors = useMemo(() => <CategoryAnchors rects={layout.anchors} />, [layout.anchors]);
  const cursor = useMemo(
    () => <HoverBandCursor height={layout.plotHeight} slot={layout.slot} top={layout.plotTop} />,
    [layout.plotHeight, layout.slot, layout.plotTop]
  );
  // One line keeps WP10's dot (its click is the band's); several lines get a clickable dot each.
  const activeDots = useMemo(
    () =>
      single
        ? [{ r: line.activeDotRadius, fill: color, stroke: 'var(--dash-card-bg)', strokeWidth: 2 }]
        : data.series.map((_, seriesIndex) => seriesActiveDot(seriesIndex, fills[seriesIndex] ?? '', onSegmentClick)),
    [single, color, data.series, fills, onSegmentClick]
  );
  const renderLabel = useDataLabelRenderer(items, layout.dataLabels, 'vertical', 'point');

  // A ComposedChart: Recharts' LineChart draws only its Line children, not the Area.
  return (
    <ComposedChart
      data={chartRows}
      height={height}
      margin={margin}
      onClick={onClick}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      width={width}
    >
      {single ? (
        <defs>
          <linearGradient id={gradientId} x1='0' x2='0' y1='0' y2='1'>
            <stop offset='0%' stopColor={color} stopOpacity={line.gradientTopAlpha} />
            <stop offset='100%' stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
      ) : null}
      <CartesianGrid
        data-parity-id='dash-chart-grid-line'
        stroke='var(--chart-grid)'
        strokeDasharray={CHART_GRID_DASH}
        vertical={false}
      />
      <XAxis
        axisLine={false}
        dataKey='__key'
        height={layout.xAxisHeight}
        interval={0}
        padding={padding}
        tick={categoryTick}
        tickLine={false}
        tickMargin={4}
        tickSize={0}
      />
      <YAxis
        allowDataOverflow
        axisLine={false}
        domain={domain.domain}
        interval={0}
        tick={valueTick}
        tickLine={false}
        // The gap `computeYAxisWidth` reserved between the tick text and the plot.
        tickMargin={axis.tickGap}
        tickSize={0}
        ticks={domain.ticks}
        type='number'
        width={valueAxisWidth}
      />
      <ReferenceLine stroke='var(--chart-grid)' y={0} />
      <Tooltip
        active={hoverActive ? undefined : false}
        content={renderNoTooltip}
        cursor={cursor}
        isAnimationActive={false}
        trigger={tooltipTrigger}
      />
      {single ? (
        <Area
          activeDot={false}
          animationDuration={CHART_ENTRY_ANIMATION_MS}
          baseValue={domain.domain[0]}
          data-parity-id='dash-chart-line-area'
          dataKey={seriesDataKey(0, seriesStyle)}
          dot={false}
          fill={`url(#${gradientId})`}
          fillOpacity={1}
          isAnimationActive={animation}
          stroke='none'
          type='monotone'
        />
      ) : null}
      {data.series.map((entry, seriesIndex) => (
        <Line
          activeDot={activeDots[seriesIndex]}
          animationDuration={CHART_ENTRY_ANIMATION_MS}
          cursor={clickable ? 'pointer' : undefined}
          data-parity-id='dash-chart-line'
          data-series={single ? '' : entry.label}
          data-testid='chart-line'
          dataKey={seriesDataKey(seriesIndex, seriesStyle)}
          dot={false}
          isAnimationActive={animation}
          key={`series-${seriesIndex}`}
          stroke={fills[seriesIndex]}
          strokeWidth={line.strokeWidth}
          type='monotone'
        >
          {single ? <LabelList content={renderLabel} dataKey={seriesDataKey(0, seriesStyle)} /> : null}
        </Line>
      ))}
      <Customized component={anchors} />
    </ComposedChart>
  );
});

/**
 * Line chart (WP10 §2.1, WP12 §2.4): a 1.5px monotone line per series, no
 * dots until a category is hovered. One series draws in its series colour
 * over a gradient area with data labels above the points and a legend with
 * the series name; several (a Group by) draw one line each in its group's
 * colour, without area or labels, with the groups in the legend.
 */
function LineChartWidgetImpl({ data, onItemClick, fill = false }: LineChartWidgetProps) {
  const { style, seriesLabel, isDark } = useChartContext();
  const color = resolveSeriesColor(0, style.colorTheme, isDark);
  const lineSeries = useMemo(() => ({ label: seriesLabel, color }), [seriesLabel, color]);
  const model = useCartesianChartModel(data, ChartType.Line, onItemClick, lineSeries);

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={model.frameHandlers}
      legend={model.legend}
      pointer={model.pointer}
      rootAttributes={model.rootAttributes}
      rows={model.rows}
      testId='line-chart-widget'
      tooltip={model.tooltip}
      truncationCount={model.truncationCount}
    >
      {(size) => (
        <LinePlot
          {...model.plot}
          dataLabelTexts={model.dataLabelTexts}
          height={size.height}
          valueAxisWidth={model.valueAxisWidth}
          width={size.width}
        />
      )}
    </ChartFrame>
  );
}

// `useChartData` hands over a new build only when the content changed and
// `ChartProvider` a stable `onItemClick`, so the default shallow comparison is enough.
export const LineChartWidget = memo(LineChartWidgetImpl);

export default LineChartWidget;
