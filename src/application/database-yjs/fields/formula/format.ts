import { NumberFormat } from '@/application/database-yjs/fields/number/number.type';
import { stringifyDesktopNumberValue } from '@/application/database-yjs/fields/number/parse';
import { DateFormat, TimeFormat } from '@/application/types';
import { getDateFormat, getTimeFormat, renderDate } from '@/utils/time';

import { formatNumberPlain } from './coerce';
import { FormulaDate, FormulaValue } from './values';

export interface FormulaFormatOptions {
  numberFormat?: NumberFormat;
  dateFormat?: DateFormat;
  timeFormat?: TimeFormat;
}

export function formatFormulaNumber(value: number, numberFormat: NumberFormat = NumberFormat.Num): string {
  if (numberFormat === NumberFormat.Num) return formatNumberPlain(value);
  const formatted = stringifyDesktopNumberValue(formatNumberPlain(value), numberFormat);

  return formatted || formatNumberPlain(value);
}

export function formatFormulaDate(value: FormulaDate, options: FormulaFormatOptions = {}): string {
  const pattern = [getDateFormat(options.dateFormat ?? DateFormat.Local)];

  if (value.includeTime) pattern.push(getTimeFormat(options.timeFormat ?? TimeFormat.TwelveHour));
  const format = pattern.join(' ');
  const start = renderDate(value.start, format);

  if (value.end === undefined) return start;
  return `${start} → ${renderDate(value.end, format)}`;
}

/** Display text of a formula result, using the field's number/date settings. */
export function formatFormulaValue(value: FormulaValue, options: FormulaFormatOptions = {}): string {
  switch (value.type) {
    case 'empty':
      return '';
    case 'text':
      return value.value;
    case 'number':
      return formatFormulaNumber(value.value, options.numberFormat);
    case 'boolean':
      return value.value ? 'Yes' : 'No';
    case 'date':
      return formatFormulaDate(value.value, options);
    case 'list':
      return value.items.map((item) => formatFormulaValue(item, options)).join(', ');
  }
}
