import { Filter } from '@/application/database-yjs';

export enum DateFilterCondition {
  DateStartsOn = 0,
  DateStartsBefore = 1,
  DateStartsAfter = 2,
  DateStartsOnOrBefore = 3,
  DateStartsOnOrAfter = 4,
  DateStartsBetween = 5,
  DateStartIsEmpty = 6,
  DateStartIsNotEmpty = 7,
  DateEndsOn = 8,
  DateEndsBefore = 9,
  DateEndsAfter = 10,
  DateEndsOnOrBefore = 11,
  DateEndsOnOrAfter = 12,
  DateEndsBetween = 13,
  DateEndIsEmpty = 14,
  DateEndIsNotEmpty = 15,
  DateStartsToday = 16,
  DateStartsYesterday = 17,
  DateStartsTomorrow = 18,
  DateStartsThisWeek = 19,
  DateStartsLastWeek = 20,
  DateStartsNextWeek = 21,
  DateEndsToday = 22,
  DateEndsYesterday = 23,
  DateEndsTomorrow = 24,
  DateEndsThisWeek = 25,
  DateEndsLastWeek = 26,
  DateEndsNextWeek = 27,
  /** "Is relative to today" on the start date: Past / This / Next × N × day, week, month, year (WP08). */
  DateStartsRelative = 28,
  /** The end-date variant; a cell without an end date is compared by its start date. */
  DateEndsRelative = 29,
}

/** Direction of a parameterized relative date filter (conditions 28 / 29). */
export type RelativeDirection = 'past' | 'this' | 'next';

/** Unit of a parameterized relative date filter. */
export type RelativeUnit = 'day' | 'week' | 'month' | 'year';

export enum DateFilterRelativeCondition {
  Today = 'today',
  Yesterday = 'yesterday',
  Tomorrow = 'tomorrow',
  ThisWeek = 'thisWeek',
  LastWeek = 'lastWeek',
  NextWeek = 'nextWeek',
}

export interface DateFilter extends Filter {
  condition: DateFilterCondition;
  start?: number;
  end?: number;
  timestamp?: number;
  /** Conditions 28 / 29: the content JSON is spread here (snake_case, like the persisted keys). */
  relative_direction?: RelativeDirection;
  relative_amount?: number;
  relative_unit?: RelativeUnit;
}
