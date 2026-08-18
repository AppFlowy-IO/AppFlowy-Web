import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import {
  CheckboxFilterCondition,
  ChecklistFilterCondition,
  DateFilter,
  DateFilterCondition,
  FieldType,
  Filter,
  NumberFilterCondition,
  parseSelectOptionTypeOptions,
  PersonFilter,
  PersonFilterCondition,
  RelationFilterCondition,
  SelectOptionFilter,
  SelectOptionFilterCondition,
  TextFilterCondition,
  toStartDateCondition,
  useFieldSelector,
} from '@/application/database-yjs';
import { isNumericRollupField } from '@/application/database-yjs/rollup/utils';
import { DateFormat, YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getDateFormat } from '@/utils/time';

export interface FilterChipLabel {
  /** Human description shown after "FieldName: " — mirrors desktop `getContentDescription`. */
  description: string;
  /**
   * Whether the filter carries a value — mirrors desktop `getContent().isNotEmpty`.
   * Drives the highlighted (blue) chip state, and whether the description is shown at all.
   */
  hasContent: boolean;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

// Desktop: TextFilterConditionPBExtension.choicechipPrefix (Morn branch — Contains has a prefix).
function textChipPrefix(condition: TextFilterCondition, t: Translate): string {
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

function textChipLabel(condition: TextFilterCondition, content: string, t: Translate): FilterChipLabel {
  const prefix = textChipPrefix(condition, t);

  if (condition === TextFilterCondition.TextIsEmpty || condition === TextFilterCondition.TextIsNotEmpty) {
    // Desktop forces content to '' for these conditions, so the chip stays plain.
    return { description: prefix, hasContent: false };
  }

  return {
    description: content ? `${prefix} ${content}`.trim() : prefix,
    hasContent: content.length > 0,
  };
}

// Desktop: NumberFilterConditionPBExtension.shortName — symbols, not words.
export function numberConditionShortName(condition: NumberFilterCondition, t: Translate): string {
  switch (condition) {
    case NumberFilterCondition.Equal:
      return '=';
    case NumberFilterCondition.NotEqual:
      return '≠';
    case NumberFilterCondition.LessThan:
      return '<';
    case NumberFilterCondition.LessThanOrEqualTo:
      return '≤';
    case NumberFilterCondition.GreaterThan:
      return '>';
    case NumberFilterCondition.GreaterThanOrEqualTo:
      return '≥';
    case NumberFilterCondition.NumberIsEmpty:
      return t('grid.numberFilter.isEmpty');
    case NumberFilterCondition.NumberIsNotEmpty:
      return t('grid.numberFilter.isNotEmpty');
    default:
      return '';
  }
}

function numberChipLabel(condition: NumberFilterCondition, content: string, t: Translate): FilterChipLabel {
  const shortName = numberConditionShortName(condition, t);

  if (condition === NumberFilterCondition.NumberIsEmpty || condition === NumberFilterCondition.NumberIsNotEmpty) {
    return { description: shortName, hasContent: false };
  }

  return {
    description: content ? `${shortName} ${content}` : shortName,
    hasContent: content.length > 0,
  };
}

function selectOptionConditionName(condition: SelectOptionFilterCondition, t: Translate): string {
  switch (condition) {
    case SelectOptionFilterCondition.OptionIs:
      return t('grid.selectOptionFilter.is');
    case SelectOptionFilterCondition.OptionIsNot:
      return t('grid.selectOptionFilter.isNot');
    case SelectOptionFilterCondition.OptionContains:
      return t('grid.selectOptionFilter.contains');
    case SelectOptionFilterCondition.OptionDoesNotContain:
      return t('grid.selectOptionFilter.doesNotContain');
    case SelectOptionFilterCondition.OptionIsEmpty:
      return t('grid.selectOptionFilter.isEmpty');
    case SelectOptionFilterCondition.OptionIsNotEmpty:
      return t('grid.selectOptionFilter.isNotEmpty');
    default:
      return '';
  }
}

function selectChipLabel(filter: SelectOptionFilter, field: YDatabaseField, t: Translate): FilterChipLabel {
  const conditionName = selectOptionConditionName(filter.condition, t);
  const canAttachContent =
    filter.condition !== SelectOptionFilterCondition.OptionIsEmpty &&
    filter.condition !== SelectOptionFilterCondition.OptionIsNotEmpty;
  const optionIds = (filter.optionIds ?? []).filter(Boolean);

  if (!canAttachContent || optionIds.length === 0) {
    return { description: conditionName, hasContent: false };
  }

  // Selected option names in field option order, matching desktop.
  const typeOption = parseSelectOptionTypeOptions(field);
  const optionIdSet = new Set(optionIds);
  const optionNames = (typeOption?.options ?? [])
    .filter((option) => option && optionIdSet.has(option.id))
    .map((option) => option.name)
    .join(', ');

  return {
    description: optionNames ? `${conditionName} ${optionNames}` : conditionName,
    hasContent: optionNames.length > 0,
  };
}

function dateChipLabel(filter: DateFilter, dateFormat: string, t: Translate): FilterChipLabel {
  const base = toStartDateCondition(filter.condition);
  const format = (unix: number) => dayjs.unix(unix).format(dateFormat);

  let description: string;

  switch (base) {
    case DateFilterCondition.DateStartsToday:
      description = t('relativeDates.today');
      break;
    case DateFilterCondition.DateStartsYesterday:
      description = t('relativeDates.yesterday');
      break;
    case DateFilterCondition.DateStartsTomorrow:
      description = t('relativeDates.tomorrow');
      break;
    case DateFilterCondition.DateStartsThisWeek:
      description = t('relativeDates.thisWeek');
      break;
    case DateFilterCondition.DateStartsLastWeek:
      description = t('relativeDates.lastWeek');
      break;
    case DateFilterCondition.DateStartsNextWeek:
      description = t('relativeDates.nextWeek');
      break;
    case DateFilterCondition.DateStartIsEmpty:
      description = t('grid.dateFilter.choicechipPrefix.isEmpty');
      break;
    case DateFilterCondition.DateStartIsNotEmpty:
      description = t('grid.dateFilter.choicechipPrefix.isNotEmpty');
      break;
    case DateFilterCondition.DateStartsBetween: {
      const prefix = t('grid.dateFilter.choicechipPrefix.between');

      description =
        typeof filter.start === 'number' && typeof filter.end === 'number'
          ? `${prefix} ${format(filter.start)} - ${format(filter.end)}`
          : prefix;
      break;
    }

    case DateFilterCondition.DateStartsOn:
      description = typeof filter.timestamp === 'number' ? format(filter.timestamp) : '';
      break;
    default: {
      // before / after / onOrBefore / onOrAfter
      const prefix =
        base === DateFilterCondition.DateStartsBefore
          ? t('grid.dateFilter.choicechipPrefix.before')
          : base === DateFilterCondition.DateStartsAfter
          ? t('grid.dateFilter.choicechipPrefix.after')
          : base === DateFilterCondition.DateStartsOnOrBefore
          ? t('grid.dateFilter.choicechipPrefix.onOrBefore')
          : t('grid.dateFilter.choicechipPrefix.onOrAfter');

      description = typeof filter.timestamp === 'number' ? `${prefix} ${format(filter.timestamp)}` : prefix;
      break;
    }
  }

  // Desktop DateTimeFilter inherits getContent = getContentDescription, so any
  // non-empty description highlights the chip.
  return { description, hasContent: description.length > 0 };
}

function personChipLabel(filter: PersonFilter, t: Translate): FilterChipLabel {
  const conditionName = personConditionName(filter.condition, t);
  const canAttachContent =
    filter.condition !== PersonFilterCondition.PersonIsEmpty &&
    filter.condition !== PersonFilterCondition.PersonIsNotEmpty;
  const userIds = filter.userIds ?? [];

  if (!canAttachContent || userIds.length === 0) {
    return { description: conditionName, hasContent: false };
  }

  return {
    description: `${conditionName}: ${t('grid.person.count', { count: userIds.length })}`,
    hasContent: true,
  };
}

function personConditionName(condition: PersonFilterCondition, t: Translate): string {
  switch (condition) {
    case PersonFilterCondition.PersonContains:
      return t('grid.personFilter.contains');
    case PersonFilterCondition.PersonDoesNotContain:
      return t('grid.personFilter.doesNotContain');
    case PersonFilterCondition.PersonIsEmpty:
      return t('grid.personFilter.isEmpty');
    case PersonFilterCondition.PersonIsNotEmpty:
      return t('grid.personFilter.isNotEmpty');
    default:
      return '';
  }
}

function parseRelationRowIds(content: string | undefined): string[] {
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);

    return Array.isArray(parsed) ? parsed.map((id) => String(id)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function relationChipLabel(filter: Filter, t: Translate): FilterChipLabel {
  // Legacy conditions 6/7 normalize to isEmpty/isNotEmpty, matching desktop.
  const condition =
    filter.condition === RelationFilterCondition.RelationLegacyTextIsEmpty
      ? RelationFilterCondition.RelationIsEmpty
      : filter.condition === RelationFilterCondition.RelationLegacyTextIsNotEmpty
      ? RelationFilterCondition.RelationIsNotEmpty
      : filter.condition;

  // Desktop relation conditions reuse the text filter strings.
  const conditionName =
    condition === RelationFilterCondition.RelationContains
      ? t('grid.textFilter.contains')
      : condition === RelationFilterCondition.RelationDoesNotContain
      ? t('grid.textFilter.doesNotContain')
      : condition === RelationFilterCondition.RelationIsEmpty
      ? t('grid.textFilter.isEmpty')
      : t('grid.textFilter.isNotEmpty');

  const canAttachContent =
    condition === RelationFilterCondition.RelationContains ||
    condition === RelationFilterCondition.RelationDoesNotContain;
  const rowIds = parseRelationRowIds(filter.content);

  if (!canAttachContent || rowIds.length === 0) {
    return { description: conditionName, hasContent: false };
  }

  return { description: `${conditionName} (${rowIds.length})`, hasContent: true };
}

/**
 * Chip label for a filter, matching the desktop choice chip exactly:
 * the chip reads `FieldName: <description>` when `hasContent` is true and
 * plain `FieldName` otherwise (desktop `ChoiceChipButton`).
 */
export function useFilterChipLabel(filter: Filter | null): FilterChipLabel & { field: YDatabaseField | undefined } {
  const { t } = useTranslation();
  // The field is returned alongside the label so chip components don't attach
  // a second useFieldSelector subscription on the same field.
  const { field } = useFieldSelector(filter?.fieldId ?? '');
  const currentUser = useCurrentUser();
  const dateFormat = getDateFormat(
    (currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) ?? DateFormat.Local
  );

  // Deliberately NOT memoized: `field` is a Yjs map that mutates in place with
  // a stable identity, so a useMemo keyed on it would serve stale labels after
  // field-config edits (e.g. renaming a select option). useFieldSelector
  // re-renders us via its internal clock; the label is cheap string assembly.
  return { ...buildChipLabel(filter, field, dateFormat, t), field };
}

function buildChipLabel(
  filter: Filter | null,
  field: YDatabaseField | undefined,
  dateFormat: string,
  t: Translate
): FilterChipLabel {
  if (!filter || !field) return { description: '', hasContent: false };

  const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;

  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
      return textChipLabel(filter.condition as TextFilterCondition, filter.content ?? '', t);
    case FieldType.Number:
    case FieldType.Time:
      return numberChipLabel(filter.condition as NumberFilterCondition, filter.content ?? '', t);
    case FieldType.Rollup:
      return isNumericRollupField(field)
        ? numberChipLabel(filter.condition as NumberFilterCondition, filter.content ?? '', t)
        : textChipLabel(filter.condition as TextFilterCondition, filter.content ?? '', t);
    case FieldType.Checkbox:
      return {
        description:
          filter.condition === CheckboxFilterCondition.IsChecked
            ? t('grid.checkboxFilter.isChecked')
            : t('grid.checkboxFilter.isUnchecked'),
        hasContent: true,
      };
    case FieldType.Checklist:
      return {
        description:
          filter.condition === ChecklistFilterCondition.IsComplete
            ? t('grid.checklistFilter.isComplete')
            : t('grid.checklistFilter.isIncomplted'),
        hasContent: true,
      };
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return selectChipLabel(filter as SelectOptionFilter, field, t);
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return dateChipLabel(filter as DateFilter, dateFormat, t);
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
      return personChipLabel(filter as PersonFilter, t);
    case FieldType.Relation:
      return relationChipLabel(filter, t);
    default:
      return { description: '', hasContent: false };
  }
}
