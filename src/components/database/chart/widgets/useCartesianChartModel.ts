import { useCallback, useMemo } from 'react';

import { isCountAggregation } from '@/application/database-yjs/chart-format';
import { computeValueDomain, computeYAxisWidth } from '@/application/database-yjs/chart-scale';
import { ChartDataItem, ChartType } from '@/application/database-yjs/chart.type';
import { useChartContext } from '@/components/database/chart/useChartContext';

import { useChartMeasure } from './measureText';
import { useChartA11yRows, useChartItemTooltip, useChartLegend } from './useChartFrameModels';
import { useChartHover } from './useChartHover';

/** The Recharts click state the drill-down reads. */
interface RechartsClickState {
  activeTooltipIndex?: number;
}

/**
 * Everything the three cartesian charts (vertical bars, horizontal bars,
 * lines) share: the value domain and its tick texts, the legend, the
 * accessibility rows, hover, the tooltip and the drill-down click. A chart
 * adds only its own plot.
 *
 * `series` is set by the line chart: its one series has a name and a color
 * of its own, which the legend and the tooltip swatch use instead of the
 * category colors.
 */
export function useCartesianChartModel(
  data: ChartDataItem[],
  chartType: ChartType,
  onItemClick: ((item: ChartDataItem) => void) | undefined,
  series?: { label: string; color: string }
) {
  const { style, format, effectiveAggregation } = useChartContext();
  const { measure12 } = useChartMeasure();
  const { hoveredIndex, pointer, clear, onChartMouseMove, frameHandlers } = useChartHover(data);

  // Counts are whole numbers, so their axis never shows a fractional tick.
  const integerOnly = isCountAggregation(effectiveAggregation);
  const domain = useMemo(
    () =>
      computeValueDomain(
        data.map((item) => item.value),
        integerOnly
      ),
    [data, integerOnly]
  );
  const formatAxis = useCallback((value: number) => format(value, 'axis'), [format]);
  const valueTickTexts = useMemo(() => domain.ticks.map(formatAxis), [domain, formatAxis]);
  const valueAxisWidth = useMemo(() => computeYAxisWidth(valueTickTexts, measure12), [valueTickTexts, measure12]);
  const dataLabelTexts = useMemo(
    () => (style.showDataLabels ? data.map((item) => format(item.value, 'label')) : null),
    [style.showDataLabels, data, format]
  );

  const seriesColor = series?.color;
  const legend = useChartLegend(chartType, style.legendPosition, data, series);
  const categoryRows = useChartA11yRows(data, format);
  // Every point of a single series takes the series color.
  const rows = useMemo(
    () => (seriesColor === undefined ? categoryRows : categoryRows.map((row) => ({ ...row, color: seriesColor }))),
    [categoryRows, seriesColor]
  );

  const hovered = hoveredIndex === null ? undefined : data[hoveredIndex];
  const tooltip = useChartItemTooltip(
    hovered,
    hovered ? format(hovered.value, 'tooltip') : undefined,
    seriesColor ?? hovered?.color,
    Boolean(onItemClick)
  );

  const handleClick = useCallback(
    (state: RechartsClickState | null) => {
      const index = state?.activeTooltipIndex;

      if (typeof index === 'number' && data[index]) onItemClick?.(data[index]);
    },
    [data, onItemClick]
  );

  return {
    legend,
    rows,
    tooltip,
    pointer,
    frameHandlers,
    valueTickTexts,
    dataLabelTexts,
    /**
     * The inputs every cartesian plot takes. Each keeps its identity until
     * what it describes changes, so a memoized plot renders when the data, the
     * size or the hover band changes, and not when the pointer moves.
     */
    plot: {
      data,
      domain,
      formatAxis,
      /** Whether a category is hovered; the plot shows its band only then. */
      hoverActive: hoveredIndex !== null,
      clickable: Boolean(onItemClick),
      onClick: handleClick,
      onMouseMove: onChartMouseMove,
      onMouseLeave: clear,
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
  /** R-FORMAT `label` text per category, or `null` when data labels are off. */
  dataLabelTexts: readonly string[] | null;
};
