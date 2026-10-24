/**
 * Locale-aware chart date labels (WP14 §1.6.5). Pure: it formats WP11's
 * canonical date keys and never parses a label back, and sorting reads the
 * keys, so a language switch relabels a chart without reordering it.
 * Desktop has the same function in `chart_date_labels.dart`; both are pinned
 * by `dashboard-parity/date-labels.json`.
 */
import { FALLBACK_INTL_LOCALE } from '@/i18n/intl-locale';

import { DateGroupCondition } from '../database.type';

/** The CLDR skeletons a date label is built from (desktop `DateFormat.yMMMMd`, `.yMMM`, `.y`, `.MMMd`, `.yMMMd`). */
export type ChartDateSkeleton = 'yMMMMd' | 'yMMM' | 'y' | 'MMMd' | 'yMMMd';

const SKELETON_OPTIONS: Readonly<Record<ChartDateSkeleton, Intl.DateTimeFormatOptions>> = {
  yMMMMd: { year: 'numeric', month: 'long', day: 'numeric' },
  yMMM: { year: 'numeric', month: 'short' },
  y: { year: 'numeric' },
  MMMd: { month: 'short', day: 'numeric' },
  yMMMd: { year: 'numeric', month: 'short', day: 'numeric' },
};

export type ChartDateLabelOverrides = Readonly<Record<string, Readonly<Partial<Record<ChartDateSkeleton, string>>>>>;

/**
 * `date-labels.json` `overrides`: CLDR patterns per locale and skeleton for
 * the pinned locales where Chrome's ICU and Dart intl disagree. Copied here so
 * the bundle does not ship the fixture; `date-labels.test` fails while the
 * two differ. Empty: both runtimes agreed when the fixture was generated.
 */
export const CHART_DATE_LABEL_OVERRIDES: ChartDateLabelOverrides = Object.freeze({});

interface CalendarDate {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per locale and options key; dates are UTC instants of calendar days, so no time zone shifts a day. */
function dateTimeFormat(locale: string, cacheKey: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${cacheKey}`;
  let formatter = formatters.get(key);

  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    } catch {
      // An invalid locale throws a RangeError; `toIntlLocale` normally screens it out first.
      formatter = new Intl.DateTimeFormat(FALLBACK_INTL_LOCALE, { ...options, timeZone: 'UTC' });
    }

    formatters.set(key, formatter);
  }

  return formatter;
}

function toInstant({ year, month, day }: CalendarDate): Date {
  const date = new Date(Date.UTC(2000, month - 1, day));

  // `Date.UTC` maps years 0–99 to 1900–1999.
  date.setUTCFullYear(year);
  return date;
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const instant = toInstant(date);

  instant.setUTCDate(instant.getUTCDate() + days);
  return { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate() };
}

/** The month name of a pattern's `MMM` / `MMMM` (format context) or `LLL` / `LLLL` (stand-alone). */
function monthName(date: CalendarDate, locale: string, width: 'short' | 'long', standAlone: boolean): string {
  if (standAlone) {
    return dateTimeFormat(locale, `L${width}`, { month: width }).format(toInstant(date));
  }

  const parts = dateTimeFormat(locale, `M${width}d`, { month: width, day: 'numeric' }).formatToParts(toInstant(date));

  return parts.find((part) => part.type === 'month')?.value ?? '';
}

function patternField(letter: string, count: number, date: CalendarDate, locale: string): string {
  switch (letter) {
    case 'y':
      return count === 2 ? String(date.year % 100).padStart(2, '0') : String(date.year).padStart(count, '0');
    case 'M':
    case 'L':
      if (count <= 2) return String(date.month).padStart(count, '0');
      return monthName(date, locale, count === 3 ? 'short' : 'long', letter === 'L');
    case 'd':
      return String(date.day).padStart(count, '0');
    default:
      return letter.repeat(count);
  }
}

/** A CLDR date pattern (letters y, M, L, d; `'…'` literals, `''` a quote), as desktop's `DateFormat(pattern, locale)`. */
export function formatDatePattern(pattern: string, date: CalendarDate, locale: string): string {
  let text = '';
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];

    if (char === "'") {
      if (pattern[index + 1] === "'") {
        text += "'";
        index += 2;
        continue;
      }

      // A quoted literal runs to the next lone quote; `''` inside it is a quote.
      index += 1;
      while (index < pattern.length) {
        if (pattern[index] === "'") {
          if (pattern[index + 1] !== "'") break;
          text += "'";
          index += 2;
          continue;
        }

        text += pattern[index];
        index += 1;
      }

      index += 1;
      continue;
    }

    if (/[yMLd]/.test(char)) {
      let count = 1;

      while (pattern[index + count] === char) count += 1;
      text += patternField(char, count, date, locale);
      index += count;
      continue;
    }

    text += char;
    index += 1;
  }

  return text;
}

function formatSkeleton(
  date: CalendarDate,
  skeleton: ChartDateSkeleton,
  locale: string,
  overrides: ChartDateLabelOverrides
): string {
  const pattern = overrides[locale]?.[skeleton];

  if (pattern) return formatDatePattern(pattern, date, locale);
  return dateTimeFormat(locale, skeleton, SKELETON_OPTIONS[skeleton]).format(toInstant(date));
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const YEAR_KEY = /^(\d{4})$/;

function parseKey(key: string, pattern: RegExp): CalendarDate | null {
  const match = pattern.exec(key);

  if (!match) return null;
  const date = { year: Number(match[1]), month: match[2] ? Number(match[2]) : 1, day: match[3] ? Number(match[3]) : 1 };

  return date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= 31 ? date : null;
}

/** Fills the desktop-style `{}` placeholders of a translation in order (a `$` in a value stays literal). */
export function fillWeekOfTemplate(template: string, start: string, end: string): string {
  return [start, end].reduce((text, value) => text.replace('{}', () => value), template);
}

/**
 * The label of a canonical chart date key in `locale` (an Intl locale from
 * `toIntlLocale`):
 *
 * - Day `YYYY-MM-DD` → `yMMMMd` ("January 15, 2026", "2026年1月15日")
 * - Month `YYYY-MM` → `yMMM` ("Jan 2026", "Jan. 2026")
 * - Year `YYYY` → `y` ("2026", "2026年")
 * - Week, keyed by its Monday → `weekOfTemplate` filled with the Monday as
 *   `MMMd` (`yMMMd` when the Sunday is in another year) and the Sunday as
 *   `yMMMd` ("Week of Mar 9 - Mar 15, 2026", "Week of Dec 29, 2025 - Jan 4, 2026")
 * - Relative: a `YYYY-MM` key (a date beyond the relative buckets) as Month.
 *   `rel:*` buckets are labelled by their translated `board.dateCondition.*`
 *   texts, not here; such a key, like any key that is not a date, comes back
 *   unchanged.
 */
export function formatChartDateLabel(
  key: string,
  condition: DateGroupCondition,
  locale: string,
  weekOfTemplate: string,
  overrides: ChartDateLabelOverrides = CHART_DATE_LABEL_OVERRIDES
): string {
  switch (condition) {
    case DateGroupCondition.Day: {
      const date = parseKey(key, DAY_KEY);

      return date ? formatSkeleton(date, 'yMMMMd', locale, overrides) : key;
    }

    case DateGroupCondition.Week: {
      const monday = parseKey(key, DAY_KEY);

      if (!monday) return key;
      const sunday = addDays(monday, 6);
      const start = formatSkeleton(monday, monday.year === sunday.year ? 'MMMd' : 'yMMMd', locale, overrides);

      return fillWeekOfTemplate(weekOfTemplate, start, formatSkeleton(sunday, 'yMMMd', locale, overrides));
    }

    case DateGroupCondition.Year: {
      const date = parseKey(key, YEAR_KEY);

      return date ? formatSkeleton(date, 'y', locale, overrides) : key;
    }

    case DateGroupCondition.Month:
    case DateGroupCondition.Relative:
    default: {
      const date = parseKey(key, MONTH_KEY);

      return date ? formatSkeleton(date, 'yMMM', locale, overrides) : key;
    }
  }
}
