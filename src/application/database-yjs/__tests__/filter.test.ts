import dayjs from 'dayjs';
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import {
  checkboxFilterCheck,
  checklistFilterCheck,
  dateFilterCheck,
  filterBy,
  numberFilterCheck,
  personFilterCheck,
  rowTimeFilterCheck,
  selectOptionFilterCheck,
  textFilterCheck,
} from '@/application/database-yjs/filter';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import {
  CheckboxFilterCondition,
  ChecklistFilterCondition,
  DateFilterCondition,
  NumberFilterCondition,
  PersonFilterCondition,
  RelationFilterCondition,
  SelectOptionFilterCondition,
  TextFilterCondition,
} from '@/application/database-yjs/fields';
import { Row } from '@/application/database-yjs/selector';
import { DateTimeCell } from '@/application/database-yjs/cell.type';
import {
  RowId,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import {
  createCell,
  createDesktopFilterGridFixture,
  createField,
  createRelationRollupFixtureFromV069,
  createRowDoc,
  loadV069DatabaseFixture,
  loadV070DatabaseFixture,
  resolveRelationText,
  resolveRollupValue,
  setRelationCellRowIds,
} from './test-helpers';

function createFilters(
  configs: { fieldId: string; fieldType: FieldType; condition: number; content?: string }[]
): YDatabaseFilters {
  const filters = configs.map((config, index) => {
    const doc = new Y.Doc();
    const filter = doc.getMap(`filter-${index}`) as YDatabaseFilter;

    filter.set(YjsDatabaseKey.id, `filter-${index}`);
    filter.set(YjsDatabaseKey.field_id, config.fieldId);
    filter.set(YjsDatabaseKey.type, config.fieldType);
    filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
    filter.set(YjsDatabaseKey.condition, config.condition);
    filter.set(YjsDatabaseKey.content, config.content ?? '');

    return filter;
  });

  return {
    toArray: () => filters,
  } as YDatabaseFilters;
}

describe('text filter tests', () => {
  it('filters rows where text field is empty', () => {
    expect(textFilterCheck('', '', TextFilterCondition.TextIsEmpty)).toBe(true);
    expect(textFilterCheck('Alpha', '', TextFilterCondition.TextIsEmpty)).toBe(false);
  });

  it('filters rows where text field is not empty', () => {
    expect(textFilterCheck('Alpha', '', TextFilterCondition.TextIsNotEmpty)).toBe(true);
    expect(textFilterCheck('', '', TextFilterCondition.TextIsNotEmpty)).toBe(false);
  });

  it('filters rows where text exactly matches', () => {
    expect(textFilterCheck('Alpha', 'Alpha', TextFilterCondition.TextIs)).toBe(true);
    expect(textFilterCheck('Alpha', 'alpha', TextFilterCondition.TextIs)).toBe(false);
  });

  it('filters rows where text does not match', () => {
    expect(textFilterCheck('Alpha', 'Beta', TextFilterCondition.TextIsNot)).toBe(true);
    expect(textFilterCheck('Alpha', 'Alpha', TextFilterCondition.TextIsNot)).toBe(false);
  });

  it('filters rows where text contains substring (case insensitive)', () => {
    expect(textFilterCheck('Alpha Beta', 'beta', TextFilterCondition.TextContains)).toBe(true);
  });

  it('filters rows where text does not contain substring', () => {
    expect(textFilterCheck('Alpha Beta', 'gamma', TextFilterCondition.TextDoesNotContain)).toBe(true);
    expect(textFilterCheck('Alpha Beta', 'alpha', TextFilterCondition.TextDoesNotContain)).toBe(false);
  });

  it('filters rows where text starts with prefix', () => {
    expect(textFilterCheck('Alpha Beta', 'alpha', TextFilterCondition.TextStartsWith)).toBe(true);
    expect(textFilterCheck('Alpha Beta', 'beta', TextFilterCondition.TextStartsWith)).toBe(false);
  });

  it('filters rows where text ends with suffix', () => {
    expect(textFilterCheck('Alpha Beta', 'beta', TextFilterCondition.TextEndsWith)).toBe(true);
    expect(textFilterCheck('Alpha Beta', 'alpha', TextFilterCondition.TextEndsWith)).toBe(false);
  });

  it('handles empty content in filter', () => {
    expect(textFilterCheck('Alpha', '', TextFilterCondition.TextContains)).toBe(true);
    expect(textFilterCheck('Alpha', '', TextFilterCondition.TextDoesNotContain)).toBe(false);
  });

  it('handles special characters in filter content', () => {
    expect(textFilterCheck('a+b*c', '+b*', TextFilterCondition.TextContains)).toBe(true);
  });

  it('handles unicode characters', () => {
    expect(textFilterCheck('Café au lait', 'fé', TextFilterCondition.TextContains)).toBe(true);
  });
});

describe('number filter tests', () => {
  it('filters rows where number equals value', () => {
    expect(numberFilterCheck('10', '10', NumberFilterCondition.Equal)).toBe(true);
  });

  it('filters rows where number does not equal value', () => {
    expect(numberFilterCheck('10', '8', NumberFilterCondition.NotEqual)).toBe(true);
  });

  it('filters rows where number is greater than value', () => {
    expect(numberFilterCheck('10', '8', NumberFilterCondition.GreaterThan)).toBe(true);
    expect(numberFilterCheck('8', '10', NumberFilterCondition.GreaterThan)).toBe(false);
  });

  it('filters rows where number is greater than or equal to value', () => {
    expect(numberFilterCheck('10', '10', NumberFilterCondition.GreaterThanOrEqualTo)).toBe(true);
  });

  it('filters rows where number is less than value', () => {
    expect(numberFilterCheck('8', '10', NumberFilterCondition.LessThan)).toBe(true);
  });

  it('filters rows where number is less than or equal to value', () => {
    expect(numberFilterCheck('10', '10', NumberFilterCondition.LessThanOrEqualTo)).toBe(true);
  });

  it('filters rows where number field is empty', () => {
    expect(numberFilterCheck('', '10', NumberFilterCondition.NumberIsEmpty)).toBe(true);
    expect(numberFilterCheck('10', '10', NumberFilterCondition.NumberIsEmpty)).toBe(false);
  });

  it('filters rows where number field is not empty', () => {
    expect(numberFilterCheck('10', '', NumberFilterCondition.NumberIsNotEmpty)).toBe(true);
    expect(numberFilterCheck('', '', NumberFilterCondition.NumberIsNotEmpty)).toBe(false);
  });

  it('handles decimal numbers', () => {
    expect(numberFilterCheck('10.5', '10.2', NumberFilterCondition.GreaterThan)).toBe(true);
  });

  it('handles negative numbers', () => {
    expect(numberFilterCheck('-1', '0', NumberFilterCondition.LessThan)).toBe(true);
  });

  it('handles very large numbers', () => {
    expect(numberFilterCheck('9007199254740993', '9007199254740992', NumberFilterCondition.GreaterThan)).toBe(true);
  });

  it('handles zero', () => {
    expect(numberFilterCheck('0', '0', NumberFilterCondition.Equal)).toBe(true);
  });

  it('handles NaN values', () => {
    expect(numberFilterCheck('NaN', '5', NumberFilterCondition.Equal)).toBe(false);
    expect(numberFilterCheck('NaN', '5', NumberFilterCondition.NumberIsNotEmpty)).toBe(true);
  });
});

describe('checkbox filter tests', () => {
  it('filters rows where checkbox is checked', () => {
    expect(checkboxFilterCheck('Yes', CheckboxFilterCondition.IsChecked)).toBe(true);
    expect(checkboxFilterCheck(false, CheckboxFilterCondition.IsChecked)).toBe(false);
  });

  it('filters rows where checkbox is unchecked', () => {
    expect(checkboxFilterCheck('No', CheckboxFilterCondition.IsUnChecked)).toBe(true);
    expect(checkboxFilterCheck('Yes', CheckboxFilterCondition.IsUnChecked)).toBe(false);
  });

  it('handles "Yes"/"No" string values', () => {
    expect(checkboxFilterCheck('yes', CheckboxFilterCondition.IsChecked)).toBe(true);
    expect(checkboxFilterCheck('no', CheckboxFilterCondition.IsUnChecked)).toBe(true);
  });

  it('handles boolean values', () => {
    expect(checkboxFilterCheck(true, CheckboxFilterCondition.IsChecked)).toBe(true);
    expect(checkboxFilterCheck(false, CheckboxFilterCondition.IsUnChecked)).toBe(true);
  });

  it('handles empty values', () => {
    expect(checkboxFilterCheck('', CheckboxFilterCondition.IsUnChecked)).toBe(true);
  });
});

describe('checklist filter tests', () => {
  const completeChecklist = JSON.stringify({
    options: [
      { id: '1', name: 'Task', color: 0 },
      { id: '2', name: 'Other', color: 0 },
    ],
    selected_option_ids: ['1', '2'],
  });
  const incompleteChecklist = JSON.stringify({
    options: [
      { id: '1', name: 'Task', color: 0 },
      { id: '2', name: 'Other', color: 0 },
    ],
    selected_option_ids: ['1'],
  });

  it('filters rows where checklist is 100% complete', () => {
    expect(checklistFilterCheck(completeChecklist, '', ChecklistFilterCondition.IsComplete)).toBe(true);
    expect(checklistFilterCheck(incompleteChecklist, '', ChecklistFilterCondition.IsComplete)).toBe(false);
  });

  it('filters rows where checklist is not complete', () => {
    expect(checklistFilterCheck(incompleteChecklist, '', ChecklistFilterCondition.IsIncomplete)).toBe(true);
  });

  it('handles empty checklist', () => {
    expect(checklistFilterCheck('', '', ChecklistFilterCondition.IsIncomplete)).toBe(true);
  });

  it('handles checklist with all items checked', () => {
    expect(checklistFilterCheck(completeChecklist, '', ChecklistFilterCondition.IsComplete)).toBe(true);
  });

  it('handles checklist with no items checked', () => {
    const noneChecked = JSON.stringify({
      options: [{ id: '1', name: 'Task', color: 0 }],
      selected_option_ids: [],
    });

    expect(checklistFilterCheck(noneChecked, '', ChecklistFilterCondition.IsIncomplete)).toBe(true);
  });

  it('handles checklist with partial completion', () => {
    expect(checklistFilterCheck(incompleteChecklist, '', ChecklistFilterCondition.IsIncomplete)).toBe(true);
  });
});

describe('date filter tests', () => {
  const base = dayjs('2024-01-15').startOf('day');
  const timestamp = base.unix().toString();
  const before = base.subtract(1, 'day').unix().toString();
  const after = base.add(1, 'day').unix().toString();

  const cell: DateTimeCell = {
    fieldType: FieldType.DateTime,
    data: timestamp,
    createdAt: 0,
    lastModified: 0,
    endTimestamp: after,
  };

  const emptyCell: DateTimeCell = {
    fieldType: FieldType.DateTime,
    data: '',
    createdAt: 0,
    lastModified: 0,
    endTimestamp: '',
  };

  it('filters rows where date is on specific day', () => {
    expect(dateFilterCheck(cell, { condition: DateFilterCondition.DateStartsOn, timestamp })).toBe(true);
  });

  it('filters rows where date is before specific day', () => {
    expect(dateFilterCheck(cell, { condition: DateFilterCondition.DateStartsBefore, timestamp: after })).toBe(true);
  });

  it('filters rows where date is after specific day', () => {
    expect(dateFilterCheck(cell, { condition: DateFilterCondition.DateStartsAfter, timestamp: before })).toBe(true);
  });

  it('filters rows where date is on or before specific day', () => {
    expect(dateFilterCheck(cell, { condition: DateFilterCondition.DateStartsOnOrBefore, timestamp })).toBe(true);
  });

  it('filters rows where date is on or after specific day', () => {
    expect(dateFilterCheck(cell, { condition: DateFilterCondition.DateStartsOnOrAfter, timestamp })).toBe(true);
  });

  it('filters rows where date is between two dates', () => {
    expect(dateFilterCheck(cell, { condition: DateFilterCondition.DateStartsBetween, start: before, end: after })).toBe(
      true
    );
  });

  it('filters rows where date is empty', () => {
    expect(dateFilterCheck(emptyCell, { condition: DateFilterCondition.DateStartIsEmpty, timestamp })).toBe(true);
  });

  it('filters rows where date is not empty', () => {
    expect(dateFilterCheck(cell, { condition: DateFilterCondition.DateStartIsNotEmpty, timestamp })).toBe(true);
  });

  it('filters date ranges by end date', () => {
    expect(dateFilterCheck(cell, { condition: DateFilterCondition.DateEndsOn, timestamp: after })).toBe(true);
    expect(dateFilterCheck(cell, { condition: DateFilterCondition.DateEndsBetween, start: before, end: after })).toBe(
      true
    );
  });
});

describe('row time filter tests', () => {
  const base = dayjs('2024-01-10').startOf('day');
  const timestamp = base.unix().toString();
  const before = base.subtract(1, 'day').unix().toString();
  const after = base.add(1, 'day').unix().toString();

  it('filters by created_at timestamp', () => {
    expect(rowTimeFilterCheck(timestamp, { condition: DateFilterCondition.DateStartsOn, timestamp })).toBe(true);
  });

  it('filters by last_modified timestamp', () => {
    expect(rowTimeFilterCheck(after, { condition: DateFilterCondition.DateStartsAfter, timestamp: before })).toBe(true);
  });

  it('filters created_at is empty', () => {
    expect(rowTimeFilterCheck('', { condition: DateFilterCondition.DateStartIsEmpty, timestamp })).toBe(true);
  });

  it('filters created_at is not empty', () => {
    expect(rowTimeFilterCheck(timestamp, { condition: DateFilterCondition.DateStartIsNotEmpty, timestamp })).toBe(true);
  });
});

describe('select option filter tests', () => {
  const field = createField('select', FieldType.SingleSelect, {
    options: [
      { id: 'opt-a', name: 'Alpha', color: 0 },
      { id: 'opt-b', name: 'Beta', color: 0 },
    ],
    disable_color: false,
  });

  it('filters rows where single select option matches', () => {
    expect(selectOptionFilterCheck(field, 'opt-a', 'opt-a', SelectOptionFilterCondition.OptionIs)).toBe(true);
  });

  it('filters rows where single select option does not match', () => {
    expect(selectOptionFilterCheck(field, 'opt-a', 'opt-b', SelectOptionFilterCondition.OptionIsNot)).toBe(true);
  });

  it('filters rows where multi-select contains option', () => {
    expect(
      selectOptionFilterCheck(field, 'opt-a,opt-b', 'opt-b', SelectOptionFilterCondition.OptionContains)
    ).toBe(true);
  });

  it('filters rows where multi-select does not contain option', () => {
    expect(
      selectOptionFilterCheck(field, 'opt-a,opt-b', 'opt-c', SelectOptionFilterCondition.OptionDoesNotContain)
    ).toBe(true);
  });

  it('filters rows where select field is empty', () => {
    expect(selectOptionFilterCheck(field, '', '', SelectOptionFilterCondition.OptionIsEmpty)).toBe(true);
  });

  it('filters rows where select field is not empty', () => {
    expect(selectOptionFilterCheck(field, 'opt-a', '', SelectOptionFilterCondition.OptionIsNotEmpty)).toBe(true);
  });

  it('handles multiple selected options', () => {
    expect(
      selectOptionFilterCheck(field, 'opt-a,opt-b', 'opt-a,opt-b', SelectOptionFilterCondition.OptionContains)
    ).toBe(true);
  });

  it('handles option matching by name vs id', () => {
    expect(selectOptionFilterCheck(field, 'Alpha', 'opt-a', SelectOptionFilterCondition.OptionIs)).toBe(true);
  });
});

describe('person filter tests', () => {
  it('filters rows where person contains id', () => {
    expect(personFilterCheck(JSON.stringify(['u1', 'u2']), JSON.stringify(['u2']), PersonFilterCondition.PersonContains))
      .toBe(true);
  });

  it('filters rows where person does not contain id', () => {
    expect(
      personFilterCheck(JSON.stringify(['u1']), JSON.stringify(['u2']), PersonFilterCondition.PersonDoesNotContain)
    ).toBe(true);
  });

  it('filters rows where person is empty', () => {
    expect(personFilterCheck('', JSON.stringify([]), PersonFilterCondition.PersonIsEmpty)).toBe(true);
  });

  it('filters rows where person is not empty', () => {
    expect(personFilterCheck(JSON.stringify(['u1']), JSON.stringify(['u1']), PersonFilterCondition.PersonIsNotEmpty)).toBe(
      true
    );
  });
});

describe('advanced filter tests', () => {
  const databaseId = 'db-filter';
  const textFieldId = 'text-field';
  const numberFieldId = 'number-field';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(textFieldId, createField(textFieldId, FieldType.RichText));
  fields.set(numberFieldId, createField(numberFieldId, FieldType.Number));

  const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
  const rowMetas: Record<RowId, YDoc> = {
    'row-a': createRowDoc('row-a', databaseId, {
      [textFieldId]: createCell(FieldType.RichText, 'Alpha'),
      [numberFieldId]: createCell(FieldType.Number, '10'),
    }),
    'row-b': createRowDoc('row-b', databaseId, {
      [textFieldId]: createCell(FieldType.RichText, 'Beta'),
      [numberFieldId]: createCell(FieldType.Number, '30'),
    }),
    'row-c': createRowDoc('row-c', databaseId, {
      [textFieldId]: createCell(FieldType.RichText, 'Gamma'),
      [numberFieldId]: createCell(FieldType.Number, '5'),
    }),
  };

  it('applies multiple filters with AND logic', () => {
    const filters = createFilters([
      { fieldId: textFieldId, fieldType: FieldType.RichText, condition: TextFilterCondition.TextContains, content: 'a' },
      { fieldId: numberFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.GreaterThan, content: '10' },
    ]);

    const result = filterBy(rows, filters, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b']);
  });

  it('handles filter with no matching rows', () => {
    const filters = createFilters([
      { fieldId: textFieldId, fieldType: FieldType.RichText, condition: TextFilterCondition.TextIs, content: 'Zeta' },
    ]);

    const result = filterBy(rows, filters, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual([]);
  });

  it('handles filter with all rows matching', () => {
    const filters = createFilters([
      {
        fieldId: textFieldId,
        fieldType: FieldType.RichText,
        condition: TextFilterCondition.TextDoesNotContain,
        content: 'zzz',
      },
    ]);

    const result = filterBy(rows, filters, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a', 'row-b', 'row-c']);
  });
});

describe('filterBy integration for select and person fields', () => {
  const databaseId = 'db-select';
  const selectFieldId = 'select-field';
  const personFieldId = 'person-field';
  const fields = new Map() as unknown as YDatabaseFields;

  const selectField = createField(selectFieldId, FieldType.SingleSelect, {
    options: [
      { id: 'opt-a', name: 'Alpha', color: 0 },
      { id: 'opt-b', name: 'Beta', color: 0 },
    ],
    disable_color: false,
  }) as YDatabaseField;

  fields.set(selectFieldId, selectField);
  fields.set(personFieldId, createField(personFieldId, FieldType.Person));

  const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
  const rowMetas: Record<RowId, YDoc> = {
    'row-a': createRowDoc('row-a', databaseId, {
      [selectFieldId]: createCell(FieldType.SingleSelect, 'opt-a'),
      [personFieldId]: createCell(FieldType.Person, JSON.stringify(['u1'])),
    }),
    'row-b': createRowDoc('row-b', databaseId, {
      [selectFieldId]: createCell(FieldType.SingleSelect, ''),
      [personFieldId]: createCell(FieldType.Person, JSON.stringify(['u2'])),
    }),
  };

  it('filters by select option in filterBy', () => {
    const filters = createFilters([
      {
        fieldId: selectFieldId,
        fieldType: FieldType.SingleSelect,
        condition: SelectOptionFilterCondition.OptionIs,
        content: 'opt-a',
      },
    ]);

    const result = filterBy(rows, filters, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a']);
  });

  it('filters by person ids in filterBy', () => {
    const filters = createFilters([
      {
        fieldId: personFieldId,
        fieldType: FieldType.Person,
        condition: PersonFilterCondition.PersonContains,
        content: JSON.stringify(['u2']),
      },
    ]);

    const result = filterBy(rows, filters, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b']);
  });
});

describe('v069 comprehensive filter tests (desktop parity)', () => {
  // Mirrors: database_filter_v069_comprehensive_test.dart
  //
  // v069 Database Structure (13 rows):
  // | Row | Name      | Amount  | Delta  | Reg Complete | Priority | Tags                  |
  // |-----|-----------|---------|--------|--------------|----------|-----------------------|
  // | 1   | Olaf      | 55200   | 0.5    | unchecked    | VIP      | Education             |
  // | 2   | Beatrice  | 828600  | -2.25  | checked      | High     | Health, Family        |
  // | 3   | Lancelot  | 22500   | 11.6   | unchecked    | VIP      | Hobby                 |
  // | 4   | Scotty    | 10900   | 0      | checked      | (empty)  | Hobby, Health         |
  // | 5   | (empty)   | (empty) | (empty)| unchecked    | (empty)  | (empty)               |
  // | 6   | Thomas    | 465800  | -0.03  | checked      | High     | Health, Hobby         |
  // | 7   | Juan      | 93100   | 4.86   | checked      | Medium   | Work, Health, Edu     |
  // | 8   | Alex      | 3560    | 1.96   | checked      | Medium   | Work, Education       |
  // | 9   | Alexander | 2073    | 0.5    | unchecked    | High     | Hobby                 |
  // | 10  | George    | (empty) | (empty)| checked      | Medium   | Work, Health          |
  // | 11  | Joanna    | 16470   | -5.36  | unchecked    | Medium   | Family, Health        |
  // | 12  | George    | 9500    | 1.7    | unchecked    | Medium   | Work, Edu, Health, Hobby |
  // | 13  | Judy      | (empty) | (empty)| checked      | (empty)  | Work                  |

  const fixture = loadV069DatabaseFixture();
  const nameFieldId = fixture.fieldIdByName.get('Name') ?? '';
  const amountFieldId = fixture.fieldIdByName.get('Amount') ?? '';
  const deltaFieldId = fixture.fieldIdByName.get('Delta') ?? '';
  const checkboxFieldId = fixture.fieldIdByName.get('Registration Complete') ?? '';
  const priorityFieldId = fixture.fieldIdByName.get('Priority') ?? '';
  const tagsFieldId = fixture.fieldIdByName.get('Tags') ?? '';

  // Priority option IDs
  const VIP = 'cplL';
  const HIGH = 'GSf_';
  const MEDIUM = 'qnja';

  function apply(configs: { fieldId: string; fieldType: FieldType; condition: number; content?: string }[]) {
    return filterBy(fixture.rows, createFilters(configs), fixture.fields, fixture.rowMetas);
  }

  function names(rows: Row[]) {
    return rows.map((r) => {
      const doc = fixture.rowMetas[r.id];
      const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
      return (row.get(YjsDatabaseKey.cells)?.get(nameFieldId)?.get(YjsDatabaseKey.data) as string) ?? '';
    });
  }

  // --- Checkbox ---

  it('checkbox is checked => 7 rows', () => {
    const result = apply([{ fieldId: checkboxFieldId, fieldType: FieldType.Checkbox, condition: CheckboxFilterCondition.IsChecked }]);
    expect(result.length).toBe(7);
    expect(names(result)).toEqual(['Beatrice', 'Scotty', 'Thomas', 'Juan', 'Alex', 'George', 'Judy']);
  });

  it('checkbox is unchecked => 6 rows', () => {
    const result = apply([{ fieldId: checkboxFieldId, fieldType: FieldType.Checkbox, condition: CheckboxFilterCondition.IsUnChecked }]);
    expect(result.length).toBe(6);
  });

  // --- Number (Amount) - isEmpty/isNotEmpty ---

  it('Amount is empty => 3 rows', () => {
    const result = apply([{ fieldId: amountFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.NumberIsEmpty }]);
    expect(result.length).toBe(3);
  });

  it('Amount is not empty => 10 rows', () => {
    const result = apply([{ fieldId: amountFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.NumberIsNotEmpty }]);
    expect(result.length).toBe(10);
  });

  // --- Number (Delta) - value comparisons ---

  it('Delta equals 0 => 1 row (Scotty)', () => {
    const result = apply([{ fieldId: deltaFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.Equal, content: '0' }]);
    expect(result.length).toBe(1);
    expect(names(result)).toEqual(['Scotty']);
  });

  it('Delta less than 0 => 3 rows', () => {
    const result = apply([{ fieldId: deltaFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.LessThan, content: '0' }]);
    expect(result.length).toBe(3);
    expect(names(result)).toEqual(['Beatrice', 'Thomas', 'Joanna']);
  });

  it('Delta greater than 0 => 6 rows', () => {
    const result = apply([{ fieldId: deltaFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.GreaterThan, content: '0' }]);
    expect(result.length).toBe(6);
  });

  it('Delta less than or equal to 0 => 4 rows', () => {
    const result = apply([{ fieldId: deltaFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.LessThanOrEqualTo, content: '0' }]);
    expect(result.length).toBe(4);
  });

  it('Delta greater than or equal to 0 => 7 rows', () => {
    const result = apply([{ fieldId: deltaFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.GreaterThanOrEqualTo, content: '0' }]);
    expect(result.length).toBe(7);
  });

  it('Delta not equal to 0 => 9 rows', () => {
    const result = apply([{ fieldId: deltaFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.NotEqual, content: '0' }]);
    expect(result.length).toBe(9);
  });

  // --- Text (Name) ---

  it('Name contains "George" => 2 rows', () => {
    const result = apply([{ fieldId: nameFieldId, fieldType: FieldType.RichText, condition: TextFilterCondition.TextContains, content: 'George' }]);
    expect(result.length).toBe(2);
  });

  // --- SingleSelect (Priority) ---

  it('Priority is VIP => 2 rows', () => {
    const result = apply([{ fieldId: priorityFieldId, fieldType: FieldType.SingleSelect, condition: SelectOptionFilterCondition.OptionIs, content: VIP }]);
    expect(result.length).toBe(2);
    expect(names(result)).toEqual(['Olaf', 'Lancelot']);
  });

  it('Priority is High => 3 rows', () => {
    const result = apply([{ fieldId: priorityFieldId, fieldType: FieldType.SingleSelect, condition: SelectOptionFilterCondition.OptionIs, content: HIGH }]);
    expect(result.length).toBe(3);
    expect(names(result)).toEqual(['Beatrice', 'Thomas', 'Alexander']);
  });

  it('Priority is Medium => 5 rows', () => {
    const result = apply([{ fieldId: priorityFieldId, fieldType: FieldType.SingleSelect, condition: SelectOptionFilterCondition.OptionIs, content: MEDIUM }]);
    expect(result.length).toBe(5);
  });

  it('Priority is empty => 3 rows', () => {
    const result = apply([{ fieldId: priorityFieldId, fieldType: FieldType.SingleSelect, condition: SelectOptionFilterCondition.OptionIsEmpty }]);
    expect(result.length).toBe(3);
  });

  it('Priority is not empty => 10 rows', () => {
    const result = apply([{ fieldId: priorityFieldId, fieldType: FieldType.SingleSelect, condition: SelectOptionFilterCondition.OptionIsNotEmpty }]);
    expect(result.length).toBe(10);
  });

  // --- MultiSelect (Tags) ---

  it('Tags contains (no selection) => 13 rows (all)', () => {
    const result = apply([{ fieldId: tagsFieldId, fieldType: FieldType.MultiSelect, condition: SelectOptionFilterCondition.OptionContains, content: '' }]);
    expect(result.length).toBe(13);
  });

  // --- Combined filters (AND logic) ---

  it('checkbox checked AND Amount not empty => 5 rows', () => {
    const result = apply([
      { fieldId: checkboxFieldId, fieldType: FieldType.Checkbox, condition: CheckboxFilterCondition.IsChecked },
      { fieldId: amountFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.NumberIsNotEmpty },
    ]);
    expect(result.length).toBe(5);
    expect(names(result)).toEqual(['Beatrice', 'Scotty', 'Thomas', 'Juan', 'Alex']);
  });

  it('checkbox checked AND Priority High => 2 rows', () => {
    const result = apply([
      { fieldId: checkboxFieldId, fieldType: FieldType.Checkbox, condition: CheckboxFilterCondition.IsChecked },
      { fieldId: priorityFieldId, fieldType: FieldType.SingleSelect, condition: SelectOptionFilterCondition.OptionIs, content: HIGH },
    ]);
    expect(result.length).toBe(2);
    expect(names(result)).toEqual(['Beatrice', 'Thomas']);
  });

  it('three filters: checked AND Amount not empty AND Priority Medium => 2 rows', () => {
    const result = apply([
      { fieldId: checkboxFieldId, fieldType: FieldType.Checkbox, condition: CheckboxFilterCondition.IsChecked },
      { fieldId: amountFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.NumberIsNotEmpty },
      { fieldId: priorityFieldId, fieldType: FieldType.SingleSelect, condition: SelectOptionFilterCondition.OptionIs, content: MEDIUM },
    ]);
    expect(result.length).toBe(2);
    expect(names(result)).toEqual(['Juan', 'Alex']);
  });
});

describe('filterBy with v069 relation and rollup values', () => {
  const fixture = createRelationRollupFixtureFromV069({ suffix: 'filter' });
  const relationField = fixture.baseDatabase
    .get(YjsDatabaseKey.fields)
    ?.get(fixture.relationFieldId) as YDatabaseField;
  const rollupField = fixture.baseDatabase
    .get(YjsDatabaseKey.fields)
    ?.get(fixture.rollupListFieldId) as YDatabaseField;

  let relationTexts: Record<RowId, string>;
  let rollupTexts: Record<RowId, string>;

  beforeAll(async () => {
    relationTexts = {};
    rollupTexts = {};
    for (const rowId of fixture.baseRowIds) {
      const rowDoc = fixture.baseRowMetas[rowId];
      const row = rowDoc
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database_row) as YDatabaseRow;
      relationTexts[rowId] = await resolveRelationText({
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        relationField,
        row,
        rowId,
        fieldId: fixture.relationFieldId,
        loadView: fixture.loadView,
        createRow: fixture.createRow,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      });
      rollupTexts[rowId] = (
        await resolveRollupValue({
          baseDoc: fixture.baseDoc,
          database: fixture.baseDatabase,
          rollupField,
          row,
          rowId,
          fieldId: fixture.rollupListFieldId,
          loadView: fixture.loadView,
          createRow: fixture.createRow,
          getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
        })
      ).value;
    }
  });

  it('filters computed relation text', () => {
    const filters = createFilters([
      {
        fieldId: fixture.relationFieldId,
        fieldType: FieldType.Relation,
        condition: TextFilterCondition.TextContains,
        content: 'Olaf',
      },
    ]);

    const result = filterBy(fixture.baseRows, filters, fixture.baseFields, fixture.baseRowMetas, {
      getRelationCellText: (rowId) => relationTexts[rowId] ?? '',
    }).map((row) => row.id);

    expect(result).toEqual([fixture.baseRowIds[0]]);
  });

  it('filters computed rollup list text', () => {
    const filters = createFilters([
      {
        fieldId: fixture.rollupListFieldId,
        fieldType: FieldType.Rollup,
        condition: TextFilterCondition.TextContains,
        content: 'Thomas',
      },
    ]);

    const result = filterBy(fixture.baseRows, filters, fixture.baseFields, fixture.baseRowMetas, {
      getRollupCellText: (rowId) => rollupTexts[rowId] ?? '',
    }).map((row) => row.id);

    expect(result).toEqual([fixture.baseRowIds[1]]);
  });
});

describe('desktop grid filter parity', () => {
  let fixture: ReturnType<typeof createDesktopFilterGridFixture>;

  beforeEach(() => {
    fixture = createDesktopFilterGridFixture();
  });

  function buildFilterHarness() {
    const doc = new Y.Doc();
    let counter = 0;

    const makeDataFilter = (
      fieldId: string,
      fieldType: FieldType,
      condition: number,
      content: string = ''
    ) => {
      const filter = new Y.Map() as YDatabaseFilter;
      filter.set(YjsDatabaseKey.id, `filter-${counter}`);
      filter.set(YjsDatabaseKey.field_id, fieldId);
      filter.set(YjsDatabaseKey.type, fieldType);
      filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
      filter.set(YjsDatabaseKey.condition, condition);
      filter.set(YjsDatabaseKey.content, content);
      counter += 1;
      return filter;
    };

    const makeGroupFilter = (type: FilterType.And | FilterType.Or, children: YDatabaseFilter[]) => {
      const filter = new Y.Map() as YDatabaseFilter;
      filter.set(YjsDatabaseKey.id, `filter-${counter}`);
      filter.set(YjsDatabaseKey.filter_type, type);
      const childArray = new Y.Array() as YDatabaseFilters;
      childArray.push(children);
      filter.set(YjsDatabaseKey.children, childArray);
      counter += 1;
      return filter;
    };

    const makeFilters = (nodes: YDatabaseFilter[]) => {
      const filters = new Y.Array() as YDatabaseFilters;
      doc.getMap('root').set('filters', filters);
      filters.push(nodes);
      return filters;
    };

    return { makeDataFilter, makeGroupFilter, makeFilters };
  }

  function applyFilters(filters: YDatabaseFilters) {
    return filterBy(fixture.rows, filters, fixture.fields, fixture.rowMetas).map((row) => row.id);
  }

  function setCellData(rowId: string, fieldId: string, fieldType: FieldType, data: string) {
    const rowDoc = fixture.rowMetas[rowId];
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cells = row.get(YjsDatabaseKey.cells);
    let cell = cells.get(fieldId);

    if (!cell) {
      cell = new Y.Map() as YDatabaseCell;
      cell.set(YjsDatabaseKey.field_type, fieldType);
      cells.set(fieldId, cell);
    }

    cell.set(YjsDatabaseKey.data, data);
  }

  it('filters text is empty', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextIsEmpty
    );

    const result = applyFilters(makeFilters([filter]));
    expect(result).toEqual([fixture.rowIds[1]]);
  });

  it('filters text is not empty', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextIsNotEmpty
    );

    const result = applyFilters(makeFilters([filter]));
    expect(result).toEqual([
      fixture.rowIds[0],
      fixture.rowIds[2],
      fixture.rowIds[3],
      fixture.rowIds[4],
      fixture.rowIds[5],
      fixture.rowIds[6],
    ]);
  });

  it('filters text is', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextIs,
      'A'
    );

    const result = applyFilters(makeFilters([filter]));
    expect(result).toEqual([fixture.rowIds[0]]);
  });

  it('filters text contains and reacts to cell updates', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextContains,
      'A'
    );
    const filters = makeFilters([filter]);

    expect(applyFilters(filters)).toEqual([
      fixture.rowIds[0],
      fixture.rowIds[3],
      fixture.rowIds[4],
      fixture.rowIds[5],
    ]);

    setCellData(fixture.rowIds[1], fixture.fieldIds.text, FieldType.RichText, 'ABC');
    expect(applyFilters(filters)).toEqual([
      fixture.rowIds[0],
      fixture.rowIds[1],
      fixture.rowIds[3],
      fixture.rowIds[4],
      fixture.rowIds[5],
    ]);
  });

  it('filters text does not contain', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextDoesNotContain,
      'AB'
    );

    const result = applyFilters(makeFilters([filter]));
    expect(result).toEqual(fixture.rowIds);
  });

  it('filters text starts with', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextStartsWith,
      'A'
    );

    const result = applyFilters(makeFilters([filter]));
    expect(result).toEqual([fixture.rowIds[0], fixture.rowIds[4], fixture.rowIds[5]]);
  });

  it('filters text ends with', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextEndsWith,
      'A'
    );

    const result = applyFilters(makeFilters([filter]));
    expect(result).toEqual([fixture.rowIds[0], fixture.rowIds[3]]);
  });

  it('updates filter conditions', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextEndsWith,
      'A'
    );
    const filters = makeFilters([filter]);

    expect(applyFilters(filters)).toEqual([fixture.rowIds[0], fixture.rowIds[3]]);

    filter.set(YjsDatabaseKey.condition, TextFilterCondition.TextIs);
    filter.set(YjsDatabaseKey.content, 'A');

    expect(applyFilters(filters)).toEqual([fixture.rowIds[0]]);
  });

  it('deletes filter', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextIsEmpty
    );
    const filters = makeFilters([filter]);

    expect(applyFilters(filters)).toEqual([fixture.rowIds[1]]);

    filters.delete(0, 1);
    expect(applyFilters(filters)).toEqual(fixture.rowIds);
  });

  it('updates empty text cell', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.text,
      FieldType.RichText,
      TextFilterCondition.TextIsEmpty
    );
    const filters = makeFilters([filter]);

    expect(applyFilters(filters)).toEqual([fixture.rowIds[1]]);

    setCellData(fixture.rowIds[0], fixture.fieldIds.text, FieldType.RichText, '');
    expect(applyFilters(filters)).toEqual([fixture.rowIds[0], fixture.rowIds[1]]);
  });

  it('filters number conditions', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.number,
            FieldType.Number,
            NumberFilterCondition.Equal,
            '1'
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.number,
            FieldType.Number,
            NumberFilterCondition.LessThan,
            '3'
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0], fixture.rowIds[1]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.number,
            FieldType.Number,
            NumberFilterCondition.LessThanOrEqualTo,
            '3'
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0], fixture.rowIds[1], fixture.rowIds[2]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.number,
            FieldType.Number,
            NumberFilterCondition.NumberIsEmpty,
            ''
          ),
        ])
      )
    ).toEqual([fixture.rowIds[4], fixture.rowIds[6]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.number,
            FieldType.Number,
            NumberFilterCondition.NumberIsNotEmpty,
            ''
          ),
        ])
      )
    ).toEqual([
      fixture.rowIds[0],
      fixture.rowIds[1],
      fixture.rowIds[2],
      fixture.rowIds[3],
      fixture.rowIds[5],
    ]);
  });

  it('filters checkbox conditions', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.checkbox,
            FieldType.Checkbox,
            CheckboxFilterCondition.IsChecked
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0], fixture.rowIds[1], fixture.rowIds[5]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.checkbox,
            FieldType.Checkbox,
            CheckboxFilterCondition.IsUnChecked
          ),
        ])
      )
    ).toEqual([fixture.rowIds[2], fixture.rowIds[3], fixture.rowIds[4], fixture.rowIds[6]]);
  });

  it('filters checklist completeness', () => {
    const row0Doc = fixture.rowMetas[fixture.rowIds[0]];
    const row0 = row0Doc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row) as YDatabaseRow;
    const row0Checklist = row0
      .get(YjsDatabaseKey.cells)
      ?.get(fixture.fieldIds.checklist)
      ?.get(YjsDatabaseKey.data);

    if (typeof row0Checklist === 'string') {
      const parsed = JSON.parse(row0Checklist) as { options: Array<{ id: string }>; selected_option_ids: string[] };
      const completeChecklist = JSON.stringify({
        options: parsed.options,
        selected_option_ids: parsed.options.map((option) => option.id),
      });
      row0
        .get(YjsDatabaseKey.cells)
        ?.get(fixture.fieldIds.checklist)
        ?.set(YjsDatabaseKey.data, completeChecklist);
    }

    const { makeDataFilter, makeFilters } = buildFilterHarness();

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.checklist,
            FieldType.Checklist,
            ChecklistFilterCondition.IsIncomplete
          ),
        ])
      )
    ).toEqual([fixture.rowIds[1], fixture.rowIds[2], fixture.rowIds[4], fixture.rowIds[5], fixture.rowIds[6]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.checklist,
            FieldType.Checklist,
            ChecklistFilterCondition.IsComplete
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0], fixture.rowIds[3]]);
  });

  it('filters date conditions', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const onFilter = makeDataFilter(
      fixture.fieldIds.date,
      FieldType.DateTime,
      DateFilterCondition.DateStartsOn,
      JSON.stringify({ timestamp: 1647251762 })
    );
    const afterFilter = makeDataFilter(
      fixture.fieldIds.date,
      FieldType.DateTime,
      DateFilterCondition.DateStartsAfter,
      JSON.stringify({ timestamp: 1647251762 })
    );
    const onOrAfterFilter = makeDataFilter(
      fixture.fieldIds.date,
      FieldType.DateTime,
      DateFilterCondition.DateStartsOnOrAfter,
      JSON.stringify({ timestamp: 1668359085 })
    );
    const onOrBeforeFilter = makeDataFilter(
      fixture.fieldIds.date,
      FieldType.DateTime,
      DateFilterCondition.DateStartsOnOrBefore,
      JSON.stringify({ timestamp: 1668359085 })
    );
    const betweenFilter = makeDataFilter(
      fixture.fieldIds.date,
      FieldType.DateTime,
      DateFilterCondition.DateStartsBetween,
      JSON.stringify({ start: 1647251762, end: 1668704685 })
    );

    expect(applyFilters(makeFilters([onFilter]))).toEqual([fixture.rowIds[0], fixture.rowIds[1], fixture.rowIds[2]]);
    expect(applyFilters(makeFilters([afterFilter]))).toEqual([fixture.rowIds[3], fixture.rowIds[4], fixture.rowIds[5]]);
    expect(applyFilters(makeFilters([onOrAfterFilter]))).toEqual([
      fixture.rowIds[3],
      fixture.rowIds[4],
      fixture.rowIds[5],
    ]);
    expect(applyFilters(makeFilters([onOrBeforeFilter]))).toEqual([
      fixture.rowIds[0],
      fixture.rowIds[1],
      fixture.rowIds[2],
      fixture.rowIds[4],
    ]);
    expect(applyFilters(makeFilters([betweenFilter]))).toEqual([
      fixture.rowIds[0],
      fixture.rowIds[1],
      fixture.rowIds[2],
      fixture.rowIds[3],
      fixture.rowIds[4],
    ]);
  });

  it('filters select option conditions', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.multiSelect,
            FieldType.MultiSelect,
            SelectOptionFilterCondition.OptionIsEmpty,
            ''
          ),
        ])
      )
    ).toEqual([fixture.rowIds[3], fixture.rowIds[6]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.multiSelect,
            FieldType.MultiSelect,
            SelectOptionFilterCondition.OptionIsNotEmpty,
            ''
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0], fixture.rowIds[1], fixture.rowIds[2], fixture.rowIds[4], fixture.rowIds[5]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.singleSelect,
            FieldType.SingleSelect,
            SelectOptionFilterCondition.OptionIsEmpty,
            ''
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0], fixture.rowIds[1], fixture.rowIds[6]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.singleSelect,
            FieldType.SingleSelect,
            SelectOptionFilterCondition.OptionIs,
            fixture.singleSelectOptions[0].id
          ),
        ])
      )
    ).toEqual([fixture.rowIds[2], fixture.rowIds[3]]);

    const containsFilter = makeDataFilter(
      fixture.fieldIds.multiSelect,
      FieldType.MultiSelect,
      SelectOptionFilterCondition.OptionContains,
      `${fixture.multiSelectOptions[0].id},${fixture.multiSelectOptions[1].id}`
    );
    expect(applyFilters(makeFilters([containsFilter]))).toEqual([
      fixture.rowIds[0],
      fixture.rowIds[1],
      fixture.rowIds[2],
      fixture.rowIds[4],
      fixture.rowIds[5],
    ]);

    const containsFilter2 = makeDataFilter(
      fixture.fieldIds.multiSelect,
      FieldType.MultiSelect,
      SelectOptionFilterCondition.OptionContains,
      fixture.multiSelectOptions[1].id
    );
    expect(applyFilters(makeFilters([containsFilter2]))).toEqual([
      fixture.rowIds[0],
      fixture.rowIds[2],
      fixture.rowIds[4],
      fixture.rowIds[5],
    ]);
  });

  it('updates single select cell under filter', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const filter = makeDataFilter(
      fixture.fieldIds.singleSelect,
      FieldType.SingleSelect,
      SelectOptionFilterCondition.OptionIs,
      fixture.singleSelectOptions[0].id
    );
    const filters = makeFilters([filter]);

    expect(applyFilters(filters)).toEqual([fixture.rowIds[2], fixture.rowIds[3]]);

    setCellData(
      fixture.rowIds[1],
      fixture.fieldIds.singleSelect,
      FieldType.SingleSelect,
      fixture.singleSelectOptions[0].id
    );
    expect(applyFilters(filters)).toEqual([fixture.rowIds[1], fixture.rowIds[2], fixture.rowIds[3]]);

    setCellData(fixture.rowIds[1], fixture.fieldIds.singleSelect, FieldType.SingleSelect, '');
    expect(applyFilters(filters)).toEqual([fixture.rowIds[2], fixture.rowIds[3]]);
  });

  it('filters relation conditions', () => {
    setRelationCellRowIds(
      fixture.rowMetas[fixture.rowIds[0]],
      fixture.fieldIds.relation,
      [fixture.rowIds[1]]
    );
    const row0RelationCell = (
      fixture.rowMetas[fixture.rowIds[0]]
        .getMap(YjsEditorKey.data_section)
        .get(YjsEditorKey.database_row) as YDatabaseRow
    )
      .get(YjsDatabaseKey.cells)
      ?.get(fixture.fieldIds.relation)
      ?.get(YjsDatabaseKey.data);
    expect(row0RelationCell && 'toJSON' in row0RelationCell ? row0RelationCell.toJSON() : row0RelationCell).toEqual([
      fixture.rowIds[1],
    ]);

    const { makeDataFilter, makeFilters } = buildFilterHarness();
    const emptyContent = JSON.stringify([]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.relation,
            FieldType.Relation,
            RelationFilterCondition.RelationIsNotEmpty,
            emptyContent
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.relation,
            FieldType.Relation,
            RelationFilterCondition.RelationIsEmpty,
            emptyContent
          ),
        ])
      )
    ).toEqual([
      fixture.rowIds[1],
      fixture.rowIds[2],
      fixture.rowIds[3],
      fixture.rowIds[4],
      fixture.rowIds[5],
      fixture.rowIds[6],
    ]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.relation,
            FieldType.Relation,
            RelationFilterCondition.RelationContains,
            JSON.stringify([fixture.rowIds[1]])
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.relation,
            FieldType.Relation,
            RelationFilterCondition.RelationDoesNotContain,
            JSON.stringify([fixture.rowIds[1]])
          ),
        ])
      )
    ).toEqual([
      fixture.rowIds[1],
      fixture.rowIds[2],
      fixture.rowIds[3],
      fixture.rowIds[4],
      fixture.rowIds[5],
      fixture.rowIds[6],
    ]);
  });

  it('filters time conditions', () => {
    const { makeDataFilter, makeFilters } = buildFilterHarness();

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.time,
            FieldType.Time,
            NumberFilterCondition.Equal,
            '75'
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.time,
            FieldType.Time,
            NumberFilterCondition.LessThan,
            '80'
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.time,
            FieldType.Time,
            NumberFilterCondition.LessThanOrEqualTo,
            '75'
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0]]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.time,
            FieldType.Time,
            NumberFilterCondition.NumberIsEmpty,
            ''
          ),
        ])
      )
    ).toEqual([
      fixture.rowIds[1],
      fixture.rowIds[2],
      fixture.rowIds[3],
      fixture.rowIds[4],
      fixture.rowIds[5],
      fixture.rowIds[6],
    ]);

    expect(
      applyFilters(
        makeFilters([
          makeDataFilter(
            fixture.fieldIds.time,
            FieldType.Time,
            NumberFilterCondition.NumberIsNotEmpty,
            ''
          ),
        ])
      )
    ).toEqual([fixture.rowIds[0]]);
  });

  it('applies nested AND/OR filters', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildFilterHarness();
    const checkboxFilter = makeDataFilter(
      fixture.fieldIds.checkbox,
      FieldType.Checkbox,
      CheckboxFilterCondition.IsChecked,
      ''
    );
    const dateFilter = makeDataFilter(
      fixture.fieldIds.date,
      FieldType.DateTime,
      DateFilterCondition.DateStartsAfter,
      JSON.stringify({ timestamp: 1651366800 })
    );
    const numberFilter = makeDataFilter(
      fixture.fieldIds.number,
      FieldType.Number,
      NumberFilterCondition.NumberIsNotEmpty,
      ''
    );

    const andGroup = makeGroupFilter(FilterType.And, [dateFilter, numberFilter]);
    const orGroup = makeGroupFilter(FilterType.Or, [checkboxFilter, andGroup]);

    const result = applyFilters(makeFilters([orGroup]));
    expect(result).toEqual([fixture.rowIds[0], fixture.rowIds[1], fixture.rowIds[3], fixture.rowIds[5]]);
  });

  it('applies nested filters with mixed group order', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildFilterHarness();
    const checkboxFilter = makeDataFilter(
      fixture.fieldIds.checkbox,
      FieldType.Checkbox,
      CheckboxFilterCondition.IsChecked,
      ''
    );
    const dateFilter = makeDataFilter(
      fixture.fieldIds.date,
      FieldType.DateTime,
      DateFilterCondition.DateStartsAfter,
      JSON.stringify({ timestamp: 1651366800 })
    );
    const numberFilter = makeDataFilter(
      fixture.fieldIds.number,
      FieldType.Number,
      NumberFilterCondition.NumberIsNotEmpty,
      ''
    );

    const andGroup = makeGroupFilter(FilterType.And, [dateFilter, numberFilter]);
    const orGroup = makeGroupFilter(FilterType.Or, [andGroup, checkboxFilter]);

    const result = applyFilters(makeFilters([orGroup]));
    expect(result).toEqual([fixture.rowIds[0], fixture.rowIds[1], fixture.rowIds[3], fixture.rowIds[5]]);
  });
});

describe('desktop sync filter parsing (plain objects)', () => {
  /**
   * When filters are synced from desktop to web, the children array inside
   * And/Or root filters may contain plain JavaScript objects instead of Yjs Maps.
   * This happens because Yjs converts nested data to plain objects during sync.
   *
   * The web selectors need to handle both:
   * - Yjs Maps (with .get() method) - created by web
   * - Plain objects (direct property access) - synced from desktop
   *
   * These tests verify that parseFilter works correctly when given a proxy wrapper
   * that provides a .get() method for plain object property access.
   */

  const { parseFilter } = require('@/application/database-yjs/filter');

  /**
   * Creates a proxy wrapper for a plain object that provides a .get() method,
   * simulating how the selector handles desktop-synced filter data.
   */
  function wrapPlainObjectAsFilter(plainObject: Record<string, unknown>) {
    return {
      get: (key: string) => plainObject[key],
    };
  }

  it('parses text filter from plain object (desktop sync scenario)', () => {
    // Simulate filter data as it arrives from desktop sync
    const plainFilterData = {
      id: 'filter-desktop-1',
      field_id: 'text-field',
      filter_type: FilterType.Data,
      condition: TextFilterCondition.TextContains,
      content: 'test',
      ty: FieldType.RichText, // Desktop stores field type in 'ty' key
    };

    const filterProxy = wrapPlainObjectAsFilter(plainFilterData);
    const parsed = parseFilter(FieldType.RichText, filterProxy);

    expect(parsed.id).toBe('filter-desktop-1');
    expect(parsed.fieldId).toBe('text-field');
    expect(parsed.filterType).toBe(FilterType.Data);
    expect(parsed.condition).toBe(TextFilterCondition.TextContains);
    expect(parsed.content).toBe('test');
  });

  it('parses number filter from plain object (desktop sync scenario)', () => {
    const plainFilterData = {
      id: 'filter-desktop-2',
      field_id: 'number-field',
      filter_type: FilterType.Data,
      condition: NumberFilterCondition.GreaterThan,
      content: '100',
      ty: FieldType.Number,
    };

    const filterProxy = wrapPlainObjectAsFilter(plainFilterData);
    const parsed = parseFilter(FieldType.Number, filterProxy);

    expect(parsed.id).toBe('filter-desktop-2');
    expect(parsed.fieldId).toBe('number-field');
    expect(parsed.condition).toBe(NumberFilterCondition.GreaterThan);
    expect(parsed.content).toBe('100');
  });

  it('parses checkbox filter from plain object (desktop sync scenario)', () => {
    const plainFilterData = {
      id: 'filter-desktop-3',
      field_id: 'checkbox-field',
      filter_type: FilterType.Data,
      condition: CheckboxFilterCondition.IsChecked,
      content: '',
      ty: FieldType.Checkbox,
    };

    const filterProxy = wrapPlainObjectAsFilter(plainFilterData);
    const parsed = parseFilter(FieldType.Checkbox, filterProxy);

    expect(parsed.id).toBe('filter-desktop-3');
    expect(parsed.fieldId).toBe('checkbox-field');
    expect(parsed.condition).toBe(CheckboxFilterCondition.IsChecked);
  });

  it('parses select option filter from plain object (desktop sync scenario)', () => {
    const plainFilterData = {
      id: 'filter-desktop-4',
      field_id: 'select-field',
      filter_type: FilterType.Data,
      condition: SelectOptionFilterCondition.OptionIs,
      content: 'opt-1,opt-2',
      ty: FieldType.SingleSelect,
    };

    const filterProxy = wrapPlainObjectAsFilter(plainFilterData);
    const parsed = parseFilter(FieldType.SingleSelect, filterProxy);

    expect(parsed.id).toBe('filter-desktop-4');
    expect(parsed.fieldId).toBe('select-field');
    expect(parsed.condition).toBe(SelectOptionFilterCondition.OptionIs);
    expect(parsed.optionIds).toEqual(['opt-1', 'opt-2']);
  });

  it('parses date filter from plain object (desktop sync scenario)', () => {
    const timestamp = dayjs('2024-01-15').startOf('day').unix();
    const plainFilterData = {
      id: 'filter-desktop-5',
      field_id: 'date-field',
      filter_type: FilterType.Data,
      condition: DateFilterCondition.DateStartsOn,
      content: JSON.stringify({ timestamp }),
      ty: FieldType.DateTime,
    };

    const filterProxy = wrapPlainObjectAsFilter(plainFilterData);
    const parsed = parseFilter(FieldType.DateTime, filterProxy);

    expect(parsed.id).toBe('filter-desktop-5');
    expect(parsed.fieldId).toBe('date-field');
    expect(parsed.condition).toBe(DateFilterCondition.DateStartsOn);
    expect(parsed.timestamp).toBe(timestamp);
  });

  it('parses date range filter from plain object (desktop sync scenario)', () => {
    const start = dayjs('2024-01-01').startOf('day').unix();
    const end = dayjs('2024-01-31').startOf('day').unix();
    const plainFilterData = {
      id: 'filter-desktop-6',
      field_id: 'date-field',
      filter_type: FilterType.Data,
      condition: DateFilterCondition.DateStartsBetween,
      content: JSON.stringify({ start, end }),
      ty: FieldType.DateTime,
    };

    const filterProxy = wrapPlainObjectAsFilter(plainFilterData);
    const parsed = parseFilter(FieldType.DateTime, filterProxy);

    expect(parsed.id).toBe('filter-desktop-6');
    expect(parsed.condition).toBe(DateFilterCondition.DateStartsBetween);
    expect(parsed.start).toBe(start);
    expect(parsed.end).toBe(end);
  });

  it('handles filter with BigInt values from desktop (converted to number)', () => {
    // Desktop may store values as BigInt, but when synced they become numbers
    // or need to be converted via Number()
    const plainFilterData = {
      id: 'filter-desktop-7',
      field_id: 'text-field',
      filter_type: BigInt(2), // FilterType.Data as BigInt
      condition: BigInt(2), // TextFilterCondition.TextContains as BigInt
      content: 'search',
      ty: BigInt(0), // FieldType.RichText as BigInt
    };

    const filterProxy = wrapPlainObjectAsFilter(plainFilterData);
    const parsed = parseFilter(FieldType.RichText, filterProxy);

    // parseFilter uses Number() to convert, so BigInt should work
    expect(parsed.filterType).toBe(2);
    expect(parsed.condition).toBe(2);
  });

  it('handles empty content in desktop-synced filter', () => {
    const plainFilterData = {
      id: 'filter-desktop-8',
      field_id: 'text-field',
      filter_type: FilterType.Data,
      condition: TextFilterCondition.TextIsEmpty,
      content: '',
      ty: FieldType.RichText,
    };

    const filterProxy = wrapPlainObjectAsFilter(plainFilterData);
    const parsed = parseFilter(FieldType.RichText, filterProxy);

    expect(parsed.id).toBe('filter-desktop-8');
    expect(parsed.condition).toBe(TextFilterCondition.TextIsEmpty);
    expect(parsed.content).toBe('');
  });

  it('simulates full desktop sync scenario with hierarchical filter structure', () => {
    // This simulates the exact structure that arrives from desktop:
    // - Root filter is an And/Or group (stored as Yjs Map)
    // - Children are stored as plain objects (after Yjs array sync)

    const doc = new Y.Doc();
    const rootFilter = doc.getMap('root') as YDatabaseFilter;

    // Set up root as AND filter
    rootFilter.set(YjsDatabaseKey.id, 'root-and');
    rootFilter.set(YjsDatabaseKey.filter_type, FilterType.And);

    // Create children array with plain objects (simulating desktop sync)
    const childrenArray = new Y.Array();

    // When Yjs syncs from desktop, nested maps become plain objects
    // We simulate this by pushing plain objects to the array
    const plainChild1 = {
      id: 'child-1',
      field_id: 'text-field',
      filter_type: FilterType.Data,
      condition: TextFilterCondition.TextContains,
      content: 'alpha',
      ty: FieldType.RichText,
    };

    const plainChild2 = {
      id: 'child-2',
      field_id: 'number-field',
      filter_type: FilterType.Data,
      condition: NumberFilterCondition.GreaterThan,
      content: '10',
      ty: FieldType.Number,
    };

    // Note: In real Yjs sync, push would accept Yjs types, but after sync
    // from desktop, accessing via .get(index) returns plain objects
    childrenArray.push([plainChild1, plainChild2]);
    rootFilter.set(YjsDatabaseKey.children, childrenArray);

    // Verify the structure
    const children = rootFilter.get(YjsDatabaseKey.children) as Y.Array<unknown>;
    expect(children.length).toBe(2);

    // Access children like the selector does
    const child0 = children.get(0);
    const child1 = children.get(1);

    // Verify children are plain objects (no .get method)
    expect(typeof (child0 as { get?: unknown }).get).toBe('undefined');
    expect(typeof (child1 as { get?: unknown }).get).toBe('undefined');

    // Parse using proxy wrapper (as the selector does)
    const proxy0 = wrapPlainObjectAsFilter(child0 as Record<string, unknown>);
    const proxy1 = wrapPlainObjectAsFilter(child1 as Record<string, unknown>);

    const parsed0 = parseFilter(FieldType.RichText, proxy0);
    const parsed1 = parseFilter(FieldType.Number, proxy1);

    expect(parsed0.id).toBe('child-1');
    expect(parsed0.fieldId).toBe('text-field');
    expect(parsed0.condition).toBe(TextFilterCondition.TextContains);

    expect(parsed1.id).toBe('child-2');
    expect(parsed1.fieldId).toBe('number-field');
    expect(parsed1.condition).toBe(NumberFilterCondition.GreaterThan);
  });
});

describe('desktop sync filter operations (delete/update with plain objects)', () => {
  /**
   * Tests for operations on filters that contain plain objects from desktop sync.
   * The useRemoveAdvancedFilter and useUpdateAdvancedFilter hooks need to handle
   * finding filters by ID when the children array contains plain objects instead
   * of Yjs Maps.
   */

  /**
   * Helper function to check if an item is a Yjs Map (has .get method)
   * and get the ID appropriately - mimics the fix in sort-filter.ts
   */
  function getFilterId(item: unknown): string | undefined {
    const isYjsMap = typeof (item as { get?: unknown }).get === 'function';
    if (isYjsMap) {
      return (item as { get: (key: string) => unknown }).get(YjsDatabaseKey.id) as string;
    }
    return (item as Record<string, unknown>)[YjsDatabaseKey.id] as string;
  }

  it('finds filter by ID when children are plain objects (desktop sync scenario)', () => {
    const doc = new Y.Doc();
    const rootFilter = doc.getMap('root') as YDatabaseFilter;

    rootFilter.set(YjsDatabaseKey.id, 'root-and');
    rootFilter.set(YjsDatabaseKey.filter_type, FilterType.And);

    const childrenArray = new Y.Array();

    // Push plain objects (simulating desktop sync)
    const plainChild1 = {
      [YjsDatabaseKey.id]: 'filter-1',
      [YjsDatabaseKey.field_id]: 'text-field',
      [YjsDatabaseKey.filter_type]: FilterType.Data,
      [YjsDatabaseKey.condition]: TextFilterCondition.TextContains,
      [YjsDatabaseKey.content]: 'test',
    };

    const plainChild2 = {
      [YjsDatabaseKey.id]: 'filter-2',
      [YjsDatabaseKey.field_id]: 'number-field',
      [YjsDatabaseKey.filter_type]: FilterType.Data,
      [YjsDatabaseKey.condition]: NumberFilterCondition.Equal,
      [YjsDatabaseKey.content]: '42',
    };

    childrenArray.push([plainChild1, plainChild2]);
    rootFilter.set(YjsDatabaseKey.children, childrenArray);

    const children = rootFilter.get(YjsDatabaseKey.children) as Y.Array<unknown>;

    // Find filter by ID using the helper (mimics the fix)
    const targetId = 'filter-2';
    let foundIndex = -1;
    for (let i = 0; i < children.length; i++) {
      const id = getFilterId(children.get(i));
      if (id === targetId) {
        foundIndex = i;
        break;
      }
    }

    expect(foundIndex).toBe(1);
  });

  it('finds filter by ID when using findIndex with plain objects', () => {
    const doc = new Y.Doc();
    const childrenArray = doc.getArray('children');

    // Push plain objects
    childrenArray.push([
      { [YjsDatabaseKey.id]: 'filter-a', [YjsDatabaseKey.field_id]: 'field-1' },
      { [YjsDatabaseKey.id]: 'filter-b', [YjsDatabaseKey.field_id]: 'field-2' },
      { [YjsDatabaseKey.id]: 'filter-c', [YjsDatabaseKey.field_id]: 'field-3' },
    ]);

    // Use findIndex with the fix pattern
    const targetId = 'filter-b';
    const index = childrenArray.toArray().findIndex((f) => {
      const isYjsMap = typeof (f as { get?: unknown }).get === 'function';
      const id = isYjsMap
        ? (f as { get: (key: string) => unknown }).get(YjsDatabaseKey.id)
        : (f as Record<string, unknown>)[YjsDatabaseKey.id];
      return id === targetId;
    });

    expect(index).toBe(1);
  });

  it('returns -1 when filter ID not found in plain objects', () => {
    const doc = new Y.Doc();
    const childrenArray = doc.getArray('children');

    childrenArray.push([
      { [YjsDatabaseKey.id]: 'filter-1' },
      { [YjsDatabaseKey.id]: 'filter-2' },
    ]);

    const targetId = 'non-existent';
    const index = childrenArray.toArray().findIndex((f) => {
      const isYjsMap = typeof (f as { get?: unknown }).get === 'function';
      const id = isYjsMap
        ? (f as { get: (key: string) => unknown }).get(YjsDatabaseKey.id)
        : (f as Record<string, unknown>)[YjsDatabaseKey.id];
      return id === targetId;
    });

    expect(index).toBe(-1);
  });

  it('handles detection of Yjs Map vs plain object', () => {
    // Test the detection logic used in the fix
    const plainObject = { [YjsDatabaseKey.id]: 'plain-filter' };

    const doc = new Y.Doc();
    const yjsMap = doc.getMap('filter');
    yjsMap.set(YjsDatabaseKey.id, 'yjs-filter');

    // Plain object should not have .get method
    const plainIsYjs = typeof (plainObject as { get?: unknown }).get === 'function';
    expect(plainIsYjs).toBe(false);

    // Yjs Map should have .get method
    const yjsIsYjs = typeof (yjsMap as { get?: unknown }).get === 'function';
    expect(yjsIsYjs).toBe(true);

    // Both should be able to retrieve the ID correctly
    const getFilterId = (item: unknown): string | undefined => {
      const isYjsMap = typeof (item as { get?: unknown }).get === 'function';
      if (isYjsMap) {
        return (item as { get: (key: string) => unknown }).get(YjsDatabaseKey.id) as string;
      }
      return (item as Record<string, unknown>)[YjsDatabaseKey.id] as string;
    };

    expect(getFilterId(plainObject)).toBe('plain-filter');
    expect(getFilterId(yjsMap)).toBe('yjs-filter');
  });

  it('can delete filter from children array with plain objects', () => {
    const doc = new Y.Doc();
    const childrenArray = doc.getArray('children');

    childrenArray.push([
      { [YjsDatabaseKey.id]: 'filter-to-keep' },
      { [YjsDatabaseKey.id]: 'filter-to-delete' },
      { [YjsDatabaseKey.id]: 'another-to-keep' },
    ]);

    expect(childrenArray.length).toBe(3);

    // Find and delete
    const targetId = 'filter-to-delete';
    const index = childrenArray.toArray().findIndex((f) => {
      const isYjsMap = typeof (f as { get?: unknown }).get === 'function';
      const id = isYjsMap
        ? (f as { get: (key: string) => unknown }).get(YjsDatabaseKey.id)
        : (f as Record<string, unknown>)[YjsDatabaseKey.id];
      return id === targetId;
    });

    expect(index).toBe(1);

    childrenArray.delete(index);

    expect(childrenArray.length).toBe(2);

    // Verify remaining filters
    const remaining = childrenArray.toArray().map((f) => {
      return (f as Record<string, unknown>)[YjsDatabaseKey.id];
    });
    expect(remaining).toEqual(['filter-to-keep', 'another-to-keep']);
  });
});

// ============================================================
// v070 advanced filter tests (matches desktop Rust tests)
// ============================================================

describe('v070 advanced filter tests', () => {
  let fixture: ReturnType<typeof loadV070DatabaseFixture>;

  beforeEach(() => {
    fixture = loadV070DatabaseFixture();
  });

  // Helper to build Yjs filter structures
  function buildHarness() {
    const doc = new Y.Doc();
    let counter = 0;

    const makeDataFilter = (
      fieldName: string,
      fieldType: FieldType,
      condition: number,
      content: string = ''
    ) => {
      const fieldId = fixture.fieldIdByName.get(fieldName);
      if (!fieldId) throw new Error(`Field "${fieldName}" not found`);
      const f = new Y.Map() as YDatabaseFilter;
      f.set(YjsDatabaseKey.id, `f-${counter}`);
      f.set(YjsDatabaseKey.field_id, fieldId);
      f.set(YjsDatabaseKey.type, fieldType);
      f.set(YjsDatabaseKey.filter_type, FilterType.Data);
      f.set(YjsDatabaseKey.condition, condition);
      f.set(YjsDatabaseKey.content, content);
      counter += 1;
      return f;
    };

    const makeGroupFilter = (type: FilterType.And | FilterType.Or, children: YDatabaseFilter[]) => {
      const f = new Y.Map() as YDatabaseFilter;
      f.set(YjsDatabaseKey.id, `f-${counter}`);
      f.set(YjsDatabaseKey.filter_type, type);
      const childArray = new Y.Array() as YDatabaseFilters;
      childArray.push(children);
      f.set(YjsDatabaseKey.children, childArray);
      counter += 1;
      return f;
    };

    const makeFilters = (nodes: YDatabaseFilter[]) => {
      const filters = new Y.Array() as YDatabaseFilters;
      doc.getMap('root').set('filters', filters);
      filters.push(nodes);
      return filters;
    };

    return { makeDataFilter, makeGroupFilter, makeFilters };
  }

  function getOptionId(fieldName: string, optionName: string): string {
    const fieldId = fixture.fieldIdByName.get(fieldName);
    if (!fieldId) throw new Error(`Field "${fieldName}" not found`);
    const field = fixture.fields.get(fieldId);
    const typeOption = field?.get(YjsDatabaseKey.type_option);
    const fieldType = Number(field?.get(YjsDatabaseKey.type));
    const option = typeOption?.get(String(fieldType));
    const content = option?.get(YjsDatabaseKey.content);
    if (typeof content !== 'string') throw new Error(`No type option content for "${fieldName}"`);
    const parsed = JSON.parse(content) as { options: Array<{ id: string; name: string }> };
    const opt = parsed.options.find((o) => o.name === optionName);
    if (!opt) throw new Error(`Option "${optionName}" not found in "${fieldName}"`);
    return opt.id;
  }

  function applyFilters(filters: YDatabaseFilters) {
    return filterBy(fixture.rows, filters, fixture.fields, fixture.rowMetas).map((r) => r.id);
  }

  // Resolve Name|Website composite key for a row
  function getRowKey(rowId: string): string {
    const rowDoc = fixture.rowMetas[rowId];
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cells = row.get(YjsDatabaseKey.cells);
    const nameFieldId = fixture.fieldIdByName.get('Name') ?? '';
    const webFieldId = fixture.fieldIdByName.get('Website') ?? '';
    const name = cells.get(nameFieldId)?.get(YjsDatabaseKey.data) ?? '';
    const web = cells.get(webFieldId)?.get(YjsDatabaseKey.data) ?? '';
    return `${name}|${web}`;
  }

  function assertVisibleRows(result: string[], expectedKeys: string[], message: string) {
    const actualKeys = result.map((id) => getRowKey(id)).sort();
    const expected = [...expectedKeys].sort();
    expect(actualKeys).toEqual(expected);
  }

  // Case 1: AND(Name Contains "Ali", Status Is Active) => 1
  it('case 1: AND(Name Contains Ali, Status Is Active)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const activeId = getOptionId('Status', 'Active');

    const andGroup = makeGroupFilter(FilterType.And, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, activeId),
    ]);

    const result = applyFilters(makeFilters([andGroup]));
    assertVisibleRows(result, ['Alice|https://alice.com'], 'Case 1');
  });

  // Case 1b: OR(Name Contains "Ali", Status Is Inactive) => 5
  it('case 1b: OR(Name Contains Ali, Status Is Inactive)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const inactiveId = getOptionId('Status', 'Inactive');

    const orGroup = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, inactiveId),
    ]);

    const result = applyFilters(makeFilters([orGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      'Alice Wang|https://awang.io',
      'Frank|https://frank.net',
      'Alice|https://alice2.com',
      'Jane|',
    ], 'Case 1b');
  });

  // Case 2: OR(Name Contains "Ali", AND(Notes Is "Team lead", Status Is Pending)) => 3
  it('case 2: OR(Name Contains Ali, AND(Notes Is Team lead, Status Is Pending))', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const pendingId = getOptionId('Status', 'Pending');

    const andChild = makeGroupFilter(FilterType.And, [
      makeDataFilter('Notes', FieldType.RichText, TextFilterCondition.TextIs, 'Team lead'),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, pendingId),
    ]);

    const orGroup = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
      andChild,
    ]);

    const result = applyFilters(makeFilters([orGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      'Alice Wang|https://awang.io',
      'Alice|https://alice2.com',
    ], 'Case 2');
  });

  // Case 3: AND(Age > 30, Active IsChecked, Status Is Active) => 3
  it('case 3: AND(Age > 30, Active IsChecked, Status Is Active)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const activeId = getOptionId('Status', 'Active');

    const andGroup = makeGroupFilter(FilterType.And, [
      makeDataFilter('Age', FieldType.Number, NumberFilterCondition.GreaterThan, '30'),
      makeDataFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsChecked),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, activeId),
    ]);

    const result = applyFilters(makeFilters([andGroup]));
    assertVisibleRows(result, [
      'Dave|https://dave.org',
      '|https://unknown.com',
      'Karl|https://karl.de',
    ], 'Case 3');
  });

  // Case 4: OR(Name Is "Bob", Age Equal 50, Status Is Inactive) => 4
  it('case 4: OR(Name Is Bob, Age Equal 50, Status Is Inactive)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const inactiveId = getOptionId('Status', 'Inactive');

    const orGroup = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextIs, 'Bob'),
      makeDataFilter('Age', FieldType.Number, NumberFilterCondition.Equal, '50'),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, inactiveId),
    ]);

    const result = applyFilters(makeFilters([orGroup]));
    assertVisibleRows(result, [
      'Bob|https://bob.dev',
      'Alice Wang|https://awang.io',
      'Frank|https://frank.net',
      'Jane|',
    ], 'Case 4');
  });

  // Case 5: OR(Active IsChecked, AND(Age > 25, Status Is Pending)) => 10
  it('case 5: OR(Active IsChecked, AND(Age > 25, Status Is Pending))', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const pendingId = getOptionId('Status', 'Pending');

    const andChild = makeGroupFilter(FilterType.And, [
      makeDataFilter('Age', FieldType.Number, NumberFilterCondition.GreaterThan, '25'),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, pendingId),
    ]);

    const orGroup = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsChecked),
      andChild,
    ]);

    const result = applyFilters(makeFilters([orGroup]));
    expect(result.length).toBe(10);
  });

  // Case 6: AND(OR(Name Contains "Ali", Name Contains "Eve"), Status IsNotEmpty) => 4
  it('case 6: AND(OR(Name Contains Ali, Name Contains Eve), Status IsNotEmpty)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();

    const orChild = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Eve'),
    ]);

    const andGroup = makeGroupFilter(FilterType.And, [
      orChild,
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIsNotEmpty),
    ]);

    const result = applyFilters(makeFilters([andGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      'Alice Wang|https://awang.io',
      'Eve|',
      'Alice|https://alice2.com',
    ], 'Case 6');
  });

  // Case 7: AND(Name EndsWith "e", Categories Contains Work) => 3
  it('case 7: AND(Name EndsWith e, Categories Contains Work)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const workId = getOptionId('Categories', 'Work');

    const andGroup = makeGroupFilter(FilterType.And, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextEndsWith, 'e'),
      makeDataFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionContains, workId),
    ]);

    const result = applyFilters(makeFilters([andGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      'Dave|https://dave.org',
      'Alice|https://alice2.com',
    ], 'Case 7');
  });

  // Case 8: OR(Age < 30, Active IsUnChecked) => 10
  it('case 8: OR(Age < 30, Active IsUnChecked)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();

    const orGroup = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Age', FieldType.Number, NumberFilterCondition.LessThan, '30'),
      makeDataFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsUnChecked),
    ]);

    const result = applyFilters(makeFilters([orGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      'Charlie|',
      '|',
      'Eve|',
      'Grace|https://grace.ai',
      'Hank|',
      'Alice|https://alice2.com',
      'Ivan|https://ivan.ru',
      'Jane|',
      'Lily|',
    ], 'Case 8');
  });

  // Case 10: AND(Tasks IsComplete, Active IsChecked, Status Is Active) => 3
  it('case 10: AND(Tasks IsComplete, Active IsChecked, Status Is Active)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const activeId = getOptionId('Status', 'Active');

    const andGroup = makeGroupFilter(FilterType.And, [
      makeDataFilter('Tasks', FieldType.Checklist, ChecklistFilterCondition.IsComplete),
      makeDataFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsChecked),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, activeId),
    ]);

    const result = applyFilters(makeFilters([andGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      '|https://unknown.com',
      'Karl|https://karl.de',
    ], 'Case 10');
  });

  // Case 12: AND(Categories Contains Health, Tasks IsIncomplete) => 2
  it('case 12: AND(Categories Contains Health, Tasks IsIncomplete)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const healthId = getOptionId('Categories', 'Health');

    const andGroup = makeGroupFilter(FilterType.And, [
      makeDataFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionContains, healthId),
      makeDataFilter('Tasks', FieldType.Checklist, ChecklistFilterCondition.IsIncomplete),
    ]);

    const result = applyFilters(makeFilters([andGroup]));
    assertVisibleRows(result, [
      'Charlie|',
      'Ivan|https://ivan.ru',
    ], 'Case 12');
  });

  // Case 15: OR(AND(Name Contains "Ali", Status Active), AND(Score < 0, Active IsChecked)) => 2
  it('case 15: OR(AND(Name Contains Ali, Status Active), AND(Score < 0, Active IsChecked))', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const activeId = getOptionId('Status', 'Active');

    const and1 = makeGroupFilter(FilterType.And, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, activeId),
    ]);

    const and2 = makeGroupFilter(FilterType.And, [
      makeDataFilter('Score', FieldType.Number, NumberFilterCondition.LessThan, '0'),
      makeDataFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsChecked),
    ]);

    const orGroup = makeGroupFilter(FilterType.Or, [and1, and2]);

    const result = applyFilters(makeFilters([orGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      'Alice Wang|https://awang.io',
    ], 'Case 15');
  });

  // Case 17: AND(Name Contains "Ali", Website Contains "alice") => 2
  it('case 17: AND(Name Contains Ali, Website Contains alice)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();

    const andGroup = makeGroupFilter(FilterType.And, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
      makeDataFilter('Website', FieldType.URL, TextFilterCondition.TextContains, 'alice'),
    ]);

    const result = applyFilters(makeFilters([andGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      'Alice|https://alice2.com',
    ], 'Case 17');
  });

  // Case 18: OR(Name IsEmpty, Age NumberIsEmpty, Status OptionIsEmpty) => 3
  it('case 18: OR(Name IsEmpty, Age NumberIsEmpty, Status OptionIsEmpty)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();

    const orGroup = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextIsEmpty),
      makeDataFilter('Age', FieldType.Number, NumberFilterCondition.NumberIsEmpty),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIsEmpty),
    ]);

    const result = applyFilters(makeFilters([orGroup]));
    assertVisibleRows(result, [
      '|',
      '|https://unknown.com',
      'Hank|',
    ], 'Case 18');
  });

  // Case 19: Left-nested And(Or(Active, Name "Ali"), Status Pending) => 1
  it('case 19: left-nested And(Or(Active, Name Ali), Status Pending)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const pendingId = getOptionId('Status', 'Pending');

    const orChild = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsChecked),
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
    ]);

    const andGroup = makeGroupFilter(FilterType.And, [
      orChild,
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, pendingId),
    ]);

    const result = applyFilters(makeFilters([andGroup]));
    assertVisibleRows(result, ['Alice|https://alice2.com'], 'Case 19');
  });

  // Case 20: Right-nested Or(Active, And(Name "Ali", Status Pending)) => 9
  it('case 20: right-nested Or(Active, And(Name Ali, Status Pending))', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();
    const pendingId = getOptionId('Status', 'Pending');

    const andChild = makeGroupFilter(FilterType.And, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
      makeDataFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, pendingId),
    ]);

    const orGroup = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsChecked),
      andChild,
    ]);

    const result = applyFilters(makeFilters([orGroup]));
    expect(result.length).toBe(9);
  });

  // Case 21: Left-nested Or(And(Name "Ali", Active), Age IsEmpty) => 5
  it('case 21: left-nested Or(And(Name Ali, Active), Age IsEmpty)', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();

    const andChild = makeGroupFilter(FilterType.And, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
      makeDataFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsChecked),
    ]);

    const orGroup = makeGroupFilter(FilterType.Or, [
      andChild,
      makeDataFilter('Age', FieldType.Number, NumberFilterCondition.NumberIsEmpty),
    ]);

    const result = applyFilters(makeFilters([orGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      'Alice Wang|https://awang.io',
      '|',
      'Hank|',
      'Alice|https://alice2.com',
    ], 'Case 21');
  });

  // Case 22: Right-nested And(Name "Ali", Or(Active, Age IsEmpty)) => 3
  it('case 22: right-nested And(Name Ali, Or(Active, Age IsEmpty))', () => {
    const { makeDataFilter, makeGroupFilter, makeFilters } = buildHarness();

    const orChild = makeGroupFilter(FilterType.Or, [
      makeDataFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsChecked),
      makeDataFilter('Age', FieldType.Number, NumberFilterCondition.NumberIsEmpty),
    ]);

    const andGroup = makeGroupFilter(FilterType.And, [
      makeDataFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'Ali'),
      orChild,
    ]);

    const result = applyFilters(makeFilters([andGroup]));
    assertVisibleRows(result, [
      'Alice|https://alice.com',
      'Alice Wang|https://awang.io',
      'Alice|https://alice2.com',
    ], 'Case 22');
  });
});

// ============================================================
// Bug fix regression tests
// ============================================================

describe('selectOptionFilter OptionIs vs OptionContains semantics', () => {
  const field = createField('sel', FieldType.MultiSelect, {
    options: [
      { id: 'A', name: 'A', color: 0 },
      { id: 'B', name: 'B', color: 0 },
      { id: 'C', name: 'C', color: 0 },
    ],
    disable_color: false,
  });

  it('OptionIs: all cell options must be within filter set', () => {
    // cell=[A], filter=[A,B] => true (A is within {A,B})
    expect(selectOptionFilterCheck(field, 'A', 'A,B', SelectOptionFilterCondition.OptionIs)).toBe(true);
    // cell=[A,B], filter=[A,B,C] => true (all within)
    expect(selectOptionFilterCheck(field, 'A,B', 'A,B,C', SelectOptionFilterCondition.OptionIs)).toBe(true);
    // cell=[A,C], filter=[A,B] => false (C not in {A,B})
    expect(selectOptionFilterCheck(field, 'A,C', 'A,B', SelectOptionFilterCondition.OptionIs)).toBe(false);
    // cell=empty, filter=[A] => false
    expect(selectOptionFilterCheck(field, '', 'A', SelectOptionFilterCondition.OptionIs)).toBe(false);
  });

  it('OptionIsNot: negation of OptionIs', () => {
    // cell=[A,C], filter=[A,B] => true (not all within)
    expect(selectOptionFilterCheck(field, 'A,C', 'A,B', SelectOptionFilterCondition.OptionIsNot)).toBe(true);
    // cell=[A], filter=[A,B] => false (all within, so IsNot = false)
    expect(selectOptionFilterCheck(field, 'A', 'A,B', SelectOptionFilterCondition.OptionIsNot)).toBe(false);
    // cell=empty, filter=[A] => true
    expect(selectOptionFilterCheck(field, '', 'A', SelectOptionFilterCondition.OptionIsNot)).toBe(true);
  });

  it('OptionContains: any filter option in cell', () => {
    // cell=[A,C], filter=[A,B] => true (A is in cell)
    expect(selectOptionFilterCheck(field, 'A,C', 'A,B', SelectOptionFilterCondition.OptionContains)).toBe(true);
    // cell=[C], filter=[A,B] => false (neither A nor B in cell)
    expect(selectOptionFilterCheck(field, 'C', 'A,B', SelectOptionFilterCondition.OptionContains)).toBe(false);
  });

  it('OptionDoesNotContain: none of filter options in cell', () => {
    // cell=[C], filter=[A,B] => true (neither in cell)
    expect(selectOptionFilterCheck(field, 'C', 'A,B', SelectOptionFilterCondition.OptionDoesNotContain)).toBe(true);
    // cell=[A,C], filter=[A,B] => false (A is in cell)
    expect(selectOptionFilterCheck(field, 'A,C', 'A,B', SelectOptionFilterCondition.OptionDoesNotContain)).toBe(false);
  });
});

describe('personFilter bug fixes', () => {
  it('PersonIsEmpty checks only cell data', () => {
    // Non-empty filter content should not matter; only cell data matters
    expect(personFilterCheck('[]', JSON.stringify(['u1']), PersonFilterCondition.PersonIsEmpty)).toBe(true);
    expect(personFilterCheck(JSON.stringify(['u1']), '[]', PersonFilterCondition.PersonIsEmpty)).toBe(false);
  });

  it('PersonIsNotEmpty checks only cell data', () => {
    expect(personFilterCheck(JSON.stringify(['u1']), '[]', PersonFilterCondition.PersonIsNotEmpty)).toBe(true);
    expect(personFilterCheck('[]', JSON.stringify(['u1']), PersonFilterCondition.PersonIsNotEmpty)).toBe(false);
  });

  it('PersonContains uses ALL semantics', () => {
    // ALL filter IDs must be present in cell
    expect(personFilterCheck(JSON.stringify(['u1', 'u2']), JSON.stringify(['u1', 'u2']), PersonFilterCondition.PersonContains)).toBe(true);
    // u2 not in cell
    expect(personFilterCheck(JSON.stringify(['u1']), JSON.stringify(['u1', 'u2']), PersonFilterCondition.PersonContains)).toBe(false);
    // all filter IDs present (cell has extra)
    expect(personFilterCheck(JSON.stringify(['u1', 'u2', 'u3']), JSON.stringify(['u1', 'u2']), PersonFilterCondition.PersonContains)).toBe(true);
  });
});

// ============================================================
// Tree utility tests (groupByConsecutiveOperator)
// ============================================================

import { groupByConsecutiveOperator, FilterDraft } from '@/application/database-yjs/filter';

describe('groupByConsecutiveOperator', () => {
  function draft(id: string, op: FilterType.And | FilterType.Or | null): FilterDraft {
    return { id, fieldId: 'f', fieldType: 0, condition: 0, content: '', operator: op };
  }

  it('groups all-AND drafts into single group', () => {
    const groups = groupByConsecutiveOperator([
      draft('A', null), draft('B', FilterType.And), draft('C', FilterType.And),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].operator).toBe(FilterType.And);
    expect(groups[0].drafts.map(d => d.id)).toEqual(['A', 'B', 'C']);
  });

  it('groups all-OR drafts into single group', () => {
    const groups = groupByConsecutiveOperator([
      draft('A', null), draft('B', FilterType.Or), draft('C', FilterType.Or),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].operator).toBe(FilterType.Or);
    expect(groups[0].drafts.map(d => d.id)).toEqual(['A', 'B', 'C']);
  });

  it('splits mixed operators into consecutive groups', () => {
    // [A(null), B(Or), C(And)] → [{Or: [A,B]}, {And: [C]}]
    const groups = groupByConsecutiveOperator([
      draft('A', null), draft('B', FilterType.Or), draft('C', FilterType.And),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].operator).toBe(FilterType.Or);
    expect(groups[0].drafts.map(d => d.id)).toEqual(['A', 'B']);
    expect(groups[1].operator).toBe(FilterType.And);
    expect(groups[1].drafts.map(d => d.id)).toEqual(['C']);
  });

  it('handles complex mixed operators', () => {
    // [A(null), B(Or), C(Or), D(And), E(And), F(Or)]
    const groups = groupByConsecutiveOperator([
      draft('A', null), draft('B', FilterType.Or), draft('C', FilterType.Or),
      draft('D', FilterType.And), draft('E', FilterType.And), draft('F', FilterType.Or),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0].drafts.map(d => d.id)).toEqual(['A', 'B', 'C']);
    expect(groups[0].operator).toBe(FilterType.Or);
    expect(groups[1].drafts.map(d => d.id)).toEqual(['D', 'E']);
    expect(groups[1].operator).toBe(FilterType.And);
    expect(groups[2].drafts.map(d => d.id)).toEqual(['F']);
    expect(groups[2].operator).toBe(FilterType.Or);
  });

  it('handles single draft', () => {
    const groups = groupByConsecutiveOperator([draft('A', null)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].drafts.map(d => d.id)).toEqual(['A']);
  });
});

// ============================================================
// v070 single-field filter tests (desktop parity)
// ============================================================

describe('v070 text/url filter tests', () => {
  let fixture: ReturnType<typeof loadV070DatabaseFixture>;

  beforeEach(() => {
    fixture = loadV070DatabaseFixture();
  });

  function applySingleFilter(
    fieldName: string,
    fieldType: FieldType,
    condition: number,
    content: string = ''
  ) {
    const fieldId = fixture.fieldIdByName.get(fieldName)!;
    const filters = createFilters([{ fieldId, fieldType, condition, content }]);
    return filterBy(fixture.rows, filters, fixture.fields, fixture.rowMetas).map((r) => r.id);
  }

  function getRowKey(rowId: string): string {
    const rowDoc = fixture.rowMetas[rowId];
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cells = row.get(YjsDatabaseKey.cells);
    const nameFieldId = fixture.fieldIdByName.get('Name')!;
    const webFieldId = fixture.fieldIdByName.get('Website')!;
    const name = cells.get(nameFieldId)?.get(YjsDatabaseKey.data) ?? '';
    const web = cells.get(webFieldId)?.get(YjsDatabaseKey.data) ?? '';
    return `${name}|${web}`;
  }

  function assertKeys(result: string[], expectedKeys: string[]) {
    const actual = result.map((id) => getRowKey(id)).sort();
    expect(actual).toEqual([...expectedKeys].sort());
  }

  // Name (RichText) field tests
  it('Name TextIs "Alice" => 2 rows', () => {
    const result = applySingleFilter('Name', FieldType.RichText, TextFilterCondition.TextIs, 'Alice');
    assertKeys(result, ['Alice|https://alice.com', 'Alice|https://alice2.com']);
  });

  it('Name TextIsNot "Alice" => 14 rows', () => {
    const result = applySingleFilter('Name', FieldType.RichText, TextFilterCondition.TextIsNot, 'Alice');
    expect(result.length).toBe(14);
  });

  it('Name TextContains "ali" => 3 rows', () => {
    const result = applySingleFilter('Name', FieldType.RichText, TextFilterCondition.TextContains, 'ali');
    assertKeys(result, ['Alice|https://alice.com', 'Alice Wang|https://awang.io', 'Alice|https://alice2.com']);
  });

  it('Name TextDoesNotContain "ali" => 13 rows', () => {
    const result = applySingleFilter('Name', FieldType.RichText, TextFilterCondition.TextDoesNotContain, 'ali');
    expect(result.length).toBe(13);
  });

  it('Name TextStartsWith "A" => 3 rows', () => {
    const result = applySingleFilter('Name', FieldType.RichText, TextFilterCondition.TextStartsWith, 'A');
    assertKeys(result, ['Alice|https://alice.com', 'Alice Wang|https://awang.io', 'Alice|https://alice2.com']);
  });

  it('Name TextEndsWith "e" => 7 rows', () => {
    const result = applySingleFilter('Name', FieldType.RichText, TextFilterCondition.TextEndsWith, 'e');
    assertKeys(result, [
      'Alice|https://alice.com', 'Charlie|', 'Dave|https://dave.org',
      'Eve|', 'Grace|https://grace.ai', 'Alice|https://alice2.com', 'Jane|',
    ]);
  });

  it('Name TextIsEmpty => 2 rows', () => {
    const result = applySingleFilter('Name', FieldType.RichText, TextFilterCondition.TextIsEmpty);
    assertKeys(result, ['|', '|https://unknown.com']);
  });

  it('Name TextIsNotEmpty => 14 rows', () => {
    const result = applySingleFilter('Name', FieldType.RichText, TextFilterCondition.TextIsNotEmpty);
    expect(result.length).toBe(14);
  });

  // Website (URL) field tests
  it('Website TextIsEmpty => 6 rows', () => {
    const result = applySingleFilter('Website', FieldType.URL, TextFilterCondition.TextIsEmpty);
    assertKeys(result, ['Charlie|', '|', 'Eve|', 'Hank|', 'Jane|', 'Lily|']);
  });

  it('Website TextIsNotEmpty => 10 rows', () => {
    const result = applySingleFilter('Website', FieldType.URL, TextFilterCondition.TextIsNotEmpty);
    expect(result.length).toBe(10);
  });

  it('Website TextContains "alice" => 2 rows', () => {
    const result = applySingleFilter('Website', FieldType.URL, TextFilterCondition.TextContains, 'alice');
    assertKeys(result, ['Alice|https://alice.com', 'Alice|https://alice2.com']);
  });

  // Notes (RichText) field tests
  it('Notes TextIs "Team lead" => 2 rows', () => {
    const result = applySingleFilter('Notes', FieldType.RichText, TextFilterCondition.TextIs, 'Team lead');
    assertKeys(result, ['Alice|https://alice.com', 'Alice|https://alice2.com']);
  });

  it('Notes TextIsEmpty => 2 rows', () => {
    const result = applySingleFilter('Notes', FieldType.RichText, TextFilterCondition.TextIsEmpty);
    assertKeys(result, ['|', '|https://unknown.com']);
  });

  it('Notes TextContains "er" => 5 rows', () => {
    const result = applySingleFilter('Notes', FieldType.RichText, TextFilterCondition.TextContains, 'er');
    assertKeys(result, [
      'Bob|https://bob.dev', 'Dave|https://dave.org', 'Eve|', 'Jane|', 'Lily|',
    ]);
  });
});

describe('v070 number filter tests', () => {
  let fixture: ReturnType<typeof loadV070DatabaseFixture>;

  beforeEach(() => {
    fixture = loadV070DatabaseFixture();
  });

  function applySingleFilter(fieldName: string, condition: number, content: string = '') {
    const fieldId = fixture.fieldIdByName.get(fieldName)!;
    const filters = createFilters([{ fieldId, fieldType: FieldType.Number, condition, content }]);
    return filterBy(fixture.rows, filters, fixture.fields, fixture.rowMetas).map((r) => r.id);
  }

  function getRowKey(rowId: string): string {
    const rowDoc = fixture.rowMetas[rowId];
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cells = row.get(YjsDatabaseKey.cells);
    const nameFieldId = fixture.fieldIdByName.get('Name')!;
    const webFieldId = fixture.fieldIdByName.get('Website')!;
    const name = cells.get(nameFieldId)?.get(YjsDatabaseKey.data) ?? '';
    const web = cells.get(webFieldId)?.get(YjsDatabaseKey.data) ?? '';
    return `${name}|${web}`;
  }

  function assertKeys(result: string[], expectedKeys: string[]) {
    const actual = result.map((id) => getRowKey(id)).sort();
    expect(actual).toEqual([...expectedKeys].sort());
  }

  // Age field tests
  it('Age Equal 25 => 3 rows', () => {
    const result = applySingleFilter('Age', NumberFilterCondition.Equal, '25');
    assertKeys(result, ['Alice|https://alice.com', 'Charlie|', 'Alice|https://alice2.com']);
  });

  it('Age NotEqual 25 => 11 rows', () => {
    const result = applySingleFilter('Age', NumberFilterCondition.NotEqual, '25');
    expect(result.length).toBe(11);
  });

  it('Age GreaterThan 35 => 4 rows', () => {
    const result = applySingleFilter('Age', NumberFilterCondition.GreaterThan, '35');
    assertKeys(result, [
      'Alice Wang|https://awang.io', 'Frank|https://frank.net',
      '|https://unknown.com', 'Karl|https://karl.de',
    ]);
  });

  it('Age LessThan 25 => 2 rows', () => {
    const result = applySingleFilter('Age', NumberFilterCondition.LessThan, '25');
    assertKeys(result, ['Grace|https://grace.ai', 'Lily|']);
  });

  it('Age GreaterThanOrEqualTo 35 => 5 rows', () => {
    const result = applySingleFilter('Age', NumberFilterCondition.GreaterThanOrEqualTo, '35');
    assertKeys(result, [
      'Alice Wang|https://awang.io', 'Dave|https://dave.org',
      'Frank|https://frank.net', '|https://unknown.com', 'Karl|https://karl.de',
    ]);
  });

  it('Age LessThanOrEqualTo 25 => 5 rows', () => {
    const result = applySingleFilter('Age', NumberFilterCondition.LessThanOrEqualTo, '25');
    assertKeys(result, [
      'Alice|https://alice.com', 'Charlie|', 'Grace|https://grace.ai',
      'Alice|https://alice2.com', 'Lily|',
    ]);
  });

  it('Age NumberIsEmpty => 2 rows', () => {
    const result = applySingleFilter('Age', NumberFilterCondition.NumberIsEmpty);
    assertKeys(result, ['|', 'Hank|']);
  });

  it('Age NumberIsNotEmpty => 14 rows', () => {
    const result = applySingleFilter('Age', NumberFilterCondition.NumberIsNotEmpty);
    expect(result.length).toBe(14);
  });

  // Score field tests
  it('Score Equal 0 => 2 rows', () => {
    const result = applySingleFilter('Score', NumberFilterCondition.Equal, '0');
    assertKeys(result, ['Charlie|', 'Jane|']);
  });

  it('Score LessThan 0 => 2 rows', () => {
    const result = applySingleFilter('Score', NumberFilterCondition.LessThan, '0');
    assertKeys(result, ['Alice Wang|https://awang.io', 'Hank|']);
  });

  it('Score GreaterThan 0 => 10 rows', () => {
    const result = applySingleFilter('Score', NumberFilterCondition.GreaterThan, '0');
    expect(result.length).toBe(10);
  });

  it('Score NumberIsEmpty => 2 rows', () => {
    const result = applySingleFilter('Score', NumberFilterCondition.NumberIsEmpty);
    assertKeys(result, ['|', 'Grace|https://grace.ai']);
  });
});

describe('v070 select filter tests', () => {
  let fixture: ReturnType<typeof loadV070DatabaseFixture>;

  beforeEach(() => {
    fixture = loadV070DatabaseFixture();
  });

  function getOptionId(fieldName: string, optionName: string): string {
    const fieldId = fixture.fieldIdByName.get(fieldName)!;
    const field = fixture.fields.get(fieldId)!;
    const typeOption = field.get(YjsDatabaseKey.type_option);
    const fieldType = Number(field.get(YjsDatabaseKey.type));
    const option = typeOption?.get(String(fieldType));
    const content = option?.get(YjsDatabaseKey.content) as string;
    const parsed = JSON.parse(content) as { options: Array<{ id: string; name: string }> };
    return parsed.options.find((o) => o.name === optionName)!.id;
  }

  function applySingleFilter(fieldName: string, fieldType: FieldType, condition: number, content: string = '') {
    const fieldId = fixture.fieldIdByName.get(fieldName)!;
    const filters = createFilters([{ fieldId, fieldType, condition, content }]);
    return filterBy(fixture.rows, filters, fixture.fields, fixture.rowMetas).map((r) => r.id);
  }

  function getRowKey(rowId: string): string {
    const rowDoc = fixture.rowMetas[rowId];
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cells = row.get(YjsDatabaseKey.cells);
    const nameFieldId = fixture.fieldIdByName.get('Name')!;
    const webFieldId = fixture.fieldIdByName.get('Website')!;
    const name = cells.get(nameFieldId)?.get(YjsDatabaseKey.data) ?? '';
    const web = cells.get(webFieldId)?.get(YjsDatabaseKey.data) ?? '';
    return `${name}|${web}`;
  }

  function assertKeys(result: string[], expectedKeys: string[]) {
    const actual = result.map((id) => getRowKey(id)).sort();
    expect(actual).toEqual([...expectedKeys].sort());
  }

  // Status (SingleSelect) tests
  it('Status OptionIs Active => 7 rows', () => {
    const activeId = getOptionId('Status', 'Active');
    const result = applySingleFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIs, activeId);
    assertKeys(result, [
      'Alice|https://alice.com', 'Bob|https://bob.dev', 'Dave|https://dave.org',
      'Grace|https://grace.ai', '|https://unknown.com', 'Ivan|https://ivan.ru', 'Karl|https://karl.de',
    ]);
  });

  it('Status OptionIsNot Active => 9 rows', () => {
    const activeId = getOptionId('Status', 'Active');
    const result = applySingleFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIsNot, activeId);
    expect(result.length).toBe(9);
  });

  it('Status OptionContains Active => 7 rows', () => {
    const activeId = getOptionId('Status', 'Active');
    const result = applySingleFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionContains, activeId);
    expect(result.length).toBe(7);
  });

  it('Status OptionDoesNotContain Active => 9 rows', () => {
    const activeId = getOptionId('Status', 'Active');
    const result = applySingleFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionDoesNotContain, activeId);
    expect(result.length).toBe(9);
  });

  it('Status OptionIsEmpty => 2 rows', () => {
    const result = applySingleFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIsEmpty);
    assertKeys(result, ['|', 'Hank|']);
  });

  it('Status OptionIsNotEmpty => 14 rows', () => {
    const result = applySingleFilter('Status', FieldType.SingleSelect, SelectOptionFilterCondition.OptionIsNotEmpty);
    expect(result.length).toBe(14);
  });

  // Categories (MultiSelect) tests
  it('Categories OptionIs Work => 1 row (subset check: only Work)', () => {
    const workId = getOptionId('Categories', 'Work');
    const result = applySingleFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionIs, workId);
    // OptionIs = all cell options must be within filter set. Only Bob has exactly {Work}
    assertKeys(result, ['Bob|https://bob.dev']);
  });

  it('Categories OptionIsNot Work => 15 rows', () => {
    const workId = getOptionId('Categories', 'Work');
    const result = applySingleFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionIsNot, workId);
    expect(result.length).toBe(15);
  });

  it('Categories OptionContains Work => 7 rows', () => {
    const workId = getOptionId('Categories', 'Work');
    const result = applySingleFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionContains, workId);
    assertKeys(result, [
      'Alice|https://alice.com', 'Bob|https://bob.dev', 'Dave|https://dave.org',
      'Frank|https://frank.net', '|https://unknown.com', 'Alice|https://alice2.com', 'Karl|https://karl.de',
    ]);
  });

  it('Categories OptionDoesNotContain Work => 9 rows', () => {
    const workId = getOptionId('Categories', 'Work');
    const result = applySingleFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionDoesNotContain, workId);
    expect(result.length).toBe(9);
  });

  it('Categories OptionContains Work,Health => 10 rows', () => {
    const workId = getOptionId('Categories', 'Work');
    const healthId = getOptionId('Categories', 'Health');
    const result = applySingleFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionContains, `${workId},${healthId}`);
    expect(result.length).toBe(10);
  });

  it('Categories OptionIs Work,Health => 4 rows (subset check)', () => {
    const workId = getOptionId('Categories', 'Work');
    const healthId = getOptionId('Categories', 'Health');
    const result = applySingleFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionIs, `${workId},${healthId}`);
    // OptionIs = all cell options must be within {Work, Health}
    // Alice: {Work,Health} ✓, Bob: {Work} ✓, Frank: {Health,Work} ✓, Ivan: {Health} ✓
    assertKeys(result, [
      'Alice|https://alice.com', 'Bob|https://bob.dev', 'Frank|https://frank.net', 'Ivan|https://ivan.ru',
    ]);
  });

  it('Categories OptionIsEmpty => 2 rows', () => {
    const result = applySingleFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionIsEmpty);
    assertKeys(result, ['|', 'Hank|']);
  });

  it('Categories OptionIsNotEmpty => 14 rows', () => {
    const result = applySingleFilter('Categories', FieldType.MultiSelect, SelectOptionFilterCondition.OptionIsNotEmpty);
    expect(result.length).toBe(14);
  });
});

describe('v070 checkbox/checklist filter tests', () => {
  let fixture: ReturnType<typeof loadV070DatabaseFixture>;

  beforeEach(() => {
    fixture = loadV070DatabaseFixture();
  });

  function applySingleFilter(fieldName: string, fieldType: FieldType, condition: number, content: string = '') {
    const fieldId = fixture.fieldIdByName.get(fieldName)!;
    const filters = createFilters([{ fieldId, fieldType, condition, content }]);
    return filterBy(fixture.rows, filters, fixture.fields, fixture.rowMetas).map((r) => r.id);
  }

  function getRowKey(rowId: string): string {
    const rowDoc = fixture.rowMetas[rowId];
    const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cells = row.get(YjsDatabaseKey.cells);
    const nameFieldId = fixture.fieldIdByName.get('Name')!;
    const webFieldId = fixture.fieldIdByName.get('Website')!;
    const name = cells.get(nameFieldId)?.get(YjsDatabaseKey.data) ?? '';
    const web = cells.get(webFieldId)?.get(YjsDatabaseKey.data) ?? '';
    return `${name}|${web}`;
  }

  function assertKeys(result: string[], expectedKeys: string[]) {
    const actual = result.map((id) => getRowKey(id)).sort();
    expect(actual).toEqual([...expectedKeys].sort());
  }

  // Active (Checkbox) tests
  it('Active IsChecked => 9 rows', () => {
    const result = applySingleFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsChecked);
    assertKeys(result, [
      'Alice|https://alice.com', 'Bob|https://bob.dev', 'Alice Wang|https://awang.io',
      'Dave|https://dave.org', 'Frank|https://frank.net', '|https://unknown.com',
      'Alice|https://alice2.com', 'Jane|', 'Karl|https://karl.de',
    ]);
  });

  it('Active IsUnChecked => 7 rows', () => {
    const result = applySingleFilter('Active', FieldType.Checkbox, CheckboxFilterCondition.IsUnChecked);
    assertKeys(result, [
      'Charlie|', '|', 'Eve|', 'Grace|https://grace.ai', 'Hank|', 'Ivan|https://ivan.ru', 'Lily|',
    ]);
  });

  // Tasks (Checklist) tests
  it('Tasks IsComplete => 6 rows', () => {
    const result = applySingleFilter('Tasks', FieldType.Checklist, ChecklistFilterCondition.IsComplete);
    assertKeys(result, [
      'Alice|https://alice.com', 'Alice Wang|https://awang.io', 'Frank|https://frank.net',
      '|https://unknown.com', 'Jane|', 'Karl|https://karl.de',
    ]);
  });

  it('Tasks IsIncomplete => 10 rows', () => {
    const result = applySingleFilter('Tasks', FieldType.Checklist, ChecklistFilterCondition.IsIncomplete);
    assertKeys(result, [
      'Bob|https://bob.dev', 'Charlie|', '|', 'Dave|https://dave.org', 'Eve|',
      'Grace|https://grace.ai', 'Hank|', 'Alice|https://alice2.com', 'Ivan|https://ivan.ru', 'Lily|',
    ]);
  });
});
