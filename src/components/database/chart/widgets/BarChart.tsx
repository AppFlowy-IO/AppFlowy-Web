import { memo, useMemo } from 'react';
import { BarChart as RechartsBarChart, CartesianGrid, Customized, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

import { CHART_GRID_DASH, ChartDataItem, ChartSeriesData, ChartType } from '@/application/database-yjs/chart.type';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { groupedBarWidth } from '@/components/database/chart/hooks/chartSeries';

import { layoutVerticalCartesian } from './cartesianLayout';
import { CategoryAnchors, CategoryTick, ValueTick } from './ChartAxisParts';
import { ChartFrame } from './ChartFrame';
import { useChartMeasure } from './measureText';
import { CartesianPlotProps, useCartesianChartModel } from './useCartesianChartModel';
import { useChartAnimation } from './useReducedMotion';
import { useSeriesBars } from './useSeriesBars';

interface BarChartWidgetProps {
  /** The series build (WP12): one `__all__` series without a Group by. */
  data: ChartSeriesData;
  /** Opens the drill-down of the clicked segment or category band. */
  onItemClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone 400px height. */
  fill?: boolean;
}

const { axis, hoverBandRadius } = DASHBOARD_CHART_GEOMETRY;

// Module constants, so Recharts sees the same props on every render.
const HOVER_BAND = { fill: 'var(--chart-hover-band)', stroke: 'none', radius: hoverBandRadius };
const renderNoTooltip = () => null;
/** The 2px gap between grouped bars (WP12 §2.3). */
const GROUPED_BAR_GAP = 2;

/**
 * The Recharts tree of the vertical bar chart. Memoized: it renders when the
 * data, the frame size or the hover band changes, never for a pointer move.
 * The layout, the tick elements, the segment shapes, the labels and the
 * margin keep their identity between those renders, so Recharts does not
 * rebuild its axes.
 */
const BarPlot = memo(function BarPlot({
  data,
  items,
  chartRows,
  seriesStyle,
  fills,
  categoryFills,
  formatValue,
  labels,
  width,
  height,
  domain,
  formatAxis,
  valueAxisWidth,
  dataLabelTexts,
  hoverActive,
  tooltipTrigger,
  clickable,
  animate,
  onClick,
  onSegmentClick,
  onMouseMove,
  onMouseLeave,
}: CartesianPlotProps & { valueAxisWidth: number }) {
  const { measure12 } = useChartMeasure();
  // No animation while the widget box resizes, nor after it until the data changes (W21).
  const animation = useChartAnimation(chartRows);
  const layout = useMemo(
    () => layoutVerticalCartesian(items, { width, height }, valueAxisWidth, dataLabelTexts, measure12),
    [items, width, height, valueAxisWidth, dataLabelTexts, measure12]
  );
  const margin = useMemo(() => ({ top: layout.marginTop, right: 0, bottom: 0, left: 0 }), [layout.marginTop]);
  const categoryTick = useMemo(
    () => <CategoryTick orientation='bottom' rotated={layout.rotated} ticks={layout.ticks} />,
    [layout.rotated, layout.ticks]
  );
  const valueTick = useMemo(() => <ValueTick format={formatAxis} orientation='left' />, [formatAxis]);
  const anchors = useMemo(() => <CategoryAnchors rects={layout.anchors} />, [layout.anchors]);
  const barSize = seriesStyle === 'grouped' ? groupedBarWidth(layout.slot, data.series.length) : layout.barWidth;
  const { bars, stackLabels } = useSeriesBars({
    data,
    categoryFills,
    seriesStyle,
    fills,
    labels,
    visibleLabels: layout.dataLabels,
    orientation: 'vertical',
    barSize,
    clickable,
    animate: animate && animation,
    onSegmentClick,
    formatValue,
  });

  return (
    <RechartsBarChart
      barCategoryGap={0}
      barGap={GROUPED_BAR_GAP}
      data={chartRows}
      height={height}
      margin={margin}
      onClick={onClick}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      stackOffset='sign'
      width={width}
    >
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
        cursor={HOVER_BAND}
        isAnimationActive={false}
        trigger={tooltipTrigger}
      />
      {bars}
      {stackLabels ? <Customized component={stackLabels} /> : null}
      <Customized component={anchors} />
    </RechartsBarChart>
  );
});

/**
 * Vertical bar chart (WP10 §2.1, WP12 §2.3): measured value axis with nice
 * ticks and no axis line, dotted grid and a solid zero line, thin bars with a
 * 2px value-end radius, fitted category labels, data labels, a hover band and
 * a portal tooltip. With a Group by the bars stack (series 0 at the top),
 * stand side by side, or fill the axis as percentages.
 */
function BarChartWidgetImpl({ data, onItemClick, fill = false }: BarChartWidgetProps) {
  const model = useCartesianChartModel(data, ChartType.Bar, onItemClick);

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={model.frameHandlers}
      legend={model.legend}
      pointer={model.pointer}
      rootAttributes={model.rootAttributes}
      rows={model.rows}
      testId='bar-chart-widget'
      tooltip={model.tooltip}
      truncationCount={model.truncationCount}
    >
      {(size) => (
        <BarPlot
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
export const BarChartWidget = memo(BarChartWidgetImpl);

export default BarChartWidget;
