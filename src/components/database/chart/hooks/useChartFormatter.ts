import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ChartFormatContext,
  ChartFormatYField,
  ChartValueFormatter,
  ChartValueMode,
  formatChartValue,
  resolveChartLocale,
} from '@/application/database-yjs/chart-format';
import { ChartAggregationType, ChartNumberFormat } from '@/application/database-yjs/chart.type';

export interface UseChartFormatterOptions {
  /** The effective aggregation (`resolveEffectiveAggregation`). */
  aggregation: ChartAggregationType;
  /** The Y field's kind and format, by value (`useChartFields`). */
  yField: ChartFormatYField | null;
  decimalPlaces: number | null;
  /** The Number chart's format, read only in `card` mode. */
  numberFormat?: ChartNumberFormat;
}

/**
 * `format(value, mode)` for the current chart: R-FORMAT with the effective
 * aggregation, the Y field's format, `decimal_places` and the app language.
 * Every input is a value, so the formatter changes exactly when what it
 * prints can change.
 */
export function useChartFormatter({
  aggregation,
  yField,
  decimalPlaces,
  numberFormat,
}: UseChartFormatterOptions): ChartValueFormatter {
  const { t, i18n } = useTranslation();
  const language = i18n?.language;

  const context = useMemo<Omit<ChartFormatContext, 'mode'>>(
    () => ({
      aggregation,
      yField,
      decimalPlaces,
      numberFormat,
      locale: resolveChartLocale(language),
      labels: { days: (count: number) => t('chart.value.days', { count, defaultValue: `${count} days` }) },
    }),
    [aggregation, yField, decimalPlaces, numberFormat, language, t]
  );

  return useCallback((value: number, mode: ChartValueMode) => formatChartValue(value, { ...context, mode }), [context]);
}

export default useChartFormatter;
