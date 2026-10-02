import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ChartFormatContext,
  ChartFormatYField,
  ChartValueMode,
  formatChartValue,
  resolveChartLocale,
} from '@/application/database-yjs/chart-format';
import { ChartAggregationType, ChartNumberFormat } from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { NumberFormat } from '@/application/database-yjs/fields';
import { getTypeOptions } from '@/application/database-yjs/fields/type_option';
import { getFieldDateTimeFormats } from '@/application/database-yjs/fields/date/utils';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

export type ChartValueFormatter = (value: number, mode: ChartValueMode) => string;

export interface UseChartFormatterOptions {
  aggregationType: ChartAggregationType;
  yAxisField: YDatabaseField | null;
  yNumberFormat: NumberFormat | null;
  decimalPlaces: number | null;
  numberFormat?: ChartNumberFormat;
  /** Bumped when the Y field changes in place (type, date format). */
  fieldsVersion?: number;
}

const DATE_FIELD_TYPES = new Set([FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime]);

/** The Y field as R-FORMAT needs it. */
export function chartFormatYField(field: YDatabaseField | null, numberFormat: NumberFormat | null): ChartFormatYField | null {
  if (!field) return null;
  const type = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  if (type === FieldType.Number) return { type: 'number', numberFormat: numberFormat ?? NumberFormat.Num };
  if (type === FieldType.Checkbox) return { type: 'checkbox' };
  if (DATE_FIELD_TYPES.has(type)) {
    return { type: 'date', dateFormat: getFieldDateTimeFormats(getTypeOptions(field)).dateFormat };
  }

  return { type: 'other' };
}

/**
 * `format(value, mode)` for the current chart: R-FORMAT with the effective
 * aggregation (a non-Count aggregation without a Y field counts rows), the Y
 * field's format, `decimal_places` and the app language.
 */
export function useChartFormatter({
  aggregationType,
  yAxisField,
  yNumberFormat,
  decimalPlaces,
  numberFormat,
  fieldsVersion,
}: UseChartFormatterOptions): ChartValueFormatter {
  const { t, i18n } = useTranslation();
  const language = i18n?.language;

  const context = useMemo<Omit<ChartFormatContext, 'mode'>>(() => {
    void fieldsVersion;

    return {
      aggregation: yAxisField ? aggregationType : ChartAggregationType.Count,
      yField: chartFormatYField(yAxisField, yNumberFormat),
      decimalPlaces,
      numberFormat,
      locale: resolveChartLocale(language),
      labels: { days: (count: number) => t('chart.value.days', { count, defaultValue: `${count} days` }) },
    };
  }, [aggregationType, yAxisField, yNumberFormat, decimalPlaces, numberFormat, language, t, fieldsVersion]);

  return useCallback((value: number, mode: ChartValueMode) => formatChartValue(value, { ...context, mode }), [context]);
}

export default useChartFormatter;
