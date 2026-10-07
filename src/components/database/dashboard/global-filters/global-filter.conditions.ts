import dayjs from 'dayjs';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { CheckboxFilterCondition } from '@/application/database-yjs/fields/checkbox/checkbox.type';
import { ChecklistFilterCondition } from '@/application/database-yjs/fields/checklist/checklist.type';
import { DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import {
  DEFAULT_RELATIVE_DATE_SPEC,
  isParameterizedRelativeCondition,
  isPresetRelativeDateCondition,
  isStartDateCondition,
  parseRelativeDateSpec,
  relativeDateSummary,
  serializeRelativeDateSpec,
  toEndDateCondition,
  toStartDateCondition,
} from '@/application/database-yjs/fields/date/relativeDate';
import { NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { PersonFilterCondition } from '@/application/database-yjs/fields/person/person.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import {
  checklistFilterConditions,
  dateFilterConditions,
  FilterConditionOption,
  multiSelectFilterConditions,
  numberFilterConditions,
  personFilterConditions,
  singleSelectFilterConditions,
  textFilterConditions,
  Translate,
} from '@/components/database/components/filters/filter-conditions';
import {
  DateFilterValue,
  serializeDateFilterContent,
} from '@/components/database/components/filters/value-controls/filter-value';

import { countUsableTargets, GlobalFilterSource } from './global-filter.utils';

export type { Translate };
export type GlobalFilterConditionOption = FilterConditionOption;

/**
 * Condition lists per property type: the lists of the single-view filter
 * editors (`filter-conditions.ts`, same values, same order, same labels), so
 * a dashboard filter's `{condition, content}` is interchangeable with a view
 * filter of that type.
 */
export function getGlobalFilterConditions(
  fieldType: FieldType,
  condition: number,
  t: Translate
): GlobalFilterConditionOption[] {
  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
      return textFilterConditions(t);
    case FieldType.Number:
      return numberFilterConditions(t);
    case FieldType.SingleSelect:
      return singleSelectFilterConditions(t);
    case FieldType.MultiSelect:
      return multiSelectFilterConditions(t);
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
      return checklistFilterConditions(t);
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      // Only a Date property has an end date; a row time is never empty.
      return dateFilterConditions(t, {
        start: fieldType !== FieldType.DateTime || isStartDateCondition(condition),
        emptiness: fieldType === FieldType.DateTime,
      });
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      return personFilterConditions(t);
    default:
      return [];
  }
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
      // The presets carry their range; "Is relative to today" shows its builder.
      return isPresetRelativeDateCondition(condition) || DATE_EMPTINESS_CONDITIONS.has(condition);
    default:
      return true;
  }
}

export type GlobalFilterDateValue = DateFilterValue;

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
  return serializeDateFilterContent(range, value);
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
 * condition (a single date becomes a range start and vice versa). Into "Is
 * relative to today" the spec starts as This week; back to an absolute
 * condition the date is picked again.
 */
export function applyConditionChange(filter: DashboardGlobalFilter, condition: number): DashboardGlobalFilter {
  if (filter.condition === condition) return filter;
  if (!isDateFieldType(filter.fieldType)) return { ...filter, condition };
  const wasRelative = isParameterizedRelativeCondition(filter.condition);

  if (isParameterizedRelativeCondition(condition)) {
    return {
      ...filter,
      condition,
      content: wasRelative ? filter.content : serializeRelativeDateSpec(DEFAULT_RELATIVE_DATE_SPEC),
    };
  }

  if (wasRelative) return { ...filter, condition, content: '' };
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

/** The ids of person content: a JSON array (what the editors write), else a comma-separated list. */
export function parsePersonContent(content: string): string[] {
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

export function parseOptionContent(content: string): string[] {
  return content.split(',').filter(Boolean);
}

/**
 * Whether the filter currently narrows any widget. Mirrors the evaluator's
 * `isDataFilterEffective` (a filter without a value is ignored) and requires at
 * least one usable mapped source (see `countUsableTargets`).
 */
export function isGlobalFilterActive(filter: DashboardGlobalFilter, sources?: GlobalFilterSource[]): boolean {
  if (countUsableTargets(filter, sources) === 0) return false;
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
      return conditionHidesContent(fieldType, condition) || parsePersonContent(content).length > 0;
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return (
        conditionHidesContent(fieldType, condition) ||
        isParameterizedRelativeCondition(condition) ||
        hasRequiredDate(condition, content)
      );
    default:
      return false;
  }
}

const OP_DEFAULTS = {
  is: 'Is',
  isNot: 'Is not',
  doesNotContain: 'Does not contain',
  startsWith: 'Starts with',
  endsWith: 'Ends with',
  isEmpty: 'Is empty',
  isNotEmpty: 'Is not empty',
  before: 'Before',
  after: 'After',
  onOrBefore: 'On or before',
  onOrAfter: 'On or after',
  between: 'Between',
  checked: 'Checked',
  unchecked: 'Unchecked',
  complete: 'Complete',
  incomplete: 'Incomplete',
} as const;

type PillOperator = keyof typeof OP_DEFAULTS;

function operator(t: Translate, op: PillOperator) {
  return t(`dashboard.globalFilters.op.${op}`, { defaultValue: OP_DEFAULTS[op] });
}

function withValue(t: Translate, op: PillOperator, value: string) {
  return `${operator(t, op)} ${value}`;
}

export interface GlobalFilterPillLabelInput {
  /** Whether the filter narrows rows (`isGlobalFilterActive`). */
  active: boolean;
  /** The primary target's property name, when known. */
  primaryFieldName?: string;
  /** The display name of the filter's type. */
  typeName: string;
  /** Names of the selected merged options (select filters). */
  mergedNames?: string[];
  /** Display names of the selected people (person filters). */
  people?: string[];
  dateFormat: string;
  t: Translate;
}

/** The pill's name: the filter's own, else its primary property's, else its type's. */
export function getGlobalFilterPillName(
  filter: Pick<DashboardGlobalFilter, 'name'>,
  primaryFieldName: string | undefined,
  typeName: string
) {
  return filter.name.trim() || primaryFieldName || typeName;
}

function selectSummary(filter: DashboardGlobalFilter, mergedNames: string[] | undefined, t: Translate) {
  const { fieldType, condition, content } = filter;
  const names = mergedNames?.length ? mergedNames.join(', ') : `(${parseOptionContent(content).length})`;
  const defaultCondition =
    fieldType === FieldType.SingleSelect
      ? SelectOptionFilterCondition.OptionIs
      : SelectOptionFilterCondition.OptionContains;

  switch (condition) {
    case SelectOptionFilterCondition.OptionIsEmpty:
      return operator(t, 'isEmpty');
    case SelectOptionFilterCondition.OptionIsNotEmpty:
      return operator(t, 'isNotEmpty');
    case SelectOptionFilterCondition.OptionIsNot:
      return withValue(t, 'isNot', names);
    case SelectOptionFilterCondition.OptionDoesNotContain:
      return withValue(t, 'doesNotContain', names);
    case SelectOptionFilterCondition.OptionIs:
      return condition === defaultCondition ? names : withValue(t, 'is', names);
    default:
      return names;
  }
}

/**
 * The start-date condition that reads the same as `condition` ("ends before"
 * reads "Before"). Not `toStartDateCondition`: the side toggle pairs "starts
 * before" with "ends after".
 */
function sameWordingStartCondition(condition: number): number {
  if (condition >= DateFilterCondition.DateEndsOn && condition <= DateFilterCondition.DateEndIsNotEmpty) {
    return condition - (DateFilterCondition.DateEndsOn - DateFilterCondition.DateStartsOn);
  }

  if (condition >= DateFilterCondition.DateEndsToday && condition <= DateFilterCondition.DateEndsNextWeek) {
    return condition - (DateFilterCondition.DateEndsToday - DateFilterCondition.DateStartsToday);
  }

  return condition === DateFilterCondition.DateEndsRelative ? DateFilterCondition.DateStartsRelative : condition;
}

function dateSummary(condition: number, content: string, dateFormat: string, t: Translate) {
  const base = sameWordingStartCondition(condition);
  const value = parseDateContent(content);
  const format = (unix: number | undefined) => (unix === undefined ? '' : dayjs.unix(unix).format(dateFormat));

  switch (base) {
    case DateFilterCondition.DateStartsRelative:
      return relativeDateSummary(parseRelativeDateSpec(content), t);
    case DateFilterCondition.DateStartsToday:
      return t('relativeDates.today', { defaultValue: 'Today' });
    case DateFilterCondition.DateStartsYesterday:
      return t('relativeDates.yesterday', { defaultValue: 'Yesterday' });
    case DateFilterCondition.DateStartsTomorrow:
      return t('relativeDates.tomorrow', { defaultValue: 'Tomorrow' });
    case DateFilterCondition.DateStartsThisWeek:
      return t('relativeDates.thisWeek', { defaultValue: 'This week' });
    case DateFilterCondition.DateStartsLastWeek:
      return t('relativeDates.lastWeek', { defaultValue: 'Last week' });
    case DateFilterCondition.DateStartsNextWeek:
      return t('relativeDates.nextWeek', { defaultValue: 'Next week' });
    case DateFilterCondition.DateStartIsEmpty:
      return operator(t, 'isEmpty');
    case DateFilterCondition.DateStartIsNotEmpty:
      return operator(t, 'isNotEmpty');
    case DateFilterCondition.DateStartsBefore:
      return withValue(t, 'before', format(value.timestamp));
    case DateFilterCondition.DateStartsAfter:
      return withValue(t, 'after', format(value.timestamp));
    case DateFilterCondition.DateStartsOnOrBefore:
      return withValue(t, 'onOrBefore', format(value.timestamp));
    case DateFilterCondition.DateStartsOnOrAfter:
      return withValue(t, 'onOrAfter', format(value.timestamp));
    case DateFilterCondition.DateStartsBetween:
      return withValue(t, 'between', `${format(value.start)} – ${format(value.end)}`);
    default:
      return format(value.timestamp);
  }
}

/**
 * What a pill says after "Name: " (WP08 §1.5): the default operator of a
 * type is left out ("Status: Doing", "Amount: 5"), every other one is a short
 * word before the value ("Status: Is not Doing", "Amount: > 5").
 */
export function getGlobalFilterSummary(
  filter: DashboardGlobalFilter,
  { mergedNames, people, dateFormat, t }: Omit<GlobalFilterPillLabelInput, 'active' | 'typeName' | 'primaryFieldName'>
): string {
  const { fieldType, condition, content } = filter;

  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
      switch (condition) {
        case TextFilterCondition.TextIs:
          return withValue(t, 'is', content);
        case TextFilterCondition.TextIsNot:
          return withValue(t, 'isNot', content);
        case TextFilterCondition.TextDoesNotContain:
          return withValue(t, 'doesNotContain', content);
        case TextFilterCondition.TextStartsWith:
          return withValue(t, 'startsWith', content);
        case TextFilterCondition.TextEndsWith:
          return withValue(t, 'endsWith', content);
        case TextFilterCondition.TextIsEmpty:
          return operator(t, 'isEmpty');
        case TextFilterCondition.TextIsNotEmpty:
          return operator(t, 'isNotEmpty');
        default:
          return content;
      }

    case FieldType.Number:
      switch (condition) {
        case NumberFilterCondition.NotEqual:
          return `≠ ${content}`;
        case NumberFilterCondition.GreaterThan:
          return `> ${content}`;
        case NumberFilterCondition.LessThan:
          return `< ${content}`;
        case NumberFilterCondition.GreaterThanOrEqualTo:
          return `≥ ${content}`;
        case NumberFilterCondition.LessThanOrEqualTo:
          return `≤ ${content}`;
        case NumberFilterCondition.NumberIsEmpty:
          return operator(t, 'isEmpty');
        case NumberFilterCondition.NumberIsNotEmpty:
          return operator(t, 'isNotEmpty');
        default:
          return content;
      }

    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return selectSummary(filter, mergedNames, t);
    case FieldType.Checkbox:
      return operator(t, condition === CheckboxFilterCondition.IsChecked ? 'checked' : 'unchecked');
    case FieldType.Checklist:
      return operator(t, condition === ChecklistFilterCondition.IsComplete ? 'complete' : 'incomplete');
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return dateSummary(condition, content, dateFormat, t);
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy: {
      if (condition === PersonFilterCondition.PersonIsEmpty) return operator(t, 'isEmpty');
      if (condition === PersonFilterCondition.PersonIsNotEmpty) return operator(t, 'isNotEmpty');
      const count = parsePersonContent(content).length;
      const names = people?.length
        ? people.join(', ')
        : t('dashboard.globalFilters.people', {
            count,
            defaultValue: '{{count}} people',
            defaultValue_one: '{{count}} person',
            defaultValue_other: '{{count}} people',
          });

      return condition === PersonFilterCondition.PersonDoesNotContain ? withValue(t, 'doesNotContain', names) : names;
    }

    default:
      return '';
  }
}

/** The pill's text: the name alone while the filter narrows nothing, else `Name: summary`. */
export function getGlobalFilterPillLabel(filter: DashboardGlobalFilter, input: GlobalFilterPillLabelInput): string {
  const name = getGlobalFilterPillName(filter, input.primaryFieldName, input.typeName);

  if (!input.active) return name;
  const summary = getGlobalFilterSummary(filter, input);

  return summary ? `${name}: ${summary}` : name;
}
