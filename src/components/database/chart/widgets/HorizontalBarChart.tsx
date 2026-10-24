import { memo, useMemo } from 'react';
import { BarChart as RechartsBarChart, CartesianGrid, Customized, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';

import { CHART_GRID_DASH, ChartDataItem, ChartSeriesData, ChartType } from '@/application/database-yjs/chart.type';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { groupedBarWidth } from '@/components/database/chart/hooks/chartSeries';

import { layoutHorizontalCartesian } from './cartesianLayout';
import { CategoryAnchors, CategoryTick, ValueTick } from './ChartAxisParts';
import { ChartFrame } from './ChartFrame';
import { calculateBarHeight } from './chartUtils';
import { useChartMeasure } from './measureText';
import { CartesianPlotProps, useCartesianChartModel } from './useCartesianChartModel';
import { useChartAnimation } from './useReducedMotion';
import { useSeriesBars } from './useSeriesBars';

interface HorizontalBarChartWidgetProps {
  /** The series build (WP12): one `__all__` series without a Group by. */
  data: ChartSeriesData;
  /** Opens the drill-down of the clicked segment or category band. */
  onItemClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone scrolling height. */
  fill?: boolean;
}

const { axis, hoverBandRadius } = DASHBOARD_CHART_GEOMETRY;

// Module constants, so Recharts sees the same props on every render.
const HOVER_BAND = { fill: 'var(--chart-hover-band)', stroke: 'none', radius: hoverBandRadius };
const renderNoTooltip = () => null;
/** The 2px gap between grouped bars (WP12 §2.3). */
const GROUPED_BAR_GAP = 2;

/** Standalone pages keep today's scrolling height: one slot per category, 300–500px visible. */
function standaloneHeights(count: number) {
  const contentHeight = Math.max(300, count * calculateBarHeight(count) + 60);

  return { contentHeight, frameHeight: Math.min(contentHeight, 500) };
}

/**
 * The Recharts tree of the horizontal bar chart. Memoized like the vertical
 * plot: a pointer move does not render it, and its layout, ticks, segment
 * shapes, labels and margin keep their identity between renders.
 */
const HorizontalBarPlot = memo(function HorizontalBarPlot({
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
  valueTickTexts,
  dataLabelTexts,
  hoverActive,
  tooltipTrigger,
  clickable,
  animate,
  onClick,
  onSegmentClick,
  onMouseMove,
  onMouseLeave,
}: CartesianPlotProps & { valueTickTexts: readonly string[] }) {
  const { measure12 } = useChartMeasure();
  // No animation while the widget box resizes, nor after it until the data changes (W21).
  const animation = useChartAnimation(chartRows);
  const layout = useMemo(
    () => layoutHorizontalCartesian(items, { width, height }, valueTickTexts, dataLabelTexts, measure12),
    [items, width, height, valueTickTexts, dataLabelTexts, measure12]
  );
  const margin = useMemo(
    () => ({ top: layout.marginTop, right: layout.marginRight, bottom: 0, left: 0 }),
    [layout.marginTop, layout.marginRight]
  );
  const categoryTick = useMemo(() => <CategoryTick orientation='left' ticks={layout.ticks} />, [layout.ticks]);
  const valueTick = useMemo(() => <ValueTick format={formatAxis} orientation='bottom' />, [formatAxis]);
  const anchors = useMemo(() => <CategoryAnchors rects={layout.anchors} />, [layout.anchors]);
  const barSize = seriesStyle === 'grouped' ? groupedBarWidth(layout.slot, data.series.length) : layout.barWidth;
  const { bars, stackLabels } = useSeriesBars({
    data,
    categoryFills,
    seriesStyle,
    fills,
    labels,
    visibleLabels: layout.dataLabels,
    orientation: 'horizontal',
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
      layout='vertical'
      margin={margin}
      onClick={onClick}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      stackOffset='sign'
      width={width}
    >
      <CartesianGrid
        data-parity-id='dash-chart-grid-line'
        horizontal={false}
        stroke='var(--chart-grid)'
        strokeDasharray={CHART_GRID_DASH}
      />
      <XAxis
        allowDataOverflow
        axisLine={false}
        domain={domain.domain}
        height={layout.valueAxisHeight}
        interval={0}
        tick={valueTick}
        tickLine={false}
        tickMargin={4}
        tickSize={0}
        ticks={domain.ticks}
        type='number'
      />
      <YAxis
        axisLine={false}
        dataKey='__key'
        interval={0}
        tick={categoryTick}
        tickLine={false}
        tickMargin={axis.tickGap}
        tickSize={0}
        type='category'
        width={layout.yAxisWidth}
      />
      <ReferenceLine stroke='var(--chart-grid)' x={0} />
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
 * Horizontal bar chart (WP10 §2.1, WP12 §2.3): categories on the left,
 * right-aligned and truncated to the label column, values along the bottom
 * with a vertical dotted grid and a solid zero line; negative bars extend
 * left of it. With a Group by the stacks grow right (series 0 at the right
 * end) and grouped bars list series 0 on top.
 */
function HorizontalBarChartWidgetImpl({ data, onItemClick, fill = false }: HorizontalBarChartWidgetProps) {
  const model = useCartesianChartModel(data, ChartType.HorizontalBar, onItemClick);
  const standalone = standaloneHeights(data.categories.length);

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={model.frameHandlers}
      legend={model.legend}
      pointer={model.pointer}
      rootAttributes={model.rootAttributes}
      rows={model.rows}
      scrollContentHeight={fill ? undefined : standalone.contentHeight}
      standaloneHeight={standalone.frameHeight}
      testId='horizontal-bar-chart-widget'
      tooltip={model.tooltip}
      truncationCount={model.truncationCount}
    >
      {(size) => (
        <HorizontalBarPlot
          {...model.plot}
          dataLabelTexts={model.dataLabelTexts}
          height={size.height}
          valueTickTexts={model.valueTickTexts}
          width={size.width}
        />
      )}
    </ChartFrame>
  );
}

// `useChartData` hands over a new build only when the content changed and
// `ChartProvider` a stable `onItemClick`, so the default shallow comparison is enough.
export const HorizontalBarChartWidget = memo(HorizontalBarChartWidgetImpl);

export default HorizontalBarChartWidget;
