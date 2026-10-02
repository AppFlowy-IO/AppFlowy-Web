import { HTMLAttributes, ReactNode, Ref, useMemo } from 'react';

import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { useElementSize } from '@/components/database/chart/hooks/useElementSize';
import { cn } from '@/lib/utils';

import { ChartA11yRow, ChartA11yTable } from './ChartA11yTable';
import { ChartLegend, ChartLegendGlyph, ChartLegendItem, layoutChartLegend } from './ChartLegend';
import { ChartTooltip, ChartTooltipRow } from './ChartTooltip';
import { ChartTooltipLayer } from './ChartTooltipLayer';
import { useChartMeasure } from './measureText';

/** Charts render nothing in a frame smaller than this (px). */
const MIN_PLOT_SIZE = 40;

/** Today's height of a standalone (page or document block) chart. */
export const STANDALONE_CHART_HEIGHT = 400;

export interface ChartFrameTooltip {
  clientX: number;
  clientY: number;
  title?: string;
  rows: ChartTooltipRow[];
  showDrilldownHint: boolean;
}

export interface ChartFrameProps {
  testId: string;
  /** Dashboard widget: fill the card with the `chart.insetWidget` insets. Otherwise a fixed-height standalone chart. */
  fill: boolean;
  standaloneHeight?: number;
  /** Standalone horizontal bars: the plot is this tall and scrolls inside the frame. */
  scrollContentHeight?: number;
  legend?: { items: ChartLegendItem[]; glyph: ChartLegendGlyph } | null;
  /** The accessibility table rows. */
  rows: ChartA11yRow[];
  tooltip?: ChartFrameTooltip | null;
  /** `useChartHover`'s frame handlers, with the ref it reads the frame through. */
  frameHandlers?: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> };
  /** `height` is the plot's; `legendHeight` is reserved below it. */
  children: (size: { width: number; height: number; legendHeight: number }) => ReactNode;
}

/**
 * The box every chart draws in (WP10 §1.8, §3.3). In a dashboard widget it
 * fills the card, inset from the card edge by `chart.insetWidget` (these
 * insets replace the widget's 12/12 content padding, they do not add to it);
 * standalone it keeps today's fixed height. It measures itself, reserves the
 * legend at the bottom, hands the rest to the plot, and renders the
 * accessibility table and the tooltip layer.
 */
export function ChartFrame({
  testId,
  fill,
  standaloneHeight = STANDALONE_CHART_HEIGHT,
  scrollContentHeight,
  legend,
  rows,
  tooltip,
  frameHandlers,
  children,
}: ChartFrameProps) {
  const { measure12 } = useChartMeasure();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const legendLayout = useMemo(
    () => (legend && legend.items.length > 0 ? layoutChartLegend(legend.items, legend.glyph, size.width, measure12) : null),
    [legend, size.width, measure12]
  );
  const legendHeight = legendLayout?.height ?? 0;
  const plotHeight = Math.max(0, size.height - legendHeight);
  const ready = size.width >= MIN_PLOT_SIZE && plotHeight >= MIN_PLOT_SIZE;
  const inset = DASHBOARD_CHART_GEOMETRY.insetWidget;

  return (
    <div
      {...frameHandlers}
      className={cn('relative flex w-full flex-col', fill && 'h-full min-h-0 flex-1')}
      data-fill={fill ? 'true' : 'false'}
      data-testid={testId}
      style={
        fill
          ? { padding: `${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px` }
          : { height: standaloneHeight }
      }
    >
      <div className='relative flex min-h-0 w-full flex-1 flex-col overflow-hidden' data-testid='chart-frame' ref={ref}>
        <div
          className={cn(
            'relative w-full shrink-0',
            scrollContentHeight !== undefined && !fill ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
          )}
          data-testid='chart-plot-area'
          style={{ height: plotHeight }}
        >
          {ready ? children({ width: size.width, height: scrollContentHeight ?? plotHeight, legendHeight }) : null}
        </div>
        {legend && legendLayout && ready ? (
          <ChartLegend glyph={legend.glyph} items={legend.items} layout={legendLayout} />
        ) : null}
      </div>
      <ChartA11yTable rows={rows} />
      <ChartTooltipLayer position={tooltip ? { clientX: tooltip.clientX, clientY: tooltip.clientY } : null}>
        {tooltip ? (
          <ChartTooltip rows={tooltip.rows} showDrilldownHint={tooltip.showDrilldownHint} title={tooltip.title} />
        ) : null}
      </ChartTooltipLayer>
    </div>
  );
}

export default ChartFrame;
