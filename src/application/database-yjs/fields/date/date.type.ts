import { Filter } from '@/application/database-yjs';

export enum TimeFormat {
  TwelveHour = 0,
  TwentyFourHour = 1,
}

export enum DateFormat {
  Local = 0,
  US = 1,
  ISO = 2,
  Friendly = 3,
  DayMonthYear = 4,
}

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
}

export interface DateFilter extends Filter {
  condition: DateFilterCondition;
  start?: number;
  end?: number;
  timestamp?: number;
}
