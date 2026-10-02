import { memo, useCallback, useId, useMemo } from 'react';
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
import { computeValueDomain, computeYAxisWidth } from '@/application/database-yjs/chart-scale';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { useChartContext } from '@/components/database/chart/useChartContext';

import { CategoryAnchors, CategoryTick, DataLabel, HoverBandCursor, ValueTick } from './ChartAxisParts';
import { ChartFrame, ChartFrameTooltip } from './ChartFrame';
import { chartDataEqual, chartItemKey, chartValuesAreCounts } from './chartUtils';
import { layoutVerticalCartesian } from './cartesianLayout';
import { useChartMeasure } from './measureText';
import { useChartA11yRows, useChartLegend } from './useChartFrameModels';
import { useChartHover } from './useChartHover';
import { useReducedMotion } from './useReducedMotion';

interface LineChartWidgetProps {
  data: ChartDataItem[];
  onPointClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone 400px height. */
  fill?: boolean;
}

interface LabelProps {
  index?: number;
  x?: number | string;
  y?: number | string;
}

const { line } = DASHBOARD_CHART_GEOMETRY;

/** Entry animation of the line (WP10 §2.5: the Recharts bar timing). */
const ENTRY_ANIMATION_MS = 400;

/**
 * Line chart (WP10 §2.1): a 1.5px monotone line in the series color over a
 * gradient area, no dots until a category is hovered, data labels above the
 * points, a legend with the series name.
 */
function LineChartWidgetImpl({ data, onPointClick, fill = false }: LineChartWidgetProps) {
  const { style, format, aggregationType, yAxisField, seriesLabel, isDark } = useChartContext();
  const { measure12 } = useChartMeasure();
  const reducedMotion = useReducedMotion();
  const gradientId = useId().replace(/:/g, '');
  const { hover, clear, onChartMouseMove, frameHandlers } = useChartHover(data);
  const color = resolveSeriesColor(0, style.colorTheme, isDark);
  const integerOnly = chartValuesAreCounts(aggregationType, Boolean(yAxisField));
  const domain = useMemo(
    () =>
      computeValueDomain(
        data.map((item) => item.value),
        integerOnly
      ),
    [data, integerOnly]
  );
  const yAxisWidth = useMemo(
    () =>
      computeYAxisWidth(
        domain.ticks.map((tick) => format(tick, 'axis')),
        measure12
      ),
    [domain, format, measure12]
  );
  const legend = useChartLegend(ChartType.Line, style.legendPosition, data, { label: seriesLabel, color });
  const tableRows = useChartA11yRows(data, format);
  // Every point of the one series takes the series color.
  const rows = useMemo(() => tableRows.map((row) => ({ ...row, color })), [tableRows, color]);
  const hovered = hover ? data[hover.index] : undefined;
  const tooltip: ChartFrameTooltip | null =
    hover && hovered
      ? {
          clientX: hover.clientX,
          clientY: hover.clientY,
          rows: [{ color, name: hovered.label, value: format(hovered.value, 'tooltip') }],
          showDrilldownHint: Boolean(onPointClick),
        }
      : null;

  const handleClick = useCallback(
    (state: { activeTooltipIndex?: number } | null) => {
      const index = state?.activeTooltipIndex;

      if (typeof index === 'number' && data[index]) onPointClick?.(data[index]);
    },
    [data, onPointClick]
  );

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={frameHandlers}
      legend={legend}
      rows={rows}
      testId='line-chart-widget'
      tooltip={tooltip}
    >
      {(size) => {
        const layout = layoutVerticalCartesian(data, size, yAxisWidth, style.showDataLabels, measure12);
        const renderLabel = (props: LabelProps) => {
          const index = props.index ?? 0;
          const item = data[index];

          if (!style.showDataLabels || !item) return null;
          const text = format(item.value, 'label');

          if (measure12(text) > layout.slot) return null;
          return (
            <DataLabel
              layout='vertical'
              target={{
                index,
                value: item.value,
                label: item.label,
                text,
                x: Number(props.x),
                y: Number(props.y),
                width: 0,
                height: 0,
              }}
            />
          );
        };

        // A ComposedChart: Recharts' LineChart draws only its Line children, not the Area.
        return (
          <ComposedChart
            data={data}
            height={size.height}
            margin={{ top: layout.marginTop, right: 0, bottom: 0, left: 0 }}
            onClick={handleClick}
            onMouseLeave={clear}
            onMouseMove={onChartMouseMove}
            width={size.width}
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
              padding={{ left: layout.slot / 2, right: layout.slot / 2 }}
              tick={<CategoryTick fit={layout.fit} labels={layout.labels} measure={measure12} orientation='bottom' />}
              tickLine={false}
              tickMargin={4}
              tickSize={0}
            />
            <YAxis
              allowDataOverflow
              axisLine={false}
              domain={domain.domain}
              interval={0}
              tick={<ValueTick format={(value) => format(value, 'axis')} orientation='left' />}
              tickLine={false}
              tickMargin={8}
              tickSize={0}
              ticks={domain.ticks}
              type='number'
              width={yAxisWidth}
            />
            <ReferenceLine stroke='var(--chart-grid)' y={0} />
            <Tooltip
              active={hover ? undefined : false}
              content={() => null}
              cursor={<HoverBandCursor height={layout.plotHeight} slot={layout.slot} top={layout.plotTop} />}
              isAnimationActive={false}
            />
            <Area
              activeDot={false}
              animationDuration={ENTRY_ANIMATION_MS}
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
              activeDot={{ r: line.activeDotRadius, fill: color, stroke: 'var(--dash-card-bg)', strokeWidth: 2 }}
              animationDuration={ENTRY_ANIMATION_MS}
              cursor={onPointClick ? 'pointer' : undefined}
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
            <Customized component={<CategoryAnchors rects={layout.anchors} />} />
          </ComposedChart>
        );
      }}
    </ChartFrame>
  );
}

// Memoized with content-equality so Yjs hydration micro-batches don't rebuild
// the recharts SVG. `onPointClick` is `useCallback`-stable in `ChartProvider`.
export const LineChartWidget = memo(LineChartWidgetImpl, (prev, next) => {
  return prev.onPointClick === next.onPointClick && prev.fill === next.fill && chartDataEqual(prev.data, next.data);
});

export default LineChartWidget;
