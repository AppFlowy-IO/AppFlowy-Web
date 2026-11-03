import { useMemo } from 'react';

import { ChartLegendPosition } from '@/application/database-yjs/chart-extended-settings';
import { ChartValueFormatter, formatShare } from '@/application/database-yjs/chart-format';
import { resolveLegend } from '@/application/database-yjs/chart-scale';
import { ChartDataItem, ChartSeriesData, ChartType } from '@/application/database-yjs/chart.type';
import { ChartSeriesStyle } from '@/components/database/chart/hooks/chartGroupBy';
import { ChartColorPainter, seriesTooltipRows } from '@/components/database/chart/hooks/chartSeries';

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
 * The tooltip of the hovered (on mobile: tapped) category: one row with its
 * swatch, name and `valueText`, and the drill-down hint when a click (on
 * mobile: a second tap) opens the rows. The same object comes back while the
 * hovered category is the same, so the tooltip neither renders nor is
 * measured again while the pointer moves inside it.
 */
export function useChartItemTooltip(
  item: ChartDataItem | undefined,
  valueText: string | undefined,
  color: string | undefined,
  showDrilldownHint: boolean,
  mobile = false
): ChartFrameTooltip | null {
  const name = item?.label;

  return useMemo(
    () =>
      name === undefined || valueText === undefined
        ? null
        : { category: name, rows: [{ color, name, value: valueText }], showDrilldownHint, mobile },
    [name, valueText, color, showDrilldownHint, mobile]
  );
}

/**
 * The legend of a chart with a Group by (WP12 §2.7): its series in series
 * order, "No {field}" included, when `resolveLegend` shows one for that many
 * series. Without a Group by, `useChartLegend`'s categories or line series.
 */
export function useSeriesChartLegend(
  chartType: ChartType,
  position: ChartLegendPosition,
  data: ChartSeriesData,
  hasGroupBy: boolean,
  paint: ChartColorPainter,
  categories: readonly ChartDataItem[],
  series?: { label: string; color: string }
): { items: ChartLegendItem[]; glyph: ChartLegendGlyph } | null {
  const single = useChartLegend(chartType, position, categories, series);

  return useMemo(() => {
    if (!hasGroupBy) return single;
    const resolved = resolveLegend(chartType, data.series.length, position);

    if (!resolved) return null;
    return {
      glyph: resolved.glyph,
      items: data.series.map((entry) => ({
        key: entry.key,
        seriesKey: entry.key,
        label: entry.label,
        color: paint(entry.color) ?? '',
      })),
    };
  }, [hasGroupBy, single, chartType, data, position, paint]);
}

/**
 * The tooltip of the hovered category of a chart with a Group by (WP12 §2.8):
 * the category as the title, one row per series with a value (percent bars
 * print `{share} ({value})`), "+{n} more" after ten rows. The same object
 * comes back while the hovered category is the same.
 */
export function useSeriesTooltip(
  data: ChartSeriesData,
  hoveredIndex: number | null,
  style: ChartSeriesStyle,
  format: ChartValueFormatter,
  paint: ChartColorPainter,
  showDrilldownHint: boolean,
  mobile = false
): ChartFrameTooltip | null {
  return useMemo(() => {
    const category = hoveredIndex === null ? undefined : data.categories[hoveredIndex];

    if (hoveredIndex === null || !category) return null;
    const { rows, more } = seriesTooltipRows(data, hoveredIndex, style);

    return {
      title: category.label,
      category: category.label,
      rows: rows.map((row) => ({
        color: paint(row.color),
        name: row.label,
        seriesKey: row.series,
        value:
          row.percent === undefined
            ? format(row.value, 'tooltip')
            : `${formatShare(row.percent, 100)} (${format(row.value, 'tooltip')})`,
      })),
      more,
      showDrilldownHint,
      mobile,
    };
  }, [data, hoveredIndex, style, format, paint, showDrilldownHint, mobile]);
}
