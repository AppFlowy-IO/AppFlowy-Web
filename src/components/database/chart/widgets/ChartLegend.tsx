import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CHART_LEGEND_GLYPH_GAP,
  CHART_LEGEND_PADDING_TOP,
  CHART_LEGEND_PAGER_GAP,
  CHART_LEGEND_PAGER_HEIGHT,
  legendItemWidth,
  LegendPagination,
  paginateLegend,
  TextMeasurer,
} from '@/application/database-yjs/chart-scale';
import { DASHBOARD_CHART_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down_small.svg';
import { ReactComponent as ArrowUpIcon } from '@/assets/icons/alt_arrow_up_small.svg';
import { cn } from '@/lib/utils';

export interface ChartLegendItem {
  key: string;
  label: string;
  color: string;
  /** A Group by series (WP12): the legend lists the series then. */
  seriesKey?: string;
}

export type ChartLegendGlyph = 'square' | 'line';

const { legend } = DASHBOARD_CHART_GEOMETRY;

/** Lays a legend out for `width`: which items each page shows and how tall it is. */
export function layoutChartLegend(
  items: readonly ChartLegendItem[],
  glyph: ChartLegendGlyph,
  width: number,
  measure: TextMeasurer
): LegendPagination {
  return paginateLegend(
    items.map((item) => legendItemWidth(measure(item.label), glyph)),
    width
  );
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  glyph: ChartLegendGlyph;
  layout: LegendPagination;
}

/**
 * The legend under a chart (spec §8.6): an 8×8 swatch (a 12×2 line for line
 * series) and the label per item, centred and wrapped, paged as `▲ n/N ▼`
 * when it needs more than two lines. Display-only: items do not open the
 * drill-down.
 */
export function ChartLegend({ items, glyph, layout }: ChartLegendProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const pageCount = layout.pages.length;
  const current = Math.min(page, Math.max(0, pageCount - 1));

  // A resize can change the pages; never point past the last one. The state
  // is adjusted while rendering (no extra commit) and kept, so the legend does
  // not jump back to the old page when the chart widens again.
  if (page > 0 && page >= pageCount) setPage(Math.max(0, pageCount - 1));

  if (pageCount === 0) return null;
  const swatch =
    glyph === 'line'
      ? { width: legend.lineGlyph[0], height: legend.lineGlyph[1], borderRadius: 1 }
      : { width: legend.swatch, height: legend.swatch, borderRadius: legend.swatchRadius };

  return (
    <div
      className='flex w-full shrink-0 flex-col items-center overflow-hidden'
      data-glyph={glyph}
      data-testid='chart-legend'
      // The same values `computeLegendHeight` reserved room with.
      style={{ height: layout.height, paddingTop: CHART_LEGEND_PADDING_TOP, gap: CHART_LEGEND_PAGER_GAP }}
    >
      <div
        className='flex max-w-full flex-wrap content-start justify-center'
        style={{ columnGap: legend.gapX, rowGap: legend.gapY }}
      >
        {layout.pages[current].map((index) => {
          const item = items[index];

          if (!item) return null;
          return (
            <div
              className='flex min-w-0 items-center'
              data-label={item.label}
              data-series-key={item.seriesKey}
              data-testid='chart-legend-item'
              key={item.key}
              style={{ gap: CHART_LEGEND_GLYPH_GAP, height: legend.lineHeight }}
            >
              <span
                className='shrink-0'
                data-parity-id='dash-chart-legend-swatch'
                data-testid='chart-legend-swatch'
                style={{ ...swatch, backgroundColor: item.color }}
              />
              <span className='truncate text-xs text-text-secondary' style={{ maxWidth: legend.maxLabelWidth }}>
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
      {pageCount > 1 ? (
        <div
          className='flex items-center gap-1 text-xs text-text-secondary'
          data-testid='chart-legend-pager'
          style={{ height: CHART_LEGEND_PAGER_HEIGHT }}
        >
          <button
            aria-label={t('chart.legend.previousPage', { defaultValue: 'Previous page' })}
            className={cn('flex h-4 w-4 items-center justify-center', current === 0 ? 'text-text-tertiary' : 'text-text-secondary')}
            data-testid='chart-legend-prev'
            disabled={current === 0}
            onClick={() => setPage(Math.max(0, current - 1))}
            type='button'
          >
            <ArrowUpIcon className='h-4 w-4' />
          </button>
          <span className='tabular-nums' data-testid='chart-legend-page'>
            {t('chart.legend.page', { page: current + 1, count: pageCount, defaultValue: `${current + 1}/${pageCount}` })}
          </span>
          <button
            aria-label={t('chart.legend.nextPage', { defaultValue: 'Next page' })}
            className={cn(
              'flex h-4 w-4 items-center justify-center',
              current >= pageCount - 1 ? 'text-text-tertiary' : 'text-text-secondary'
            )}
            data-testid='chart-legend-next'
            disabled={current >= pageCount - 1}
            onClick={() => setPage(Math.min(pageCount - 1, current + 1))}
            type='button'
          >
            <ArrowDownIcon className='h-4 w-4' />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default ChartLegend;
