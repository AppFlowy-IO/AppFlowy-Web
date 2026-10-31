import dayjs, { Dayjs } from 'dayjs';

import { ChartDataItem } from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType, FilterType } from '@/application/database-yjs/database.type';
import { DetachedFilter } from '@/application/database-yjs/dispatch/detached-filters';
import { CheckboxFilterCondition } from '@/application/database-yjs/fields/checkbox/checkbox.type';
import { DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

import { dateToBucketKey, parseBucketDate, RELATIVE_MONTH_PREFIX } from './useChartData';

/** Desktop's `supportsChartRowFilter`: the field types the drill-down can filter by. */
const CHART_ROW_FILTER_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  FieldType.RichText,
  FieldType.URL,
  FieldType.Number,
  FieldType.Checkbox,
  FieldType.SingleSelect,
  FieldType.MultiSelect,
  FieldType.DateTime,
  FieldType.CreatedTime,
  FieldType.LastEditedTime,
]);

export function isChartRowFilterFieldType(fieldType: FieldType) {
  return CHART_ROW_FILTER_FIELD_TYPES.has(fieldType);
}

/** Inclusive local calendar days of a date bucket. */
type DayRange = [start: Dayjs, end: Dayjs];

/** Day offsets from today of each named Relative bucket (`relativeBucketKey`). */
const RELATIVE_BUCKET_DAYS = new Map<string, [number, number]>([
  ['today', [0, 0]],
  ['yesterday', [-1, -1]],
  ['tomorrow', [1, 1]],
  ['last_7_days', [-7, -2]],
  ['next_7_days', [2, 7]],
  ['last_30_days', [-30, -8]],
  ['next_30_days', [8, 30]],
]);

/** The named Relative buckets cover this many days either side of today; months hold the rest. */
const RELATIVE_WINDOW_DAYS = 30;

/**
 * The days a Relative month bucket actually holds. Desktop filters the whole
 * month, which also lists the rows its bar leaves to "Last 30 days" or
 * "Next 30 days"; the month's days inside that window are cut off instead.
 */
function outsideRelativeWindow([start, end]: DayRange, today: Dayjs): DayRange | null {
  const first = today.subtract(RELATIVE_WINDOW_DAYS, 'day');
  const last = today.add(RELATIVE_WINDOW_DAYS, 'day');

  if (end.isBefore(first) || start.isAfter(last)) return [start, end];
  if (start.isBefore(first)) return [start, first.subtract(1, 'day')];
  if (end.isAfter(last)) return [last.add(1, 'day'), end];
  // The whole month is inside the window, so no month bucket can hold it.
  return null;
}

/** Desktop's `_dateRange`: the days a bucket key covers, or null for a key it cannot have produced. */
function bucketDayRange(key: string, condition: DateGroupCondition, now: Dayjs): DayRange | null {
  const today = now.startOf('day');

  if (condition === DateGroupCondition.Relative) {
    const offsets = RELATIVE_BUCKET_DAYS.get(key);

    if (offsets) return [today.add(offsets[0], 'day'), today.add(offsets[1], 'day')];
    if (!key.startsWith(RELATIVE_MONTH_PREFIX)) return null;

    const month = bucketDayRange(key.substring(RELATIVE_MONTH_PREFIX.length), DateGroupCondition.Month, now);

    return month && outsideRelativeWindow(month, today);
  }

  const start =
    condition === DateGroupCondition.Month
      ? parseBucketDate(`${key}-01`)
      : condition === DateGroupCondition.Year
      ? parseBucketDate(`${key}-01-01`)
      : condition === DateGroupCondition.Day || condition === DateGroupCondition.Week
      ? parseBucketDate(key)
      : null;

  // Round-tripping rejects impossible dates (`2026-02-31`) and weeks that do not start on a Monday.
  if (!start || dateToBucketKey(start, condition, now) !== key) return null;

  switch (condition) {
    case DateGroupCondition.Week:
      return [start, start.add(6, 'day')];
    case DateGroupCondition.Month:
      return [start, start.endOf('month').startOf('day')];
    case DateGroupCondition.Year:
      return [start, start.endOf('year').startOf('day')];
    default:
      return [start, start];
  }
}

/**
 * Desktop's `chartCategoryFilter`: the clicked category as a rule the drill-down
 * can show and edit, built from the same predicates the filter editors write.
 * Date keys, checkbox flags and option ids are authoritative; labels are only
 * matched for select options, which charts group by name. Returns null when
 * the category cannot be described this way.
 */
export function chartCategoryFilter({
  item,
  field,
  dateCondition,
  now = dayjs(),
}: {
  item: ChartDataItem;
  field: YDatabaseField | null | undefined;
  dateCondition: DateGroupCondition;
  now?: Dayjs;
}): DetachedFilter | null {
  if (!field) return null;

  const fieldId = String(field.get(YjsDatabaseKey.id));
  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  if (!isChartRowFilterFieldType(fieldType)) return null;

  const rule = (condition: number, content?: string): DetachedFilter => ({
    [YjsDatabaseKey.id]: `chart-category-${fieldId}`,
    [YjsDatabaseKey.field_id]: fieldId,
    [YjsDatabaseKey.type]: fieldType,
    [YjsDatabaseKey.filter_type]: FilterType.Data,
    [YjsDatabaseKey.condition]: condition,
    ...(content === undefined ? {} : { [YjsDatabaseKey.content]: content }),
  });

  switch (fieldType) {
    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      if (item.isEmptyCategory) return rule(SelectOptionFilterCondition.OptionIsEmpty, '');

      // Options sharing a name form one bucket, so all of them belong to the rule.
      const optionIds = (parseSelectOptionTypeOptions(field)?.options ?? [])
        .filter((option) => option && (option.name || option.id) === item.label)
        .map((option) => option.id);

      if (optionIds.length === 0) return null;

      return rule(
        fieldType === FieldType.MultiSelect
          ? SelectOptionFilterCondition.OptionContains
          : SelectOptionFilterCondition.OptionIs,
        optionIds.join(',')
      );
    }

    case FieldType.Checkbox:
      if (item.isCheckedCategory === undefined) return null;
      return rule(item.isCheckedCategory ? CheckboxFilterCondition.IsChecked : CheckboxFilterCondition.IsUnChecked);
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime: {
      if (item.isEmptyCategory) return rule(DateFilterCondition.DateStartIsEmpty, '');

      const range = item.sortKey ? bucketDayRange(item.sortKey, dateCondition, now) : null;

      if (!range) return null;

      const [start, end] = range;

      // The filter editors store local midnights.
      return start.isSame(end, 'day')
        ? rule(DateFilterCondition.DateStartsOn, JSON.stringify({ timestamp: start.unix() }))
        : rule(DateFilterCondition.DateStartsBetween, JSON.stringify({ start: start.unix(), end: end.unix() }));
    }

    default:
      return null;
  }
}
