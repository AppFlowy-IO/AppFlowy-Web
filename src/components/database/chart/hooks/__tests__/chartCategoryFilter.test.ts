/**
 * Mirrors desktop's `chart_category_filter_test.dart`: the clicked chart
 * category as an editable rule, checked against the grid's own predicates.
 * Times are local, so the expectations hold in any time zone.
 */
import dayjs from 'dayjs';
import * as Y from 'yjs';

import { createCell, createRowDoc } from '@/application/database-yjs/__tests__/test-helpers';
import { ChartDataItem } from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { asYDatabaseFilters, DetachedFilter } from '@/application/database-yjs/dispatch/detached-filters';
import { CheckboxFilterCondition } from '@/application/database-yjs/fields/checkbox/checkbox.type';
import { DateFilterCondition } from '@/application/database-yjs/fields/date/date.type';
import { SelectOption, SelectOptionColor, SelectOptionFilterCondition } from '@/application/database-yjs/fields';
import { filterBy } from '@/application/database-yjs/filter';
import {
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFieldTypeOption,
  YjsDatabaseKey as K,
  YMapFieldTypeOption,
} from '@/application/types';

import { chartCategoryFilter } from '../chartCategoryFilter';

const NOW = dayjs(new Date(2026, 9, 28, 15));

function fieldOf(type: FieldType, options?: SelectOption[]) {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;

  fields.set('group', field);
  field.set(K.id, 'group');
  field.set(K.name, 'Group');
  field.set(K.type, type);
  if (options) {
    const typeOptions = new Y.Map() as YDatabaseFieldTypeOption;
    const typeOption = new Y.Map() as YMapFieldTypeOption;

    field.set(K.type_option, typeOptions);
    typeOptions.set(String(type), typeOption);
    typeOption.set(K.content, JSON.stringify({ options, disable_color: false }));
  }

  return { field, fields };
}

/** Whether a row whose `group` cell (or creation time) holds `data` passes the rule. */
function matches(rule: DetachedFilter, fields: YDatabaseFields, type: FieldType, data: string, createdAt = '0') {
  const cells = type === FieldType.CreatedTime ? {} : { group: createCell(type, data) };
  const rowDocs = { row: createRowDoc('row', 'db', cells, type === FieldType.CreatedTime ? data : createdAt) };

  return filterBy([{ id: 'row', height: 36 }], asYDatabaseFilters([rule]), fields, rowDocs).length === 1;
}

const item = (patch: Partial<ChartDataItem>): ChartDataItem => ({ label: 'localized label', value: 1, rowIds: [], ...patch });
const seconds = (date: Date) => String(dayjs(date).unix());
const content = (rule: DetachedFilter | null) => JSON.parse(String(rule?.[K.content]));

function dateRule(key: string, condition: DateGroupCondition) {
  const { field, fields } = fieldOf(FieldType.DateTime);

  return { rule: chartCategoryFilter({ item: item({ sortKey: key }), field, dateCondition: condition, now: NOW }), fields };
}

describe('chartCategoryFilter', () => {
  it('select buckets use option ids and keep merged duplicate-label categories', () => {
    const options: SelectOption[] = [
      { id: 'a', name: 'Done', color: SelectOptionColor.OptionColor1 },
      { id: 'b', name: 'Done', color: SelectOptionColor.OptionColor2 },
      { id: 'c', name: 'Other', color: SelectOptionColor.OptionColor3 },
    ];

    for (const type of [FieldType.SingleSelect, FieldType.MultiSelect]) {
      const { field, fields } = fieldOf(type, options);
      const rule = chartCategoryFilter({ item: item({ label: 'Done' }), field, dateCondition: DateGroupCondition.Month })!;

      expect(rule[K.content]).toBe('a,b');
      expect(rule[K.condition]).toBe(
        type === FieldType.SingleSelect ? SelectOptionFilterCondition.OptionIs : SelectOptionFilterCondition.OptionContains
      );
      expect(matches(rule, fields, type, type === FieldType.MultiSelect ? 'a,c' : 'a')).toBe(true);
      expect(matches(rule, fields, type, 'c')).toBe(false);

      const empty = chartCategoryFilter({
        item: item({ label: 'arbitrary localized empty label', isEmptyCategory: true }),
        field,
        dateCondition: DateGroupCondition.Month,
      })!;

      expect(empty[K.condition]).toBe(SelectOptionFilterCondition.OptionIsEmpty);
      expect(empty[K.content]).toBe('');
      expect(matches(empty, fields, type, '')).toBe(true);
    }
  });

  it('checkbox categories use their boolean flag rather than the localized text', () => {
    const { field, fields } = fieldOf(FieldType.Checkbox);

    for (const checked of [true, false]) {
      const rule = chartCategoryFilter({
        item: item({ label: '任意显示文本', isCheckedCategory: checked }),
        field,
        dateCondition: DateGroupCondition.Month,
      })!;

      expect(rule[K.condition]).toBe(checked ? CheckboxFilterCondition.IsChecked : CheckboxFilterCondition.IsUnChecked);
      expect(matches(rule, fields, FieldType.Checkbox, checked ? 'Yes' : 'No')).toBe(true);
      expect(matches(rule, fields, FieldType.Checkbox, checked ? 'No' : 'Yes')).toBe(false);
    }
  });

  it('calendar date buckets cover exactly the day, week, month or year', () => {
    const cases: [DateGroupCondition, string, Date, Date][] = [
      [DateGroupCondition.Day, '2026-10-28', new Date(2026, 9, 28), new Date(2026, 9, 28)],
      [DateGroupCondition.Week, '2026-10-26', new Date(2026, 9, 26), new Date(2026, 10, 1)],
      [DateGroupCondition.Month, '2024-02', new Date(2024, 1, 1), new Date(2024, 1, 29)],
      [DateGroupCondition.Year, '2026', new Date(2026, 0, 1), new Date(2026, 11, 31)],
    ];

    for (const [condition, key, start, end] of cases) {
      const { rule, fields } = dateRule(key, condition);

      if (condition === DateGroupCondition.Day) {
        expect(rule?.[K.condition]).toBe(DateFilterCondition.DateStartsOn);
        expect(content(rule)).toEqual({ timestamp: dayjs(start).unix() });
        expect(matches(rule!, fields, FieldType.DateTime, seconds(new Date(2026, 9, 28, 23, 59)))).toBe(true);
      } else {
        expect(rule?.[K.condition]).toBe(DateFilterCondition.DateStartsBetween);
        // The filter editors store local midnights.
        expect(content(rule)).toEqual({ start: dayjs(start).unix(), end: dayjs(end).unix() });
      }

      const dayBefore = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, 12);
      const dayAfter = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);

      expect(matches(rule!, fields, FieldType.DateTime, seconds(start))).toBe(true);
      expect(matches(rule!, fields, FieldType.DateTime, seconds(end))).toBe(true);
      expect(matches(rule!, fields, FieldType.DateTime, seconds(dayBefore))).toBe(false);
      expect(matches(rule!, fields, FieldType.DateTime, seconds(dayAfter))).toBe(false);
    }
  });

  it('relative date buckets exclude the neighboring categories', () => {
    const cases: [string, number, number][] = [
      ['today', 0, 0],
      ['yesterday', -1, -1],
      ['tomorrow', 1, 1],
      ['last_7_days', -7, -2],
      ['next_7_days', 2, 7],
      ['last_30_days', -30, -8],
      ['next_30_days', 8, 30],
    ];

    for (const [key, first, last] of cases) {
      const { rule } = dateRule(key, DateGroupCondition.Relative);
      const day = (offset: number) => dayjs(new Date(2026, 9, 28 + offset)).unix();

      expect(content(rule)).toEqual(first === last ? { timestamp: day(first) } : { start: day(first), end: day(last) });
    }

    expect(content(dateRule('month_2026-01', DateGroupCondition.Relative).rule)).toEqual({
      start: dayjs(new Date(2026, 0, 1)).unix(),
      end: dayjs(new Date(2026, 0, 31)).unix(),
    });
  });

  it('a relative month leaves out the days the 30-day buckets already hold (web fix)', () => {
    // Today is Oct 28, so the named buckets cover Sep 28 – Nov 27.
    expect(content(dateRule('month_2026-09', DateGroupCondition.Relative).rule)).toEqual({
      start: dayjs(new Date(2026, 8, 1)).unix(),
      end: dayjs(new Date(2026, 8, 27)).unix(),
    });
    expect(content(dateRule('month_2026-11', DateGroupCondition.Relative).rule)).toEqual({
      start: dayjs(new Date(2026, 10, 28)).unix(),
      end: dayjs(new Date(2026, 10, 30)).unix(),
    });
    // October lies inside the window, so no month bucket can hold it.
    expect(dateRule('month_2026-10', DateGroupCondition.Relative).rule).toBeNull();
  });

  it('date empty categories and timestamp fields keep their actual field type', () => {
    for (const type of [FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime]) {
      const { field } = fieldOf(type);
      const rule = chartCategoryFilter({
        item: item({ label: 'empty', isEmptyCategory: true }),
        field,
        dateCondition: DateGroupCondition.Month,
      })!;

      expect(rule[K.type]).toBe(type);
      expect(rule[K.condition]).toBe(DateFilterCondition.DateStartIsEmpty);
    }

    const { field, fields } = fieldOf(FieldType.CreatedTime);
    const created = chartCategoryFilter({
      item: item({ sortKey: '2026-10-28' }),
      field,
      dateCondition: DateGroupCondition.Day,
    })!;

    expect(matches(created, fields, FieldType.CreatedTime, seconds(new Date(2026, 9, 28, 9)))).toBe(true);
    expect(matches(created, fields, FieldType.CreatedTime, seconds(new Date(2026, 9, 29, 9)))).toBe(false);
  });

  it('missing fields, unknown select options and malformed date keys are not guessed', () => {
    expect(
      chartCategoryFilter({ item: item({ label: 'missing' }), field: null, dateCondition: DateGroupCondition.Month })
    ).toBeNull();
    expect(
      chartCategoryFilter({
        item: item({ label: 'missing' }),
        field: fieldOf(FieldType.SingleSelect).field,
        dateCondition: DateGroupCondition.Month,
      })
    ).toBeNull();
    expect(
      chartCategoryFilter({
        item: item({ label: 'Checked' }),
        field: fieldOf(FieldType.Checkbox).field,
        dateCondition: DateGroupCondition.Month,
      })
    ).toBeNull();
    expect(
      chartCategoryFilter({
        item: item({ label: 'text' }),
        field: fieldOf(FieldType.Person).field,
        dateCondition: DateGroupCondition.Month,
      })
    ).toBeNull();

    const malformed: [string, DateGroupCondition][] = [
      ['invalid', DateGroupCondition.Month],
      ['2026-99', DateGroupCondition.Month],
      ['2026-02-31', DateGroupCondition.Day],
      // Weeks are keyed by their Monday.
      ['2026-10-27', DateGroupCondition.Week],
      ['month_soon', DateGroupCondition.Relative],
    ];

    for (const [key, condition] of malformed) {
      expect(dateRule(key, condition).rule).toBeNull();
    }

    expect(dateRule('2026-10-28', DateGroupCondition.Day).rule).not.toBeNull();
    const { field } = fieldOf(FieldType.DateTime);

    expect(chartCategoryFilter({ item: item({}), field, dateCondition: DateGroupCondition.Day })).toBeNull();
  });
});
