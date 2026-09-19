import { TFunction } from 'i18next';

import { ChartAggregationType, ChartNumberFormat } from '@/application/database-yjs/chart.type';
import { currencyFormaterMap, NumberFormat } from '@/application/database-yjs/fields';

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

const MAX_FRACTION_DIGITS = 2;

function isCountLike(aggregationType: ChartAggregationType): boolean {
  return aggregationType === ChartAggregationType.Count || aggregationType === ChartAggregationType.CountValues;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;

  return Math.round(value * factor) / factor;
}

export interface FormatNumberChartValueOptions {
  numberFormat: ChartNumberFormat;
  aggregationType: ChartAggregationType;
  /** Number format of the Y field when it is a Number field */
  fieldNumberFormat?: NumberFormat | null;
}

/**
 * Format the Number chart value.
 *
 * - `percent` treats the value as a ratio (0.25 → "25%").
 * - `compact` uses abbreviated notation ("1.2K").
 * - `auto` follows the Y field's number format (currency / percent) for value
 *   aggregations; counts and non-Number fields use a grouped decimal.
 */
// Built once: `Intl.NumberFormat` construction is far costlier than `format`.
const PERCENT_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: MAX_FRACTION_DIGITS,
});
const COMPACT_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const DECIMAL_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: MAX_FRACTION_DIGITS,
  useGrouping: true,
});

export function formatNumberChartValue(
  value: number,
  { numberFormat, aggregationType, fieldNumberFormat }: FormatNumberChartValueOptions
): string {
  if (!Number.isFinite(value)) return '0';

  switch (numberFormat) {
    case 'percent':
      return PERCENT_FORMATTER.format(value);

    case 'compact':
      return COMPACT_FORMATTER.format(value);

    case 'auto':
    default: {
      if (
        !isCountLike(aggregationType) &&
        fieldNumberFormat !== null &&
        fieldNumberFormat !== undefined &&
        fieldNumberFormat !== NumberFormat.Num &&
        currencyFormaterMap[fieldNumberFormat]
      ) {
        // The field formatter rounds (after scaling, for Percent) exactly like the cells do.
        return currencyFormaterMap[fieldNumberFormat](value);
      }

      return DECIMAL_FORMATTER.format(roundTo(value, MAX_FRACTION_DIGITS));
    }
  }
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
