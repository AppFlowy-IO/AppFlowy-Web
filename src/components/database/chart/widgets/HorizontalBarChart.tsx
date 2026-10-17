import { memo, useMemo, useRef, useState } from 'react';

import { ChartAggregationType, ChartClickItem, ChartDataItem } from '@/application/database-yjs/chart.type';
import { cn } from '@/lib/utils';

import { ChartNoValidData } from './ChartNoValidData';
import { ChartTitle, useChartAggregationLabel } from './ChartTitle';
import { PositionedChartTooltip } from './ChartTooltip';
import {
  chartDataEqual,
  computeHorizontalAxisMax,
  computeHorizontalLabelCount,
  isPlottableValue,
  resolveChartItemColor,
  truncateChartLabel,
} from './chartUtils';
import { useElementSize } from './useElementSize';

interface HorizontalBarChartWidgetProps {
  data: ChartDataItem[];
  onBarClick?: (item: ChartClickItem) => void;
  aggregationType?: ChartAggregationType;
}

/** Category label column left of the bars (desktop's `labelWidth`). */
const LABEL_WIDTH = 120;
/** Room right of the bar area for the value after the longest bar (desktop's `_rightPadding`). */
const VALUE_WIDTH = 40;
/** Desktop anchors the tooltip 110px (half its width plus 20) past the end of the bar. */
const TOOLTIP_OFFSET_X = 110;
/** Height desktop leaves out (8px gap + a 24px axis) when centering the tooltip on a row. */
const X_AXIS_HEIGHT = 32;

/**
 * Desktop's `_HorizontalBarChartContent`: equal-height rows of label + bar +
 * value over dashed vertical grid lines, the value axis below, then the
 * aggregation title. Built from plain elements like desktop (no chart library).
 */
function HorizontalBarChartContent({ data, onBarClick, aggregationType }: HorizontalBarChartWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(containerRef);
  const aggregationLabel = useChartAggregationLabel(aggregationType);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const bars = useMemo(() => data.map((item, index) => ({ item, color: resolveChartItemColor(item, index) })), [data]);
  const axisMax = useMemo(() => {
    const maxValue = data.reduce((max, item) => Math.max(max, item.value), 0);

    return computeHorizontalAxisMax(maxValue > 0 ? maxValue : 1);
  }, [data]);
  const intervalCount = computeHorizontalLabelCount(axisMax);
  const interval = axisMax / intervalCount;
  const barAreaWidth = width - LABEL_WIDTH - VALUE_WIDTH;
  const gridLineXs = Array.from(
    { length: intervalCount + 1 },
    (_, i) => LABEL_WIDTH + (i * barAreaWidth) / intervalCount
  );
  const axisLabels = Array.from({ length: intervalCount + 1 }, (_, i) => Math.round(i * interval));
  const hovered = hoveredIndex === null ? undefined : bars[hoveredIndex];

  const handleRowClick = (index: number) => {
    const bar = bars[index];

    // Desktop only drills into categories that have rows (a "No …" bucket at 0 has none).
    if (!bar || bar.item.rowIds.length === 0 || !onBarClick) return;
    // The drill-down dialog covers the chart, which ends the hover on desktop.
    setHoveredIndex(null);
    onBarClick({ ...bar.item, color: bar.color });
  };

  return (
    <div ref={containerRef} className='relative h-full w-full'>
      {width > 0 && height > 0 && (
        <div className='flex h-full flex-col'>
          <div className='relative min-h-0 flex-1'>
            <svg
              aria-hidden
              className='pointer-events-none absolute inset-0 h-full w-full overflow-visible stroke-text-primary'
            >
              {gridLineXs.map((x, i) => (
                <line
                  key={i}
                  data-testid='horizontal-bar-chart-grid-line'
                  x1={x}
                  x2={x}
                  y1={0}
                  y2='100%'
                  strokeOpacity={0.08}
                  strokeWidth={1}
                  strokeDasharray='4 4'
                />
              ))}
            </svg>
            {/* Positioned so the rows (and the hovered row's fill) paint above the grid lines. */}
            <div className='relative flex h-full flex-col'>
              {bars.map(({ item, color }, index) => {
                const isHovered = index === hoveredIndex;
                const barWidth = Math.max(0, Math.min((item.value / axisMax) * barAreaWidth, barAreaWidth));

                return (
                  <div
                    key={`${item.label}-${index}`}
                    data-testid='horizontal-bar-chart-row'
                    className={cn('flex min-h-0 flex-1 items-center', isHovered && 'cursor-pointer')}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onClick={() => handleRowClick(index)}
                  >
                    <div className='shrink-0 py-1 pr-2' style={{ width: LABEL_WIDTH }}>
                      <div className='truncate text-right text-xs font-medium leading-[18px] text-text-tertiary'>
                        {truncateChartLabel(item.label)}
                      </div>
                    </div>
                    {/* The hover fill runs from the bar start to the right edge, leaving the label alone. */}
                    <div
                      data-testid='horizontal-bar-chart-bar-area'
                      className={cn(
                        'flex min-w-0 flex-1 items-center self-stretch py-1',
                        isHovered && 'bg-fill-content-hover'
                      )}
                    >
                      <div
                        data-testid='horizontal-bar-chart-bar'
                        className='h-6 max-h-full shrink-0 rounded-r-100 transition-[width] duration-200 ease-linear'
                        style={{ width: barWidth, backgroundColor: color }}
                      />
                      <span
                        data-testid='horizontal-bar-chart-value'
                        className='ml-2 shrink-0 text-xs font-medium leading-[18px] text-text-tertiary'
                      >
                        {Math.trunc(item.value)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/*
           * Desktop centers this `labelWidth + barAreaWidth` wide row in the chart column, so its
           * labels sit 20px (half of the value room) right of the grid lines; kept for parity.
           */}
          <div
            className='mx-auto mt-2 flex shrink-0 justify-between text-[10px] leading-3 text-text-primary opacity-60'
            style={{ width: LABEL_WIDTH + barAreaWidth, paddingLeft: LABEL_WIDTH }}
          >
            {axisLabels.map((value, i) => (
              <span key={i} data-testid='horizontal-bar-chart-x-label'>
                {value}
              </span>
            ))}
          </div>
          {aggregationLabel && (
            <ChartTitle className='mt-2 shrink-0' label={aggregationLabel} orientation='horizontal' />
          )}
        </div>
      )}
      {hovered && hoveredIndex !== null && (
        <PositionedChartTooltip
          label={hovered.item.label}
          value={hovered.item.value}
          color={hovered.color}
          anchor={{
            x: LABEL_WIDTH + (hovered.item.value / axisMax) * barAreaWidth + TOOLTIP_OFFSET_X,
            // Rows share the height equally, so row centers sit at (index + 0.5) / n of it.
            y: ((hoveredIndex + 0.5) / bars.length) * (height - X_AXIS_HEIGHT),
          }}
          chartSize={{ width, height }}
        />
      )}
    </div>
  );
}

/**
 * Horizontal bar chart (desktop's `DatabaseHorizontalBarChart`). Categories
 * with a negative or non-finite value are dropped; zero-value categories keep
 * their row with an empty bar.
 */
function HorizontalBarChartWidgetImpl({ data, onBarClick, aggregationType }: HorizontalBarChartWidgetProps) {
  const validData = useMemo(() => data.filter(isPlottableValue), [data]);

  return (
    // The 18px right inset is the padding desktop's chart page puts around this chart.
    <div data-testid='horizontal-bar-chart-widget' className='h-[400px] w-full pr-[18px]'>
      {validData.length === 0 ? (
        <ChartNoValidData />
      ) : (
        <div className='h-full px-6'>
          <HorizontalBarChartContent data={validData} onBarClick={onBarClick} aggregationType={aggregationType} />
        </div>
      )}
    </div>
  );
}

// Memoized with content-equality so Yjs hydration micro-batches don't rebuild
// the chart. `onBarClick` is `useCallback`-stable in `ChartProvider`.
export const HorizontalBarChartWidget = memo(HorizontalBarChartWidgetImpl, (prev, next) => {
  return (
    prev.onBarClick === next.onBarClick &&
    prev.aggregationType === next.aggregationType &&
    chartDataEqual(prev.data, next.data)
  );
});

export default HorizontalBarChartWidget;
