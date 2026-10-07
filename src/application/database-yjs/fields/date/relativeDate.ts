import dayjs, { Dayjs } from 'dayjs';

import {
  DateFilter,
  DateFilterCondition,
  DateFilterRelativeCondition,
  RelativeDirection,
  RelativeUnit,
} from './date.type';

export function relativeConditionFor(condition: DateFilterCondition): DateFilterRelativeCondition | null {
  switch (condition) {
    case DateFilterCondition.DateStartsToday:
    case DateFilterCondition.DateEndsToday:
      return DateFilterRelativeCondition.Today;
    case DateFilterCondition.DateStartsYesterday:
    case DateFilterCondition.DateEndsYesterday:
      return DateFilterRelativeCondition.Yesterday;
    case DateFilterCondition.DateStartsTomorrow:
    case DateFilterCondition.DateEndsTomorrow:
      return DateFilterRelativeCondition.Tomorrow;
    case DateFilterCondition.DateStartsThisWeek:
    case DateFilterCondition.DateEndsThisWeek:
      return DateFilterRelativeCondition.ThisWeek;
    case DateFilterCondition.DateStartsLastWeek:
    case DateFilterCondition.DateEndsLastWeek:
      return DateFilterRelativeCondition.LastWeek;
    case DateFilterCondition.DateStartsNextWeek:
    case DateFilterCondition.DateEndsNextWeek:
      return DateFilterRelativeCondition.NextWeek;
    default:
      return null;
  }
}

/** The six presets (Today … Next week, start or end side). */
export function isPresetRelativeDateCondition(condition: DateFilterCondition): boolean {
  return relativeConditionFor(condition) !== null;
}

/** "Is relative to today" with a direction, an amount and a unit (28 / 29). */
export function isParameterizedRelativeCondition(condition: DateFilterCondition): boolean {
  return condition === DateFilterCondition.DateStartsRelative || condition === DateFilterCondition.DateEndsRelative;
}

/** Any condition resolved against today: a preset or a parameterized relative condition. */
export function isRelativeDateCondition(condition: DateFilterCondition): boolean {
  return isPresetRelativeDateCondition(condition) || isParameterizedRelativeCondition(condition);
}

/**
 * The end-date conditions, as an explicit set: their values are not one
 * range (28 is a start condition after the end presets).
 */
const END_DATE_CONDITIONS: ReadonlySet<number> = new Set([
  DateFilterCondition.DateEndsOn,
  DateFilterCondition.DateEndsBefore,
  DateFilterCondition.DateEndsAfter,
  DateFilterCondition.DateEndsOnOrBefore,
  DateFilterCondition.DateEndsOnOrAfter,
  DateFilterCondition.DateEndsBetween,
  DateFilterCondition.DateEndIsEmpty,
  DateFilterCondition.DateEndIsNotEmpty,
  DateFilterCondition.DateEndsToday,
  DateFilterCondition.DateEndsYesterday,
  DateFilterCondition.DateEndsTomorrow,
  DateFilterCondition.DateEndsThisWeek,
  DateFilterCondition.DateEndsLastWeek,
  DateFilterCondition.DateEndsNextWeek,
  DateFilterCondition.DateEndsRelative,
]);

export function isEndDateCondition(condition: number): boolean {
  return END_DATE_CONDITIONS.has(condition);
}

const START_END_PAIRS: ReadonlyArray<readonly [DateFilterCondition, DateFilterCondition]> = [
  [DateFilterCondition.DateStartsOn, DateFilterCondition.DateEndsOn],
  [DateFilterCondition.DateStartsBefore, DateFilterCondition.DateEndsAfter],
  [DateFilterCondition.DateStartsAfter, DateFilterCondition.DateEndsBefore],
  [DateFilterCondition.DateStartsOnOrBefore, DateFilterCondition.DateEndsOnOrAfter],
  [DateFilterCondition.DateStartsOnOrAfter, DateFilterCondition.DateEndsOnOrBefore],
  [DateFilterCondition.DateStartsBetween, DateFilterCondition.DateEndsBetween],
  [DateFilterCondition.DateStartIsEmpty, DateFilterCondition.DateEndIsEmpty],
  [DateFilterCondition.DateStartIsNotEmpty, DateFilterCondition.DateEndIsNotEmpty],
  [DateFilterCondition.DateStartsToday, DateFilterCondition.DateEndsToday],
  [DateFilterCondition.DateStartsYesterday, DateFilterCondition.DateEndsYesterday],
  [DateFilterCondition.DateStartsTomorrow, DateFilterCondition.DateEndsTomorrow],
  [DateFilterCondition.DateStartsThisWeek, DateFilterCondition.DateEndsThisWeek],
  [DateFilterCondition.DateStartsLastWeek, DateFilterCondition.DateEndsLastWeek],
  [DateFilterCondition.DateStartsNextWeek, DateFilterCondition.DateEndsNextWeek],
  [DateFilterCondition.DateStartsRelative, DateFilterCondition.DateEndsRelative],
];

export function isStartDateCondition(condition: DateFilterCondition): boolean {
  return START_END_PAIRS.some(([start]) => start === condition);
}

export function toStartDateCondition(condition: DateFilterCondition): DateFilterCondition {
  for (const [start, end] of START_END_PAIRS) {
    if (start === condition || end === condition) return start;
  }

  return condition;
}

export function toEndDateCondition(condition: DateFilterCondition): DateFilterCondition {
  for (const [start, end] of START_END_PAIRS) {
    if (start === condition || end === condition) return end;
  }

  return condition;
}

// Mirrors desktop: week starts on Monday (ISO 8601). Returns inclusive [start, end] dates.
export function dateRangeForRelative(
  relative: DateFilterRelativeCondition,
  today: Dayjs = dayjs(),
): { start: Dayjs; end: Dayjs } {
  const startOfToday = today.startOf('day');

  switch (relative) {
    case DateFilterRelativeCondition.Today:
      return { start: startOfToday, end: startOfToday };
    case DateFilterRelativeCondition.Yesterday: {
      const day = startOfToday.subtract(1, 'day');

      return { start: day, end: day };
    }

    case DateFilterRelativeCondition.Tomorrow: {
      const day = startOfToday.add(1, 'day');

      return { start: day, end: day };
    }

    case DateFilterRelativeCondition.ThisWeek:
      return weekRange(startOfToday, 0);
    case DateFilterRelativeCondition.LastWeek:
      return weekRange(startOfToday, -7);
    case DateFilterRelativeCondition.NextWeek:
      return weekRange(startOfToday, 7);
  }
}

function weekRange(today: Dayjs, offsetDays: number): { start: Dayjs; end: Dayjs } {
  // dayjs().day() returns 0 (Sunday) - 6 (Saturday); convert to Monday-based 0-6.
  const mondayBased = (today.day() + 6) % 7;
  const start = today.subtract(mondayBased, 'day').add(offsetDays, 'day');
  const end = start.add(6, 'day');

  return { start, end };
}

// ---------------------------------------------------------------------------
// Parameterized relative dates (conditions 28 / 29, WP08 §1.10)
// ---------------------------------------------------------------------------

export interface RelativeDateSpec {
  direction: RelativeDirection;
  amount: number;
  unit: RelativeUnit;
}

export const RELATIVE_DIRECTIONS: readonly RelativeDirection[] = ['past', 'this', 'next'];
export const RELATIVE_UNITS: readonly RelativeUnit[] = ['day', 'week', 'month', 'year'];
export const RELATIVE_AMOUNT_MIN = 1;
export const RELATIVE_AMOUNT_MAX = 9999;

/** What a new relative filter starts with, and what unreadable content reads as: This week. */
export const DEFAULT_RELATIVE_DATE_SPEC: RelativeDateSpec = Object.freeze({
  direction: 'this',
  amount: 1,
  unit: 'week',
}) as RelativeDateSpec;

type RelativeDateSource = string | null | undefined | Partial<Record<'relative_direction' | 'relative_amount' | 'relative_unit', unknown>>;

function readRelativeSource(source: RelativeDateSource): Record<string, unknown> {
  if (typeof source !== 'string') return (source ?? {}) as Record<string, unknown>;

  try {
    const parsed = JSON.parse(source) as unknown;

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * A relative spec from filter content (JSON) or a parsed filter. Readers
 * default an unknown direction to `this`, a missing or non-numeric amount to 1
 * (numbers are floored and clamped to 1..9999) and an unknown unit to `week`.
 */
export function parseRelativeDateSpec(source: RelativeDateSource): RelativeDateSpec {
  const raw = readRelativeSource(source);
  const direction = RELATIVE_DIRECTIONS.includes(raw.relative_direction as RelativeDirection)
    ? (raw.relative_direction as RelativeDirection)
    : DEFAULT_RELATIVE_DATE_SPEC.direction;
  const unit = RELATIVE_UNITS.includes(raw.relative_unit as RelativeUnit)
    ? (raw.relative_unit as RelativeUnit)
    : DEFAULT_RELATIVE_DATE_SPEC.unit;
  const amount =
    typeof raw.relative_amount === 'number' && Number.isFinite(raw.relative_amount)
      ? Math.min(RELATIVE_AMOUNT_MAX, Math.max(RELATIVE_AMOUNT_MIN, Math.floor(raw.relative_amount)))
      : DEFAULT_RELATIVE_DATE_SPEC.amount;

  return { direction, amount, unit };
}

/** The content a writer stores: always all three keys. */
export function serializeRelativeDateSpec(spec: RelativeDateSpec): string {
  return JSON.stringify({
    relative_direction: spec.direction,
    relative_amount: spec.amount,
    relative_unit: spec.unit,
  });
}

function shiftDays(day: Dayjs, unit: RelativeUnit, amount: number) {
  switch (unit) {
    case 'day':
      return day.add(amount, 'day');
    case 'week':
      return day.add(7 * amount, 'day');
    case 'month':
      // dayjs clamps the day to the month's length, like Rust `checked_add_months`.
      return day.add(amount, 'month');
    case 'year':
      // Through months, so Feb 29 behaves as on desktop.
      return day.add(12 * amount, 'month');
  }
}

/**
 * The inclusive local days a spec covers on `today`: Past N units ends today,
 * Next N units starts today, and This unit is the calendar day, ISO week
 * (Monday..Sunday), month or year that holds today.
 */
export function relativeDateRange(spec: RelativeDateSpec, today: Dayjs = dayjs()): { start: Dayjs; end: Dayjs } {
  const day = today.startOf('day');

  if (spec.direction === 'past') return { start: shiftDays(day, spec.unit, -spec.amount), end: day };
  if (spec.direction === 'next') return { start: day, end: shiftDays(day, spec.unit, spec.amount) };

  switch (spec.unit) {
    case 'day':
      return { start: day, end: day };
    case 'week':
      return weekRange(day, 0);
    case 'month':
      return { start: day.startOf('month'), end: day.endOf('month').startOf('day') };
    case 'year':
      return { start: day.startOf('year'), end: day.endOf('year').startOf('day') };
  }
}

/**
 * "This week", "Past week", "Next 3 days": the summary of a relative spec on
 * a pill or a filter chip.
 */
export function relativeDateSummary(spec: RelativeDateSpec, t: (key: string, options?: Record<string, unknown>) => string) {
  const count = spec.direction === 'this' ? 1 : spec.amount;
  const unit = relativeUnitName(spec.unit, count, t);

  if (spec.direction === 'this') {
    return t('dashboard.globalFilters.relative.summaryThis', { unit, defaultValue: 'This {{unit}}' });
  }

  const key = spec.direction === 'past' ? 'summaryPast' : 'summaryNext';
  const word = spec.direction === 'past' ? 'Past' : 'Next';

  return t(`dashboard.globalFilters.relative.${key}`, {
    count,
    unit,
    defaultValue: `${word} {{count}} {{unit}}`,
    defaultValue_one: `${word} {{unit}}`,
    defaultValue_other: `${word} {{count}} {{unit}}`,
  });
}

const UNIT_WORDS: Record<RelativeUnit, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
};

/** `day` / `days` …, in the plural unless `count` is 1. */
export function relativeUnitName(
  unit: RelativeUnit,
  count: number,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const [one, other] = UNIT_WORDS[unit];

  return t(`dashboard.globalFilters.units.${unit}`, {
    count,
    defaultValue: count === 1 ? one : other,
    defaultValue_one: one,
    defaultValue_other: other,
  });
}

// Returns a filter copy with relative-date conditions resolved into start/end timestamps
// anchored at today's local date. For non-relative conditions this returns the filter as-is.
export function resolveRelativeDates(filter: DateFilter, today: Dayjs = dayjs()): DateFilter {
  let range: { start: Dayjs; end: Dayjs } | null = null;

  if (isParameterizedRelativeCondition(filter.condition)) {
    range = relativeDateRange(parseRelativeDateSpec(filter), today);
  } else {
    const relative = relativeConditionFor(filter.condition);

    if (relative) range = dateRangeForRelative(relative, today);
  }

  if (!range) return filter;

  const { start, end } = range;
  const startUnix = start.unix();
  const endUnix = end.unix();

  if (startUnix === endUnix) {
    return {
      ...filter,
      timestamp: startUnix,
      start: undefined,
      end: undefined,
    };
  }

  return {
    ...filter,
    timestamp: undefined,
    start: startUnix,
    end: endUnix,
  };
}
