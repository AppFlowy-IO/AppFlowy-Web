import { memo, useMemo, useState } from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';

import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { ChartTooltip } from './ChartTooltip';
import {
  TooltipState,
  INITIAL_TOOLTIP_STATE,
  calculateBarWidth,
  chartDataEqual,
  computeValueAxis,
  formatValue,
} from './chartUtils';

interface BarChartWidgetProps {
  data: ChartDataItem[];
  onBarClick?: (item: ChartDataItem) => void;
}

/**
 * Vertical bar chart widget using Recharts
 */
function BarChartWidgetImpl({ data, onBarClick }: BarChartWidgetProps) {
  const [tooltip, setTooltip] = useState<TooltipState>(INITIAL_TOOLTIP_STATE);

  // Y-axis: zero-anchored [min, max] domain + nice ticks. Shared across
  // BarChart / LineChart / HorizontalBarChart via `computeValueAxis`.
  const { domain: yAxisDomain, ticks: yAxisTicks } = useMemo(() => computeValueAxis(data), [data]);

  // Calculate bar width based on data count
  const barWidth = useMemo(() => calculateBarWidth(data.length), [data.length]);

  const handleClick = (item: ChartDataItem) => {
    if (onBarClick) {
      onBarClick(item);
    }
  };

  const handleMouseEnter = (data: ChartDataItem, index: number, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = e.currentTarget.closest('.recharts-wrapper')?.getBoundingClientRect();

    if (containerRect) {
      setTooltip({
        active: true,
        item: data,
        // Center horizontally on the bar
        x: rect.left + rect.width / 2 - containerRect.left,
        // Position above the bar top (with offset for value label)
        y: rect.top - containerRect.top - 20,
      });
    }
  };

  const handleMouseLeave = () => {
    setTooltip(INITIAL_TOOLTIP_STATE);
  };

  return (
    <div className="w-full relative" style={{ height: '400px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={data}
          margin={{ top: 24, right: 0, left: 0, bottom: 40 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--border-primary)"
            strokeOpacity={0.5}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border-primary)' }}
            interval={0}
            tickFormatter={(label) => label.length > 15 ? `${label.substring(0, 15)}...` : label}
          />
          <YAxis
            domain={yAxisDomain}
            ticks={yAxisTicks}
            tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border-primary)' }}
            width={40}
          />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(data) => handleClick(data as ChartDataItem)}
            maxBarSize={barWidth}
            activeBar={false}
            onMouseLeave={handleMouseLeave}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color}
                onMouseEnter={(e) => handleMouseEnter(entry, index, e as unknown as React.MouseEvent)}
              />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              formatter={formatValue}
              style={{
                fontSize: 12,
                fontWeight: 600,
                fill: 'var(--text-primary)',
              }}
            />
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>

      {/* Fixed position tooltip above the bar */}
      {tooltip.active && tooltip.item && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <ChartTooltip
            label={tooltip.item.label}
            value={tooltip.item.value}
            color={tooltip.item.color}
          />
        </div>
      )}
    </div>
  );
}

// Memoized with a content-equality comparator so Yjs hydration micro-batches
// that produce the same final chart don't rebuild the recharts SVG tree.
// `onBarClick` is `useCallback`-stable in `ChartProvider`, so reference
// equality is sufficient there.
export const BarChartWidget = memo(BarChartWidgetImpl, (prev, next) => {
  return prev.onBarClick === next.onBarClick && chartDataEqual(prev.data, next.data);
});

export default BarChartWidget;
