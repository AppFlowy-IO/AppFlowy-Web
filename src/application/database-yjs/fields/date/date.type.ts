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
}

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
}
