import { memo, useCallback, useMemo } from 'react';
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
import { computeValueDomain, computeYAxisWidth } from '@/application/database-yjs/chart-scale';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { useChartContext } from '@/components/database/chart/useChartContext';

import { CategoryAnchors, CategoryTick, DataLabel, ValueTick } from './ChartAxisParts';
import { ChartFrame, ChartFrameTooltip } from './ChartFrame';
import { chartDataEqual, chartItemKey, chartValuesAreCounts } from './chartUtils';
import { layoutVerticalCartesian } from './cartesianLayout';
import { useChartMeasure } from './measureText';
import { useChartA11yRows, useChartLegend } from './useChartFrameModels';
import { useChartHover } from './useChartHover';
import { useReducedMotion } from './useReducedMotion';

interface BarChartWidgetProps {
  data: ChartDataItem[];
  onBarClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone 400px height. */
  fill?: boolean;
}

/** The props Recharts passes to a `LabelList` content renderer. */
interface LabelProps {
  index?: number;
  value?: unknown;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
}

const { bar, hoverBandRadius } = DASHBOARD_CHART_GEOMETRY;

/**
 * Vertical bar chart (WP10 §2.1): measured value axis with nice ticks and no
 * axis line, dotted grid and a solid zero line, thin bars with a 2px
 * value-end radius, fitted category labels, data labels, a hover band and a
 * portal tooltip.
 */
function BarChartWidgetImpl({ data, onBarClick, fill = false }: BarChartWidgetProps) {
  const { style, format, aggregationType, yAxisField } = useChartContext();
  const { measure12 } = useChartMeasure();
  const reducedMotion = useReducedMotion();
  const { hover, clear, onChartMouseMove, frameHandlers } = useChartHover(data);
  const integerOnly = chartValuesAreCounts(aggregationType, Boolean(yAxisField));
  const domain = useMemo(() => computeValueDomain(data.map((item) => item.value), integerOnly), [data, integerOnly]);
  const yAxisWidth = useMemo(
    () => computeYAxisWidth(domain.ticks.map((tick) => format(tick, 'axis')), measure12),
    [domain, format, measure12]
  );
  const legend = useChartLegend(ChartType.Bar, style.legendPosition, data);
  const rows = useChartA11yRows(data, format);
  const hovered = hover ? data[hover.index] : undefined;
  const tooltip: ChartFrameTooltip | null =
    hover && hovered
      ? {
          clientX: hover.clientX,
          clientY: hover.clientY,
          rows: [{ color: hovered.color, name: hovered.label, value: format(hovered.value, 'tooltip') }],
          showDrilldownHint: Boolean(onBarClick),
        }
      : null;

  const handleClick = useCallback(
    (state: { activeTooltipIndex?: number } | null) => {
      const index = state?.activeTooltipIndex;

      if (typeof index === 'number' && data[index]) onBarClick?.(data[index]);
    },
    [data, onBarClick]
  );

  return (
    <ChartFrame
      fill={fill}
      frameHandlers={frameHandlers}
      legend={legend}
      rows={rows}
      testId='bar-chart-widget'
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
                width: Number(props.width),
                height: Number(props.height),
              }}
            />
          );
        };

        return (
          <RechartsBarChart
            barCategoryGap={0}
            data={data}
            height={size.height}
            margin={{ top: layout.marginTop, right: 0, bottom: 0, left: 0 }}
            onClick={handleClick}
            onMouseLeave={clear}
            onMouseMove={onChartMouseMove}
            width={size.width}
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
              cursor={{ fill: 'var(--chart-hover-band)', stroke: 'none', radius: hoverBandRadius }}
              isAnimationActive={false}
            />
            <Bar
              activeBar={false}
              barSize={layout.barWidth}
              cursor={onBarClick ? 'pointer' : undefined}
              dataKey='value'
              isAnimationActive={!reducedMotion}
              radius={[bar.radius, bar.radius, 0, 0]}
            >
              {data.map((item) => (
                <Cell data-parity-id='dash-chart-bar' fill={item.color} key={chartItemKey(item)} />
              ))}
              <LabelList content={renderLabel} dataKey='value' />
            </Bar>
            <Customized component={<CategoryAnchors rects={layout.anchors} />} />
          </RechartsBarChart>
        );
      }}
    </ChartFrame>
  );
}

// Memoized with a content-equality comparator so Yjs hydration micro-batches
// that produce the same final chart don't rebuild the recharts SVG tree.
// `onBarClick` is `useCallback`-stable in `ChartProvider`, so reference
// equality is sufficient there.
export const BarChartWidget = memo(BarChartWidgetImpl, (prev, next) => {
  return prev.onBarClick === next.onBarClick && prev.fill === next.fill && chartDataEqual(prev.data, next.data);
});

export default BarChartWidget;
