import { useId, useMemo, useState } from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Area,
  LabelList,
} from 'recharts';

import { ChartDataItem, CHART_COLORS } from '@/application/database-yjs/chart.type';
import { ChartTooltip } from './ChartTooltip';
import {
  TooltipState,
  INITIAL_TOOLTIP_STATE,
  formatValue,
  generateIntegerTicks,
  computeAxisMax,
} from './chartUtils';

interface LineChartWidgetProps {
  data: ChartDataItem[];
  onPointClick?: (item: ChartDataItem) => void;
}

/**
 * Line chart widget using Recharts
 */
export function LineChartWidget({ data, onPointClick }: LineChartWidgetProps) {
  const [tooltip, setTooltip] = useState<TooltipState>(INITIAL_TOOLTIP_STATE);
  const gradientId = useId();

  // Calculate dynamic Y-axis domain and ticks
  const { yAxisDomain, yAxisTicks } = useMemo(() => {
    const maxValue = Math.max(...data.map(d => d.value), 0);
    const axisMax = computeAxisMax(maxValue);
    // Add extra 15% for value labels (matching Flutter's chartMaxY = axisMaxY * 1.15)
    const ticks = generateIntegerTicks(maxValue);

    return { yAxisDomain: [0, axisMax * 1.15], yAxisTicks: ticks };
  }, [data]);

  // Use first color from palette for the line
  const lineColor = data[0]?.color || CHART_COLORS[0];

  const handleClick = (item: ChartDataItem) => {
    if (onPointClick) {
      onPointClick(item);
    }
  };

  const handleMouseMove = (e: { activePayload?: Array<{ payload: ChartDataItem }>; activeCoordinate?: { x: number; y: number } }) => {
    if (e && e.activePayload && e.activePayload[0] && e.activeCoordinate) {
      setTooltip({
        active: true,
        item: e.activePayload[0].payload,
        x: e.activeCoordinate.x,
        y: e.activeCoordinate.y,
      });
    }
  };

  const handleMouseLeave = () => {
    setTooltip(INITIAL_TOOLTIP_STATE);
  };

  return (
    <div className="w-full relative" style={{ height: '400px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart
          data={data}
          margin={{ top: 30, right: 0, left: 0, bottom: 40 }}
          onClick={(e) => {
            if (e && e.activePayload && e.activePayload[0]) {
              handleClick(e.activePayload[0].payload as ChartDataItem);
            }
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id={`lineAreaGradient-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.15}/>
              <stop offset="95%" stopColor={lineColor} stopOpacity={0}/>
            </linearGradient>
          </defs>
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
            padding={{ left: 20, right: 20 }}
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
          <Area
            type="monotone"
            dataKey="value"
            stroke="none"
            fill={`url(#lineAreaGradient-${gradientId})`}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={lineColor}
            strokeWidth={3}
            dot={{
              r: 4,
              fill: lineColor,
              stroke: '#fff',
              strokeWidth: 2,
              cursor: 'pointer',
            }}
            activeDot={{
              r: 6,
              fill: lineColor,
              stroke: '#fff',
              strokeWidth: 2,
              cursor: 'pointer',
            }}
          >
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
          </Line>
        </RechartsLineChart>
      </ResponsiveContainer>

      {/* Fixed position tooltip above the data point */}
      {tooltip.active && tooltip.item && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: tooltip.x,
            top: tooltip.y - 30,
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

export default LineChartWidget;
