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
import { CHART_GRID_DASH, ChartDataItem, ChartType } from '@/application/database-yjs/chart.type';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { useChartContext } from '@/components/database/chart/useChartContext';

import { layoutVerticalCartesian } from './cartesianLayout';
import { CategoryAnchors, CategoryTick, HoverBandCursor, ValueTick } from './ChartAxisParts';
import { ChartFrame } from './ChartFrame';
import { CHART_ENTRY_ANIMATION_MS, chartItemKey } from './chartUtils';
import { useChartMeasure } from './measureText';
import { CartesianPlotProps, useCartesianChartModel } from './useCartesianChartModel';
import { useDataLabelRenderer } from './useDataLabelRenderer';
import { useReducedMotion } from './useReducedMotion';

interface LineChartWidgetProps {
  data: ChartDataItem[];
  /** Opens the drill-down of the clicked category. */
  onItemClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone 400px height. */
  fill?: boolean;
}

const { axis, line } = DASHBOARD_CHART_GEOMETRY;

const renderNoTooltip = () => null;

/**
 * The Recharts tree of the line chart. Memoized like the bar plots: a pointer
 * move does not render it, and its layout, ticks, label renderer, margin,
 * cursor and active dot keep their identity between renders.
 */
const LinePlot = memo(function LinePlot({
  data,
  width,
  height,
  color,
  domain,
  formatAxis,
  valueAxisWidth,
  dataLabelTexts,
  hoverActive,
  clickable,
  onClick,
  onMouseMove,
  onMouseLeave,
}: CartesianPlotProps & { valueAxisWidth: number; color: string }) {
  const { measure12 } = useChartMeasure();
  const reducedMotion = useReducedMotion();
  const gradientId = useId().replace(/:/g, '');
  const layout = useMemo(
    () => layoutVerticalCartesian(data, { width, height }, valueAxisWidth, dataLabelTexts, measure12),
    [data, width, height, valueAxisWidth, dataLabelTexts, measure12]
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
  const activeDot = useMemo(
    () => ({ r: line.activeDotRadius, fill: color, stroke: 'var(--dash-card-bg)', strokeWidth: 2 }),
    [color]
  );
  const renderLabel = useDataLabelRenderer(data, layout.dataLabels, 'vertical', 'point');

  // A ComposedChart: Recharts' LineChart draws only its Line children, not the Area.
  return (
    <ComposedChart
      data={data}
      height={height}
      margin={margin}
      onClick={onClick}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      width={width}
    >
      <defs>
        <linearGradient id={gradientId} x1='0' x2='0' y1='0' y2='1'>
          <stop offset='0%' stopColor={color} stopOpacity={line.gradientTopAlpha} />
          <stop offset='100%' stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
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
      <Tooltip active={hoverActive ? undefined : false} content={renderNoTooltip} cursor={cursor} isAnimationActive={false} />
      <Area
        activeDot={false}
        animationDuration={CHART_ENTRY_ANIMATION_MS}
        baseValue={domain.domain[0]}
        data-parity-id='dash-chart-line-area'
        dataKey='value'
        dot={false}
        fill={`url(#${gradientId})`}
        fillOpacity={1}
        isAnimationActive={!reducedMotion}
        stroke='none'
        type='monotone'
      />
      <Line
        activeDot={activeDot}
        animationDuration={CHART_ENTRY_ANIMATION_MS}
        cursor={clickable ? 'pointer' : undefined}
        data-parity-id='dash-chart-line'
        dataKey='value'
        dot={false}
        isAnimationActive={!reducedMotion}
        stroke={color}
        strokeWidth={line.strokeWidth}
        type='monotone'
      >
        <LabelList content={renderLabel} dataKey='value' />
      </Line>
      <Customized component={anchors} />
    </ComposedChart>
  );
});

/**
 * Line chart (WP10 §2.1): a 1.5px monotone line in the series color over a
 * gradient area, no dots until a category is hovered, data labels above the
 * points, a legend with the series name.
 */
function LineChartWidgetImpl({ data, onItemClick, fill = false }: LineChartWidgetProps) {
  const { style, seriesLabel, isDark } = useChartContext();
  const color = resolveSeriesColor(0, style.colorTheme, isDark);
  const model = useCartesianChartModel(data, ChartType.Line, onItemClick, { label: seriesLabel, color });

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={model.frameHandlers}
      legend={model.legend}
      pointer={model.pointer}
      rows={model.rows}
      testId='line-chart-widget'
      tooltip={model.tooltip}
    >
      {(size) => (
        <LinePlot
          {...model.plot}
          color={color}
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
export const LineChartWidget = memo(LineChartWidgetImpl);

export default LineChartWidget;
