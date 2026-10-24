import { TFunction } from 'i18next';

import { CHART_AGGREGATION_META } from '@/application/database-yjs/chart-config';
import { ChartAggregationType, CHART_NUMBER_COLOR_VARS, ChartNumberColor } from '@/application/database-yjs/chart.type';

/** The label of an aggregation 0–16 (WP11 §1.14): 6 is "Count unique values", 7 "Count values". */
export function getChartAggregationLabel(t: TFunction, aggregation: number): string {
  const meta = CHART_AGGREGATION_META[aggregation];

  return meta ? t(meta.labelKey, { defaultValue: meta.fallback }) : '';
}

export interface ChartSeriesTitleOptions {
  /** The effective aggregation (`effectiveChartAggregation`): Count when the chart counts rows. */
  aggregation: ChartAggregationType;
  yFieldName: string;
}

/**
 * The generated name of what a chart shows (the auto caption): "Count all"
 * for a row count, "<aggregation> of <field>" otherwise ("Sum of Estimate",
 * "Percent checked of Urgent"). It titles the Number chart (unless a custom
 * title is set) and names the line chart's series.
 */
export function getChartSeriesTitle(t: TFunction, { aggregation, yFieldName }: ChartSeriesTitleOptions): string {
  if (aggregation === ChartAggregationType.Count) {
    return t('chart.agg.countAll', { defaultValue: 'Count all' });
  }

  return t('chart.number.titleOf', {
    defaultValue: '{{aggregation}} of {{field}}',
    aggregation: getChartAggregationLabel(t, aggregation),
    field: yFieldName || t('grid.field.untitled', { defaultValue: 'Untitled' }),
  });
}

/** The Number chart's title: the custom title when one is set, otherwise the generated one. */
export function getNumberChartTitle(t: TFunction, options: ChartSeriesTitleOptions & { titleText?: string }): string {
  return options.titleText?.trim() || getChartSeriesTitle(t, options);
}

/** The CSS color of a Number card value (`--chart-number-*`, switching with the theme); unknown names are default. */
export function numberColorVar(color: ChartNumberColor | string | null | undefined): string {
  return (color && CHART_NUMBER_COLOR_VARS[color as ChartNumberColor]) || CHART_NUMBER_COLOR_VARS.default;
}
