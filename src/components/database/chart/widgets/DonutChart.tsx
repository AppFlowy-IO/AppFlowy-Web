import { memo, useMemo, useState, useRef } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';

import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { ChartTooltip } from './ChartTooltip';
import { chartDataEqual, DonutTooltipState } from './chartUtils';

interface DonutChartWidgetProps {
  data: ChartDataItem[];
  onSliceClick?: (item: ChartDataItem) => void;
}

/**
 * Format value for external label (count + percentage)
 */
function formatLabel(value: number, percent: number): string {
  const percentStr = (percent * 100).toFixed(1);

  return `${value} (${percentStr}%)`;
}

/**
 * Horizontal legend component matching Flutter design
 */
function HorizontalLegend({
  data,
  onItemClick
}: {
  data: ChartDataItem[];
  onItemClick?: (item: ChartDataItem) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 px-4">
      {data.map((item, index) => (
        <button
          key={`legend-${index}`}
          className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-fill-hover transition-colors"
          onClick={() => onItemClick?.(item)}
        >
          <div
            className="h-3 w-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-xs text-text-secondary">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Center total display matching Flutter design
 */
function CenterTotal({ total }: { total: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ marginBottom: '60px' }}>
      <div className="text-center">
        <div className="text-3xl font-semibold text-text-primary">
          {Math.round(total)}
        </div>
        <div className="text-sm text-text-secondary">
          Total
        </div>
      </div>
    </div>
  );
}

/**
 * Custom label renderer for external labels showing "count (percentage%)"
 */
function renderCustomLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  value,
  percent
}: {
  cx: number;
  cy: number;
  midAngle: number;
  outerRadius: number;
  value: number;
  percent: number;
}) {
  const RADIAN = Math.PI / 180;
  // Position label outside the pie (matching Flutter's 2.2x radius offset)
  const radius = outerRadius * 1.6;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      className="text-xs"
      style={{ fill: 'var(--text-secondary)', fontWeight: 500 }}
    >
      {formatLabel(value, percent)}
    </text>
  );
}

/**
 * Donut (pie) chart widget using Recharts
 */
function DonutChartWidgetImpl({ data, onSliceClick }: DonutChartWidgetProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>();
  const [tooltip, setTooltip] = useState<DonutTooltipState>({ active: false, item: null, x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate total for percentage display
  const total = useMemo(() => {
    return data.reduce((sum, item) => sum + item.value, 0);
  }, [data]);

  // Add percentage to data
  const dataWithPercent = useMemo(() => {
    return data.map(item => ({
      ...item,
      percent: total > 0 ? item.value / total : 0,
    }));
  }, [data, total]);

  const handleClick = (item: ChartDataItem) => {
    if (onSliceClick) {
      onSliceClick(item);
    }
  };

  const onPieEnter = (_: unknown, index: number) => {
    setActiveIndex(index);
  };

  const onPieLeave = () => {
    setActiveIndex(undefined);
    setTooltip({ active: false, item: null, x: 0, y: 0 });
  };

  const handleSliceMouseEnter = (entry: ChartDataItem & { percent?: number }, e: React.MouseEvent) => {
    const containerRect = containerRef.current?.getBoundingClientRect();

    if (containerRect) {
      setTooltip({
        active: true,
        item: entry,
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top,
      });
    }
  };

  return (
    <div className="w-full flex flex-col" style={{ height: '400px' }}>
      {/* Chart area with center total */}
      <div className="flex-1 relative min-h-0" ref={containerRef}>
        <CenterTotal total={total} />
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={dataWithPercent}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={2}
              dataKey="value"
              nameKey="label"
              cursor="pointer"
              onClick={(_, index) => handleClick(data[index])}
              onMouseEnter={onPieEnter}
              onMouseLeave={onPieLeave}
              label={renderCustomLabel}
              labelLine={false}
            >
              {dataWithPercent.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  stroke={index === activeIndex ? '#fff' : 'none'}
                  strokeWidth={index === activeIndex ? 2 : 0}
                  style={{
                    filter: index === activeIndex ? 'drop-shadow(0 0 4px rgba(0,0,0,0.2))' : 'none',
                  }}
                  onMouseEnter={(e) => handleSliceMouseEnter(entry, e as unknown as React.MouseEvent)}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Fixed position tooltip at slice */}
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
              percent={tooltip.item.percent}
            />
          </div>
        )}
      </div>

      {/* Horizontal legend at bottom */}
      <div className="pt-4 pb-2">
        <HorizontalLegend data={data} onItemClick={handleClick} />
      </div>
    </div>
  );
}

// Memoized with content-equality so Yjs hydration micro-batches don't rebuild
// the recharts SVG. `onSliceClick` is `useCallback`-stable in `ChartProvider`.
export const DonutChartWidget = memo(DonutChartWidgetImpl, (prev, next) => {
  return prev.onSliceClick === next.onSliceClick && chartDataEqual(prev.data, next.data);
});

export default DonutChartWidget;
