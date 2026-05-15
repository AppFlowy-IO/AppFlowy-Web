import dayjs from 'dayjs';
import { expect } from '@jest/globals';

import {
  DateFilterCondition,
  DateFilterRelativeCondition,
  dateRangeForRelative,
  isRelativeDateCondition,
  isStartDateCondition,
  resolveRelativeDates,
  toEndDateCondition,
  toStartDateCondition,
} from './';

// Deterministic anchor (Wed 2024-06-12) — matches desktop test fixture.
const TEST_TODAY = dayjs('2024-06-12');

describe('relativeDate', () => {
  it('detects relative conditions', () => {
    expect(isRelativeDateCondition(DateFilterCondition.DateStartsToday)).toBe(true);
    expect(isRelativeDateCondition(DateFilterCondition.DateEndsNextWeek)).toBe(true);
    expect(isRelativeDateCondition(DateFilterCondition.DateStartsOn)).toBe(false);
  });

  it('classifies start vs end conditions', () => {
    expect(isStartDateCondition(DateFilterCondition.DateStartsToday)).toBe(true);
    expect(isStartDateCondition(DateFilterCondition.DateEndsToday)).toBe(false);
    expect(toEndDateCondition(DateFilterCondition.DateStartsThisWeek)).toBe(
      DateFilterCondition.DateEndsThisWeek
    );
    expect(toStartDateCondition(DateFilterCondition.DateEndsLastWeek)).toBe(
      DateFilterCondition.DateStartsLastWeek
    );
  });

  it('Today resolves to single-day range', () => {
    const range = dateRangeForRelative(DateFilterRelativeCondition.Today, TEST_TODAY);

    expect(range.start.format('YYYY-MM-DD')).toBe('2024-06-12');
    expect(range.end.format('YYYY-MM-DD')).toBe('2024-06-12');
  });

  it('ThisWeek resolves to Mon-Sun for a Wednesday', () => {
    const range = dateRangeForRelative(DateFilterRelativeCondition.ThisWeek, TEST_TODAY);

    expect(range.start.format('YYYY-MM-DD')).toBe('2024-06-10');
    expect(range.end.format('YYYY-MM-DD')).toBe('2024-06-16');
  });

  it('LastWeek and NextWeek shift by 7 days', () => {
    const last = dateRangeForRelative(DateFilterRelativeCondition.LastWeek, TEST_TODAY);

    expect(last.start.format('YYYY-MM-DD')).toBe('2024-06-03');
    expect(last.end.format('YYYY-MM-DD')).toBe('2024-06-09');

    const next = dateRangeForRelative(DateFilterRelativeCondition.NextWeek, TEST_TODAY);

    expect(next.start.format('YYYY-MM-DD')).toBe('2024-06-17');
    expect(next.end.format('YYYY-MM-DD')).toBe('2024-06-23');
  });

  it('resolveRelativeDates clears unused fields and sets timestamp for single-day', () => {
    const resolved = resolveRelativeDates(
      {
        id: 'f',
        fieldId: 'date',
        filterType: 0,
        condition: DateFilterCondition.DateStartsToday,
      } as any,
      TEST_TODAY
    );

    expect(resolved.timestamp).toBe(TEST_TODAY.startOf('day').unix());
    expect(resolved.start).toBeUndefined();
    expect(resolved.end).toBeUndefined();
  });

  it('resolveRelativeDates sets start/end for week range', () => {
    const resolved = resolveRelativeDates(
      {
        id: 'f',
        fieldId: 'date',
        filterType: 0,
        condition: DateFilterCondition.DateStartsThisWeek,
      } as any,
      TEST_TODAY
    );

    expect(resolved.start).toBe(dayjs('2024-06-10').startOf('day').unix());
    expect(resolved.end).toBe(dayjs('2024-06-16').startOf('day').unix());
    expect(resolved.timestamp).toBeUndefined();
  });

  it('resolveRelativeDates is identity for non-relative conditions', () => {
    const filter = {
      id: 'f',
      fieldId: 'date',
      filterType: 0,
      condition: DateFilterCondition.DateStartsOn,
      timestamp: 1668387885,
    } as any;

    expect(resolveRelativeDates(filter, TEST_TODAY)).toBe(filter);
  });
});
