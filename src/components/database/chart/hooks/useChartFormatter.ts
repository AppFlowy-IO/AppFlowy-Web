import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ChartFormatContext,
  ChartFormatYField,
  ChartValueFormatter,
  ChartValueMode,
  formatChartValue,
} from '@/application/database-yjs/chart-format';
import { ChartAggregationType, ChartNumberFormat } from '@/application/database-yjs/chart.type';
import { useAppLocale } from '@/i18n/useAppLocale';

export interface UseChartFormatterOptions {
  /** The effective aggregation (`effectiveChartAggregation`). */
  aggregation: ChartAggregationType;
  /** The Y field's kind and format, by value (`useChartFields`). */
  yField: ChartFormatYField | null;
  decimalPlaces: number | null;
  /** The Number chart's format, read only in `card` mode. */
  numberFormat?: ChartNumberFormat;
}

/**
 * `format(value, mode)` for the current chart: R-FORMAT with the effective
 * aggregation, the Y field's format, `decimal_places` and the app locale
 * (`useAppLocale`). Every number a chart prints goes through it: the Number
 * card, axes, data labels, the donut centre and tooltips.
 * Every input is a value, so the formatter changes exactly when what it
 * prints can change.
 */
export function useChartFormatter({
  aggregation,
  yField,
  decimalPlaces,
  numberFormat,
}: UseChartFormatterOptions): ChartValueFormatter {
  const { t } = useTranslation();
  const locale = useAppLocale();

  const context = useMemo<Omit<ChartFormatContext, 'mode'>>(
    () => ({
      aggregation,
      yField,
      decimalPlaces,
      numberFormat,
      locale,
      labels: { days: (count: number) => t('chart.value.days', { count, defaultValue: `${count} days` }) },
    }),
    [aggregation, yField, decimalPlaces, numberFormat, locale, t]
  );

  return useCallback((value: number, mode: ChartValueMode) => formatChartValue(value, { ...context, mode }), [context]);
}

export default useChartFormatter;
