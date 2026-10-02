import { TFunction } from 'i18next';

import { ChartAggregationType, ChartNumberFormat } from '@/application/database-yjs/chart.type';
import { formatChartValue } from '@/application/database-yjs/chart-format';
import { NumberFormat } from '@/application/database-yjs/fields';

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

export interface FormatNumberChartValueOptions {
  numberFormat: ChartNumberFormat;
  aggregationType: ChartAggregationType;
  /** Number format of the Y field when it is a Number field */
  fieldNumberFormat?: NumberFormat | null;
  /** `decimal_places`; null / absent is auto. */
  decimalPlaces?: number | null;
  /** The chart locale (`resolveChartLocale`); US English by default. */
  locale?: string;
}

/**
 * Format the Number chart value: R-FORMAT in `card` mode (WP10 §1.2).
 *
 * - `percent` treats the value as a ratio (0.25 → "25%").
 * - `compact` abbreviates from 1,000 on ("12.3K", "$1.5M" for a currency).
 * - `auto` follows the Y field's number format for value aggregations;
 *   counts are whole numbers, and values of 1,000 or more drop their decimals.
 */
export function formatNumberChartValue(
  value: number,
  { numberFormat, aggregationType, fieldNumberFormat, decimalPlaces, locale = 'en-US' }: FormatNumberChartValueOptions
): string {
  return formatChartValue(value, {
    aggregation: aggregationType,
    yField:
      fieldNumberFormat === null || fieldNumberFormat === undefined
        ? null
        : { type: 'number', numberFormat: fieldNumberFormat },
    mode: 'card',
    numberFormat,
    decimalPlaces,
    locale,
  });
}

export interface NumberChartTitleOptions {
  titleText?: string;
  aggregationType: ChartAggregationType;
  yFieldName: string;
  hasYField: boolean;
}

/**
 * Custom title when set, otherwise "Count all" for counts (or when the Y field
 * is missing) and "<aggregation> of <field>" for value aggregations.
 */
export function getNumberChartTitle(
  t: TFunction,
  { titleText, aggregationType, yFieldName, hasYField }: NumberChartTitleOptions
): string {
  const custom = titleText?.trim();

  if (custom) return custom;

  if (aggregationType === ChartAggregationType.Count || !hasYField) {
    return t('chart.number.countAll', { defaultValue: 'Count all' });
  }

  const label = CHART_AGGREGATION_LABELS.find((item) => item.type === aggregationType);
  const aggregation = label ? t(label.labelKey, { defaultValue: label.fallback }) : '';

  return t('chart.number.titleOf', {
    defaultValue: '{{aggregation}} of {{field}}',
    aggregation,
    field: yFieldName || t('grid.field.untitled', { defaultValue: 'Untitled' }),
  });
}
