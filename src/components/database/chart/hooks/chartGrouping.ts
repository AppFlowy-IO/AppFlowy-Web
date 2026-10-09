import dayjs, { Dayjs } from 'dayjs';
import { TFunction } from 'i18next';

import { ChartGroupHint, ChartGroupLabels, dateGroupRef } from '@/application/database-yjs/chart-config';
import { DateGroupCondition } from '@/application/database-yjs/database.type';
import { FALLBACK_INTL_LOCALE } from '@/i18n/intl-locale';

export { CHECKBOX_CHECKED_KEY, CHECKBOX_UNCHECKED_KEY } from '@/application/database-yjs/chart-config';

/** A date bucket: its group key (`rel:today`, `2026-03`), label and default-sort hint. */
export interface GroupValue {
  label: string;
  groupKey: string;
  hint: ChartGroupHint;
}

/** Translated chart category labels, built once per language (R-GROUPKEY, WP11 §1.4). */
export type ChartLabels = ChartGroupLabels;

/** Fills the desktop-style `{}` placeholders of a translation, in order. */
function fillPlaceholders(template: string, ...values: string[]): string {
  // A replacer function, so a `$` in a field name is not a replacement pattern.
  return values.reduce((text, value) => text.replace('{}', () => value), template);
}

export function createChartLabels(t: TFunction): ChartLabels {
  const noFieldValue = t('chart.noFieldValue', { defaultValue: 'No {}' });
  const emptyValue = t('chart.emptyValue', { defaultValue: 'Empty' });

  return {
    checked: t('chart.checked', { defaultValue: 'Checked' }),
    unchecked: t('chart.unchecked', { defaultValue: 'Unchecked' }),
    noFieldValue: (fieldName) => (fieldName ? fillPlaceholders(noFieldValue, fieldName) : emptyValue),
    weekOfTemplate: t('board.dateCondition.weekOf', { defaultValue: 'Week of {} - {}' }),
    relative: {
      last_30_days: t('board.dateCondition.lastThirtyDays', { defaultValue: 'Last 30 days' }),
      last_7_days: t('board.dateCondition.lastSevenDays', { defaultValue: 'Last 7 days' }),
      yesterday: t('board.dateCondition.yesterday', { defaultValue: 'Yesterday' }),
      today: t('board.dateCondition.today', { defaultValue: 'Today' }),
      tomorrow: t('board.dateCondition.tomorrow', { defaultValue: 'Tomorrow' }),
      next_7_days: t('board.dateCondition.nextSevenDays', { defaultValue: 'Next 7 days' }),
      next_30_days: t('board.dateCondition.nextThirtyDays', { defaultValue: 'Next 30 days' }),
    },
    unknownPerson: t('chart.groups.unknownPerson', { defaultValue: 'Unknown person' }),
    unknownUser: t('chart.groups.unknownUser', { defaultValue: 'Unknown user' }),
    untitled: t('chart.groups.untitled', { defaultValue: 'Untitled' }),
  };
}

/**
 * Date bucket of a chart X-axis value (`dateGroupRef`): ASCII keys, and
 * labels in `locale` from `formatChartDateLabel` (the same as desktop's).
 * Relative buckets are `rel:<bucket>` ranked 0–6, farther dates their month
 * key ranked 7.
 */
export function bucketDate(
  date: Dayjs,
  condition: DateGroupCondition,
  labels: ChartLabels,
  now: Dayjs = dayjs(),
  locale: string = FALLBACK_INTL_LOCALE
): GroupValue {
  const ref = dateGroupRef(date, condition, labels, now, locale);

  return { label: ref.label, groupKey: ref.key, hint: ref.hint };
}
