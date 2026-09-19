import dayjs from 'dayjs';

import { FormulaError, SourcePosition } from './errors';
import { FormulaDate, FormulaValue } from './values';

/**
 * Runtime coercions. The type checker rejects mismatched types before
 * evaluation, so these mostly handle `empty` (an empty property) leniently:
 * an empty number is 0, an empty text is "", an empty list is [].
 */

export function asNumber(value: FormulaValue, position?: SourcePosition): number {
  switch (value.type) {
    case 'number':
      return value.value;
    case 'empty':
      return 0;
    case 'boolean':
      return value.value ? 1 : 0;
    case 'text': {
      const parsed = Number(value.value.trim());

      if (value.value.trim() === '' || !Number.isFinite(parsed)) {
        throw new FormulaError(`Expected a number but got text "${value.value}"`, position);
      }

      return parsed;
    }

    case 'date':
      return value.value.start;
    default:
      throw new FormulaError('Expected a number', position);
  }
}

export function asText(value: FormulaValue): string {
  switch (value.type) {
    case 'text':
      return value.value;
    case 'number':
      return formatNumberPlain(value.value);
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'date':
      return formatDatePlain(value.value);
    case 'list':
      return value.items.map(asText).join(', ');
    case 'empty':
      return '';
  }
}

/** Charge string growth before joining nested lists or copying existing text. */
export function asTextWithBudget(value: FormulaValue, consumeWork: (amount: number) => void): string {
  if (value.type === 'list') {
    const parts = value.items.map((item) => asTextWithBudget(item, consumeWork));

    consumeWork(parts.reduce((length, part) => length + part.length, Math.max(0, parts.length - 1) * 2));
    return parts.join(', ');
  }

  const result = asText(value);

  consumeWork(result.length);
  return result;
}

export function asBoolean(value: FormulaValue): boolean {
  switch (value.type) {
    case 'boolean':
      return value.value;
    case 'empty':
      return false;
    case 'number':
      return value.value !== 0;
    case 'text':
      return value.value !== '';
    case 'list':
      return value.items.length > 0;
    case 'date':
      return true;
  }
}

export function asDate(value: FormulaValue, position?: SourcePosition): FormulaDate | null {
  switch (value.type) {
    case 'date':
      return value.value;
    case 'empty':
      return null;
    case 'number':
      return { start: value.value, includeTime: true };
    case 'text': {
      const parsed = dayjs(value.value);

      if (!parsed.isValid()) throw new FormulaError(`Expected a date but got text "${value.value}"`, position);
      return { start: parsed.valueOf(), includeTime: /\d:\d/.test(value.value) };
    }

    default:
      throw new FormulaError('Expected a date', position);
  }
}

export function asList(value: FormulaValue): FormulaValue[] {
  switch (value.type) {
    case 'list':
      return value.items;
    case 'empty':
      return [];
    default:
      return [value];
  }
}

/** Plain number text: no exponent for ordinary magnitudes, no float noise. */
export function formatNumberPlain(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toPrecision(15));

  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** `format(date)` text: "Sep 14, 2026" or "Sep 14, 2026 10:30 AM", ranges joined by "→". */
export function formatDatePlain(value: FormulaDate): string {
  const pattern = value.includeTime ? 'MMM D, YYYY h:mm A' : 'MMM D, YYYY';
  const start = dayjs(value.start).format(pattern);

  if (value.end === undefined) return start;
  return `${start} → ${dayjs(value.end).format(pattern)}`;
}
