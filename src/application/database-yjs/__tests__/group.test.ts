import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import {
  areGroupRowsHydrated,
  getDateGroupId,
  getGroupCellData,
  groupByCheckbox,
  groupByDate,
  groupByField,
  groupByIdentifier,
  groupByNumber,
  groupBySelectOption,
  groupByText,
  getGroupColumns,
  getGroupLabel,
  getNumberGroupId,
  isDatabaseGroupableFieldType,
  isDynamicDatabaseGroupFieldType,
  normalizeGroupIdentifiers,
} from '@/application/database-yjs/group';
import { DateGroupCondition, FieldType, FilterType } from '@/application/database-yjs/database.type';
import { CheckboxFilterCondition, SelectOptionFilterCondition } from '@/application/database-yjs/fields';
import { Row } from '@/application/database-yjs/selector';
import {
  RowId,
  YDatabaseFilter,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createCell, createField, createFieldWithTypeOption, createRowDoc } from './test-helpers';

function createFilter(fieldId: string, condition: number, content: string = ''): YDatabaseFilter {
  const doc = new Y.Doc();
  const filter = doc.getMap(`filter-${fieldId}-${condition}`) as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, `filter-${fieldId}-${condition}`);
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, condition);
  filter.set(YjsDatabaseKey.content, content);

  return filter;
}

describe('checkbox group tests', () => {
  const databaseId = 'db-group-checkbox';
  const fieldId = 'checkbox-field';
  const field = createField(fieldId, FieldType.Checkbox);

  const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
  const rowMetas: Record<RowId, YDoc> = {
    'row-a': createRowDoc('row-a', databaseId, {
      [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
    }),
    'row-b': createRowDoc('row-b', databaseId, {
      [fieldId]: createCell(FieldType.Checkbox, 'No'),
    }),
    'row-c': createRowDoc('row-c', databaseId, {
      [fieldId]: createCell(FieldType.Checkbox, ''),
    }),
  };

  it('groups rows by checked/unchecked status', () => {
    const result = groupByCheckbox(rows, rowMetas, field);
    expect(result?.get('Yes')?.map((row) => row.id)).toEqual(['row-a']);
    expect(result?.get('No')?.map((row) => row.id)).toEqual(['row-b', 'row-c']);
  });

  it('returns two groups: Yes and No', () => {
    const result = groupByCheckbox(rows, rowMetas, field);
    expect(Array.from(result?.keys() ?? [])).toEqual(['Yes', 'No']);
  });

  it('handles empty checkbox values', () => {
    const result = groupByCheckbox(rows, rowMetas, field);
    expect(result?.get('No')?.map((row) => row.id)).toContain('row-c');
  });

  it('maintains row order within groups', () => {
    const result = groupByCheckbox(rows, rowMetas, field);
    expect(result?.get('No')?.map((row) => row.id)).toEqual(['row-b', 'row-c']);
  });

  it('applies checkbox filter to groups', () => {
    const filter = createFilter(fieldId, CheckboxFilterCondition.IsChecked);
    const result = groupByCheckbox(rows, rowMetas, field, filter);
    expect(Array.from(result?.keys() ?? [])).toEqual(['Yes']);
  });
});

describe('select option group tests', () => {
  const databaseId = 'db-group-select';
  const fieldId = 'select-field';
  const field = createField(fieldId, FieldType.MultiSelect, {
    options: [
      { id: 'opt-a', name: 'Alpha', color: 0 },
      { id: 'opt-b', name: 'Beta', color: 0 },
    ],
    disable_color: false,
  });

  const rows: Row[] = ['row-a', 'row-b', 'row-c', 'row-d'].map((id) => ({ id, height: 0 }));
  const rowMetas: Record<RowId, YDoc> = {
    'row-a': createRowDoc('row-a', databaseId, {
      [fieldId]: createCell(FieldType.MultiSelect, 'opt-a'),
    }),
    'row-b': createRowDoc('row-b', databaseId, {
      [fieldId]: createCell(FieldType.MultiSelect, 'opt-b'),
    }),
    'row-c': createRowDoc('row-c', databaseId, {
      [fieldId]: createCell(FieldType.MultiSelect, ''),
    }),
    'row-d': createRowDoc('row-d', databaseId, {
      [fieldId]: createCell(FieldType.MultiSelect, 'opt-a,opt-b'),
    }),
  };

  it('groups rows by single select option', () => {
    const result = groupBySelectOption(rows, rowMetas, field);
    expect(result?.get('opt-a')?.map((row) => row.id)).toEqual(['row-a', 'row-d']);
    expect(result?.get('opt-b')?.map((row) => row.id)).toEqual(['row-b', 'row-d']);
  });

  it('groups rows by multi-select (row appears in multiple groups)', () => {
    const result = groupBySelectOption(rows, rowMetas, field);
    expect(result?.get('opt-a')?.map((row) => row.id)).toContain('row-d');
    expect(result?.get('opt-b')?.map((row) => row.id)).toContain('row-d');
  });

  it('creates "No Status" group for empty values', () => {
    const result = groupBySelectOption(rows, rowMetas, field);
    expect(result?.get(fieldId)?.map((row) => row.id)).toEqual(['row-c']);
  });

  it('handles option with no rows', () => {
    const result = groupBySelectOption(rows, rowMetas, field);
    expect(result?.get('opt-a')?.length).toBeGreaterThan(0);
  });

  it('maintains option order in groups', () => {
    const result = groupBySelectOption(rows, rowMetas, field);
    expect(result?.get('opt-a')?.map((row) => row.id)).toEqual(['row-a', 'row-d']);
  });

  it('applies filter to groups', () => {
    const filter = createFilter(fieldId, SelectOptionFilterCondition.OptionIs, 'opt-a');
    const result = groupBySelectOption(rows, rowMetas, field, filter);
    expect(Array.from(result?.keys() ?? [])).toEqual(['opt-a']);
  });
});

describe('desktop-model lazy conversion grouping', () => {
  const databaseId = 'db-group-lazy-conversion';

  it('groups a preserved text cell through the current checkbox field type', () => {
    const fieldId = 'converted-checkbox';
    const field = createField(fieldId, FieldType.Checkbox);
    const rows: Row[] = [{ id: 'row-a', height: 0 }];
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'true'),
      }),
    };

    const result = groupByCheckbox(rows, rowMetas, field);

    expect(result?.get('Yes')?.map((row) => row.id)).toEqual(['row-a']);
    expect(result?.get('No')).toEqual([]);
  });

  it('resolves a preserved text value through the current select options', () => {
    const fieldId = 'converted-select';
    const field = createField(fieldId, FieldType.MultiSelect, {
      options: [
        { id: 'opt-a', name: 'Alpha', color: 0 },
        { id: 'opt-b', name: 'Beta', color: 0 },
      ],
      disable_color: false,
    });
    const rows: Row[] = [{ id: 'row-a', height: 0 }];
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'Alpha'),
      }),
    };

    const result = groupBySelectOption(rows, rowMetas, field);

    expect(result?.get('opt-a')?.map((row) => row.id)).toEqual(['row-a']);
    expect(result?.get(fieldId)).toEqual([]);
  });

  it('does not treat a preserved text payload as person identifiers', () => {
    const fieldId = 'converted-person';
    const field = createField(fieldId, FieldType.Person);
    const rows: Row[] = [{ id: 'row-a', height: 0 }];
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'person-a,person-b'),
      }),
    };

    const result = groupByIdentifier(rows, rowMetas, field);

    expect([...result.keys()]).toEqual([fieldId]);
    expect(result.get(fieldId)?.map((row) => row.id)).toEqual(['row-a']);
  });
});

describe('group by field fallback', () => {
  it('returns undefined for unsupported field types', () => {
    const fields = new Y.Map() as YDatabaseFields;
    const field = createField('media-field', FieldType.Media);
    fields.set('media-field', field);

    const result = groupByField([], {}, field);
    expect(result).toBeUndefined();
  });
});

describe.each([
  ['Relation', FieldType.Relation],
  ['Person', FieldType.Person],
] as const)('%s identifier grouping', (_name, fieldType) => {
  const fieldId = `${String(_name).toLowerCase()}-field`;
  const field = createField(fieldId, fieldType);
  const rows: Row[] = ['multi', 'single', 'empty', 'duplicate'].map((id) => ({ id, height: 0 }));
  const value = (identifiers: string[]) => (fieldType === FieldType.Person ? JSON.stringify(identifiers) : identifiers);
  const rowMetas: Record<RowId, YDoc> = {
    multi: createRowDoc('multi', 'identifier-db', {
      [fieldId]: createCell(fieldType, value([' id-a ', 'id-b'])),
    }),
    single: createRowDoc('single', 'identifier-db', {
      [fieldId]: createCell(fieldType, value(['id-b'])),
    }),
    empty: createRowDoc('empty', 'identifier-db', {
      [fieldId]: createCell(fieldType, value([])),
    }),
    duplicate: createRowDoc('duplicate', 'identifier-db', {
      [fieldId]: createCell(fieldType, value(['id-a', 'id-a', ' ', 'id-c'])),
    }),
  };

  it('places multi-value rows in every stable, normalized identifier group', () => {
    const result = groupByIdentifier(rows, rowMetas, field);

    expect([...result.keys()]).toEqual([fieldId, 'id-a', 'id-b', 'id-c']);
    expect(result.get('id-a')?.map(({ id }) => id)).toEqual(['multi', 'duplicate']);
    expect(result.get('id-b')?.map(({ id }) => id)).toEqual(['multi', 'single']);
    expect(result.get('id-c')?.map(({ id }) => id)).toEqual(['duplicate']);
    expect(result.get(fieldId)?.map(({ id }) => id)).toEqual(['empty']);
  });

  it('moves a row between concrete and default groups after a live cell edit', () => {
    const row = rowMetas.single.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId);

    cell?.set(YjsDatabaseKey.data, value([]));
    const result = groupByField(rows, rowMetas, field);

    expect(result?.get('id-b')?.map(({ id }) => id)).toEqual(['multi']);
    expect(result?.get(fieldId)?.map(({ id }) => id)).toEqual(['single', 'empty']);
  });
});

describe.each([
  ['Created by', FieldType.CreatedBy, YjsDatabaseKey.created_by],
  ['Last edited by', FieldType.LastEditedBy, YjsDatabaseKey.last_edited_by],
] as const)('%s attribution grouping', (_name, fieldType, attributionKey) => {
  const fieldId = `${fieldType}-field`;
  const field = createField(fieldId, fieldType);
  const rows: Row[] = ['row-a', 'row-b', 'legacy-row'].map((id) => ({ id, height: 0 }));
  const rowMetas: Record<RowId, YDoc> = Object.fromEntries(
    rows.map(({ id }) => [id, createRowDoc(id, 'attribution-group-db', {})])
  );
  const rowA = rowMetas['row-a']
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database_row) as YDatabaseRow;
  const rowB = rowMetas['row-b']
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database_row) as YDatabaseRow;

  rowA.set(attributionKey, 101);
  rowB.set(attributionKey, 202);

  it('groups by the primitive numeric uid and leaves legacy rows ungrouped', () => {
    const result = groupByIdentifier(rows, rowMetas, field);

    expect(result.get('101')?.map((row) => row.id)).toEqual(['row-a']);
    expect(result.get('202')?.map((row) => row.id)).toEqual(['row-b']);
    expect(result.get(fieldId)?.map((row) => row.id)).toEqual(['legacy-row']);
  });

  it('uses resolved user labels without making the group writable', () => {
    expect(getGroupLabel('101', field, undefined, new Date(), new Map([['101', 'Annie']]))).toBe('Annie');
    expect(getGroupLabel('999', field)).toBe('Unknown user');
    expect(getGroupCellData('101', field)).toBeUndefined();
  });
});

describe('identifier normalization', () => {
  it('accepts JSON, comma-delimited, and array values without duplicate identifiers', () => {
    expect(normalizeGroupIdentifiers('[" a ","b","a",""]')).toEqual(['a', 'b']);
    expect(normalizeGroupIdentifiers(' a, b, a, ')).toEqual(['a', 'b']);
    expect(normalizeGroupIdentifiers(['a', ' a ', 'b'])).toEqual(['a', 'b']);
  });
});

describe('desktop Grid dynamic grouping parity', () => {
  const databaseId = 'db-dynamic-groups';

  function createRows(fieldId: string, fieldType: FieldType, values: Array<string | undefined>) {
    const rows = values.map((_, index) => ({ id: `row-${index}`, height: 0 }));
    const rowMetas = Object.fromEntries(
      values.map((value, index) => [
        `row-${index}`,
        createRowDoc(`row-${index}`, databaseId, {
          ...(value === undefined ? {} : { [fieldId]: createCell(fieldType, value) }),
        }),
      ])
    );

    return { rowMetas, rows };
  }

  function updateCell(rowDoc: YDoc, fieldId: string, value: string) {
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    row.get(YjsDatabaseKey.cells).get(fieldId)?.set(YjsDatabaseKey.data, value);
  }

  it('groups RichText by exact value and keeps empty values in No Name', () => {
    const field = createField('name', FieldType.RichText);
    field.set(YjsDatabaseKey.name, 'Name');
    const { rowMetas, rows } = createRows('name', FieldType.RichText, ['A', 'B', 'A', '']);
    const result = groupByText(rows, rowMetas, field);

    expect([...result.keys()]).toEqual(['name', 'A', 'B']);
    expect(result.get('A')?.map(({ id }) => id)).toEqual(['row-0', 'row-2']);
    expect(result.get('name')?.map(({ id }) => id)).toEqual(['row-3']);
  });

  it('groups URL fields by exact URL', () => {
    const field = createField('website', FieldType.URL);
    const { rowMetas, rows } = createRows('website', FieldType.URL, [
      'https://appflowy.io',
      'https://github.com/AppFlowy-IO/AppFlowy',
      'https://appflowy.io',
    ]);
    const result = groupByText(rows, rowMetas, field);

    expect(result.get('https://appflowy.io')?.map(({ id }) => id)).toEqual(['row-0', 'row-2']);
  });

  it('groups numbers into fixed 100-value ranges including negatives', () => {
    const field = createField('amount', FieldType.Number);
    const { rowMetas, rows } = createRows('amount', FieldType.Number, [
      '-150',
      '-100',
      '-1',
      '0',
      '99.9',
      '100',
      '1,250',
      '',
    ]);
    const result = groupByNumber(rows, rowMetas, field);

    expect([...result.keys()]).toEqual([
      'amount',
      'number_range_-200_-100',
      'number_range_-100_0',
      'number_range_0_100',
      'number_range_100_200',
      'number_range_1200_1300',
    ]);
    expect(result.get('number_range_0_100')?.map(({ id }) => id)).toEqual(['row-3', 'row-4']);
    expect(result.get('amount')?.map(({ id }) => id)).toEqual(['row-7']);
  });

  it('moves a row when the RichText grouping cell changes', () => {
    const field = createField('name', FieldType.RichText);
    const { rowMetas, rows } = createRows('name', FieldType.RichText, ['A', 'B']);

    updateCell(rowMetas['row-0'], 'name', 'B');
    const result = groupByText(rows, rowMetas, field);

    expect(result.has('A')).toBe(false);
    expect(result.get('B')?.map(({ id }) => id)).toEqual(['row-0', 'row-1']);
  });

  it('moves a row to the correct number range when its value changes', () => {
    const field = createField('amount', FieldType.Number);
    const { rowMetas, rows } = createRows('amount', FieldType.Number, ['1', '2']);

    updateCell(rowMetas['row-0'], 'amount', '250');
    const result = groupByNumber(rows, rowMetas, field);

    expect(result.get('number_range_0_100')?.map(({ id }) => id)).toEqual(['row-1']);
    expect(result.get('number_range_200_300')?.map(({ id }) => id)).toEqual(['row-0']);
  });

  it.each<Array<[string, FieldType, string]>>([
    ['RichText', FieldType.RichText, 'A'],
    ['URL', FieldType.URL, 'https://appflowy.io'],
    ['Number', FieldType.Number, '12'],
  ])('does not delete a singleton %s group after an unrelated cell edit', (_name, fieldType, value) => {
    const groupingField = createField('grouping', fieldType);
    const unrelatedField = createField('other', FieldType.RichText);
    const rows: Row[] = [{ id: 'only-row', height: 0 }];
    const rowMetas = {
      'only-row': createRowDoc('only-row', databaseId, {
        grouping: createCell(fieldType, value),
        other: createCell(FieldType.RichText, 'before'),
      }),
    };
    const before = groupByField(rows, rowMetas, groupingField);
    const groupId = [...(before?.keys() ?? [])].find((id) => id !== 'grouping') as string;

    updateCell(rowMetas['only-row'], unrelatedField.get(YjsDatabaseKey.id), 'after');
    const after = groupByField(rows, rowMetas, groupingField);

    expect(after?.get(groupId)?.map(({ id }) => id)).toEqual(['only-row']);
  });

  it('preserves filtered and sorted row input inside every group', () => {
    const field = createField('name', FieldType.RichText);
    const { rowMetas, rows } = createRows('name', FieldType.RichText, ['A', 'B', 'A']);
    const filteredAndSorted = [rows[2], rows[0]];
    const result = groupByText(filteredAndSorted, rowMetas, field);

    expect([...result.keys()]).toEqual(['name', 'A']);
    expect(result.get('A')?.map(({ id }) => id)).toEqual(['row-2', 'row-0']);
  });

  it('supports the desktop Grid grouping field types plus attribution fields', () => {
    expect(
      [
        FieldType.RichText,
        FieldType.Number,
        FieldType.URL,
        FieldType.Checkbox,
        FieldType.SingleSelect,
        FieldType.MultiSelect,
        FieldType.DateTime,
        FieldType.Relation,
        FieldType.Person,
        FieldType.CreatedBy,
        FieldType.LastEditedBy,
      ].every(isDatabaseGroupableFieldType)
    ).toBe(true);
    expect(isDatabaseGroupableFieldType(FieldType.Media)).toBe(false);
    expect(isDynamicDatabaseGroupFieldType(FieldType.Relation)).toBe(true);
    expect(isDynamicDatabaseGroupFieldType(FieldType.Person)).toBe(true);
    expect(isDynamicDatabaseGroupFieldType(FieldType.CreatedBy)).toBe(true);
    expect(isDynamicDatabaseGroupFieldType(FieldType.LastEditedBy)).toBe(true);
    expect(isDynamicDatabaseGroupFieldType(FieldType.SingleSelect)).toBe(false);
  });

  it('uses desktop-compatible group labels and new-row values', () => {
    const numberField = createField('amount', FieldType.Number);
    numberField.set(YjsDatabaseKey.name, 'Amount');
    const dateField = createField('date', FieldType.DateTime);
    const selectField = createField('status', FieldType.SingleSelect, {
      disable_color: false,
      options: [{ id: 'todo', name: 'To do', color: 1 }],
    });
    const personField = createField('assignee', FieldType.Person, {
      persons: [{ id: 'person-a', name: 'Annie' }],
    });
    const splitPersonField = createFieldWithTypeOption('watchers', FieldType.Person, {
      [YjsDatabaseKey.persons]: JSON.stringify([{ id: 'person-b', name: 'Eva' }]),
    });
    const relationField = createField('project', FieldType.Relation);

    expect(getGroupLabel('number_range_-100_0', numberField)).toBe('-100 to 0');
    expect(getGroupLabel('amount', numberField)).toBe('No Amount');
    expect(getGroupLabel('todo', selectField)).toBe('To do');
    expect(getGroupCellData('number_range_200_300', numberField)).toBe('200');
    expect(getGroupCellData('status', selectField)).toBeUndefined();
    expect(getGroupCellData('2026/08/13', dateField)).toMatch(/^\d+$/);
    expect(getGroupCellData('person-a', personField)).toBe('["person-a"]');
    expect(getGroupCellData('row-a', relationField)).toBe('["row-a"]');
    expect(getGroupLabel('person-a', personField)).toBe('Annie');
    expect(getGroupLabel('person-b', splitPersonField)).toBe('Eva');
    expect(getGroupLabel('person-missing', personField)).toBe('Unknown person');
    expect(getGroupLabel('row-a', relationField, undefined, new Date(), new Map([['row-a', 'Project A']]))).toBe(
      'Project A'
    );
    expect(getGroupLabel('row-missing', relationField)).toBe('Untitled relation');
  });

  it('calculates number group IDs at desktop range boundaries', () => {
    expect(getNumberGroupId('-100')).toBe('number_range_-100_0');
    expect(getNumberGroupId('-0.1')).toBe('number_range_-100_0');
    expect(getNumberGroupId('0')).toBe('number_range_0_100');
    expect(getNumberGroupId('100')).toBe('number_range_100_200');
    expect(getNumberGroupId('not-a-number')).toBeNull();
  });
});

describe('desktop DateTime grouping parity', () => {
  const localTimestamp = (year: number, month: number, day: number) =>
    String(Math.floor(new Date(year, month - 1, day, 12).getTime() / 1000));

  it.each<Array<[DateGroupCondition, string]>>([
    [DateGroupCondition.Day, '2026/08/13'],
    [DateGroupCondition.Week, '2026/08/10'],
    [DateGroupCondition.Month, '2026/08/01'],
    [DateGroupCondition.Year, '2026/01/01'],
  ])('groups a date using condition %s', (condition, expected) => {
    expect(getDateGroupId(localTimestamp(2026, 8, 13), condition, new Date(2026, 7, 20))).toBe(expected);
  });

  it('uses the seven relative-date buckets and month fallback', () => {
    const now = new Date(2026, 7, 13, 12);

    expect(getDateGroupId(localTimestamp(2026, 8, 13), DateGroupCondition.Relative, now)).toBe('2026/08/13');
    expect(getDateGroupId(localTimestamp(2026, 8, 12), DateGroupCondition.Relative, now)).toBe('2026/08/12');
    expect(getDateGroupId(localTimestamp(2026, 8, 11), DateGroupCondition.Relative, now)).toBe('2026/08/06');
    expect(getDateGroupId(localTimestamp(2026, 8, 6), DateGroupCondition.Relative, now)).toBe('2026/08/06');
    expect(getDateGroupId(localTimestamp(2026, 8, 17), DateGroupCondition.Relative, now)).toBe('2026/08/15');
    expect(getDateGroupId(localTimestamp(2026, 7, 30), DateGroupCondition.Relative, now)).toBe('2026/07/14');
    expect(getDateGroupId(localTimestamp(2026, 7, 14), DateGroupCondition.Relative, now)).toBe('2026/07/14');
    expect(getDateGroupId(localTimestamp(2026, 8, 25), DateGroupCondition.Relative, now)).toBe('2026/08/21');
    expect(getDateGroupId(localTimestamp(2026, 10, 1), DateGroupCondition.Relative, now)).toBe('2026/10/01');
  });

  it('keeps missing dates in the default group and sorts date groups chronologically', () => {
    const field = createField('date', FieldType.DateTime);
    const rows: Row[] = ['later', 'empty', 'earlier'].map((id) => ({ id, height: 0 }));
    const rowMetas = {
      later: createRowDoc('later', 'date-db', { date: createCell(FieldType.DateTime, localTimestamp(2026, 8, 20)) }),
      empty: createRowDoc('empty', 'date-db', { date: createCell(FieldType.DateTime, '') }),
      earlier: createRowDoc('earlier', 'date-db', {
        date: createCell(FieldType.DateTime, localTimestamp(2026, 8, 10)),
      }),
    };
    const result = groupByDate(
      rows,
      rowMetas,
      field,
      JSON.stringify({ condition: DateGroupCondition.Day, hide_empty: false })
    );

    expect([...result.keys()]).toEqual(['date', '2026/08/10', '2026/08/20']);
    expect(result.get('date')?.map(({ id }) => id)).toEqual(['empty']);
  });
});

describe('get group columns', () => {
  it('returns select option group columns', () => {
    const field = createField('select-field', FieldType.SingleSelect, {
      options: [
        { id: 'opt-a', name: 'Alpha', color: 0 },
        { id: 'opt-b', name: 'Beta', color: 0 },
      ],
      disable_color: false,
    });

    expect(getGroupColumns(field)).toEqual([{ id: 'select-field' }, { id: 'opt-a' }, { id: 'opt-b' }]);
  });

  it('returns checkbox group columns', () => {
    const field = createField('checkbox-field', FieldType.Checkbox);
    expect(getGroupColumns(field)).toEqual([{ id: 'Yes' }, { id: 'No' }]);
  });

  it.each([FieldType.Relation, FieldType.Person])(
    'starts identifier field type %s with only its default group',
    (type) => {
      const field = createField('identifier-field', type);

      expect(getGroupColumns(field)).toEqual([{ id: 'identifier-field' }]);
    }
  );
});

describe('rows loading in a grouped board', () => {
  const databaseId = 'db-loading-test';

  it('checkbox: omits unloaded rows instead of guessing the No group', () => {
    const fieldId = 'checkbox-field';
    const field = createField(fieldId, FieldType.Checkbox);

    const rows: Row[] = [
      { id: 'row-loaded', height: 0 },
      { id: 'row-unloaded-1', height: 0 },
      { id: 'row-unloaded-2', height: 0 },
    ];

    const rowMetas: Record<RowId, YDoc> = {
      'row-loaded': createRowDoc('row-loaded', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
      }),
    };

    const result = groupByCheckbox(rows, rowMetas, field);

    expect(result?.get('Yes')?.map((r) => r.id)).toEqual(['row-loaded']);
    expect(result?.get('No')).toEqual([]);
    expect(areGroupRowsHydrated(rows, rowMetas)).toBe(false);
  });

  it('select option: omits unloaded rows instead of guessing No Status', () => {
    const fieldId = 'select-field';
    const field = createField(fieldId, FieldType.SingleSelect, {
      options: [
        { id: 'opt-a', name: 'Alpha', color: 0 },
        { id: 'opt-b', name: 'Beta', color: 0 },
      ],
      disable_color: false,
    });

    const rows: Row[] = [
      { id: 'row-loaded', height: 0 },
      { id: 'row-unloaded-1', height: 0 },
      { id: 'row-unloaded-2', height: 0 },
    ];

    const rowMetas: Record<RowId, YDoc> = {
      'row-loaded': createRowDoc('row-loaded', databaseId, {
        [fieldId]: createCell(FieldType.SingleSelect, 'opt-a'),
      }),
    };

    const result = groupBySelectOption(rows, rowMetas, field);

    expect(result?.get('opt-a')?.map((r) => r.id)).toEqual(['row-loaded']);
    expect(result?.get(fieldId)).toEqual([]);
  });

  it('maintains all groups even when some are empty', () => {
    const fieldId = 'select-field';
    const field = createField(fieldId, FieldType.SingleSelect, {
      options: [
        { id: 'opt-a', name: 'Alpha', color: 0 },
        { id: 'opt-b', name: 'Beta', color: 0 },
      ],
      disable_color: false,
    });

    const rows: Row[] = [{ id: 'row-1', height: 0 }];
    const rowMetas: Record<RowId, YDoc> = {
      'row-1': createRowDoc('row-1', databaseId, {
        [fieldId]: createCell(FieldType.SingleSelect, 'opt-a'),
      }),
    };

    const result = groupBySelectOption(rows, rowMetas, field);

    expect(result?.has(fieldId)).toBe(true);
    expect(result?.has('opt-a')).toBe(true);
    expect(result?.has('opt-b')).toBe(true);
    expect(result?.get('opt-b')).toEqual([]);
  });

  it('keeps every group empty while all rows are unloaded', () => {
    const fieldId = 'checkbox-field';
    const field = createField(fieldId, FieldType.Checkbox);

    const rows: Row[] = [
      { id: 'row-1', height: 0 },
      { id: 'row-2', height: 0 },
    ];

    const rowMetas: Record<RowId, YDoc> = {};

    const result = groupByCheckbox(rows, rowMetas, field);

    expect(result?.get('Yes')).toEqual([]);
    expect(result?.get('No')).toEqual([]);
    expect(areGroupRowsHydrated(rows, rowMetas)).toBe(false);
  });

  it('handles empty rows array', () => {
    const fieldId = 'checkbox-field';
    const field = createField(fieldId, FieldType.Checkbox);

    const result = groupByCheckbox([], {}, field);

    expect(result?.get('Yes')).toEqual([]);
    expect(result?.get('No')).toEqual([]);
  });

  it('reveals progressively hydrated rows directly in their real groups', () => {
    const fieldId = 'checkbox-field';
    const field = createField(fieldId, FieldType.Checkbox);

    const rows: Row[] = [
      { id: 'row-1', height: 0 },
      { id: 'row-2', height: 0 },
      { id: 'row-3', height: 0 },
    ];

    let rowMetas: Record<RowId, YDoc> = {};
    let result = groupByCheckbox(rows, rowMetas, field);

    expect(result?.get('Yes')).toEqual([]);
    expect(result?.get('No')).toEqual([]);

    rowMetas = {
      'row-1': createRowDoc('row-1', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
      }),
    };
    result = groupByCheckbox(rows, rowMetas, field);

    expect(result?.get('Yes')?.map((r) => r.id)).toEqual(['row-1']);
    expect(result?.get('No')).toEqual([]);
    expect(areGroupRowsHydrated(rows, rowMetas)).toBe(false);

    rowMetas = {
      'row-1': createRowDoc('row-1', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
      }),
      'row-2': createRowDoc('row-2', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'No'),
      }),
      'row-3': createRowDoc('row-3', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
      }),
    };
    result = groupByCheckbox(rows, rowMetas, field);

    expect(result?.get('Yes')?.map((r) => r.id)).toEqual(['row-1', 'row-3']);
    expect(result?.get('No')?.map((r) => r.id)).toEqual(['row-2']);
    expect(areGroupRowsHydrated(rows, rowMetas)).toBe(true);
  });

  it('checkbox: treats a hydrated missing cell as No while omitting an unloaded row', () => {
    const fieldId = 'checkbox-field';
    const otherFieldId = 'other-field';
    const field = createField(fieldId, FieldType.Checkbox);

    const rows: Row[] = [
      { id: 'row-with-checkbox-yes', height: 0 },
      { id: 'row-with-meta-no-checkbox-cell', height: 0 },
      { id: 'row-completely-unloaded', height: 0 },
    ];

    const rowMetas: Record<RowId, YDoc> = {
      'row-with-checkbox-yes': createRowDoc('row-with-checkbox-yes', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
      }),
      'row-with-meta-no-checkbox-cell': createRowDoc('row-with-meta-no-checkbox-cell', databaseId, {
        [otherFieldId]: createCell(FieldType.RichText, 'some text'),
      }),
    };

    const result = groupByCheckbox(rows, rowMetas, field);

    expect(result?.get('Yes')?.map((r) => r.id)).toEqual(['row-with-checkbox-yes']);
    expect(result?.get('No')?.map((r) => r.id)).toEqual(['row-with-meta-no-checkbox-cell']);
  });

  it('select option: treats a hydrated missing cell as No Status while omitting an unloaded row', () => {
    const fieldId = 'select-field';
    const otherFieldId = 'other-field';
    const field = createField(fieldId, FieldType.SingleSelect, {
      options: [
        { id: 'opt-a', name: 'Alpha', color: 0 },
        { id: 'opt-b', name: 'Beta', color: 0 },
      ],
      disable_color: false,
    });

    const rows: Row[] = [
      { id: 'row-with-select-value', height: 0 },
      { id: 'row-with-meta-no-select-cell', height: 0 },
      { id: 'row-completely-unloaded', height: 0 },
    ];

    const rowMetas: Record<RowId, YDoc> = {
      'row-with-select-value': createRowDoc('row-with-select-value', databaseId, {
        [fieldId]: createCell(FieldType.SingleSelect, 'opt-a'),
      }),
      'row-with-meta-no-select-cell': createRowDoc('row-with-meta-no-select-cell', databaseId, {
        [otherFieldId]: createCell(FieldType.RichText, 'some text'),
      }),
    };

    const result = groupBySelectOption(rows, rowMetas, field);

    expect(result?.get('opt-a')?.map((r) => r.id)).toEqual(['row-with-select-value']);
    expect(result?.get(fieldId)?.map((r) => r.id)).toEqual(['row-with-meta-no-select-cell']);
  });
});
