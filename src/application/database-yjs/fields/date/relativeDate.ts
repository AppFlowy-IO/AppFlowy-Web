import dayjs, { Dayjs } from 'dayjs';

import {
  DateFilter,
  DateFilterCondition,
  DateFilterRelativeCondition,
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

export function isRelativeDateCondition(condition: DateFilterCondition): boolean {
  return relativeConditionFor(condition) !== null;
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

// Returns a filter copy with relative-date conditions resolved into start/end timestamps
// anchored at today's local date. For non-relative conditions this returns the filter as-is.
export function resolveRelativeDates(filter: DateFilter, today: Dayjs = dayjs()): DateFilter {
  const relative = relativeConditionFor(filter.condition);

  if (!relative) return filter;

  const { start, end } = dateRangeForRelative(relative, today);
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
