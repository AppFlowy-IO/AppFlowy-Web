import { memo, MouseEvent, useCallback, useMemo, useState } from 'react';
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  LabelProps,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartAggregationType, ChartClickItem, ChartDataItem } from '@/application/database-yjs/chart.type';
import { cn } from '@/lib/utils';

import {
  AXIS_LINE_PROPS,
  AxisTickProps,
  barCategoryAxisLayout,
  GRID_LINE_PROPS,
  NO_MARGIN,
  PLOT_SURFACE_OVERFLOW_CLASS,
  renderCategoryAxisTick,
  VALUE_AXIS_WIDTH,
} from './chartAxis';
import { ChartNoValidData } from './ChartNoValidData';
import { CHART_TITLE_VERTICAL_WIDTH, ChartTitle, useChartAggregationLabel } from './ChartTitle';
import { PositionedChartTooltip } from './ChartTooltip';
import {
  axisTicks,
  calculateAxisInterval,
  calculateBarWidth,
  chartDataEqual,
  computeBarAxisMax,
  formatValue,
  isPlottableValue,
  resolveChartItemColor,
} from './chartUtils';

interface BarChartWidgetProps {
  data: ChartDataItem[];
  onBarClick?: (item: ChartClickItem) => void;
  aggregationType?: ChartAggregationType;
}

/** Gap between a bar's top and its value label (fl_chart `tooltipMargin`). */
const BAR_VALUE_LABEL_GAP = 4;

/**
 * Bar chart value-axis label (desktop's `_buildLeftTitle`): 12px regular in
 * the body text color at 70%, right-aligned against the plot (`space: 0`).
 */
function ValueAxisTick({ x = 0, y = 0, payload }: AxisTickProps) {
  return (
    <text
      x={x}
      y={y}
      textAnchor='end'
      dominantBaseline='central'
      fillOpacity={0.7}
      className='fill-text-primary text-xs'
    >
      {payload?.value}
    </text>
  );
}

interface BarChartBodyProps extends BarChartWidgetProps {
  /** Set by `ResponsiveContainer`: the box desktop's `LayoutBuilder` measures. */
  width?: number;
  height?: number;
}

/**
 * Desktop's `_BarChartContent`: the vertical aggregation title, then the
 * chart. Hovering anywhere in a bar's equal-width column (axis band included)
 * shades that column behind the bar, hides the bar's value label and shows the
 * tooltip above the bar; clicking the column opens the bar's rows.
 */
function BarChartBody({ data, onBarClick, aggregationType, width = 0, height = 0 }: BarChartBodyProps) {
  const aggregationLabel = useChartAggregationLabel(aggregationType);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const bars = useMemo(() => data.map((item, index) => ({ item, color: resolveChartItemColor(item, index) })), [data]);
  const rows = useMemo(() => data.map((item, index) => ({ index, value: item.value })), [data]);
  const labels = useMemo(() => data.map((item) => item.label), [data]);
  const axis = useMemo(() => {
    const maxValue = data.reduce((max, item) => Math.max(max, item.value), 0);
    const axisMax = computeBarAxisMax(maxValue);
    // Desktop steps the labels and grid lines by the interval of the tallest
    // bar, not of the padded axis maximum.
    const ticks = axisTicks(axisMax, calculateAxisInterval(maxValue));

    return {
      axisMax,
      // Whole numbers only, never the axis minimum or maximum.
      labelValues: ticks.filter((value) => value > 0 && value < axisMax && Number.isInteger(value)),
      // fl_chart draws no grid line on the axis minimum or maximum.
      gridValues: ticks.filter((value) => value > 0 && value < axisMax),
    };
  }, [data]);

  const titleWidth = aggregationLabel ? CHART_TITLE_VERTICAL_WIDTH : 0;
  const chartWidth = Math.max(0, width - titleWidth);
  const plotWidth = Math.max(0, chartWidth - VALUE_AXIS_WIDTH);
  // `BarChartAlignment.spaceAround` centers every bar in an equal segment.
  const segmentWidth = bars.length > 0 ? plotWidth / bars.length : 0;
  // Each label has its bar's segment; the band grows to hold the labels once they tilt.
  const categoryAxis = useMemo(() => barCategoryAxisLayout(labels, segmentWidth), [labels, segmentWidth]);
  const categoryTick = useMemo(() => renderCategoryAxisTick(labels, categoryAxis), [labels, categoryAxis]);
  const plotHeight = Math.max(0, height - categoryAxis.height);
  const activeIndex = hoveredIndex !== null && hoveredIndex < bars.length ? hoveredIndex : null;
  const hovered = activeIndex === null ? null : bars[activeIndex];

  const gridLines = useCallback(
    () => axis.gridValues.map((value) => plotHeight * (1 - value / axis.axisMax)),
    [axis, plotHeight]
  );

  // Desktop draws each value label (fl_chart's bar tooltip) above its bar in
  // the bar's color, except for the hovered bar, which shows the tooltip.
  // The label's box ends 4px above the bar; its baseline sits one descent up.
  const renderValueLabel = useCallback(
    ({ index, value, viewBox }: LabelProps) => {
      if (index === undefined || index === activeIndex || !bars[index]) return null;
      const { x = 0, y = 0, width: barWidth = 0 } = (viewBox ?? {}) as { x?: number; y?: number; width?: number };

      return (
        <text
          x={x + barWidth / 2}
          y={y - BAR_VALUE_LABEL_GAP}
          dy='-0.24em'
          textAnchor='middle'
          fill={bars[index].color}
          className='text-xs font-semibold'
        >
          {formatValue(Number(value))}
        </text>
      );
    },
    [activeIndex, bars]
  );

  // `_ChartHitDetector`: only the pointer's x matters, so the whole column of
  // a segment, from the top of the plot through the label band, is its bar.
  const segmentIndexAt = (event: MouseEvent<HTMLDivElement>) => {
    if (segmentWidth <= 0) return null;
    const plotX = event.clientX - event.currentTarget.getBoundingClientRect().left - VALUE_AXIS_WIDTH;

    if (plotX < 0) return null;
    const index = Math.floor(plotX / segmentWidth);

    return index < bars.length ? index : null;
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const index = segmentIndexAt(event);

    if (index === null) return;
    const { item, color } = bars[index];

    onBarClick?.({ ...item, color });
  };

  return (
    <div className='relative flex h-full w-full'>
      {aggregationLabel && <ChartTitle label={aggregationLabel} />}
      <div
        data-testid='bar-chart-plot'
        className={cn(
          'relative h-full min-w-0 flex-1',
          PLOT_SURFACE_OVERFLOW_CLASS,
          activeIndex !== null && 'cursor-pointer'
        )}
        onMouseMove={(event) => setHoveredIndex(segmentIndexAt(event))}
        onMouseLeave={() => setHoveredIndex(null)}
        onClick={handleClick}
      >
        {activeIndex !== null && (
          <div
            data-testid='bar-chart-hover-background'
            className='pointer-events-none absolute top-0 bg-fill-content-hover'
            style={{ left: VALUE_AXIS_WIDTH + segmentWidth * activeIndex, width: segmentWidth, height: plotHeight }}
          />
        )}
        <RechartsBarChart
          width={chartWidth}
          height={height}
          data={rows}
          margin={NO_MARGIN}
          // Recharts pins `cursor: default` on its wrapper; follow the hover state instead.
          style={{ cursor: 'inherit' }}
        >
          <CartesianGrid vertical={false} horizontalCoordinatesGenerator={gridLines} {...GRID_LINE_PROPS} />
          <XAxis
            dataKey='index'
            type='category'
            height={categoryAxis.height}
            interval={0}
            tickLine={false}
            tickSize={0}
            tickMargin={0}
            axisLine={AXIS_LINE_PROPS}
            tick={categoryTick}
          />
          <YAxis
            type='number'
            domain={[0, axis.axisMax]}
            ticks={axis.labelValues}
            interval={0}
            width={VALUE_AXIS_WIDTH}
            axisLine={false}
            tickLine={false}
            tickSize={0}
            tickMargin={0}
            // An all-zero chart has no whole-number label between 0 and the
            // axis maximum, so desktop draws none; Recharts would otherwise
            // fall back to its own fractional ticks for an empty list.
            tick={axis.labelValues.length > 0 ? ValueAxisTick : false}
          />
          <Bar dataKey='value' barSize={calculateBarWidth(bars.length)} isAnimationActive={false}>
            {bars.map(({ color }, index) => (
              <Cell key={index} fill={color} />
            ))}
            <LabelList dataKey='value' content={renderValueLabel} />
          </Bar>
        </RechartsBarChart>
      </div>
      {hovered && activeIndex !== null && (
        <PositionedChartTooltip
          label={hovered.item.label}
          value={hovered.item.value}
          color={hovered.color}
          anchor={{
            x: titleWidth + VALUE_AXIS_WIDTH + segmentWidth * (activeIndex + 0.5),
            y: plotHeight * (1 - hovered.item.value / axis.axisMax),
          }}
          chartSize={{ width, height }}
        />
      )}
    </div>
  );
}

/**
 * Vertical bar chart (desktop's `DatabaseBarChart`): a 400px chart padded
 * 24px on the left, or a "no valid data" note when no value can be plotted.
 */
function BarChartWidgetImpl({ data, onBarClick, aggregationType }: BarChartWidgetProps) {
  const validData = useMemo(() => data.filter(isPlottableValue), [data]);

  if (validData.length === 0) {
    return (
      <div data-testid='bar-chart-widget' className='h-[400px] w-full'>
        <ChartNoValidData />
      </div>
    );
  }

  return (
    <div data-testid='bar-chart-widget' className='h-[400px] w-full pl-6'>
      <ResponsiveContainer width='100%' height='100%'>
        <BarChartBody data={validData} onBarClick={onBarClick} aggregationType={aggregationType} />
      </ResponsiveContainer>
    </div>
  );
}

// Memoized with a content-equality comparator so Yjs hydration micro-batches
// that produce the same final chart don't rebuild the recharts SVG tree.
// `onBarClick` is `useCallback`-stable in `ChartProvider`, so reference
// equality is sufficient there.
export const BarChartWidget = memo(BarChartWidgetImpl, (prev, next) => {
  return (
    prev.onBarClick === next.onBarClick &&
    prev.aggregationType === next.aggregationType &&
    chartDataEqual(prev.data, next.data)
  );
});

export default BarChartWidget;
