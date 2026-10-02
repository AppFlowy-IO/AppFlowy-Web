import { ChartDataItem } from '@/application/database-yjs/chart.type';
import {
  CategoryLabelFit,
  computeBarWidth,
  computeXAxisHeight,
  fitCategoryLabels,
  TextMeasurer,
} from '@/application/database-yjs/chart-scale';

import { CategoryAnchorRect } from './ChartAxisParts';
import { chartItemKey } from './chartUtils';

/** Room above the tallest mark: a data label's height when labels are on (WP10 §1.3). */
export function labelRoom(showDataLabels: boolean) {
  return showDataLabels ? 16 : 4;
}

export interface VerticalCartesianLayout {
  /** Recharts margin top (the frame applies the card insets). */
  marginTop: number;
  plotLeft: number;
  plotTop: number;
  plotWidth: number;
  plotHeight: number;
  /** Width of one category. */
  slot: number;
  fit: CategoryLabelFit;
  xAxisHeight: number;
  barWidth: number;
  labels: Map<string, string>;
  anchors: CategoryAnchorRect[];
}

/**
 * The plot rectangle of a chart with categories along the bottom (vertical
 * bars, lines): the value axis column on the left, label room on top, the
 * fitted category axis under the plot.
 */
export function layoutVerticalCartesian(
  data: readonly ChartDataItem[],
  size: { width: number; height: number },
  yAxisWidth: number,
  showDataLabels: boolean,
  measure: TextMeasurer
): VerticalCartesianLayout {
  const marginTop = labelRoom(showDataLabels);
  const plotWidth = Math.max(0, size.width - yAxisWidth);
  const count = Math.max(1, data.length);
  const slot = plotWidth / count;
  const widths = data.map((item) => measure(item.label));
  const fit = fitCategoryLabels(widths, slot);
  const xAxisHeight = computeXAxisHeight(fit.mode, widths.length ? Math.max(...widths) : 0);
  const plotHeight = Math.max(0, size.height - marginTop - xAxisHeight);

  return {
    marginTop,
    plotLeft: yAxisWidth,
    plotTop: marginTop,
    plotWidth,
    plotHeight,
    slot,
    fit,
    xAxisHeight,
    barWidth: computeBarWidth(plotWidth, data.length),
    labels: new Map(data.map((item) => [chartItemKey(item), item.label])),
    anchors: data.map((item, index) => ({
      label: item.label,
      x: yAxisWidth + slot * index,
      y: marginTop,
      width: slot,
      height: plotHeight,
    })),
  };
}
