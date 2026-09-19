import dayjs, { ManipulateType, OpUnitType } from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import dayOfYear from 'dayjs/plugin/dayOfYear';
import isoWeek from 'dayjs/plugin/isoWeek';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import weekYear from 'dayjs/plugin/weekYear';

import { asDate, asNumber, asText } from '../coerce';
import { FormulaError, SourcePosition } from '../errors';
import { FormulaFunctionSpec } from '../registry';
import { date, EMPTY, FormulaDate, FormulaValue, num, text } from '../values';

dayjs.extend(advancedFormat);
dayjs.extend(dayOfYear);
dayjs.extend(isoWeek);
dayjs.extend(quarterOfYear);
dayjs.extend(weekOfYear);
dayjs.extend(weekYear);

const UNITS: Record<string, ManipulateType> = {
  year: 'year',
  years: 'year',
  quarter: 'quarter' as ManipulateType,
  quarters: 'quarter' as ManipulateType,
  month: 'month',
  months: 'month',
  week: 'week',
  weeks: 'week',
  day: 'day',
  days: 'day',
  hour: 'hour',
  hours: 'hour',
  minute: 'minute',
  minutes: 'minute',
  second: 'second',
  seconds: 'second',
};

function ordinal(value: number): string {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';

  return `${value}${suffix}`;
}

/**
 * Formats with Notion's Moment-style tokens. dayjs covers most of them; the
 * ones it lacks (`Y`, day of year, `E`/`e` weekdays) become bracketed literals.
 */
export function formatMomentDate(value: dayjs.Dayjs, pattern: string): string {
  const translated = pattern.replace(/\[[^\]]*]|YYYY|YY|Y|DDDD|DDDo|DDD|Wo|E|e/g, (token) => {
    switch (token) {
      case 'Y':
        return `[${value.year()}]`;
      case 'DDD':
        return `[${value.dayOfYear()}]`;
      case 'DDDD':
        return `[${String(value.dayOfYear()).padStart(3, '0')}]`;
      case 'DDDo':
        return `[${ordinal(value.dayOfYear())}]`;
      case 'Wo':
        return `[${ordinal(value.isoWeek())}]`;
      case 'E':
        return `[${value.isoWeekday()}]`;
      case 'e':
        return `[${value.day()}]`;
      default:
        return token;
    }
  });

  return value.format(translated);
}

export const DATE_UNITS = ['years', 'quarters', 'months', 'weeks', 'days', 'hours', 'minutes'];

function parseUnit(value: FormulaValue, position: SourcePosition): ManipulateType {
  const unit = UNITS[asText(value).trim().toLowerCase()];

  if (!unit) {
    throw new FormulaError(`Unknown date unit "${asText(value)}"; use one of ${DATE_UNITS.join(', ')}`, position);
  }

  return unit;
}

function dateComponent(
  name: string,
  description: string,
  example: string,
  result: string,
  compute: (value: dayjs.Dayjs) => number
): FormulaFunctionSpec {
  return {
    name,
    category: 'date',
    signature: `${name}(date)`,
    description,
    examples: [{ expression: example, result }],
    params: [{ name: 'date', type: 'date' }],
    returnType: 'number',
    impl: ([value], _ctx, _nodes, position) => {
      const parsed = asDate(value, position);

      return parsed === null ? EMPTY : num(compute(dayjs(parsed.start)));
    },
  };
}

function shift(value: FormulaDate, amount: number, unit: ManipulateType, sign: 1 | -1): FormulaDate {
  return {
    start: dayjs(value.start).add(sign * amount, unit).valueOf(),
    end: value.end === undefined ? undefined : dayjs(value.end).add(sign * amount, unit).valueOf(),
    includeTime: value.includeTime,
  };
}

export const dateFunctions: FormulaFunctionSpec[] = [
  {
    name: 'now',
    category: 'date',
    signature: 'now()',
    description: 'Returns the current date and time.',
    examples: [{ expression: 'now()', result: 'the current date and time' }],
    params: [],
    returnType: 'date',
    impl: (_args, ctx) => date({ start: ctx.now(), includeTime: true }),
  },
  {
    name: 'today',
    category: 'date',
    signature: 'today()',
    description: 'Returns the current date, without a time.',
    examples: [{ expression: 'today()', result: "today's date" }],
    params: [],
    returnType: 'date',
    impl: (_args, ctx) => date({ start: dayjs(ctx.now()).startOf('day').valueOf(), includeTime: false }),
  },
  {
    name: 'timestamp',
    category: 'date',
    signature: 'timestamp(date)',
    description: 'Returns the number of milliseconds since January 1, 1970 for the date.',
    examples: [{ expression: 'timestamp(parseDate("1970-01-02"))', result: '86400000 (in UTC)' }],
    params: [{ name: 'date', type: 'date' }],
    returnType: 'number',
    impl: ([value], _ctx, _nodes, position) => {
      const parsed = asDate(value, position);

      return parsed === null ? EMPTY : num(parsed.start);
    },
  },
  {
    name: 'fromTimestamp',
    category: 'date',
    signature: 'fromTimestamp(number)',
    description: 'Returns the date for a number of milliseconds since January 1, 1970.',
    examples: [{ expression: 'fromTimestamp(0)', result: 'January 1, 1970' }],
    params: [{ name: 'number', type: 'number' }],
    returnType: 'date',
    impl: ([value], _ctx, _nodes, position) =>
      value.type === 'empty' ? EMPTY : date({ start: asNumber(value, position), includeTime: true }),
  },
  dateComponent('minute', 'Returns the minute of the date, from 0 to 59.', 'minute(now())', '0 to 59', (value) => value.minute()),
  dateComponent('hour', 'Returns the hour of the date, from 0 to 23.', 'hour(now())', '0 to 23', (value) => value.hour()),
  dateComponent(
    'day',
    'Returns the day of the week, from 1 (Monday) to 7 (Sunday).',
    'day(parseDate("2024-01-01"))',
    '1',
    (value) => value.isoWeekday()
  ),
  dateComponent('date', 'Returns the day of the month, from 1 to 31.', 'date(parseDate("2024-01-15"))', '15', (value) => value.date()),
  dateComponent('week', 'Returns the ISO week of the year, from 1 to 53.', 'week(parseDate("2024-01-01"))', '1', (value) => value.isoWeek()),
  dateComponent('month', 'Returns the month of the date, from 1 to 12.', 'month(parseDate("2024-03-01"))', '3', (value) => value.month() + 1),
  dateComponent('year', 'Returns the year of the date.', 'year(parseDate("2024-03-01"))', '2024', (value) => value.year()),
  {
    name: 'dateAdd',
    category: 'date',
    signature: 'dateAdd(date, amount, unit)',
    description: 'Adds time to a date. Units: "years", "quarters", "months", "weeks", "days", "hours", "minutes".',
    examples: [{ expression: 'dateAdd(prop("Start"), 2, "weeks")', result: 'two weeks after Start' }],
    params: [
      { name: 'date', type: 'date' },
      { name: 'amount', type: 'number' },
      { name: 'unit', type: 'text' },
    ],
    returnType: 'date',
    impl: ([value, amount, unit], _ctx, _nodes, position) => {
      const parsed = asDate(value, position);

      if (parsed === null) return EMPTY;
      return date(shift(parsed, asNumber(amount, position), parseUnit(unit, position), 1));
    },
  },
  {
    name: 'dateSubtract',
    category: 'date',
    signature: 'dateSubtract(date, amount, unit)',
    description: 'Subtracts time from a date. Units: "years", "quarters", "months", "weeks", "days", "hours", "minutes".',
    examples: [{ expression: 'dateSubtract(now(), 1, "months")', result: 'one month ago' }],
    params: [
      { name: 'date', type: 'date' },
      { name: 'amount', type: 'number' },
      { name: 'unit', type: 'text' },
    ],
    returnType: 'date',
    impl: ([value, amount, unit], _ctx, _nodes, position) => {
      const parsed = asDate(value, position);

      if (parsed === null) return EMPTY;
      return date(shift(parsed, asNumber(amount, position), parseUnit(unit, position), -1));
    },
  },
  {
    name: 'dateBetween',
    category: 'date',
    signature: 'dateBetween(date1, date2, unit)',
    description: 'Returns the time between two dates in the given unit (date1 minus date2), rounded toward zero.',
    examples: [{ expression: 'dateBetween(prop("Due"), now(), "days")', result: 'days until Due' }],
    params: [
      { name: 'date1', type: 'date' },
      { name: 'date2', type: 'date' },
      { name: 'unit', type: 'text' },
    ],
    returnType: 'number',
    impl: ([a, b, unit], _ctx, _nodes, position) => {
      const first = asDate(a, position);
      const second = asDate(b, position);

      if (first === null || second === null) return EMPTY;
      return num(dayjs(first.start).diff(dayjs(second.start), parseUnit(unit, position) as OpUnitType));
    },
  },
  {
    name: 'dateRange',
    category: 'date',
    signature: 'dateRange(start, end)',
    description: 'Creates a date range from a start date and an end date.',
    examples: [{ expression: 'dateRange(prop("Start"), prop("End"))', result: 'Start → End' }],
    params: [
      { name: 'start', type: 'date' },
      { name: 'end', type: 'date' },
    ],
    returnType: 'date',
    impl: ([a, b], _ctx, _nodes, position) => {
      const start = asDate(a, position);
      const end = asDate(b, position);

      if (start === null) return EMPTY;
      if (end === null) return date({ start: start.start, includeTime: start.includeTime });
      return date({ start: start.start, end: end.start, includeTime: start.includeTime || end.includeTime });
    },
  },
  {
    name: 'dateStart',
    category: 'date',
    signature: 'dateStart(dateRange)',
    description: 'Returns the start of a date range.',
    examples: [{ expression: 'dateStart(prop("Sprint"))', result: 'the first day of Sprint' }],
    params: [{ name: 'dateRange', type: 'date' }],
    returnType: 'date',
    impl: ([value], _ctx, _nodes, position) => {
      const parsed = asDate(value, position);

      return parsed === null ? EMPTY : date({ start: parsed.start, includeTime: parsed.includeTime });
    },
  },
  {
    name: 'dateEnd',
    category: 'date',
    signature: 'dateEnd(dateRange)',
    description: 'Returns the end of a date range, or the date itself when it has no end.',
    examples: [{ expression: 'dateEnd(prop("Sprint"))', result: 'the last day of Sprint' }],
    params: [{ name: 'dateRange', type: 'date' }],
    returnType: 'date',
    impl: ([value], _ctx, _nodes, position) => {
      const parsed = asDate(value, position);

      return parsed === null ? EMPTY : date({ start: parsed.end ?? parsed.start, includeTime: parsed.includeTime });
    },
  },
  {
    name: 'parseDate',
    category: 'date',
    signature: 'parseDate(text)',
    description: 'Parses a date from ISO 8601 text such as "2024-03-01" or "2024-03-01T09:30:00".',
    examples: [{ expression: 'parseDate("2024-03-01")', result: 'March 1, 2024' }],
    params: [{ name: 'text', type: 'text' }],
    returnType: 'date',
    impl: ([value]) => {
      const source = asText(value).trim();

      if (source === '') return EMPTY;
      const parsed = dayjs(source);

      if (!parsed.isValid()) return EMPTY;
      return date({ start: parsed.valueOf(), includeTime: /\d:\d/.test(source) });
    },
  },
  {
    name: 'formatDate',
    category: 'date',
    signature: 'formatDate(date, format)',
    description:
      'Formats a date as text. Tokens: YYYY, Y, MM, MMM, MMMM, D, DD, Do, DDD, ddd, dddd, E, H, HH, h, hh, mm, ss, A, Q, w, wo, W, Wo, X, x. Wrap literal text in [brackets].',
    examples: [
      { expression: 'formatDate(parseDate("2024-03-01"), "MMM D, YYYY")', result: '"Mar 1, 2024"' },
      { expression: 'formatDate(now(), "[Week] W")', result: '"Week 10"' },
    ],
    params: [
      { name: 'date', type: 'date' },
      { name: 'format', type: 'text' },
    ],
    returnType: 'text',
    impl: ([value, pattern], _ctx, _nodes, position) => {
      const parsed = asDate(value, position);

      return parsed === null ? text('') : text(formatMomentDate(dayjs(parsed.start), asText(pattern)));
    },
  },
];
