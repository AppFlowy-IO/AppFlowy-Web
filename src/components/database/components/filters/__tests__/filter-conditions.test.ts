import { FieldType } from '@/application/database-yjs/database.type';
import { DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import { toEndDateCondition } from '@/application/database-yjs/fields/date/relativeDate';
import { NumberFilterCondition } from '@/application/database-yjs/fields/number/number.type';
import { PersonFilterCondition } from '@/application/database-yjs/fields/person/person.type';
import { SelectOptionFilterCondition } from '@/application/database-yjs/fields/select-option/select_option.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import { getFieldTypeName } from '@/components/database/components/field/FieldLabel';
import { getGlobalFilterConditions } from '@/components/database/dashboard/global-filters/global-filter.conditions';

import {
  checklistFilterConditions,
  dateFilterConditions,
  multiSelectFilterConditions,
  numberFilterConditions,
  personFilterConditions,
  singleSelectFilterConditions,
  textFilterConditions,
  Translate,
} from '../filter-conditions';

const t: Translate = (key, options) => (options?.defaultValue as string | undefined) ?? key;
const values = (conditions: { value: number }[]) => conditions.map((condition) => condition.value);

describe('the condition lists of the filter editors', () => {
  it('lists text and number conditions in protobuf ordinal order, like desktop', () => {
    expect(values(textFilterConditions(t))).toEqual([
      TextFilterCondition.TextIs,
      TextFilterCondition.TextIsNot,
      TextFilterCondition.TextContains,
      TextFilterCondition.TextDoesNotContain,
      TextFilterCondition.TextStartsWith,
      TextFilterCondition.TextEndsWith,
      TextFilterCondition.TextIsEmpty,
      TextFilterCondition.TextIsNotEmpty,
    ]);
    expect(values(numberFilterConditions(t))).toEqual([
      NumberFilterCondition.Equal,
      NumberFilterCondition.NotEqual,
      NumberFilterCondition.LessThan,
      NumberFilterCondition.LessThanOrEqualTo,
      NumberFilterCondition.GreaterThan,
      NumberFilterCondition.GreaterThanOrEqualTo,
      NumberFilterCondition.NumberIsEmpty,
      NumberFilterCondition.NumberIsNotEmpty,
    ]);
    expect(numberFilterConditions(t)[0].text).toBe('grid.numberFilter.equal');
  });

  it('offers "is" for a single select and "contains" for a multi-select', () => {
    expect(values(singleSelectFilterConditions(t)).slice(0, 2)).toEqual([
      SelectOptionFilterCondition.OptionIs,
      SelectOptionFilterCondition.OptionIsNot,
    ]);
    expect(values(multiSelectFilterConditions(t)).slice(0, 2)).toEqual([
      SelectOptionFilterCondition.OptionContains,
      SelectOptionFilterCondition.OptionDoesNotContain,
    ]);
    expect(values(personFilterConditions(t))).toEqual([
      PersonFilterCondition.PersonContains,
      PersonFilterCondition.PersonDoesNotContain,
      PersonFilterCondition.PersonIsEmpty,
      PersonFilterCondition.PersonIsNotEmpty,
    ]);
  });

  it('switches every date condition to its end-date variant and can leave emptiness out', () => {
    const start = dateFilterConditions(t, { start: true, emptiness: true });
    const end = dateFilterConditions(t, { start: false, emptiness: true });
    const rowTime = dateFilterConditions(t, { start: true, emptiness: false });

    expect(values(end)).toEqual(values(start).map((value) => toEndDateCondition(value)));
    expect(end.map((item) => item.text)).toEqual(start.map((item) => item.text));
    expect(values(start)).toContain(DateFilterCondition.DateStartIsEmpty);
    expect(values(rowTime)).toEqual(
      values(start).filter(
        (value) => value !== DateFilterCondition.DateStartIsEmpty && value !== DateFilterCondition.DateStartIsNotEmpty
      )
    );
  });

  it('gives the dashboard global filter editor the very same lists', () => {
    expect(getGlobalFilterConditions(FieldType.RichText, 0, t)).toEqual(textFilterConditions(t));
    expect(getGlobalFilterConditions(FieldType.URL, 0, t)).toEqual(textFilterConditions(t));
    expect(getGlobalFilterConditions(FieldType.Number, 0, t)).toEqual(numberFilterConditions(t));
    expect(getGlobalFilterConditions(FieldType.SingleSelect, 0, t)).toEqual(singleSelectFilterConditions(t));
    expect(getGlobalFilterConditions(FieldType.MultiSelect, 0, t)).toEqual(multiSelectFilterConditions(t));
    expect(getGlobalFilterConditions(FieldType.Checklist, 0, t)).toEqual(checklistFilterConditions(t));
    expect(getGlobalFilterConditions(FieldType.Person, 0, t)).toEqual(personFilterConditions(t));
    expect(getGlobalFilterConditions(FieldType.LastEditedBy, 0, t)).toEqual(personFilterConditions(t));
    expect(getGlobalFilterConditions(FieldType.DateTime, DateFilterCondition.DateEndsOn, t)).toEqual(
      dateFilterConditions(t, { start: false, emptiness: true })
    );
    // A row time has no end date and is never empty.
    expect(getGlobalFilterConditions(FieldType.CreatedTime, DateFilterCondition.DateEndsOn, t)).toEqual(
      dateFilterConditions(t, { start: true, emptiness: false })
    );
  });
});

describe('getFieldTypeName', () => {
  it('names every property type the type picker offers, from one table', () => {
    expect(getFieldTypeName(FieldType.RichText, t)).toBe('grid.field.textFieldName');
    expect(getFieldTypeName(FieldType.LastEditedTime, t)).toBe('grid.field.updatedAtFieldName');
    // The three the global filter copy had lost.
    expect(getFieldTypeName(FieldType.Summary, t)).toBe('grid.field.summaryFieldName');
    expect(getFieldTypeName(FieldType.Translate, t)).toBe('grid.field.translateFieldName');
    expect(getFieldTypeName(FieldType.Formula, t)).toBe('Formula');
    expect(getFieldTypeName(FieldType.Rollup, t)).toBe('Rollup');
    expect(getFieldTypeName(999 as FieldType, t)).toBe('');
  });
});
