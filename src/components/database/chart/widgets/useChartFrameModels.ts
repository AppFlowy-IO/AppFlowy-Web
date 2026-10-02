import { useMemo } from 'react';

import { ChartLegendPosition } from '@/application/database-yjs/chart-extended-settings';
import { ChartValueMode } from '@/application/database-yjs/chart-format';
import { resolveLegend } from '@/application/database-yjs/chart-scale';
import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { ChartA11yRow } from './ChartA11yTable';
import { ChartLegendGlyph, ChartLegendItem } from './ChartLegend';
import { chartItemKey } from './chartUtils';

export type ChartFormat = (value: number, mode: ChartValueMode) => string;

/**
 * The legend a chart shows for `legend_position` (WP10 §1.5): its categories
 * (donut, single-series bars) or its one series (lines, labelled with
 * `seriesLabel` in `seriesColor`), or none.
 */
export function useChartLegend(
  chartType: number,
  position: ChartLegendPosition,
  data: readonly ChartDataItem[],
  series?: { label: string; color: string }
): { items: ChartLegendItem[]; glyph: ChartLegendGlyph } | null {
  const resolved = resolveLegend(chartType, 1, position);
  const content = resolved?.content ?? null;
  const glyph = resolved?.glyph ?? 'square';
  const seriesLabel = series?.label;
  const seriesColor = series?.color;

  return useMemo(() => {
    if (!content) return null;
    if (content === 'series') {
      return { glyph, items: [{ key: 'series-0', label: seriesLabel ?? '', color: seriesColor ?? '' }] };
    }

    return {
      glyph,
      items: data.map((item) => ({ key: chartItemKey(item), label: item.label, color: item.color ?? '' })),
    };
  }, [content, glyph, data, seriesLabel, seriesColor]);
}

/** The accessibility table rows: raw values, tooltip text and colors per category. */
export function useChartA11yRows(data: readonly ChartDataItem[], format: ChartFormat): ChartA11yRow[] {
  return useMemo(
    () =>
      data.map((item) => ({
        key: chartItemKey(item),
        label: item.label,
        value: item.value,
        valueText: format(item.value, 'tooltip'),
        color: item.color,
      })),
    [data, format]
  );
}
