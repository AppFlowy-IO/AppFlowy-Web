/**
 * `formatChartDateLabel` and `toIntlLocale` against
 * `dashboard-parity/date-labels.json` (WP14 §1.6.4, §1.6.5), the cases
 * desktop's `chart_date_labels.dart` reads too.
 */
import { INTL_LOCALE_ALIASES, toIntlLocale } from '@/i18n/useAppLocale';

import { loadParityFixture } from '../../__tests__/dashboard-parity-helpers';
import { DateGroupCondition } from '../../database.type';
import {
  CHART_DATE_LABEL_OVERRIDES,
  ChartDateLabelOverrides,
  fillWeekOfTemplate,
  formatChartDateLabel,
  formatDatePattern,
} from '../date-labels';

import { dateConditionOf } from './fixture-helpers';

interface DateLabelCase {
  locale: string;
  condition: string;
  key: string;
  expected: string;
}

const fixture = loadParityFixture<{
  fixture: string;
  version: number;
  locale_map: { app: string; intl: string }[];
  week_of_template: string;
  cases: DateLabelCase[];
  overrides: ChartDateLabelOverrides;
}>('date-labels.json');

describe('formatChartDateLabel (dashboard-parity/date-labels.json#cases)', () => {
  it('is the date-labels fixture, version 1, with the English week template', () => {
    expect(fixture.fixture).toBe('date-labels');
    expect(fixture.version).toBe(1);
    expect(fixture.week_of_template).toBe('Week of {} - {}');
  });

  it.each(fixture.cases.map((entry) => [`${entry.locale} ${entry.condition} ${entry.key}`, entry] as const))(
    '%s',
    (_, entry) => {
      expect(
        formatChartDateLabel(entry.key, dateConditionOf(entry.condition), entry.locale, fixture.week_of_template)
      ).toBe(entry.expected);
    }
  );

  it('pins every locale and date grouping of WP14 §1.6.5', () => {
    const locales = new Set(fixture.cases.map((entry) => entry.locale));
    const conditions = new Set(fixture.cases.map((entry) => entry.condition));

    expect([...locales].sort()).toEqual(['de-DE', 'en-US', 'fr-FR', 'ja-JP', 'zh-CN']);
    expect([...conditions].sort()).toEqual(['Day', 'Month', 'Relative', 'Week', 'Year']);
    // The same-month, cross-month and cross-year weeks for every locale.
    locales.forEach((locale) => {
      const weeks = fixture.cases.filter((entry) => entry.locale === locale && entry.condition === 'Week');

      expect(weeks.map((entry) => entry.key).sort()).toEqual(['2025-12-29', '2026-03-09', '2026-03-30']);
    });
  });

  it('reads the overrides of the fixture', () => {
    expect(CHART_DATE_LABEL_OVERRIDES).toEqual(fixture.overrides);
  });
});

describe('toIntlLocale (dashboard-parity/date-labels.json#locale_map)', () => {
  it.each(fixture.locale_map.map((row) => [row.app, row.intl] as const))('%p → %p', (app, intl) => {
    expect(toIntlLocale(app)).toBe(intl);
  });

  it('applies exactly the aliases the fixture lists', () => {
    const aliases = Object.fromEntries(
      fixture.locale_map
        .filter((row) => row.app !== row.intl && row.intl !== 'en-US' && !row.app.includes('_'))
        .map((row) => [row.app, row.intl])
    );

    expect({ ...INTL_LOCALE_ALIASES }).toEqual({ en: 'en-US', ...aliases });
  });

  it('falls back to en-US for missing, invalid and unsupported tags', () => {
    expect(toIntlLocale(undefined)).toBe('en-US');
    expect(toIntlLocale(null)).toBe('en-US');
    expect(toIntlLocale('   ')).toBe('en-US');
    expect(toIntlLocale('not a locale')).toBe('en-US');
  });
});

describe('formatChartDateLabel', () => {
  it('formats a farther relative date as its month and leaves rel: buckets to their translations', () => {
    expect(formatChartDateLabel('2026-04', DateGroupCondition.Relative, 'en-US', 'Week of {} - {}')).toBe('Apr 2026');
    expect(formatChartDateLabel('rel:today', DateGroupCondition.Relative, 'en-US', 'Week of {} - {}')).toBe('rel:today');
  });

  it('returns a key it cannot read unchanged', () => {
    expect(formatChartDateLabel('2026-13', DateGroupCondition.Month, 'en-US', 'Week of {} - {}')).toBe('2026-13');
    expect(formatChartDateLabel('soon', DateGroupCondition.Day, 'en-US', 'Week of {} - {}')).toBe('soon');
    expect(formatChartDateLabel('2026-03', DateGroupCondition.Week, 'en-US', 'Week of {} - {}')).toBe('2026-03');
    expect(formatChartDateLabel('26', DateGroupCondition.Year, 'en-US', 'Week of {} - {}')).toBe('26');
  });

  it('keeps the day whatever the time zone (keys are calendar dates)', () => {
    expect(formatChartDateLabel('2026-01-01', DateGroupCondition.Day, 'en-US', '')).toBe('January 1, 2026');
    expect(formatChartDateLabel('2026-12-31', DateGroupCondition.Day, 'en-US', '')).toBe('December 31, 2026');
  });

  it('fills the translated week template, a $ in it staying literal', () => {
    expect(formatChartDateLabel('2026-03-09', DateGroupCondition.Week, 'fr-FR', 'Semaine du {} au {}')).toBe(
      'Semaine du 9 mars au 15 mars 2026'
    );
    expect(fillWeekOfTemplate('{} $& {}', 'a', 'b')).toBe('a $& b');
  });

  it('formats with an override pattern when the fixture pins one', () => {
    const overrides: ChartDateLabelOverrides = {
      'de-DE': { yMMM: "MMM 'yy'", MMMd: 'd.M.', yMMMd: 'dd.MM.y' },
      'ja-JP': { yMMMMd: "y'年'M'月'd'日'" },
    };

    expect(formatChartDateLabel('2026-01', DateGroupCondition.Month, 'de-DE', '', overrides)).toBe('Jan. yy');
    expect(formatChartDateLabel('2026-03-09', DateGroupCondition.Week, 'de-DE', '{} – {}', overrides)).toBe(
      '9.3. – 15.03.2026'
    );
    expect(formatChartDateLabel('2026-01-15', DateGroupCondition.Day, 'ja-JP', '', overrides)).toBe('2026年1月15日');
    // A locale without an override keeps the platform's skeleton.
    expect(formatChartDateLabel('2026-01', DateGroupCondition.Month, 'en-US', '', overrides)).toBe('Jan 2026');
  });

  it('reads CLDR pattern letters, literals and quotes', () => {
    const date = { year: 2026, month: 3, day: 9 };

    expect(formatDatePattern('y-MM-dd', date, 'en-US')).toBe('2026-03-09');
    expect(formatDatePattern('yy MMMM d', date, 'en-US')).toBe('26 March 9');
    expect(formatDatePattern("d 'de' MMMM 'de' y", date, 'es-ES')).toBe('9 de marzo de 2026');
    expect(formatDatePattern("h 'o''clock'", date, 'en-US')).toBe("h o'clock");
    expect(formatDatePattern("''d", date, 'en-US')).toBe("'9");
    expect(formatDatePattern('LLLL', date, 'en-US')).toBe('March');
  });
});
