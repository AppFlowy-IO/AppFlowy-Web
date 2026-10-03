import { useMemo } from 'react';

import { ChartLegendPosition } from '@/application/database-yjs/chart-extended-settings';
import { ChartValueFormatter } from '@/application/database-yjs/chart-format';
import { resolveLegend } from '@/application/database-yjs/chart-scale';
import { ChartDataItem, ChartType } from '@/application/database-yjs/chart.type';

import { ChartA11yRow } from './ChartA11yTable';
import { ChartFrameTooltip } from './ChartFrame';
import { ChartLegendGlyph, ChartLegendItem } from './ChartLegend';
import { chartItemKey } from './chartUtils';

/**
 * The legend a chart shows for `legend_position` (WP10 §1.5): its categories
 * (donut, single-series bars) or its one series (lines, labelled with
 * `seriesLabel` in `seriesColor`), or none.
 */
export function useChartLegend(
  chartType: ChartType,
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
export function useChartA11yRows(data: readonly ChartDataItem[], format: ChartValueFormatter): ChartA11yRow[] {
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

/**
 * The tooltip of the hovered category: one row with its swatch, name and
 * `valueText`, and the drill-down hint when a click opens the rows. The same
 * object comes back while the hovered category is the same, so the tooltip
 * neither renders nor is measured again while the pointer moves inside it.
 */
export function useChartItemTooltip(
  item: ChartDataItem | undefined,
  valueText: string | undefined,
  color: string | undefined,
  showDrilldownHint: boolean
): ChartFrameTooltip | null {
  const name = item?.label;

  return useMemo(
    () =>
      name === undefined || valueText === undefined
        ? null
        : { rows: [{ color, name, value: valueText }], showDrilldownHint },
    [name, valueText, color, showDrilldownHint]
  );
}
