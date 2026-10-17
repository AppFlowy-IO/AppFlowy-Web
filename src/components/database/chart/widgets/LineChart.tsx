import { memo, MouseEvent, useCallback, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Dot,
  LabelList,
  LabelProps,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartAggregationType, ChartClickItem, ChartDataItem } from '@/application/database-yjs/chart.type';
import { cn } from '@/lib/utils';

import {
  AXIS_LINE_PROPS,
  AxisTickProps,
  CATEGORY_AXIS_HEIGHT,
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
  chartDataEqual,
  computeLineAxisMax,
  formatValue,
  isPlottableValue,
  resolveChartItemColor,
} from './chartUtils';

interface LineChartWidgetProps {
  data: ChartDataItem[];
  onPointClick?: (item: ChartClickItem) => void;
  aggregationType?: ChartAggregationType;
}

/** fl_chart's `touchSpotThreshold`: a point reacts within 10px of the pointer, measured along x. */
const TOUCH_SPOT_THRESHOLD = 10;
/** Dot radius, grown while its point is hovered. */
const DOT_RADIUS = 4;
const HOVERED_DOT_RADIUS = 6;
/** Width of the white ring fl_chart paints just outside each dot. */
const DOT_RING_WIDTH = 2;
/** Gap `SideTitleWidget` leaves between a value-axis label and the plot. */
const VALUE_AXIS_LABEL_GAP = 8;
/** Each point's value label box (body 14/20) starts 28px above the point. */
const POINT_LABEL_RISE = 28;
const POINT_LABEL_LINE_HEIGHT = 20;
/** Desktop lifts the tooltip clear of the point's value label. */
const TOOLTIP_VERTICAL_GAP = 60;
/** Hover line through the point: 1px, dashed 5/4, from the top of the plot. */
const HOVER_LINE_DASHES = 'repeating-linear-gradient(to bottom, var(--border-secondary) 0 5px, transparent 5px 9px)';

/**
 * Line chart value-axis label (desktop's `_buildLeftTitle`): caption 12/18
 * w500 in the tertiary text color, ending 8px left of the plot.
 */
function ValueAxisTick({ x = 0, y = 0, payload }: AxisTickProps) {
  return (
    <text x={x} y={y} textAnchor='end' dominantBaseline='central' className='fill-text-tertiary text-xs font-medium'>
      {payload?.value}
    </text>
  );
}

/**
 * Value label over every point, hovered or not (desktop positions a 20px-tall
 * body 14/20 w500 box 28px above the point, never above the plot top).
 */
function PointValueLabel({ value, viewBox }: LabelProps) {
  const { x = 0, y = 0 } = (viewBox ?? {}) as { x?: number; y?: number };

  return (
    <text
      x={x}
      y={Math.max(0, y - POINT_LABEL_RISE) + POINT_LABEL_LINE_HEIGHT / 2}
      textAnchor='middle'
      dominantBaseline='central'
      fill='var(--block-text-color-13)'
      className='text-sm font-medium'
    >
      {formatValue(Number(value))}
    </text>
  );
}

interface LineChartBodyProps extends LineChartWidgetProps {
  /** Set by `ResponsiveContainer`: the box desktop's `LayoutBuilder` measures. */
  width?: number;
  height?: number;
}

/**
 * Desktop's `_LineChartContent`: the vertical aggregation title, then a
 * straight theme-colored line through points centered in equal segments.
 * Hovering within 10px of a point (inside the plot) grows its dot, draws a
 * dashed line through it and shows the tooltip; clicking it opens its rows.
 *
 * Desktop also configures a larger "touched spot" ring and fl_chart value
 * labels, but neither ever paints (`handleBuiltInTouches: false` leaves
 * `showingIndicators` empty, and the label spots carry index -1), so they are
 * not drawn here either.
 */
function LineChartBody({ data, onPointClick, aggregationType, width = 0, height = 0 }: LineChartBodyProps) {
  const aggregationLabel = useChartAggregationLabel(aggregationType);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const points = useMemo(() => data.map((item, index) => ({ item, color: resolveChartItemColor(item, index) })), [data]);
  const rows = useMemo(() => data.map((item, index) => ({ index, value: item.value })), [data]);
  const categoryTick = useMemo(() => renderCategoryAxisTick(data.map((item) => item.label)), [data]);
  const axis = useMemo(() => {
    const maxValue = data.reduce((max, item) => Math.max(max, item.value), 0);
    // `_computeMaxY` treats an all-zero series as a maximum of 1.
    const axisMax = computeLineAxisMax(maxValue > 0 ? maxValue : 1);
    const ticks = axisTicks(axisMax, calculateAxisInterval(axisMax));

    return {
      axisMax,
      // Whole numbers only, never the axis maximum (0 stays).
      labelValues: ticks.filter((value) => value < axisMax && Number.isInteger(value)),
      // fl_chart draws no grid line on the axis minimum or maximum.
      gridValues: ticks.filter((value) => value > 0 && value < axisMax),
    };
  }, [data]);

  const titleWidth = aggregationLabel ? CHART_TITLE_VERTICAL_WIDTH : 0;
  const chartWidth = Math.max(0, width - titleWidth);
  const plotWidth = Math.max(0, chartWidth - VALUE_AXIS_WIDTH);
  const plotHeight = Math.max(0, height - CATEGORY_AXIS_HEIGHT);
  const activeIndex = hoveredIndex !== null && hoveredIndex < points.length ? hoveredIndex : null;
  const hovered = activeIndex === null ? null : points[activeIndex];

  // The x domain runs from -0.5 to n - 0.5, so each point sits in the middle
  // of an equal segment of the plot. Coordinates are chart-area relative.
  const pointX = (index: number) => VALUE_AXIS_WIDTH + ((index + 0.5) / points.length) * plotWidth;
  const pointY = (value: number) => plotHeight * (1 - value / axis.axisMax);

  const gridLines = useCallback(
    () => axis.gridValues.map((value) => plotHeight * (1 - value / axis.axisMax)),
    [axis, plotHeight]
  );

  // fl_chart paints the white ring outside the fill: a circle 1px larger with
  // a 2px stroke leaves exactly `radius` of fill. The ring is white in both
  // themes on desktop (`Colors.white`), like `--icon-on-fill`.
  const renderDot = useCallback(
    ({ key, cx, cy, index }: { key?: string; cx?: number; cy?: number; index?: number }) => (
      <Dot
        key={key}
        className='recharts-line-dot'
        cx={cx}
        cy={cy}
        r={(index === activeIndex ? HOVERED_DOT_RADIUS : DOT_RADIUS) + DOT_RING_WIDTH / 2}
        fill={index === undefined ? undefined : points[index]?.color}
        stroke='var(--icon-on-fill)'
        strokeWidth={DOT_RING_WIDTH}
      />
    ),
    [activeIndex, points]
  );

  // fl_chart only reports pointers over the plot, and picks the point nearest
  // along x as long as it is within the touch threshold.
  const pointIndexAt = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (x < VALUE_AXIS_WIDTH || x > chartWidth || y < 0 || y > plotHeight) return null;
    let nearest: number | null = null;
    let nearestDistance = Infinity;

    for (let index = 0; index < points.length; index++) {
      const distance = Math.abs(pointX(index) - x);

      if (distance <= TOUCH_SPOT_THRESHOLD && distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }

    return nearest;
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const index = pointIndexAt(event);

    if (index !== null) {
      const { item, color } = points[index];

      onPointClick?.({ ...item, color });
    }

    // Desktop drops the hover state on tap up; the next pointer move restores it.
    setHoveredIndex(null);
  };

  return (
    <div className='relative flex h-full w-full'>
      {aggregationLabel && <ChartTitle label={aggregationLabel} />}
      <div
        data-testid='line-chart-plot'
        // The labels always overhang here. Desktop's line chart does clip them
        // once a segment is narrower than its 60px value labels (its inner
        // Stack keeps `Clip.hardEdge`); that quirk is not copied.
        className={cn(
          'relative h-full min-w-0 flex-1',
          PLOT_SURFACE_OVERFLOW_CLASS,
          activeIndex !== null && 'cursor-pointer'
        )}
        onMouseMove={(event) => setHoveredIndex(pointIndexAt(event))}
        onMouseLeave={() => setHoveredIndex(null)}
        onClick={handleClick}
      >
        <RechartsLineChart
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
            type='number'
            domain={[-0.5, rows.length - 0.5]}
            ticks={rows.map((row) => row.index)}
            interval={0}
            height={CATEGORY_AXIS_HEIGHT}
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
            tickMargin={VALUE_AXIS_LABEL_GAP}
            tick={ValueAxisTick}
          />
          <Line
            type='linear'
            dataKey='value'
            stroke='var(--fill-theme-thick)'
            strokeWidth={3}
            strokeLinecap='round'
            dot={renderDot}
            activeDot={false}
            isAnimationActive={false}
          >
            <LabelList dataKey='value' content={PointValueLabel} />
          </Line>
        </RechartsLineChart>
        {activeIndex !== null && (
          <div
            data-testid='line-chart-hover-line'
            className='pointer-events-none absolute top-0 w-px'
            style={{ left: pointX(activeIndex) - 0.5, height: plotHeight, backgroundImage: HOVER_LINE_DASHES }}
          />
        )}
      </div>
      {hovered && activeIndex !== null && (
        <PositionedChartTooltip
          label={hovered.item.label}
          value={hovered.item.value}
          color={hovered.color}
          anchor={{ x: titleWidth + pointX(activeIndex), y: pointY(hovered.item.value) }}
          chartSize={{ width, height }}
          verticalGap={TOOLTIP_VERTICAL_GAP}
        />
      )}
    </div>
  );
}

/**
 * Line chart (desktop's `DatabaseLineChart`). The chart page pads it 18px
 * left / 55px right and the widget adds 24px on both sides; the 400px chart,
 * or a "no valid data" note when no value can be plotted, fills the rest.
 */
function LineChartWidgetImpl({ data, onPointClick, aggregationType }: LineChartWidgetProps) {
  const validData = useMemo(() => data.filter(isPlottableValue), [data]);

  return (
    <div data-testid='line-chart-widget' className='h-[400px] w-full pl-[18px] pr-[55px]'>
      {validData.length === 0 ? (
        <ChartNoValidData />
      ) : (
        <div className='h-full w-full px-6'>
          <ResponsiveContainer width='100%' height='100%'>
            <LineChartBody data={validData} onPointClick={onPointClick} aggregationType={aggregationType} />
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// Memoized with content-equality so Yjs hydration micro-batches don't rebuild
// the recharts SVG. `onPointClick` is `useCallback`-stable in `ChartProvider`.
export const LineChartWidget = memo(LineChartWidgetImpl, (prev, next) => {
  return (
    prev.onPointClick === next.onPointClick &&
    prev.aggregationType === next.aggregationType &&
    chartDataEqual(prev.data, next.data)
  );
});

export default LineChartWidget;
