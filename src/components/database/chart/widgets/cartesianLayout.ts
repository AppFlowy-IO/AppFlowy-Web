import {
  CHART_AXIS_HEIGHT,
  CHART_DATA_LABEL_OFFSET,
  CHART_PLOT_TOP,
  computeBarWidth,
  computeHorizontalLabelWidth,
  computeXAxisHeight,
  fitCategoryLabels,
  TextMeasurer,
  thinLabelIndices,
  truncateToWidth,
} from '@/application/database-yjs/chart-scale';
import { ChartDataItem } from '@/application/database-yjs/chart.type';
import { DASHBOARD_CHART_GEOMETRY, DASHBOARD_TYPOGRAPHY } from '@/application/database-yjs/dashboard-geometry';

import type { CategoryAnchorRect, CategoryTickLabel } from './ChartAxisParts';

const { axis } = DASHBOARD_CHART_GEOMETRY;

/**
 * Right gutter of a horizontal bar chart per data label: the label's offset
 * from its bar end plus 2px, so the last glyph does not touch the frame edge.
 */
const HORIZONTAL_DATA_LABEL_GUTTER = CHART_DATA_LABEL_OFFSET + 2;

/** Room above the tallest mark: a data label's line when labels are on (WP10 §1.3). */
export function labelRoom(showDataLabels: boolean) {
  return showDataLabels ? DASHBOARD_TYPOGRAPHY.dataLabel.lineHeight : CHART_PLOT_TOP;
}

/**
 * What both cartesian layouts hand to their plot. Everything a tick, a data
 * label or an anchor needs is decided here, once per layout, so the Recharts
 * renderers only read it.
 */
interface CartesianLayout {
  /** Recharts margin top (the frame applies the card insets). */
  marginTop: number;
  plotLeft: number;
  plotTop: number;
  plotWidth: number;
  plotHeight: number;
  /** Extent of one category along the category axis. */
  slot: number;
  /** One entry per category: the label to draw, or `null` when it is thinned out. */
  ticks: Array<CategoryTickLabel | null>;
  /** One entry per category: the data label to draw, or `null` when it does not fit. `null` when labels are off. */
  dataLabels: Array<string | null> | null;
  barWidth: number;
  anchors: CategoryAnchorRect[];
}

export interface VerticalCartesianLayout extends CartesianLayout {
  /** The category labels are drawn at −45°. */
  rotated: boolean;
  xAxisHeight: number;
}

/**
 * The plot rectangle of a chart with categories along the bottom (vertical
 * bars, lines): the value axis column on the left, label room on top, the
 * fitted category axis under the plot.
 *
 * `dataLabelTexts` are the R-FORMAT `label` texts per category, or `null`
 * when data labels are off.
 */
export function layoutVerticalCartesian(
  data: readonly ChartDataItem[],
  size: { width: number; height: number },
  yAxisWidth: number,
  dataLabelTexts: readonly string[] | null,
  measure: TextMeasurer
): VerticalCartesianLayout {
  const marginTop = labelRoom(dataLabelTexts !== null);
  const plotWidth = Math.max(0, size.width - yAxisWidth);
  const count = Math.max(1, data.length);
  const slot = plotWidth / count;
  const widths = data.map((item) => measure(item.label));
  const fit = fitCategoryLabels(widths, slot);
  const rotated = fit.mode === 'rotated';
  const shown = new Set(fit.shown);
  const xAxisHeight = computeXAxisHeight(fit.mode, widths.length ? Math.max(...widths) : 0);
  const plotHeight = Math.max(0, size.height - marginTop - xAxisHeight);

  return {
    marginTop,
    plotLeft: yAxisWidth,
    plotTop: marginTop,
    plotWidth,
    plotHeight,
    slot,
    rotated,
    ticks: data.map((item, index) =>
      shown.has(index)
        ? { label: item.label, text: rotated ? truncateToWidth(item.label, axis.rotatedMaxLabel, measure) : item.label }
        : null
    ),
    // A label wider than its slot would run into its neighbours.
    dataLabels: dataLabelTexts ? dataLabelTexts.map((text) => (measure(text) > slot ? null : text)) : null,
    xAxisHeight,
    barWidth: computeBarWidth(plotWidth, data.length),
    anchors: data.map((item, index) => ({
      label: item.label,
      x: yAxisWidth + slot * index,
      y: marginTop,
      width: slot,
      height: plotHeight,
    })),
  };
}

export interface HorizontalCartesianLayout extends CartesianLayout {
  /** The data labels' gutter right of the plot. */
  marginRight: number;
  /** Width of the category column; labels are truncated to it. */
  labelColumn: number;
  /** The category column plus the gap to the plot. */
  yAxisWidth: number;
  valueAxisHeight: number;
}

/**
 * The plot rectangle of a horizontal bar chart: the category column on the
 * left (right-aligned labels, truncated to the column), the value axis under
 * the plot, and a right gutter for the data labels.
 *
 * `valueTickTexts` are the R-FORMAT `axis` texts of the value ticks;
 * `dataLabelTexts` the `label` texts per category, or `null` when off.
 */
export function layoutHorizontalCartesian(
  data: readonly ChartDataItem[],
  size: { width: number; height: number },
  valueTickTexts: readonly string[],
  dataLabelTexts: readonly string[] | null,
  measure: TextMeasurer
): HorizontalCartesianLayout {
  const labelColumn = computeHorizontalLabelWidth(
    data.map((item) => measure(item.label)),
    size.width
  );
  const yAxisWidth = labelColumn + axis.tickGap;
  const widestLabel = (dataLabelTexts ?? []).reduce((max, text) => Math.max(max, measure(text)), 0);
  const widestTick = valueTickTexts.reduce((max, text) => Math.max(max, measure(text)), 0);
  // The last tick is centred on the plot edge, so half of it must fit too.
  const marginRight = Math.ceil(
    Math.max(dataLabelTexts ? widestLabel + HORIZONTAL_DATA_LABEL_GUTTER : 0, widestTick / 2)
  );
  const plotWidth = Math.max(0, size.width - yAxisWidth - marginRight);
  const plotHeight = Math.max(0, size.height - CHART_PLOT_TOP - CHART_AXIS_HEIGHT);
  const slot = plotHeight / Math.max(1, data.length);
  const shown =
    slot < axis.minLabelSpacing
      ? new Set(thinLabelIndices(data.length, Math.ceil(axis.minLabelSpacing / slot)))
      : null;

  return {
    marginTop: CHART_PLOT_TOP,
    marginRight,
    plotLeft: yAxisWidth,
    plotTop: CHART_PLOT_TOP,
    plotWidth,
    plotHeight,
    slot,
    labelColumn,
    yAxisWidth,
    valueAxisHeight: CHART_AXIS_HEIGHT,
    ticks: data.map((item, index) =>
      shown === null || shown.has(index)
        ? { label: item.label, text: truncateToWidth(item.label, labelColumn, measure) }
        : null
    ),
    dataLabels: dataLabelTexts ? [...dataLabelTexts] : null,
    barWidth: computeBarWidth(plotHeight, data.length),
    anchors: data.map((item, index) => ({
      label: item.label,
      x: yAxisWidth,
      y: CHART_PLOT_TOP + slot * index,
      width: plotWidth,
      height: slot,
    })),
  };
}
