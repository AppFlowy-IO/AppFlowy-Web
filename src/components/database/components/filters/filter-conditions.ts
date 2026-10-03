import { CheckboxFilterCondition } from '@/application/database-yjs/fields/checkbox/checkbox.type';
import { ChecklistFilterCondition } from '@/application/database-yjs/fields/checklist/checklist.type';
import { DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import { toEndDateCondition } from '@/application/database-yjs/fields/date/relativeDate';
import { NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { PersonFilterCondition } from '@/application/database-yjs/fields/person/person.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';

/**
 * The condition lists of the filter editors, per property type: the values a
 * condition dropdown offers, in order, with their labels. The view filter
 * menus and the dashboard's global filter editor both build their dropdowns
 * from these, so a filter's `{condition, content}` reads the same in either
 * place. (The advanced filter panel has its own, differently worded lists.)
 */

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface FilterConditionOption {
  value: number;
  text: string;
}

/** Text and URL, in protobuf ordinal order like desktop. */
export function textFilterConditions(t: Translate): FilterConditionOption[] {
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
}

/** Number, in protobuf ordinal order like desktop (=, ≠, <, ≤, >, ≥, empty, not empty), labelled in words. */
export function numberFilterConditions(t: Translate): FilterConditionOption[] {
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
}

export function singleSelectFilterConditions(t: Translate): FilterConditionOption[] {
  return [
    { value: SelectOptionFilterCondition.OptionIs, text: t('grid.selectOptionFilter.is') },
    { value: SelectOptionFilterCondition.OptionIsNot, text: t('grid.selectOptionFilter.isNot') },
    { value: SelectOptionFilterCondition.OptionIsEmpty, text: t('grid.selectOptionFilter.isEmpty') },
    { value: SelectOptionFilterCondition.OptionIsNotEmpty, text: t('grid.selectOptionFilter.isNotEmpty') },
  ];
}

export function multiSelectFilterConditions(t: Translate): FilterConditionOption[] {
  return [
    { value: SelectOptionFilterCondition.OptionContains, text: t('grid.selectOptionFilter.contains') },
    { value: SelectOptionFilterCondition.OptionDoesNotContain, text: t('grid.selectOptionFilter.doesNotContain') },
    { value: SelectOptionFilterCondition.OptionIsEmpty, text: t('grid.selectOptionFilter.isEmpty') },
    { value: SelectOptionFilterCondition.OptionIsNotEmpty, text: t('grid.selectOptionFilter.isNotEmpty') },
  ];
}

export function checkboxFilterConditions(t: Translate): FilterConditionOption[] {
  return [
    { value: CheckboxFilterCondition.IsChecked, text: t('grid.checkboxFilter.isChecked') },
    { value: CheckboxFilterCondition.IsUnChecked, text: t('grid.checkboxFilter.isUnchecked') },
  ];
}

export function checklistFilterConditions(t: Translate): FilterConditionOption[] {
  return [
    { value: ChecklistFilterCondition.IsComplete, text: t('grid.checklistFilter.isComplete') },
    { value: ChecklistFilterCondition.IsIncomplete, text: t('grid.checklistFilter.isIncomplted') },
  ];
}

export function personFilterConditions(t: Translate): FilterConditionOption[] {
  return [
    { value: PersonFilterCondition.PersonContains, text: t('grid.personFilter.contains') },
    { value: PersonFilterCondition.PersonDoesNotContain, text: t('grid.personFilter.doesNotContain') },
    { value: PersonFilterCondition.PersonIsEmpty, text: t('grid.personFilter.isEmpty') },
    { value: PersonFilterCondition.PersonIsNotEmpty, text: t('grid.personFilter.isNotEmpty') },
  ];
}

/**
 * Date, created time and last edited time. `start` picks the start-date
 * variant of every condition (`false`: the end-date one). A row time is never
 * empty, so `emptiness: false` leaves the two emptiness conditions out.
 */
export function dateFilterConditions(
  t: Translate,
  { start, emptiness }: { start: boolean; emptiness: boolean }
): FilterConditionOption[] {
  const pick = (condition: DateFilterCondition) => (start ? condition : toEndDateCondition(condition));

  return [
    { value: pick(DateFilterCondition.DateStartsOn), text: t('grid.dateFilter.is') },
    { value: pick(DateFilterCondition.DateStartsBefore), text: t('grid.dateFilter.before') },
    { value: pick(DateFilterCondition.DateStartsAfter), text: t('grid.dateFilter.after') },
    { value: pick(DateFilterCondition.DateStartsOnOrBefore), text: t('grid.dateFilter.onOrBefore') },
    { value: pick(DateFilterCondition.DateStartsOnOrAfter), text: t('grid.dateFilter.onOrAfter') },
    { value: pick(DateFilterCondition.DateStartsBetween), text: t('grid.dateFilter.between') },
    ...(emptiness
      ? [
          { value: pick(DateFilterCondition.DateStartIsEmpty), text: t('grid.dateFilter.empty') },
          { value: pick(DateFilterCondition.DateStartIsNotEmpty), text: t('grid.dateFilter.notEmpty') },
        ]
      : []),
    { value: pick(DateFilterCondition.DateStartsToday), text: t('relativeDates.today') },
    { value: pick(DateFilterCondition.DateStartsYesterday), text: t('relativeDates.yesterday') },
    { value: pick(DateFilterCondition.DateStartsTomorrow), text: t('relativeDates.tomorrow') },
    { value: pick(DateFilterCondition.DateStartsThisWeek), text: t('relativeDates.thisWeek') },
    { value: pick(DateFilterCondition.DateStartsLastWeek), text: t('relativeDates.lastWeek') },
    { value: pick(DateFilterCondition.DateStartsNextWeek), text: t('relativeDates.nextWeek') },
  ];
}
