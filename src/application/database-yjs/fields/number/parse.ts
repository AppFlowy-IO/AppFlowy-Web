import Big from 'big.js';

import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField } from '@/application/types';

import { getTypeOptions } from '../type_option';

import { currencyFormaterMap } from './format';
import { NumberFormat } from './number.type';

const RUST_DECIMAL_MAX_COEFFICIENT = 79_228_162_514_264_337_593_543_950_335n;
const RUST_DECIMAL_MAX_SCALE = 28;

export function parseNumberTypeOptions(field: YDatabaseField, fieldType?: FieldType) {
  const numberTypeOption = getTypeOptions(field, fieldType)?.toJSON();

  if (!numberTypeOption) {
    return {
      format: NumberFormat.Num,
    };
  }

  const format = Number.parseInt(String(numberTypeOption.format), 10);

  return {
    format: NumberFormat[format] === undefined ? NumberFormat.Num : (format as NumberFormat),
  };
}

/**
 * Decode text with Desktop's Number type-option rules, but return the
 * unformatted decimal expected by the Web number cell renderer.
 */
export function parseDesktopNumberValue(input: string | number, format: NumberFormat): string {
  const text = String(input);
  let candidate = '';

  if (format === NumberFormat.Num) {
    if (/[+-]?\d*\.?\d+e[+-]?\d+/.test(text)) {
      candidate = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)e[+-]?\d+$/.test(text) ? text : '';
    } else {
      candidate = text.match(/^\.\d+/)?.[0] ?? text.match(/-?\d+(?:\.\d+)?/)?.[0] ?? '';
      if (candidate.startsWith('.')) candidate = `0${candidate}`;
    }
  } else {
    const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? [];

    candidate = matches.join('');
    if (candidate && !text.startsWith('-')) candidate = candidate.replace(/^-/, '');
  }

  if (!candidate) return '';

  try {
    return normalizeRustDecimal(candidate);
  } catch {
    return '';
  }
}

/** Match Desktop's 96-bit rust_decimal range and half-up precision reduction. */
function normalizeRustDecimal(candidate: string): string {
  const scientific = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))e([+-]?\d+)$/i.exec(candidate);

  if (scientific) {
    const exponent = Number(scientific[2]);

    if (!Number.isSafeInteger(exponent)) return '';

    const baseScale = scientific[1].split('.')[1]?.length ?? 0;

    // Decimal::from_scientific adjusts the parsed base scale directly; it
    // rejects exponents that cannot fit rather than silently underflowing.
    if (exponent < 0 && baseScale - exponent > RUST_DECIMAL_MAX_SCALE) return '';
    if (exponent > RUST_DECIMAL_MAX_SCALE) return '';
  }

  const value = new Big(candidate);
  const absolute = value.abs();
  const integerDigits = absolute.lt(1) ? 0 : absolute.round(0, Big.roundDown).toFixed().length;
  let decimalPlaces = Math.min(RUST_DECIMAL_MAX_SCALE, Math.max(0, 29 - integerDigits));

  while (decimalPlaces >= 0) {
    const rounded = value.round(decimalPlaces, Big.roundHalfUp);
    const normalized = rounded.toFixed();
    const coefficient = BigInt(normalized.replace('-', '').replace('.', '') || '0');

    if (coefficient <= RUST_DECIMAL_MAX_COEFFICIENT) return normalized;
    if (decimalPlaces === 0) return '';
    decimalPlaces -= 1;
  }

  return '';
}

export function stringifyDesktopNumberValue(input: string | number, format: NumberFormat): string {
  const value = parseDesktopNumberValue(input, format);

  if (!value || format === NumberFormat.Num) return value;

  const formatter = currencyFormaterMap[format];

  if (!formatter) return value;

  try {
    return formatter(value.includes('.') ? Number(value) : BigInt(value));
  } catch {
    return value;
  }
}
