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

import { layoutVerticalCartesian } from './cartesianLayout';
import { CategoryAnchors, CategoryTick, ValueTick } from './ChartAxisParts';
import { ChartFrame } from './ChartFrame';
import { chartItemKey } from './chartUtils';
import { useChartMeasure } from './measureText';
import { CartesianPlotProps, useCartesianChartModel } from './useCartesianChartModel';
import { useDataLabelRenderer } from './useDataLabelRenderer';
import { useReducedMotion } from './useReducedMotion';

interface BarChartWidgetProps {
  data: ChartDataItem[];
  /** Opens the drill-down of the clicked category. */
  onItemClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone 400px height. */
  fill?: boolean;
}

const { axis, bar, hoverBandRadius } = DASHBOARD_CHART_GEOMETRY;

// Module constants, so Recharts sees the same props on every render.
const BAR_RADIUS: [number, number, number, number] = [bar.radius, bar.radius, 0, 0];
const HOVER_BAND = { fill: 'var(--chart-hover-band)', stroke: 'none', radius: hoverBandRadius };
const renderNoTooltip = () => null;

/**
 * The Recharts tree of the vertical bar chart. Memoized: it renders when the
 * data, the frame size or the hover band changes, never for a pointer move.
 * The layout, the tick elements, the label renderer and the margin keep their
 * identity between those renders, so Recharts does not rebuild its axes.
 */
const BarPlot = memo(function BarPlot({
  data,
  width,
  height,
  domain,
  formatAxis,
  valueAxisWidth,
  dataLabelTexts,
  hoverActive,
  clickable,
  onClick,
  onMouseMove,
  onMouseLeave,
}: CartesianPlotProps & { valueAxisWidth: number }) {
  const { measure12 } = useChartMeasure();
  const reducedMotion = useReducedMotion();
  const layout = useMemo(
    () => layoutVerticalCartesian(data, { width, height }, valueAxisWidth, dataLabelTexts, measure12),
    [data, width, height, valueAxisWidth, dataLabelTexts, measure12]
  );
  const margin = useMemo(() => ({ top: layout.marginTop, right: 0, bottom: 0, left: 0 }), [layout.marginTop]);
  const categoryTick = useMemo(
    () => <CategoryTick orientation='bottom' rotated={layout.rotated} ticks={layout.ticks} />,
    [layout.rotated, layout.ticks]
  );
  const valueTick = useMemo(() => <ValueTick format={formatAxis} orientation='left' />, [formatAxis]);
  const anchors = useMemo(() => <CategoryAnchors rects={layout.anchors} />, [layout.anchors]);
  const renderLabel = useDataLabelRenderer(data, layout.dataLabels, 'vertical', 'bar');

  return (
    <RechartsBarChart
      barCategoryGap={0}
      data={data}
      height={height}
      margin={margin}
      onClick={onClick}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
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
        dataKey={chartItemKey}
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
 * Vertical bar chart (WP10 §2.1): measured value axis with nice ticks and no
 * axis line, dotted grid and a solid zero line, thin bars with a 2px
 * value-end radius, fitted category labels, data labels, a hover band and a
 * portal tooltip.
 */
function BarChartWidgetImpl({ data, onItemClick, fill = false }: BarChartWidgetProps) {
  const model = useCartesianChartModel(data, ChartType.Bar, onItemClick);

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={model.frameHandlers}
      legend={model.legend}
      pointer={model.pointer}
      rows={model.rows}
      testId='bar-chart-widget'
      tooltip={model.tooltip}
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

// `ChartProvider` hands over a new `data` array only when the content changed
// and a stable `onItemClick`, so the default shallow comparison is enough.
export const BarChartWidget = memo(BarChartWidgetImpl);

export default BarChartWidget;
