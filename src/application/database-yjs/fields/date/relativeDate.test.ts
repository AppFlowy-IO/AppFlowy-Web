import dayjs from 'dayjs';
import { expect } from '@jest/globals';

import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';

import {
  DateFilterCondition,
  DateFilterRelativeCondition,
  dateRangeForRelative,
  DEFAULT_RELATIVE_DATE_SPEC,
  isEndDateCondition,
  isParameterizedRelativeCondition,
  isPresetRelativeDateCondition,
  isRelativeDateCondition,
  isStartDateCondition,
  parseRelativeDateSpec,
  relativeDateRange,
  relativeDateSummary,
  resolveRelativeDates,
  serializeRelativeDateSpec,
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
    // "Is relative to today" (28 start, 29 end) is relative too, but not a preset.
    expect(isRelativeDateCondition(DateFilterCondition.DateStartsRelative)).toBe(true);
    expect(isRelativeDateCondition(DateFilterCondition.DateEndsRelative)).toBe(true);
    expect(isPresetRelativeDateCondition(DateFilterCondition.DateStartsRelative)).toBe(false);
    expect(isParameterizedRelativeCondition(DateFilterCondition.DateEndsRelative)).toBe(true);
    expect(isParameterizedRelativeCondition(DateFilterCondition.DateEndsNextWeek)).toBe(false);
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
    // 28 is a start condition after the end presets; 29 is its end pair.
    expect(isStartDateCondition(DateFilterCondition.DateStartsRelative)).toBe(true);
    expect(isStartDateCondition(DateFilterCondition.DateEndsRelative)).toBe(false);
    expect(toEndDateCondition(DateFilterCondition.DateStartsRelative)).toBe(DateFilterCondition.DateEndsRelative);
    expect(toStartDateCondition(DateFilterCondition.DateEndsRelative)).toBe(DateFilterCondition.DateStartsRelative);
  });

  it('lists the end-date conditions explicitly', () => {
    const ends = Object.values(DateFilterCondition)
      .filter((value): value is number => typeof value === 'number')
      .filter(isEndDateCondition);

    expect(ends).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 22, 23, 24, 25, 26, 27, 29]);
    expect(isEndDateCondition(DateFilterCondition.DateStartsRelative)).toBe(false);
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

/** `dashboard-parity/relative-dates.json` (WP08 §1.10), read by Rust and Dart too. */
interface RelativeDatesFixture {
  ranges: { name: string; today: string; spec: Record<string, unknown>; start: string; end: string }[];
}

const relativeFixture = loadParityFixture<RelativeDatesFixture>('relative-dates.json');

describe('relative to today (dashboard-parity/relative-dates.json)', () => {
  it.each(relativeFixture.ranges.map((entry) => [entry.name, entry] as const))('range: %s', (_name, entry) => {
    const range = relativeDateRange(parseRelativeDateSpec(entry.spec), dayjs(entry.today));

    expect([range.start.format('YYYY-MM-DD'), range.end.format('YYYY-MM-DD')]).toEqual([entry.start, entry.end]);
  });

  it('reads unreadable content as This week and writes all three keys', () => {
    expect(parseRelativeDateSpec('{bad')).toEqual(DEFAULT_RELATIVE_DATE_SPEC);
    expect(parseRelativeDateSpec(null)).toEqual(DEFAULT_RELATIVE_DATE_SPEC);
    expect(parseRelativeDateSpec('[1]')).toEqual(DEFAULT_RELATIVE_DATE_SPEC);
    expect(JSON.parse(serializeRelativeDateSpec({ direction: 'past', amount: 7, unit: 'day' }))).toEqual({
      relative_direction: 'past',
      relative_amount: 7,
      relative_unit: 'day',
    });
  });

  it('resolves 28 and 29 like the presets, one day as a timestamp', () => {
    const past = resolveRelativeDates(
      {
        condition: DateFilterCondition.DateStartsRelative,
        relative_direction: 'past',
        relative_amount: 7,
        relative_unit: 'day',
      } as never,
      TEST_TODAY
    );

    expect(past.start).toBe(dayjs('2024-06-05').unix());
    expect(past.end).toBe(dayjs('2024-06-12').unix());
    const today = resolveRelativeDates(
      { condition: DateFilterCondition.DateEndsRelative, relative_direction: 'this', relative_unit: 'day' } as never,
      TEST_TODAY
    );

    expect(today.timestamp).toBe(dayjs('2024-06-12').unix());
    expect(today.start).toBeUndefined();
  });

  it('summarizes a spec in words', () => {
    const t = (key: string, options?: Record<string, unknown>) => {
      const count = options?.count as number | undefined;
      const template = String(
        (count === 1 ? options?.defaultValue_one : options?.defaultValue_other) ?? options?.defaultValue ?? key
      );

      return template.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
    };

    expect(relativeDateSummary({ direction: 'past', amount: 7, unit: 'day' }, t)).toBe('Past 7 days');
    expect(relativeDateSummary({ direction: 'past', amount: 1, unit: 'week' }, t)).toBe('Past week');
    expect(relativeDateSummary({ direction: 'next', amount: 3, unit: 'month' }, t)).toBe('Next 3 months');
    expect(relativeDateSummary({ direction: 'this', amount: 5, unit: 'year' }, t)).toBe('This year');
  });
});
