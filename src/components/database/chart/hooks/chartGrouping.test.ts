import dayjs from 'dayjs';
import { TFunction } from 'i18next';

import { DateGroupCondition } from '@/application/database-yjs/database.type';

import { bucketDate, createChartLabels } from './chartGrouping';

const defaultT = ((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key) as TFunction;

function translatingT(translations: Record<string, string>) {
  return ((key: string, options?: { defaultValue?: string }) =>
    translations[key] ?? options?.defaultValue ?? key) as TFunction;
}

const labels = createChartLabels(defaultT);
// Local noon, so day offsets never straddle midnight.
const now = dayjs(new Date(2026, 2, 15, 12));

function relative(offsetDays: number) {
  return bucketDate(now.add(offsetDays, 'day'), DateGroupCondition.Relative, labels, now);
}

describe('bucketDate relative', () => {
  it.each([
    [-31, 'Feb 2026'],
    [-30, 'Last 30 days'],
    [-8, 'Last 30 days'],
    [-7, 'Last 7 days'],
    [-2, 'Last 7 days'],
    [-1, 'Yesterday'],
    [0, 'Today'],
    [1, 'Tomorrow'],
    [2, 'Next 7 days'],
    [7, 'Next 7 days'],
    [8, 'Next 30 days'],
    [30, 'Next 30 days'],
    [31, 'Apr 2026'],
  ])('puts a date %i days away in "%s"', (offset, label) => {
    expect(relative(offset).label).toBe(label);
  });

  it('buckets by calendar day, not by elapsed hours', () => {
    const lateTonight = dayjs(new Date(2026, 2, 15, 23, 59));
    const earlyToday = dayjs(new Date(2026, 2, 15, 0, 1));

    expect(bucketDate(lateTonight, DateGroupCondition.Relative, labels, earlyToday).label).toBe('Today');
    expect(bucketDate(earlyToday.subtract(2, 'minute'), DateGroupCondition.Relative, labels, lateTonight).label).toBe(
      'Yesterday'
    );
  });

  it('orders the buckets like desktop, with months chronologically after them', () => {
    const buckets = [60, -60, 20, 3, 1, 0, -1, -3, -20, 400].map(relative);
    const sorted = [...buckets].sort((a, b) => (a.sortKey! < b.sortKey! ? -1 : a.sortKey! > b.sortKey! ? 1 : 0));

    expect(sorted.map((bucket) => bucket.label)).toEqual([
      'Last 30 days',
      'Last 7 days',
      'Yesterday',
      'Today',
      'Tomorrow',
      'Next 7 days',
      'Next 30 days',
      'Jan 2026',
      'May 2026',
      'Apr 2027',
    ]);
  });

  it('merges dates of the same bucket under one stable key', () => {
    expect(relative(-3).groupKey).toBe(relative(-6).groupKey);
    expect(relative(-3).groupKey).not.toBe(relative(-10).groupKey);
    expect(relative(40).groupKey).toBe('2026-04');
  });
});

describe('bucketDate absolute', () => {
  it('labels a day with a long date', () => {
    expect(bucketDate(now, DateGroupCondition.Day, labels)).toEqual({
      label: 'March 15, 2026',
      groupKey: '2026-03-15',
      sortKey: '2026-03-15',
    });
  });

  it('labels a week with its Monday to Sunday range', () => {
    const week = (date: Date) => bucketDate(dayjs(date), DateGroupCondition.Week, labels);

    expect(week(new Date(2026, 2, 11))).toEqual({
      label: 'Week of Mar 09 - 15 2026',
      groupKey: '2026-03-09',
      sortKey: '2026-03-09',
    });
    // A Sunday belongs to the week that started the Monday before.
    expect(week(new Date(2026, 2, 15)).groupKey).toBe('2026-03-09');
    expect(week(new Date(2026, 3, 1)).label).toBe('Week of Mar 30 - Apr 05 2026');
    expect(week(new Date(2026, 0, 1)).label).toBe('Week of Dec 29 2025 - Jan 04 2026');
  });

  it('labels months and years', () => {
    expect(bucketDate(now, DateGroupCondition.Month, labels)).toEqual({
      label: 'Mar 2026',
      groupKey: '2026-03',
      sortKey: '2026-03',
    });
    expect(bucketDate(now, DateGroupCondition.Year, labels)).toEqual({
      label: '2026',
      groupKey: '2026',
      sortKey: '2026',
    });
  });
});

describe('createChartLabels', () => {
  it('translates the relative, checkbox and week labels', () => {
    const translated = createChartLabels(
      translatingT({
        'board.dateCondition.today': "Aujourd'hui",
        'board.dateCondition.lastThirtyDays': '30 derniers jours',
        'board.dateCondition.weekOf': 'Semaine du {} au {}',
        'chart.checked': 'Coché',
        'chart.unchecked': 'Non coché',
      })
    );

    expect(translated.relative.today).toBe("Aujourd'hui");
    expect(translated.relative.last_30_days).toBe('30 derniers jours');
    expect(translated.checked).toBe('Coché');
    expect(translated.unchecked).toBe('Non coché');
    expect(translated.weekOf('Mar 09', '15 2026')).toBe('Semaine du Mar 09 au 15 2026');
    expect(bucketDate(now, DateGroupCondition.Relative, translated, now).label).toBe("Aujourd'hui");
  });

  it('names the empty category after the field', () => {
    const translated = createChartLabels(translatingT({ 'chart.noFieldValue': 'Sans {}', 'chart.emptyValue': 'Vide' }));

    expect(labels.noFieldValue('Status')).toBe('No Status');
    expect(translated.noFieldValue('Statut')).toBe('Sans Statut');
    // A `$` in the name is literal text, not a replacement pattern.
    expect(labels.noFieldValue('Cost $&')).toBe('No Cost $&');
    expect(labels.noFieldValue('')).toBe('Empty');
    expect(translated.noFieldValue('')).toBe('Vide');
  });
});
