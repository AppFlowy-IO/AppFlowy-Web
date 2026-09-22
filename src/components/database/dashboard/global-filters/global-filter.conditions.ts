import dayjs from 'dayjs';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { CheckboxFilterCondition } from '@/application/database-yjs/fields/checkbox/checkbox.type';
import { ChecklistFilterCondition } from '@/application/database-yjs/fields/checklist/checklist.type';
import { DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import {
  isRelativeDateCondition,
  isStartDateCondition,
  toEndDateCondition,
  toStartDateCondition,
} from '@/application/database-yjs/fields/date/relativeDate';
import { NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { PersonFilterCondition } from '@/application/database-yjs/fields/person/person.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import { numberConditionShortName } from '@/components/database/components/filters/overview/useFilterChipLabel';

import { countGlobalFilterSources, GlobalFilterSource, GlobalFilterSourceField } from './global-filter.utils';

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface GlobalFilterConditionOption {
  value: number;
  text: string;
}

/**
 * Condition lists per property type. They match the single-view filter editors
 * (same values, same order, same labels), so a dashboard filter's
 * `{condition, content}` is interchangeable with a view filter of that type.
 */
export function getGlobalFilterConditions(
  fieldType: FieldType,
  condition: number,
  t: Translate
): GlobalFilterConditionOption[] {
  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
      return [
        { value: TextFilterCondition.TextIs, text: t('grid.textFilter.is') },
        { value: TextFilterCondition.TextIsNot, text: t('grid.textFilter.isNot') },
        { value: TextFilterCondition.TextContains, text: t('grid.textFilter.contains') },
        { value: TextFilterCondition.TextDoesNotContain, text: t('grid.textFilter.doesNotContain') },
        { value: TextFilterCondition.TextStartsWith, text: t('grid.textFilter.startWith') },
        { value: TextFilterCondition.TextEndsWith, text: t('grid.textFilter.endsWith') },
        { value: TextFilterCondition.TextIsEmpty, text: t('grid.textFilter.isEmpty') },
        { value: TextFilterCondition.TextIsNotEmpty, text: t('grid.textFilter.isNotEmpty') },
      ];
    case FieldType.Number:
      return [
        { value: NumberFilterCondition.Equal, text: t('grid.numberFilter.equal') },
        { value: NumberFilterCondition.NotEqual, text: t('grid.numberFilter.notEqual') },
        { value: NumberFilterCondition.LessThan, text: t('grid.numberFilter.lessThan') },
        { value: NumberFilterCondition.LessThanOrEqualTo, text: t('grid.numberFilter.lessThanOrEqualTo') },
        { value: NumberFilterCondition.GreaterThan, text: t('grid.numberFilter.greaterThan') },
        { value: NumberFilterCondition.GreaterThanOrEqualTo, text: t('grid.numberFilter.greaterThanOrEqualTo') },
        { value: NumberFilterCondition.NumberIsEmpty, text: t('grid.numberFilter.isEmpty') },
        { value: NumberFilterCondition.NumberIsNotEmpty, text: t('grid.numberFilter.isNotEmpty') },
      ];
    case FieldType.SingleSelect:
      return [
        { value: SelectOptionFilterCondition.OptionIs, text: t('grid.selectOptionFilter.is') },
        { value: SelectOptionFilterCondition.OptionIsNot, text: t('grid.selectOptionFilter.isNot') },
        { value: SelectOptionFilterCondition.OptionIsEmpty, text: t('grid.selectOptionFilter.isEmpty') },
        { value: SelectOptionFilterCondition.OptionIsNotEmpty, text: t('grid.selectOptionFilter.isNotEmpty') },
      ];
    case FieldType.MultiSelect:
      return [
        { value: SelectOptionFilterCondition.OptionContains, text: t('grid.selectOptionFilter.contains') },
        { value: SelectOptionFilterCondition.OptionDoesNotContain, text: t('grid.selectOptionFilter.doesNotContain') },
        { value: SelectOptionFilterCondition.OptionIsEmpty, text: t('grid.selectOptionFilter.isEmpty') },
        { value: SelectOptionFilterCondition.OptionIsNotEmpty, text: t('grid.selectOptionFilter.isNotEmpty') },
      ];
    case FieldType.Checkbox:
      // A dropdown entry needs the verb ("Is checked"); the chip keeps the view wording ("Checked").
      return [
        {
          value: CheckboxFilterCondition.IsChecked,
          text: t('dashboard.globalFilters.isChecked', { defaultValue: 'Is checked' }),
        },
        {
          value: CheckboxFilterCondition.IsUnChecked,
          text: t('dashboard.globalFilters.isUnchecked', { defaultValue: 'Is unchecked' }),
        },
      ];
    case FieldType.Checklist:
      return [
        { value: ChecklistFilterCondition.IsComplete, text: t('grid.checklistFilter.isComplete') },
        { value: ChecklistFilterCondition.IsIncomplete, text: t('grid.checklistFilter.isIncomplted') },
      ];
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime: {
      const start = fieldType !== FieldType.DateTime || isStartDateCondition(condition);
      const pick = (value: DateFilterCondition) => (start ? value : toEndDateCondition(value));
      const isRowTime = fieldType !== FieldType.DateTime;

      return [
        { value: pick(DateFilterCondition.DateStartsOn), text: t('grid.dateFilter.is') },
        { value: pick(DateFilterCondition.DateStartsBefore), text: t('grid.dateFilter.before') },
        { value: pick(DateFilterCondition.DateStartsAfter), text: t('grid.dateFilter.after') },
        { value: pick(DateFilterCondition.DateStartsOnOrBefore), text: t('grid.dateFilter.onOrBefore') },
        { value: pick(DateFilterCondition.DateStartsOnOrAfter), text: t('grid.dateFilter.onOrAfter') },
        { value: pick(DateFilterCondition.DateStartsBetween), text: t('grid.dateFilter.between') },
        ...(isRowTime
          ? []
          : [
              { value: pick(DateFilterCondition.DateStartIsEmpty), text: t('grid.dateFilter.empty') },
              { value: pick(DateFilterCondition.DateStartIsNotEmpty), text: t('grid.dateFilter.notEmpty') },
            ]),
        { value: pick(DateFilterCondition.DateStartsToday), text: t('relativeDates.today') },
        { value: pick(DateFilterCondition.DateStartsYesterday), text: t('relativeDates.yesterday') },
        { value: pick(DateFilterCondition.DateStartsTomorrow), text: t('relativeDates.tomorrow') },
        { value: pick(DateFilterCondition.DateStartsThisWeek), text: t('relativeDates.thisWeek') },
        { value: pick(DateFilterCondition.DateStartsLastWeek), text: t('relativeDates.lastWeek') },
        { value: pick(DateFilterCondition.DateStartsNextWeek), text: t('relativeDates.nextWeek') },
      ];
    }

    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      return [
        { value: PersonFilterCondition.PersonContains, text: t('grid.personFilter.contains') },
        { value: PersonFilterCondition.PersonDoesNotContain, text: t('grid.personFilter.doesNotContain') },
        { value: PersonFilterCondition.PersonIsEmpty, text: t('grid.personFilter.isEmpty') },
        { value: PersonFilterCondition.PersonIsNotEmpty, text: t('grid.personFilter.isNotEmpty') },
      ];
    default:
      return [];
  }
}

// Condition labels per translator, keyed by condition list (a DateTime list
// depends on the start / end side), so a chip label is a map lookup instead of
// a rebuilt list.
const conditionLabelCache = new WeakMap<Translate, Map<string, Map<number, string>>>();

/** The label `getGlobalFilterConditions` gives `condition` (empty when it is not listed). */
export function getGlobalFilterConditionText(fieldType: FieldType, condition: number, t: Translate): string {
  let lists = conditionLabelCache.get(t);

  if (!lists) {
    lists = new Map();
    conditionLabelCache.set(t, lists);
  }

  const key =
    fieldType === FieldType.DateTime ? `${fieldType}:${isStartDateCondition(condition) ? 'start' : 'end'}` : `${fieldType}`;
  let labels = lists.get(key);

  if (!labels) {
    labels = new Map(getGlobalFilterConditions(fieldType, condition, t).map((option) => [option.value, option.text]));
    lists.set(key, labels);
  }

  return labels.get(condition) ?? '';
}

export function isDateFieldType(fieldType: FieldType) {
  return (
    fieldType === FieldType.DateTime || fieldType === FieldType.CreatedTime || fieldType === FieldType.LastEditedTime
  );
}

export function isPersonFieldType(fieldType: FieldType) {
  return fieldType === FieldType.Person || fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy;
}

export function isDateRangeCondition(condition: number) {
  return condition === DateFilterCondition.DateStartsBetween || condition === DateFilterCondition.DateEndsBetween;
}

const DATE_EMPTINESS_CONDITIONS: ReadonlySet<number> = new Set([
  DateFilterCondition.DateStartIsEmpty,
  DateFilterCondition.DateStartIsNotEmpty,
  DateFilterCondition.DateEndIsEmpty,
  DateFilterCondition.DateEndIsNotEmpty,
]);

/** Whether the condition alone decides the filter, so no value control is shown. */
export function conditionHidesContent(fieldType: FieldType, condition: number): boolean {
  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
      return condition === TextFilterCondition.TextIsEmpty || condition === TextFilterCondition.TextIsNotEmpty;
    case FieldType.Number:
      return condition === NumberFilterCondition.NumberIsEmpty || condition === NumberFilterCondition.NumberIsNotEmpty;
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return (
        condition === SelectOptionFilterCondition.OptionIsEmpty ||
        condition === SelectOptionFilterCondition.OptionIsNotEmpty
      );
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      return condition === PersonFilterCondition.PersonIsEmpty || condition === PersonFilterCondition.PersonIsNotEmpty;
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return isRelativeDateCondition(condition) || DATE_EMPTINESS_CONDITIONS.has(condition);
    default:
      return true;
  }
}

export interface GlobalFilterDateValue {
  timestamp?: number;
  start?: number;
  end?: number;
}

/** Date content in the view-filter encoding: `{"timestamp"}` or `{"start","end"}` (unix seconds). */
export function parseDateContent(content: string): GlobalFilterDateValue {
  if (!content) return {};

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const read = (value: unknown) =>
      value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
        ? undefined
        : Number(value);

    return { timestamp: read(parsed.timestamp), start: read(parsed.start), end: read(parsed.end) };
  } catch {
    return {};
  }
}

/**
 * Date content for a picked value. A cleared picker yields empty content (the
 * filter then narrows nothing) rather than a `null` date.
 */
export function serializeDateContent(range: boolean, value: GlobalFilterDateValue): string {
  if (range ? value.start === undefined && value.end === undefined : value.timestamp === undefined) return '';
  // Desktop deserializes Option<i64>: write null (never '') for a missing range bound.
  return JSON.stringify(range ? { start: value.start ?? null, end: value.end } : { timestamp: value.timestamp });
}

/** Whether date content holds the date(s) its condition needs (a range needs both bounds). */
export function hasRequiredDate(condition: number, content: string): boolean {
  const value = parseDateContent(content);

  return isDateRangeCondition(condition)
    ? value.start !== undefined && value.end !== undefined
    : value.timestamp !== undefined;
}

/**
 * Condition switch for a filter: keeps the content shape valid for the new
 * condition (a single date becomes a range start and vice versa).
 */
export function applyConditionChange(filter: DashboardGlobalFilter, condition: number): DashboardGlobalFilter {
  if (filter.condition === condition) return filter;
  if (!isDateFieldType(filter.fieldType)) return { ...filter, condition };
  const wasRange = isDateRangeCondition(filter.condition);
  const isRange = isDateRangeCondition(condition);

  if (wasRange === isRange || !filter.content) return { ...filter, condition };
  const value = parseDateContent(filter.content);
  const content = isRange
    ? serializeDateContent(true, { start: value.timestamp, end: value.timestamp })
    : serializeDateContent(false, { timestamp: value.start });

  return { ...filter, condition, content };
}

/** Switch a DateTime filter between the start-date and end-date variants of its condition. */
export function toggleDateConditionSide(condition: number, start: boolean): number {
  return start ? toStartDateCondition(condition) : toEndDateCondition(condition);
}

function parseIdList(content: string): string[] {
  const trimmed = content.trim();

  if (!trimmed) return [];

  // Person ids are stored as a JSON array; anything else is a comma-separated list.
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed)) return parsed.map((id) => String(id)).filter(Boolean);
    } catch {
      // Not JSON after all: read it as a list.
    }
  }

  return trimmed
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function parsePersonContent(content: string): string[] {
  return parseIdList(content);
}

export function parseOptionContent(content: string): string[] {
  return content.split(',').filter(Boolean);
}

/**
 * Whether the filter currently narrows any widget. Mirrors the evaluator's
 * `isDataFilterEffective` (a filter without a value is ignored) and requires at
 * least one usable mapped source (see `countGlobalFilterSources`).
 */
export function isGlobalFilterActive(filter: DashboardGlobalFilter, sources?: GlobalFilterSource[]): boolean {
  if (countGlobalFilterSources(filter, sources) === 0) return false;
  const { fieldType, condition, content } = filter;

  switch (fieldType) {
    case FieldType.Checkbox:
    case FieldType.Checklist:
      return true;
    case FieldType.RichText:
    case FieldType.URL:
      return conditionHidesContent(fieldType, condition) || content.length > 0;
    case FieldType.Number:
      return conditionHidesContent(fieldType, condition) || content.trim().length > 0;
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return conditionHidesContent(fieldType, condition) || parseOptionContent(content).length > 0;
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      return conditionHidesContent(fieldType, condition) || parseIdList(content).length > 0;
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return conditionHidesContent(fieldType, condition) || hasRequiredDate(condition, content);
    default:
      return false;
  }
}

function textChipPrefix(condition: number, t: Translate): string {
  switch (condition) {
    case TextFilterCondition.TextDoesNotContain:
    case TextFilterCondition.TextIsNot:
      return t('grid.textFilter.choicechipPrefix.isNot');
    case TextFilterCondition.TextEndsWith:
      return t('grid.textFilter.choicechipPrefix.endWith');
    case TextFilterCondition.TextStartsWith:
      return t('grid.textFilter.choicechipPrefix.startWith');
    case TextFilterCondition.TextIsEmpty:
      return t('grid.textFilter.choicechipPrefix.isEmpty');
    case TextFilterCondition.TextIsNotEmpty:
      return t('grid.textFilter.choicechipPrefix.isNotEmpty');
    case TextFilterCondition.TextContains:
      return t('grid.textFilter.contains');
    default:
      return '';
  }
}

function dateChipDescription(filter: DashboardGlobalFilter, dateFormat: string, t: Translate): string {
  const base = toStartDateCondition(filter.condition);
  const value = parseDateContent(filter.content);
  const format = (unix: number) => dayjs(unix * 1000).format(dateFormat);

  switch (base) {
    case DateFilterCondition.DateStartsToday:
      return t('relativeDates.today');
    case DateFilterCondition.DateStartsYesterday:
      return t('relativeDates.yesterday');
    case DateFilterCondition.DateStartsTomorrow:
      return t('relativeDates.tomorrow');
    case DateFilterCondition.DateStartsThisWeek:
      return t('relativeDates.thisWeek');
    case DateFilterCondition.DateStartsLastWeek:
      return t('relativeDates.lastWeek');
    case DateFilterCondition.DateStartsNextWeek:
      return t('relativeDates.nextWeek');
    case DateFilterCondition.DateStartIsEmpty:
      return t('grid.dateFilter.choicechipPrefix.isEmpty');
    case DateFilterCondition.DateStartIsNotEmpty:
      return t('grid.dateFilter.choicechipPrefix.isNotEmpty');
    case DateFilterCondition.DateStartsBetween: {
      const prefix = t('grid.dateFilter.choicechipPrefix.between');

      return value.start !== undefined && value.end !== undefined
        ? `${prefix} ${format(value.start)} - ${format(value.end)}`
        : prefix;
    }

    case DateFilterCondition.DateStartsOn:
      return value.timestamp !== undefined ? format(value.timestamp) : '';
    default: {
      const prefix =
        base === DateFilterCondition.DateStartsBefore
          ? t('grid.dateFilter.choicechipPrefix.before')
          : base === DateFilterCondition.DateStartsAfter
          ? t('grid.dateFilter.choicechipPrefix.after')
          : base === DateFilterCondition.DateStartsOnOrBefore
          ? t('grid.dateFilter.choicechipPrefix.onOrBefore')
          : t('grid.dateFilter.choicechipPrefix.onOrAfter');

      return value.timestamp !== undefined ? `${prefix} ${format(value.timestamp)}` : prefix;
    }
  }
}

function conditionText(filter: DashboardGlobalFilter, t: Translate) {
  return getGlobalFilterConditionText(filter.fieldType, filter.condition, t);
}

/**
 * The condition summary shown after "Name: " on a chip, formatted like the
 * single-view filter chips (`useFilterChipLabel`).
 */
export function getGlobalFilterDescription(
  filter: DashboardGlobalFilter,
  {
    primaryField,
    dateFormat,
    t,
  }: {
    /** The primary target's property; supplies option names for select content. */
    primaryField?: GlobalFilterSourceField;
    dateFormat: string;
    t: Translate;
  }
): string {
  const { fieldType, condition, content } = filter;

  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL: {
      const prefix = textChipPrefix(condition, t);

      if (conditionHidesContent(fieldType, condition)) return prefix;
      return content ? `${prefix} ${content}`.trim() : prefix;
    }

    case FieldType.Number: {
      const shortName = numberConditionShortName(condition, t);

      if (conditionHidesContent(fieldType, condition)) return shortName;
      return content ? `${shortName} ${content}` : shortName;
    }

    case FieldType.Checkbox:
      return condition === CheckboxFilterCondition.IsChecked
        ? t('grid.checkboxFilter.isChecked')
        : t('grid.checkboxFilter.isUnchecked');
    case FieldType.Checklist:
      return conditionText(filter, t);
    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      const name = conditionText(filter, t);
      const selected = new Set(parseOptionContent(content));

      if (conditionHidesContent(fieldType, condition) || selected.size === 0) return name;
      const names = (primaryField?.options ?? [])
        .filter((option) => selected.has(option.id))
        .map((option) => option.name)
        .join(', ');

      return names ? `${name} ${names}` : `${name} (${selected.size})`;
    }

    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return dateChipDescription(filter, dateFormat, t);
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy: {
      const name = conditionText(filter, t);
      const userIds = parsePersonContent(content);

      if (conditionHidesContent(fieldType, condition) || userIds.length === 0) return name;
      return `${name}: ${t('grid.person.count', { count: userIds.length })}`;
    }

    default:
      return '';
  }
}

/**
 * Chip text: `Name: summary` while the filter narrows widgets, the bare name
 * otherwise. Pass `active` when it is already known (see `isGlobalFilterActive`).
 */
export function getGlobalFilterChipText(
  filter: DashboardGlobalFilter,
  description: string,
  fallbackName: string,
  active: boolean = isGlobalFilterActive(filter)
) {
  const name = filter.name.trim() || fallbackName;

  return active && description ? `${name}: ${description}` : name;
}

/** Localized property-type name (same strings as the property type picker). */
export function getFieldTypeName(type: FieldType, t: Translate): string {
  switch (type) {
    case FieldType.RichText:
      return t('grid.field.textFieldName');
    case FieldType.Number:
      return t('grid.field.numberFieldName');
    case FieldType.DateTime:
      return t('grid.field.dateFieldName');
    case FieldType.SingleSelect:
      return t('grid.field.singleSelectFieldName');
    case FieldType.MultiSelect:
      return t('grid.field.multiSelectFieldName');
    case FieldType.Checkbox:
      return t('grid.field.checkboxFieldName');
    case FieldType.URL:
      return t('grid.field.urlFieldName');
    case FieldType.Checklist:
      return t('grid.field.checklistFieldName');
    case FieldType.LastEditedTime:
      return t('grid.field.updatedAtFieldName');
    case FieldType.CreatedTime:
      return t('grid.field.createdAtFieldName');
    case FieldType.CreatedBy:
      return t('grid.field.createdByFieldName');
    case FieldType.LastEditedBy:
      return t('grid.field.lastEditedByFieldName');
    case FieldType.Relation:
      return t('grid.field.relationFieldName');
    case FieldType.Person:
      return t('grid.field.personFieldName');
    case FieldType.Time:
      return t('grid.field.timeFieldName');
    case FieldType.Media:
      return t('grid.field.mediaFieldName');
    case FieldType.Rollup:
      return t('grid.field.rollupFieldName', { defaultValue: 'Rollup' });
    default:
      return '';
  }
}
