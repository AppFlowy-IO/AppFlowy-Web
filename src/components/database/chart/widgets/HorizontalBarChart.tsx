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
import {
  CategoryLabelFit,
  computeBarWidth,
  computeHorizontalLabelWidth,
  computeValueDomain,
  thinLabelIndices,
} from '@/application/database-yjs/chart-scale';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { useChartContext } from '@/components/database/chart/useChartContext';

import { CategoryAnchors, CategoryTick, DataLabel, ValueTick } from './ChartAxisParts';
import { ChartFrame, ChartFrameTooltip } from './ChartFrame';
import { calculateBarHeight, chartDataEqual, chartItemKey, chartValuesAreCounts } from './chartUtils';
import { useChartMeasure } from './measureText';
import { useChartA11yRows, useChartLegend } from './useChartFrameModels';
import { useChartHover } from './useChartHover';
import { useReducedMotion } from './useReducedMotion';

interface HorizontalBarChartWidgetProps {
  data: ChartDataItem[];
  onBarClick?: (item: ChartDataItem) => void;
  /** Fill a dashboard widget card instead of the standalone scrolling height. */
  fill?: boolean;
}

interface LabelProps {
  index?: number;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
}

const { bar, axis, hoverBandRadius } = DASHBOARD_CHART_GEOMETRY;

/** Height of the value axis under the plot. */
const VALUE_AXIS_HEIGHT = 24;
/** Gap between a data label and its bar end. */
const DATA_LABEL_GAP = 6;
const PLOT_TOP = 4;

/** Standalone pages keep today's scrolling height: one slot per category, 300–500px visible. */
function standaloneHeights(count: number) {
  const contentHeight = Math.max(300, count * calculateBarHeight(count) + 60);

  return { contentHeight, frameHeight: Math.min(contentHeight, 500) };
}

/**
 * Horizontal bar chart (WP10 §2.1): categories on the left, right-aligned and
 * truncated to the label column, values along the bottom with a vertical
 * dotted grid and a solid zero line; negative bars extend left of it.
 */
function HorizontalBarChartWidgetImpl({ data, onBarClick, fill = false }: HorizontalBarChartWidgetProps) {
  const { style, format, aggregationType, yAxisField } = useChartContext();
  const { measure12 } = useChartMeasure();
  const reducedMotion = useReducedMotion();
  const { hover, clear, onChartMouseMove, frameHandlers } = useChartHover(data);
  const integerOnly = chartValuesAreCounts(aggregationType, Boolean(yAxisField));
  const domain = useMemo(() => computeValueDomain(data.map((item) => item.value), integerOnly), [data, integerOnly]);
  const legend = useChartLegend(ChartType.HorizontalBar, style.legendPosition, data);
  const rows = useChartA11yRows(data, format);
  const standalone = standaloneHeights(data.length);
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
      scrollContentHeight={fill ? undefined : standalone.contentHeight}
      standaloneHeight={standalone.frameHeight}
      testId='horizontal-bar-chart-widget'
      tooltip={tooltip}
    >
      {(size) => {
        const labelWidths = data.map((item) => measure12(item.label));
        const labelColumn = computeHorizontalLabelWidth(labelWidths, size.width);
        const yAxisWidth = labelColumn + axis.tickGap;
        const labelTexts = data.map((item) => format(item.value, 'label'));
        const widestLabel = labelTexts.reduce((max, text) => Math.max(max, measure12(text)), 0);
        const widestTick = domain.ticks.reduce((max, tick) => Math.max(max, measure12(format(tick, 'axis'))), 0);
        // The data labels' gutter; the last tick is centred on the plot edge, so half of it must fit too.
        const marginRight = Math.ceil(Math.max(style.showDataLabels ? widestLabel + DATA_LABEL_GAP : 0, widestTick / 2));
        const plotWidth = Math.max(0, size.width - yAxisWidth - marginRight);
        const plotHeight = Math.max(0, size.height - PLOT_TOP - VALUE_AXIS_HEIGHT);
        const count = Math.max(1, data.length);
        const slot = plotHeight / count;
        const all = data.map((_, index) => index);
        const fit: CategoryLabelFit = {
          mode: 'horizontal',
          shown: slot < axis.minLabelSpacing ? thinLabelIndices(data.length, Math.ceil(axis.minLabelSpacing / slot)) : all,
        };
        const labels = new Map(data.map((item) => [chartItemKey(item), item.label]));
        const anchors = data.map((item, index) => ({
          label: item.label,
          x: yAxisWidth,
          y: PLOT_TOP + slot * index,
          width: plotWidth,
          height: slot,
        }));
        const renderLabel = (props: LabelProps) => {
          const index = props.index ?? 0;
          const item = data[index];

          if (!style.showDataLabels || !item) return null;
          return (
            <DataLabel
              layout='horizontal'
              target={{
                index,
                value: item.value,
                label: item.label,
                text: labelTexts[index],
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
            layout='vertical'
            margin={{ top: PLOT_TOP, right: marginRight, bottom: 0, left: 0 }}
            onClick={handleClick}
            onMouseLeave={clear}
            onMouseMove={onChartMouseMove}
            width={size.width}
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
              height={VALUE_AXIS_HEIGHT}
              interval={0}
              tick={<ValueTick format={(value) => format(value, 'axis')} orientation='bottom' />}
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
              tick={
                <CategoryTick fit={fit} labels={labels} maxWidth={labelColumn} measure={measure12} orientation='left' />
              }
              tickLine={false}
              tickMargin={axis.tickGap}
              tickSize={0}
              type='category'
              width={yAxisWidth}
            />
            <ReferenceLine stroke='var(--chart-grid)' x={0} />
            <Tooltip
              active={hover ? undefined : false}
              content={() => null}
              cursor={{ fill: 'var(--chart-hover-band)', stroke: 'none', radius: hoverBandRadius }}
              isAnimationActive={false}
            />
            <Bar
              activeBar={false}
              barSize={computeBarWidth(plotHeight, data.length)}
              cursor={onBarClick ? 'pointer' : undefined}
              dataKey='value'
              isAnimationActive={!reducedMotion}
              radius={[0, bar.radius, bar.radius, 0]}
            >
              {data.map((item) => (
                <Cell data-parity-id='dash-chart-bar' fill={item.color} key={chartItemKey(item)} />
              ))}
              <LabelList content={renderLabel} dataKey='value' />
            </Bar>
            <Customized component={<CategoryAnchors rects={anchors} />} />
          </RechartsBarChart>
        );
      }}
    </ChartFrame>
  );
}

// Memoized with content-equality so Yjs hydration micro-batches don't rebuild
// the recharts SVG. `onBarClick` is `useCallback`-stable in `ChartProvider`.
export const HorizontalBarChartWidget = memo(HorizontalBarChartWidgetImpl, (prev, next) => {
  return prev.onBarClick === next.onBarClick && prev.fill === next.fill && chartDataEqual(prev.data, next.data);
});

export default HorizontalBarChartWidget;
