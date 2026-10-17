import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/**
 * Tooltip box size desktop's `PositionedChartTooltip` assumes when it centers
 * the tooltip on an anchor and clamps it inside the chart.
 */
export const CHART_TOOLTIP_WIDTH = 180;
export const CHART_TOOLTIP_HEIGHT = 80;
const CHART_TOOLTIP_EDGE_MARGIN = 8;

/**
 * Small colored square with a theme border ring (desktop's
 * `ChartIndicatorDot`), so light option colors stay visible on both the
 * tooltip and the page background.
 */
export function ChartIndicatorDot({ color, className }: { color?: string; className?: string }) {
  return (
    <span data-testid='chart-indicator-dot' className={cn('flex shrink-0 p-0.5', className)}>
      <span className='flex rounded-100 border border-border-primary p-px'>
        <span className='h-3 w-3 rounded-[2px]' style={{ backgroundColor: color }} />
      </span>
    </span>
  );
}

interface ChartTooltipProps {
  label: string;
  value: number;
  color?: string;
}

/**
 * Hover tooltip shared by every chart type (desktop's `ChartTooltip`): the
 * category with its color and value, a divider, then the drill-down hint.
 * Desktop prints the value as `item.value.toInt()`, so fractions truncate.
 *
 * The box sizes to its content with no cap, like desktop's `IntrinsicWidth`
 * inside a `Positioned` that sets only `left` and `top`: a long category name
 * (already cut to 15 characters on the axis) reads in full here, and the
 * label's ellipsis never applies. Positioning still assumes the 180×80 box.
 */
export function ChartTooltip({ label, value, color }: ChartTooltipProps) {
  const { t } = useTranslation();

  return (
    <div data-testid='chart-tooltip' className='flex w-max flex-col rounded-300 bg-surface-inverse p-3 shadow-tooltip'>
      <div className='flex min-w-0 items-center'>
        <ChartIndicatorDot color={color} />
        <span className='ml-2 min-w-0 truncate text-sm font-medium leading-5 text-text-inverse'>{label}</span>
        <span className='ml-3 shrink-0 text-sm leading-5 text-text-inverse'>{Math.trunc(value)}</span>
      </div>
      <div className='my-2 h-px shrink-0 bg-border-primary' />
      <span className='truncate text-xs leading-[18px] text-text-tertiary'>
        {t('chart.tooltip.clickToView', 'Click to view data')}
      </span>
    </div>
  );
}

/**
 * Top-left corner for a tooltip centered on `anchor` and lifted
 * `verticalGap` px above it, clamped 8px inside the chart (desktop's
 * `PositionedChartTooltip`).
 */
export function getChartTooltipPosition(
  anchor: { x: number; y: number },
  chartSize: { width: number; height: number },
  verticalGap = 20
): { left: number; top: number } {
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

  return {
    left: clamp(
      anchor.x - CHART_TOOLTIP_WIDTH / 2,
      CHART_TOOLTIP_EDGE_MARGIN,
      chartSize.width - CHART_TOOLTIP_WIDTH - CHART_TOOLTIP_EDGE_MARGIN
    ),
    top: clamp(
      anchor.y - CHART_TOOLTIP_HEIGHT / 2 - verticalGap,
      CHART_TOOLTIP_EDGE_MARGIN,
      chartSize.height - CHART_TOOLTIP_HEIGHT - CHART_TOOLTIP_EDGE_MARGIN
    ),
  };
}

interface PositionedChartTooltipProps extends ChartTooltipProps {
  anchor: { x: number; y: number };
  chartSize: { width: number; height: number };
  verticalGap?: number;
}

/**
 * Absolutely positioned {@link ChartTooltip}. Pointer events pass through so
 * the tooltip never steals hover from the element underneath it.
 */
export function PositionedChartTooltip({ anchor, chartSize, verticalGap, ...tooltip }: PositionedChartTooltipProps) {
  const { left, top } = getChartTooltipPosition(anchor, chartSize, verticalGap);

  return (
    <div className='pointer-events-none absolute z-10' style={{ left, top }}>
      <ChartTooltip {...tooltip} />
    </div>
  );
}

export default ChartTooltip;
