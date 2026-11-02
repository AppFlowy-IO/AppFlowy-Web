import { useCallback, useMemo } from 'react';

import { isCountAggregation } from '@/application/database-yjs/chart-format';
import { computeValueDomain, computeYAxisWidth, ValueDomain } from '@/application/database-yjs/chart-scale';
import { ChartDataItem, ChartSeriesData, ChartType } from '@/application/database-yjs/chart.type';
import { ChartSeriesStyle, effectiveGroupStyle } from '@/components/database/chart/hooks/chartGroupBy';
import {
  ChartRechartsRow,
  ChartSeriesDataLabel,
  drawnSegmentCount,
  hasSeriesGroupBy,
  seriesDataLabels,
  toCategoryItems,
  toDrillItem,
  toRechartsRows,
  truncationCaptionCount,
  valueExtent,
} from '@/components/database/chart/hooks/chartSeries';
import { useChartContext } from '@/components/database/chart/useChartContext';

import { useChartMeasure } from './measureText';
import { useChartA11yRows, useChartItemTooltip, useSeriesChartLegend, useSeriesTooltip } from './useChartFrameModels';
import { useChartHover } from './useChartHover';

/** The Recharts click state the drill-down reads. */
interface RechartsClickState {
  activeTooltipIndex?: number;
}

/** What opens a Recharts tooltip (and its hover band): the pointer, or a tap in a mobile context. */
export type ChartTooltipTrigger = 'hover' | 'click';

/** A data label with its R-FORMAT `label` text. */
export interface SeriesDataLabel extends ChartSeriesDataLabel {
  text: string;
}

/** Percent bars run 0–100 with a tick every quarter (WP12 §2.3). */
const PERCENT_DOMAIN: ValueDomain = { ticks: [0, 25, 50, 75, 100], domain: [0, 100] };

/** Above this many drawn segments the bars appear without an entry animation (WP12 risk 4). */
export const SERIES_ANIMATION_SEGMENT_LIMIT = 500;

/**
 * The text a category's data labels measure with in the layout: the stack
 * total (or the negative total of a category with no positive one), the widest
 * grouped bar label, or `''` for a category without a label. `null` when the
 * chart draws no data labels.
 */
function layoutLabelTexts(labels: readonly SeriesDataLabel[], categoryCount: number, drawsLabels: boolean) {
  if (!drawsLabels) return null;
  const texts: string[] = Array.from({ length: categoryCount }, () => '');

  labels.forEach((label) => {
    const current = texts[label.categoryIndex] ?? '';
    const positiveTotal = label.series === null && label.side === 'positive';

    if (positiveTotal || current === '' || (label.series !== null && label.text.length > current.length)) {
      texts[label.categoryIndex] = label.text;
    }
  });
  return texts;
}

/**
 * Everything the three cartesian charts (vertical bars, horizontal bars,
 * lines) share: the series style, the value domain and its tick texts, the
 * data labels, the legend, the accessibility rows, hover, the tooltip and the
 * drill-down clicks. A chart adds only its own plot.
 *
 * `data` is the series build (WP12). Without a Group by it has one series,
 * and the category items carry the colours, the legend and the tooltip.
 * `lineSeries` is set by the line chart: its one series has a name and a
 * colour of its own, which the legend and the tooltip swatch use.
 */
export function useCartesianChartModel(
  data: ChartSeriesData,
  chartType: ChartType,
  onItemClick: ((item: ChartDataItem) => void) | undefined,
  lineSeries?: { label: string; color: string }
) {
  const { style, format, effectiveAggregation, paint, mobile } = useChartContext();
  const { measure12 } = useChartMeasure();
  const { hoveredIndex, pointer, leave, tap, onChartMouseMove, frameHandlers } = useChartHover(data, {
    mobile,
    chartType,
  });
  const hasGroupBy = hasSeriesGroupBy(data);
  const seriesStyle: ChartSeriesStyle = effectiveGroupStyle(chartType, hasGroupBy, style.groupStyle);
  const items = useMemo(() => toCategoryItems(data, paint), [data, paint]);
  const rows = useMemo<ChartRechartsRow[]>(() => toRechartsRows(data, seriesStyle), [data, seriesStyle]);

  // Counts are whole numbers, so their axis never shows a fractional tick.
  const integerOnly = isCountAggregation(effectiveAggregation);
  const domain = useMemo(() => {
    if (seriesStyle === 'percent') return PERCENT_DOMAIN;
    const extent = valueExtent(data, chartType, seriesStyle);

    return computeValueDomain([extent.min, extent.max], integerOnly);
  }, [data, chartType, seriesStyle, integerOnly]);
  const formatAxis = useCallback(
    (value: number) => (seriesStyle === 'percent' ? `${value}%` : format(value, 'axis')),
    [format, seriesStyle]
  );
  const valueTickTexts = useMemo(() => domain.ticks.map(formatAxis), [domain, formatAxis]);
  const valueAxisWidth = useMemo(() => computeYAxisWidth(valueTickTexts, measure12), [valueTickTexts, measure12]);
  const labels = useMemo<SeriesDataLabel[]>(
    () =>
      seriesDataLabels(data, chartType, seriesStyle, style.showDataLabels).map((label) => ({
        ...label,
        text: format(label.value, 'label'),
      })),
    [data, chartType, seriesStyle, style.showDataLabels, format]
  );
  // Percent bars and lines with several series draw no data labels, so they keep no room for them.
  const drawsLabels =
    style.showDataLabels && seriesStyle !== 'percent' && !(chartType === ChartType.Line && data.series.length > 1);
  const dataLabelTexts = useMemo(
    () => layoutLabelTexts(labels, data.categories.length, drawsLabels),
    [labels, data.categories.length, drawsLabels]
  );

  const seriesColor = lineSeries?.color;
  const legend = useSeriesChartLegend(chartType, style.legendPosition, data, hasGroupBy, paint, items, lineSeries);
  const categoryRows = useChartA11yRows(items, format);
  // Every point of a single line takes the series color.
  const a11yRows = useMemo(
    () =>
      seriesColor === undefined || hasGroupBy ? categoryRows : categoryRows.map((row) => ({ ...row, color: seriesColor })),
    [categoryRows, seriesColor, hasGroupBy]
  );

  const hovered = hoveredIndex === null || hasGroupBy ? undefined : items[hoveredIndex];
  const singleTooltip = useChartItemTooltip(
    hovered,
    hovered ? format(hovered.value, 'tooltip') : undefined,
    seriesColor ?? hovered?.color,
    Boolean(onItemClick),
    mobile
  );
  const seriesTooltip = useSeriesTooltip(
    data,
    hasGroupBy ? hoveredIndex : null,
    seriesStyle,
    format,
    paint,
    Boolean(onItemClick),
    mobile
  );

  /**
   * A tap on category `categoryIndex` (`resolveChartTap`): a desktop click
   * drills at once; in a mobile context the first tap shows the category's
   * tooltip and a second tap on it drills into `seriesIndex`'s cell, or the
   * whole category for `null`.
   */
  const tapCategory = useCallback(
    (categoryIndex: number | undefined, seriesIndex: number | null, event: unknown) => {
      const category = typeof categoryIndex === 'number' ? data.categories[categoryIndex] : undefined;

      tap(category && categoryIndex !== undefined ? { index: categoryIndex, key: category.key } : null, event, () => {
        if (!onItemClick || categoryIndex === undefined) return;
        const item = toDrillItem(data, { categoryIndex, seriesIndex }, paint);

        if (item) onItemClick(item);
      });
    },
    [data, onItemClick, paint, tap]
  );
  // A click in the category band outside any segment opens the whole category (WP12 §2.10).
  const handleClick = useCallback(
    (state: RechartsClickState | null, event?: unknown) => tapCategory(state?.activeTooltipIndex, null, event),
    [tapCategory]
  );
  // A segment (or a line point) opens its cell: the category and the series.
  const handleSegmentClick = useCallback(
    (categoryIndex: number, seriesIndex: number, event?: unknown) => tapCategory(categoryIndex, seriesIndex, event),
    [tapCategory]
  );
  // The fill of each series: its colour with a Group by, the line colour of a single line.
  const fills = useMemo(
    () => data.series.map((entry) => (hasGroupBy ? paint(entry.color) ?? '' : seriesColor ?? '')),
    [data, hasGroupBy, paint, seriesColor]
  );
  const categoryFills = useMemo(() => items.map((item) => item.color), [items]);
  const formatValue = useCallback((value: number) => format(value, 'tooltip'), [format]);

  return {
    legend,
    rows: a11yRows,
    tooltip: hasGroupBy ? seriesTooltip : singleTooltip,
    pointer,
    frameHandlers,
    valueTickTexts,
    dataLabelTexts,
    truncationCount: truncationCaptionCount(data),
    rootAttributes: {
      'data-group-style': seriesStyle,
      'data-series-count': data.series.length,
    } as Record<`data-${string}`, string | number>,
    /**
     * The inputs every cartesian plot takes. Each keeps its identity until
     * what it describes changes, so a memoized plot renders when the data, the
     * size or the hover band changes, and not when the pointer moves.
     */
    plot: {
      data,
      /** One item per category (label, total, colour): the layout and single-series fills read them. */
      items,
      /** One Recharts row per category: `s{j}` values and `p{j}` shares. */
      chartRows: rows,
      seriesStyle,
      fills,
      categoryFills,
      formatValue,
      labels,
      domain,
      formatAxis,
      /** Whether a category is hovered (on mobile: selected by a tap); the plot shows its band only then. */
      hoverActive: hoveredIndex !== null,
      /** A mobile chart moves its band on taps, not on pointer moves. */
      tooltipTrigger: (mobile ? 'click' : 'hover') as ChartTooltipTrigger,
      clickable: Boolean(onItemClick),
      animate: drawnSegmentCount(data) <= SERIES_ANIMATION_SEGMENT_LIMIT,
      onClick: handleClick,
      onSegmentClick: handleSegmentClick,
      onMouseMove: onChartMouseMove,
      onMouseLeave: leave,
    },
    /** Width of the value-axis column of a chart whose values run up the left edge. */
    valueAxisWidth,
  };
}

export type CartesianChartModel = ReturnType<typeof useCartesianChartModel>;

/** What a cartesian plot gets: the shared model inputs and the size of its frame. */
export type CartesianPlotProps = CartesianChartModel['plot'] & {
  width: number;
  height: number;
  /** The text each category's data labels measure with, or `null` when the chart draws none. */
  dataLabelTexts: readonly string[] | null;
};
