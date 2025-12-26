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

describe('filterBy with v069 fixture', () => {
  const fixture = loadV069DatabaseFixture();
  const nameFieldId = fixture.fieldIdByName.get('Name') ?? '';
  const amountFieldId = fixture.fieldIdByName.get('Amount') ?? '';
  const checkboxFieldId = fixture.fieldIdByName.get('Registration Complete') ?? '';
  const priorityFieldId = fixture.fieldIdByName.get('Priority') ?? '';

  function getRowName(rowId: string) {
    const rowDoc = fixture.rowMetas[rowId];
    const rowMap = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    return rowMap.get(YjsDatabaseKey.cells)?.get(nameFieldId)?.get(YjsDatabaseKey.data) as string;
  }

  it('filters checkbox values from csv dataset', () => {
    const filters = createFilters([
      { fieldId: checkboxFieldId, fieldType: FieldType.Checkbox, condition: CheckboxFilterCondition.IsChecked },
    ]);

    const result = filterBy(fixture.rows, filters, fixture.fields, fixture.rowMetas).map((row) => getRowName(row.id));
    expect(result).toEqual(['Beatrice', 'Scotty', 'Thomas', 'Juan', 'Alex', 'George', 'Judy']);
  });

  it('filters single select options from csv dataset', () => {
    const filters = createFilters([
      { fieldId: priorityFieldId, fieldType: FieldType.SingleSelect, condition: SelectOptionFilterCondition.OptionIs, content: 'cplL' },
    ]);

    const result = filterBy(fixture.rows, filters, fixture.fields, fixture.rowMetas).map((row) => getRowName(row.id));
    expect(result).toEqual(['Olaf', 'Lancelot']);
  });

  it('filters numbers greater than from csv dataset', () => {
    const filters = createFilters([
      { fieldId: amountFieldId, fieldType: FieldType.Number, condition: NumberFilterCondition.GreaterThan, content: '100000' },
    ]);

    const result = filterBy(fixture.rows, filters, fixture.fields, fixture.rowMetas).map((row) => getRowName(row.id));
    expect(result).toEqual(['Beatrice', 'Thomas']);
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
        createRowDoc: fixture.createRowDoc,
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
          createRowDoc: fixture.createRowDoc,
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
