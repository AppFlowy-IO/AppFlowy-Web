import dayjs, { Dayjs } from 'dayjs';
import { TFunction } from 'i18next';

import { DateGroupCondition } from '@/application/database-yjs/database.type';

export interface GroupValue {
  label: string;
  /** Used to merge buckets across rows (e.g., date bucket key like "2026-03"). */
  groupKey: string;
  /** Chronological sort hint for date buckets. */
  sortKey?: string;
}

/** Stable group keys of checkbox cells; only their labels are translated. */
export const CHECKBOX_CHECKED_KEY = 'checked';
export const CHECKBOX_UNCHECKED_KEY = 'unchecked';

/**
 * Relative date buckets in chart order, matching desktop's
 * `ChartUtils.relativeBucketSortOrder`. Dates more than 30 days away fall back
 * to month buckets, which sort after all of these.
 */
const RELATIVE_BUCKETS = [
  'last_30_days',
  'last_7_days',
  'yesterday',
  'today',
  'tomorrow',
  'next_7_days',
  'next_30_days',
] as const;

type RelativeBucket = (typeof RELATIVE_BUCKETS)[number];

/** Translated chart category labels, built once per language. */
export interface ChartLabels {
  checked: string;
  unchecked: string;
  /** Empty category: "No {field}". */
  noFieldValue: (fieldName: string) => string;
  /** Week bucket: "Week of {first day} - {last day}". */
  weekOf: (start: string, end: string) => string;
  relative: Record<RelativeBucket, string>;
}

/** Fills the desktop-style `{}` placeholders of a translation, in order. */
function fillPlaceholders(template: string, ...values: string[]): string {
  // A replacer function, so a `$` in a field name is not a replacement pattern.
  return values.reduce((text, value) => text.replace('{}', () => value), template);
}

export function createChartLabels(t: TFunction): ChartLabels {
  const noFieldValue = t('chart.noFieldValue', { defaultValue: 'No {}' });
  const emptyValue = t('chart.emptyValue', { defaultValue: 'Empty' });
  const weekOf = t('board.dateCondition.weekOf', { defaultValue: 'Week of {} - {}' });

  return {
    checked: t('chart.checked', { defaultValue: 'Checked' }),
    unchecked: t('chart.unchecked', { defaultValue: 'Unchecked' }),
    noFieldValue: (fieldName) => (fieldName ? fillPlaceholders(noFieldValue, fieldName) : emptyValue),
    weekOf: (start, end) => fillPlaceholders(weekOf, start, end),
    relative: {
      last_30_days: t('board.dateCondition.lastThirtyDays', { defaultValue: 'Last 30 days' }),
      last_7_days: t('board.dateCondition.lastSevenDays', { defaultValue: 'Last 7 days' }),
      yesterday: t('board.dateCondition.yesterday', { defaultValue: 'Yesterday' }),
      today: t('board.dateCondition.today', { defaultValue: 'Today' }),
      tomorrow: t('board.dateCondition.tomorrow', { defaultValue: 'Tomorrow' }),
      next_7_days: t('board.dateCondition.nextSevenDays', { defaultValue: 'Next 7 days' }),
      next_30_days: t('board.dateCondition.nextThirtyDays', { defaultValue: 'Next 30 days' }),
    },
  };
}

function relativeBucket(diffDays: number): RelativeBucket | null {
  if (diffDays === 0) return 'today';
  if (diffDays === -1) return 'yesterday';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays >= -7 && diffDays < -1) return 'last_7_days';
  if (diffDays > 1 && diffDays <= 7) return 'next_7_days';
  if (diffDays >= -30 && diffDays < -7) return 'last_30_days';
  if (diffDays > 7 && diffDays <= 30) return 'next_30_days';
  return null;
}

/**
 * Date bucket of a chart X-axis value, with the labels desktop's
 * `ChartUtils.bucketKeyToLabel` produces. Sort keys compare by code unit:
 * relative buckets ("0-<order>") sort before month buckets ("1-YYYY-MM").
 */
export function bucketDate(
  date: Dayjs,
  condition: DateGroupCondition,
  labels: ChartLabels,
  now: Dayjs = dayjs()
): GroupValue {
  switch (condition) {
    case DateGroupCondition.Day: {
      const key = date.format('YYYY-MM-DD');

      return { label: date.format('MMMM D, YYYY'), groupKey: key, sortKey: key };
    }

    case DateGroupCondition.Week: {
      // Week of year (ISO-style): start on Monday
      const monday = date.day() === 0 ? date.subtract(6, 'day') : date.subtract(date.day() - 1, 'day');
      const sunday = monday.add(6, 'day');
      const key = monday.format('YYYY-MM-DD');
      const start = monday.format(monday.year() !== sunday.year() ? 'MMM DD YYYY' : 'MMM DD');
      const end = sunday.format(monday.month() !== sunday.month() ? 'MMM DD YYYY' : 'DD YYYY');

      return { label: labels.weekOf(start, end), groupKey: key, sortKey: key };
    }

    case DateGroupCondition.Month: {
      const key = date.format('YYYY-MM');

      return { label: date.format('MMM YYYY'), groupKey: key, sortKey: key };
    }

    case DateGroupCondition.Year: {
      const key = date.format('YYYY');

      return { label: key, groupKey: key, sortKey: key };
    }

    case DateGroupCondition.Relative:
    default: {
      const diffDays = date.startOf('day').diff(now.startOf('day'), 'day');
      const bucket = relativeBucket(diffDays);

      if (bucket) {
        return {
          label: labels.relative[bucket],
          groupKey: `rel-${bucket}`,
          sortKey: `0-${RELATIVE_BUCKETS.indexOf(bucket)}`,
        };
      }

      // Fallback: month bucket
      const key = date.format('YYYY-MM');

      return { label: date.format('MMM YYYY'), groupKey: key, sortKey: `1-${key}` };
    }
  }
}
