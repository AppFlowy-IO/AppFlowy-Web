/**
 * Runtime values and static types of the formula language.
 *
 * The language is deliberately small and typed: every expression has one
 * result type, mirroring Notion's formulas 2.0. Dates are carried as unix
 * milliseconds so `timestamp()`/`fromTimestamp()` match Notion, and are
 * converted to AppFlowy's unix-second cells only at the boundary.
 */
import dayjs from 'dayjs';

export type FormulaScalarType = 'text' | 'number' | 'boolean' | 'date';

/** Static type of an expression. `empty` unifies with anything; `any` is unknown. */
export type FormulaType = FormulaScalarType | 'empty' | 'any' | { list: FormulaType };

export interface FormulaDate {
  /** Unix milliseconds of the start (or the single instant). */
  start: number;
  /** Unix milliseconds of the end when the value is a range. */
  end?: number;
  /** Whether the time-of-day is meaningful (AppFlowy `include_time`). */
  includeTime: boolean;
}

export type FormulaTextColor = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';

export type FormulaTextStyle = 'b' | 'i' | 'u' | 's' | 'c' | FormulaTextColor | `${FormulaTextColor}_background`;

export interface FormulaTextRun {
  text: string;
  styles: FormulaTextStyle[];
}

export interface FormulaTextValue {
  type: 'text';
  /** Plain text remains the source for comparisons, searches and exports. */
  value: string;
  /** Nonempty runs cover the entire value; omitted when all text is unstyled. */
  runs?: FormulaTextRun[];
}

export type FormulaValue =
  | FormulaTextValue
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: FormulaDate }
  | { type: 'list'; items: FormulaValue[] }
  | { type: 'empty' };

export const EMPTY: FormulaValue = { type: 'empty' };

export const text = (value: string): FormulaTextValue => ({ type: 'text', value });
export const num = (value: number): FormulaValue => (Number.isFinite(value) ? { type: 'number', value } : EMPTY);
export const bool = (value: boolean): FormulaValue => ({ type: 'boolean', value });
export const date = (value: FormulaDate): FormulaValue => ({ type: 'date', value });
export const list = (items: FormulaValue[]): FormulaValue => ({ type: 'list', items });

export function isListType(type: FormulaType): type is { list: FormulaType } {
  return typeof type === 'object' && type !== null && 'list' in type;
}

export function listOf(type: FormulaType): FormulaType {
  return { list: type };
}

export function typeToString(type: FormulaType): string {
  if (isListType(type)) return `list<${typeToString(type.list)}>`;
  return type;
}

/** `empty` and `any` are compatible with every type; lists compare element-wise. */
export function typesCompatible(a: FormulaType, b: FormulaType): boolean {
  if (a === 'any' || b === 'any' || a === 'empty' || b === 'empty') return true;
  if (isListType(a) || isListType(b)) {
    return isListType(a) && isListType(b) && typesCompatible(a.list, b.list);
  }

  return a === b;
}

/** The most specific of two compatible types (`unify('empty', 'number')` is `number`). */
export function unifyTypes(a: FormulaType, b: FormulaType): FormulaType | null {
  if (!typesCompatible(a, b)) return null;
  if (a === 'empty' || a === 'any') return b;
  if (b === 'empty' || b === 'any') return a;
  if (isListType(a) && isListType(b)) {
    const inner = unifyTypes(a.list, b.list);

    return inner === null ? null : listOf(inner);
  }

  return a;
}

/** Runtime type of a value, as a static type. */
export function typeOfValue(value: FormulaValue): FormulaType {
  switch (value.type) {
    case 'list': {
      let inner: FormulaType = 'empty';

      for (const item of value.items) {
        const unified = unifyTypes(inner, typeOfValue(item));

        if (unified === null) return listOf('any');
        inner = unified;
      }

      return listOf(inner);
    }

    default:
      return value.type;
  }
}

/** Notion semantics: 0, "", false and [] are empty. */
export function isEmptyValue(value: FormulaValue): boolean {
  switch (value.type) {
    case 'empty':
      return true;
    case 'text':
      return value.value === '';
    case 'number':
      return value.value === 0;
    case 'boolean':
      return value.value === false;
    case 'list':
      return value.items.length === 0;
    case 'date':
      return false;
  }
}

/** Compare calendar days when both operands are date-only. */
export function compareDateTimes(left: number, right: number, includeTime: boolean): number {
  return includeTime ? left - right : dayjs(left).startOf('day').diff(dayjs(right).startOf('day'));
}

export function valuesEqual(a: FormulaValue, b: FormulaValue, visit?: () => void): boolean {
  visit?.();
  if (a.type === 'empty' || b.type === 'empty') return isEmptyValue(a) && isEmptyValue(b);
  if (a.type !== b.type) return false;

  switch (a.type) {
    case 'text':
    case 'number':
    case 'boolean':
      return a.value === (b as typeof a).value;
    case 'date': {
      const left = a.value;
      const right = (b as typeof a).value;
      const includeTime = left.includeTime || right.includeTime;

      if (compareDateTimes(left.start, right.start, includeTime) !== 0) return false;

      const leftEnd = left.end ?? null;
      const rightEnd = right.end ?? null;

      if (leftEnd === null || rightEnd === null) return leftEnd === rightEnd;
      return compareDateTimes(leftEnd, rightEnd, includeTime) === 0;
    }

    case 'list': {
      const items = (b as typeof a).items;

      return a.items.length === items.length && a.items.every((item, index) => valuesEqual(item, items[index], visit));
    }

    default:
      return false;
  }
}
