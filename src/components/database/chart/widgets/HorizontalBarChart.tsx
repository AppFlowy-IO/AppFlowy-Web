import { memo, useMemo } from 'react';
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  Customized,
  LabelList,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART_GRID_DASH, ChartDataItem, ChartType } from '@/application/database-yjs/chart.type';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';

import { layoutHorizontalCartesian } from './cartesianLayout';
import { CategoryAnchors, CategoryTick, ValueTick } from './ChartAxisParts';
import { ChartFrame } from './ChartFrame';
import { calculateBarHeight, chartItemKey } from './chartUtils';
import { useChartMeasure } from './measureText';
import { CartesianPlotProps, useCartesianChartModel } from './useCartesianChartModel';
import { useDataLabelRenderer } from './useDataLabelRenderer';
import { useReducedMotion } from './useReducedMotion';

interface HorizontalBarChartWidgetProps {
  data: ChartDataItem[];
  /** Opens the drill-down of the clicked category. */
  onItemClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone scrolling height. */
  fill?: boolean;
}

const { axis, bar, hoverBandRadius } = DASHBOARD_CHART_GEOMETRY;

// Module constants, so Recharts sees the same props on every render.
const BAR_RADIUS: [number, number, number, number] = [0, bar.radius, bar.radius, 0];
const HOVER_BAND = { fill: 'var(--chart-hover-band)', stroke: 'none', radius: hoverBandRadius };
const renderNoTooltip = () => null;

/** Standalone pages keep today's scrolling height: one slot per category, 300–500px visible. */
function standaloneHeights(count: number) {
  const contentHeight = Math.max(300, count * calculateBarHeight(count) + 60);

  return { contentHeight, frameHeight: Math.min(contentHeight, 500) };
}

/**
 * The Recharts tree of the horizontal bar chart. Memoized like the vertical
 * plot: a pointer move does not render it, and its layout, ticks, label
 * renderer and margin keep their identity between renders.
 */
const HorizontalBarPlot = memo(function HorizontalBarPlot({
  data,
  width,
  height,
  domain,
  formatAxis,
  valueTickTexts,
  dataLabelTexts,
  hoverActive,
  clickable,
  onClick,
  onMouseMove,
  onMouseLeave,
}: CartesianPlotProps & { valueTickTexts: readonly string[] }) {
  const { measure12 } = useChartMeasure();
  const reducedMotion = useReducedMotion();
  const layout = useMemo(
    () => layoutHorizontalCartesian(data, { width, height }, valueTickTexts, dataLabelTexts, measure12),
    [data, width, height, valueTickTexts, dataLabelTexts, measure12]
  );
  const margin = useMemo(
    () => ({ top: layout.marginTop, right: layout.marginRight, bottom: 0, left: 0 }),
    [layout.marginTop, layout.marginRight]
  );
  const categoryTick = useMemo(() => <CategoryTick orientation='left' ticks={layout.ticks} />, [layout.ticks]);
  const valueTick = useMemo(() => <ValueTick format={formatAxis} orientation='bottom' />, [formatAxis]);
  const anchors = useMemo(() => <CategoryAnchors rects={layout.anchors} />, [layout.anchors]);
  const renderLabel = useDataLabelRenderer(data, layout.dataLabels, 'horizontal', 'bar');

  return (
    <RechartsBarChart
      barCategoryGap={0}
      data={data}
      height={height}
      layout='vertical'
      margin={margin}
      onClick={onClick}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
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
        dataKey={chartItemKey}
        interval={0}
        tick={categoryTick}
        tickLine={false}
        tickMargin={axis.tickGap}
        tickSize={0}
        type='category'
        width={layout.yAxisWidth}
      />
      <ReferenceLine stroke='var(--chart-grid)' x={0} />
      <Tooltip active={hoverActive ? undefined : false} content={renderNoTooltip} cursor={HOVER_BAND} isAnimationActive={false} />
      <Bar
        activeBar={false}
        barSize={layout.barWidth}
        cursor={clickable ? 'pointer' : undefined}
        dataKey='value'
        isAnimationActive={!reducedMotion}
        radius={BAR_RADIUS}
      >
        {data.map((item) => (
          <Cell data-parity-id='dash-chart-bar' fill={item.color} key={chartItemKey(item)} />
        ))}
        <LabelList content={renderLabel} dataKey='value' />
      </Bar>
      <Customized component={anchors} />
    </RechartsBarChart>
  );
});

/**
 * Horizontal bar chart (WP10 §2.1): categories on the left, right-aligned and
 * truncated to the label column, values along the bottom with a vertical
 * dotted grid and a solid zero line; negative bars extend left of it.
 */
function HorizontalBarChartWidgetImpl({ data, onItemClick, fill = false }: HorizontalBarChartWidgetProps) {
  const model = useCartesianChartModel(data, ChartType.HorizontalBar, onItemClick);
  const standalone = standaloneHeights(data.length);

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={model.frameHandlers}
      legend={model.legend}
      pointer={model.pointer}
      rows={model.rows}
      scrollContentHeight={fill ? undefined : standalone.contentHeight}
      standaloneHeight={standalone.frameHeight}
      testId='horizontal-bar-chart-widget'
      tooltip={model.tooltip}
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

// `ChartProvider` hands over a new `data` array only when the content changed
// and a stable `onItemClick`, so the default shallow comparison is enough.
export const HorizontalBarChartWidget = memo(HorizontalBarChartWidgetImpl);

export default HorizontalBarChartWidget;
