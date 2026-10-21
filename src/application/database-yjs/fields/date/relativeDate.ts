import dayjs, { Dayjs } from 'dayjs';

import { DateFilter, DateFilterCondition, DateFilterRelativeCondition, DateFilterRelativeDate } from './date.type';

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
  [DateFilterCondition.DateStartsBefore, DateFilterCondition.DateEndsBefore],
  [DateFilterCondition.DateStartsAfter, DateFilterCondition.DateEndsAfter],
  [DateFilterCondition.DateStartsOnOrBefore, DateFilterCondition.DateEndsOnOrBefore],
  [DateFilterCondition.DateStartsOnOrAfter, DateFilterCondition.DateEndsOnOrAfter],
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

export function isDateComparisonCondition(condition: DateFilterCondition): boolean {
  return [
    DateFilterCondition.DateStartsOn,
    DateFilterCondition.DateStartsBefore,
    DateFilterCondition.DateStartsAfter,
    DateFilterCondition.DateStartsOnOrBefore,
    DateFilterCondition.DateStartsOnOrAfter,
  ].includes(toStartDateCondition(condition));
}

export function relativeDateForFilter(
  filter: Pick<DateFilter, 'condition' | 'relative_date'>
): DateFilterRelativeDate | undefined {
  switch (relativeConditionFor(filter.condition)) {
    case DateFilterRelativeCondition.Today:
      return DateFilterRelativeDate.Today;
    case DateFilterRelativeCondition.Yesterday:
      return DateFilterRelativeDate.Yesterday;
    case DateFilterRelativeCondition.Tomorrow:
      return DateFilterRelativeDate.Tomorrow;
  }

  if (filter.relative_date && isDateComparisonCondition(filter.condition)) {
    switch (filter.relative_date) {
      case DateFilterRelativeDate.Today:
      case DateFilterRelativeDate.Yesterday:
      case DateFilterRelativeDate.Tomorrow:
        return filter.relative_date;
    }
  }
}

function relativeDateFromContent(condition: DateFilterCondition, content: unknown) {
  try {
    const data = typeof content === 'string' && content ? JSON.parse(content) : {};

    return relativeDateForFilter({ ...data, condition });
  } catch {
    return relativeDateForFilter({ condition });
  }
}

export function isRelativeDateFilter(condition: DateFilterCondition, content: unknown): boolean {
  return isRelativeDateCondition(condition) || relativeDateFromContent(condition, content) !== undefined;
}

// Preserve the selected day when editing the operator, including legacy Today rules.
// Conditions without a single date operand must not retain a hidden relative value.
export function dateFilterContentForCondition(
  previous: DateFilterCondition,
  next: DateFilterCondition,
  content: string
) {
  const relative = relativeDateFromContent(previous, content);

  if (relative && isDateComparisonCondition(next)) return JSON.stringify({ relative_date: relative });
  if (relative || isRelativeDateCondition(previous) || isRelativeDateCondition(next)) return '';
  return content;
}

// Mirrors desktop: week starts on Monday (ISO 8601). Returns inclusive [start, end] dates.
export function dateRangeForRelative(
  relative: DateFilterRelativeCondition,
  today: Dayjs = dayjs()
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
export function resolveRelativeDates(filter: DateFilter, today?: Dayjs): DateFilter {
  const operand = relativeDateForFilter(filter);

  if (operand) {
    const offset =
      operand === DateFilterRelativeDate.Yesterday ? -1 : operand === DateFilterRelativeDate.Tomorrow ? 1 : 0;

    return {
      ...filter,
      timestamp: (today ?? dayjs()).startOf('day').add(offset, 'day').unix(),
      start: undefined,
      end: undefined,
    };
  }

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
