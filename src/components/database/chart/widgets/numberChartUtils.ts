import { TFunction } from 'i18next';

import { ChartAggregationType } from '@/application/database-yjs/chart.type';

/**
 * Translation keys for every aggregation, shared by the Number chart title and
 * the chart settings menu. Order matches desktop's `_buildAggregationItems`.
 */
export const CHART_AGGREGATION_LABELS: ReadonlyArray<{
  type: ChartAggregationType;
  labelKey: string;
  fallback: string;
}> = [
  { type: ChartAggregationType.Count, labelKey: 'chart.tooltip.count', fallback: 'Count' },
  { type: ChartAggregationType.CountValues, labelKey: 'chart.tooltip.countValues', fallback: 'Count values' },
  { type: ChartAggregationType.Sum, labelKey: 'chart.tooltip.sum', fallback: 'Sum' },
  { type: ChartAggregationType.Average, labelKey: 'chart.tooltip.average', fallback: 'Average' },
  { type: ChartAggregationType.Min, labelKey: 'chart.tooltip.min', fallback: 'Min' },
  { type: ChartAggregationType.Max, labelKey: 'chart.tooltip.max', fallback: 'Max' },
  { type: ChartAggregationType.Median, labelKey: 'chart.tooltip.median', fallback: 'Median' },
];

export interface ChartSeriesTitleOptions {
  /** The effective aggregation (`resolveEffectiveAggregation`): Count when the chart counts rows. */
  aggregation: ChartAggregationType;
  yFieldName: string;
}

/**
 * The generated name of what a chart shows: "Count all" for a row count,
 * "<aggregation> of <field>" for a value aggregation. It titles the Number
 * chart (unless a custom title is set) and names the line chart's series.
 */
export function getChartSeriesTitle(t: TFunction, { aggregation, yFieldName }: ChartSeriesTitleOptions): string {
  if (aggregation === ChartAggregationType.Count) {
    return t('chart.number.countAll', { defaultValue: 'Count all' });
  }

  const label = CHART_AGGREGATION_LABELS.find((item) => item.type === aggregation);

  return t('chart.number.titleOf', {
    defaultValue: '{{aggregation}} of {{field}}',
    aggregation: label ? t(label.labelKey, { defaultValue: label.fallback }) : '',
    field: yFieldName || t('grid.field.untitled', { defaultValue: 'Untitled' }),
  });
}

/** The Number chart's title: the custom title when one is set, otherwise the generated one. */
export function getNumberChartTitle(t: TFunction, options: ChartSeriesTitleOptions & { titleText?: string }): string {
  return options.titleText?.trim() || getChartSeriesTitle(t, options);
}
