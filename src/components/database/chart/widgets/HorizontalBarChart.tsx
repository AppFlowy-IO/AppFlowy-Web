import { useMemo, useState } from 'react';
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
  formatValue,
  generateIntegerTicks,
  calculateBarHeight,
  computeAxisMax,
} from './chartUtils';

interface HorizontalBarChartWidgetProps {
  data: ChartDataItem[];
  onBarClick?: (item: ChartDataItem) => void;
}

/**
 * Horizontal bar chart widget using Recharts
 * Better for long category names
 */
export function HorizontalBarChartWidget({ data, onBarClick }: HorizontalBarChartWidgetProps) {
  const [tooltip, setTooltip] = useState<TooltipState>(INITIAL_TOOLTIP_STATE);

  // Calculate dynamic X-axis domain and ticks
  const { xAxisDomain, xAxisTicks } = useMemo(() => {
    const maxValue = Math.max(...data.map(d => d.value), 0);
    const axisMax = computeAxisMax(maxValue);
    const ticks = generateIntegerTicks(maxValue);
    return { xAxisDomain: [0, axisMax], xAxisTicks: ticks };
  }, [data]);

  // Calculate bar height based on data count
  const barHeight = useMemo(() => calculateBarHeight(data.length), [data.length]);

  // Calculate dynamic height based on number of bars
  const chartHeight = useMemo(() => {
    const minHeight = 300;
    return Math.max(minHeight, data.length * barHeight + 60);
  }, [data.length, barHeight]);

  const handleClick = (item: ChartDataItem) => {
    if (onBarClick) {
      onBarClick(item);
    }
  };

  const handleMouseEnter = (item: ChartDataItem, index: number, e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = e.currentTarget.closest('.recharts-wrapper')?.getBoundingClientRect();
    if (containerRect) {
      setTooltip({
        active: true,
        item: item,
        x: rect.right - containerRect.left,
        y: rect.top - containerRect.top + rect.height / 2,
      });
    }
  };

  const handleMouseLeave = () => {
    setTooltip(INITIAL_TOOLTIP_STATE);
  };

  return (
    <div className="w-full overflow-y-auto relative" style={{ height: Math.min(chartHeight, 500) }}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <RechartsBarChart
          data={data}
          layout="vertical"
          margin={{ top: 20, right: 0, left: 0, bottom: 20 }}
          barSize={barHeight - 16}
        >
          <CartesianGrid
            horizontal={false}
            stroke="var(--border-primary)"
            strokeOpacity={0.5}
          />
          <XAxis
            type="number"
            domain={xAxisDomain}
            ticks={xAxisTicks}
            tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border-primary)' }}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border-primary)' }}
            width={120}
            tickFormatter={(label) => label.length > 15 ? `${label.substring(0, 15)}...` : label}
          />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            cursor="pointer"
            onClick={(data) => handleClick(data as ChartDataItem)}
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
              position="right"
              formatter={formatValue}
              style={{
                fontSize: 12,
                fontWeight: 500,
                fill: 'var(--text-secondary)',
              }}
            />
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>

      {/* Fixed position tooltip at bar's end */}
      {tooltip.active && tooltip.item && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: tooltip.x + 8,
            top: tooltip.y,
            transform: 'translateY(-50%)',
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

export default HorizontalBarChartWidget;
