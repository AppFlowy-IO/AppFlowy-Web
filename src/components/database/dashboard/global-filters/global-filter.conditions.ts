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
  dateChipDescription,
  numberConditionShortName,
  personConditionName,
  selectOptionConditionName,
  textChipPrefix,
} from '@/components/database/components/filters/overview/useFilterChipLabel';
import {
  DateFilterValue,
  serializeDateFilterContent,
} from '@/components/database/components/filters/value-controls/filter-value';

import { countGlobalFilterSources, GlobalFilterSource, GlobalFilterSourceField } from './global-filter.utils';

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
      return isRelativeDateCondition(condition) || DATE_EMPTINESS_CONDITIONS.has(condition);
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
      return conditionHidesContent(fieldType, condition) || parsePersonContent(content).length > 0;
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return conditionHidesContent(fieldType, condition) || hasRequiredDate(condition, content);
    default:
      return false;
  }
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
      return condition === ChecklistFilterCondition.IsComplete
        ? t('grid.checklistFilter.isComplete')
        : t('grid.checklistFilter.isIncomplted');
    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      const name = selectOptionConditionName(condition, t);
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
      return dateChipDescription(condition, parseDateContent(content), dateFormat, t);
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy: {
      const name = personConditionName(condition, t);
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
