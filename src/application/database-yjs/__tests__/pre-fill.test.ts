import dayjs from 'dayjs';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import {
  checkboxFilterFillData,
  dateFilterFillData,
  filterFillData,
  numberFilterFillData,
  selectOptionFilterFillData,
  textFilterFillData,
} from '@/application/database-yjs/filter';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  CheckboxFilterCondition,
  DateFilterCondition,
  NumberFilterCondition,
  SelectOptionFilterCondition,
  TextFilterCondition,
} from '@/application/database-yjs/fields';
import { YDatabaseFilter, YjsDatabaseKey } from '@/application/types';

import { createField } from './test-helpers';

function createFilter(condition: number, content: string): YDatabaseFilter {
  const doc = new Y.Doc();
  const filter = doc.getMap('filter') as YDatabaseFilter;
  filter.set(YjsDatabaseKey.condition, condition);
  filter.set(YjsDatabaseKey.content, content);
  return filter;
}

describe('pre-fill cell tests', () => {
  it('pre-fills text field based on TextContains filter', () => {
    expect(textFilterFillData('alpha', TextFilterCondition.TextContains)).toBe('alpha');
  });

  it('pre-fills number field based on Equal filter', () => {
    expect(numberFilterFillData('10', NumberFilterCondition.Equal)).toBe('10');
  });

  it('pre-fills checkbox based on IsChecked filter', () => {
    expect(checkboxFilterFillData(CheckboxFilterCondition.IsChecked)).toBe('Yes');
  });

  it('pre-fills select option based on OptionIs filter', () => {
    expect(selectOptionFilterFillData('opt-a', SelectOptionFilterCondition.OptionIs)).toBe('opt-a');
  });

  it('pre-fills date based on DateStartsOn filter', () => {
    const timestamp = dayjs('2024-01-15').startOf('day').unix().toString();
    const filter = createFilter(
      DateFilterCondition.DateStartsOn,
      JSON.stringify({ timestamp })
    );

    expect(dateFilterFillData(filter)).toEqual({ data: timestamp, isRange: false });
  });

  it('pre-fills row with provided cell values', () => {
    const filter = createFilter(TextFilterCondition.TextIs, 'Hello');
    const field = createField('text-field', FieldType.RichText);

    expect(filterFillData(filter, field)).toBe('Hello');
  });

  it('pre-fills multiple cells at once', () => {
    const textFilter = createFilter(TextFilterCondition.TextStartsWith, 'Alpha');
    const numberFilter = createFilter(NumberFilterCondition.GreaterThan, '5');
    const textField = createField('text-field', FieldType.RichText);
    const numberField = createField('number-field', FieldType.Number);

    expect(filterFillData(textFilter, textField)).toBe('Alpha');
    expect(filterFillData(numberFilter, numberField)).toBe(6);
  });

  it('handles no active filter', () => {
    const filter = createFilter(TextFilterCondition.TextDoesNotContain, 'Alpha');
    const field = createField('text-field', FieldType.RichText);

    expect(filterFillData(filter, field)).toBe('');
  });

  it('handles unsupported field type', () => {
    const filter = createFilter(TextFilterCondition.TextContains, 'Alpha');
    const field = createField('date-field', FieldType.DateTime);

    expect(filterFillData(filter, field)).toBeNull();
  });

  it('handles date range filters with payload', () => {
    const start = dayjs('2024-01-10').startOf('day').unix().toString();
    const end = dayjs('2024-01-12').startOf('day').unix().toString();
    const filter = createFilter(
      DateFilterCondition.DateEndsBetween,
      JSON.stringify({ start, end })
    );

    expect(dateFilterFillData(filter)).toEqual({ data: start, endTimestamp: end, isRange: true });
  });
});
