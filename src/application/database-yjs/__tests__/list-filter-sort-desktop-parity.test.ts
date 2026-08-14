import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { FieldType, FilterType, SortCondition } from '@/application/database-yjs/database.type';
import {
  CheckboxFilterCondition,
  NumberFilterCondition,
  SelectOptionFilterCondition,
  TextFilterCondition,
} from '@/application/database-yjs/fields';
import { filterBy } from '@/application/database-yjs/filter';
import { Row } from '@/application/database-yjs/selector';
import { sortBy } from '@/application/database-yjs/sort';
import {
  RowId,
  YDatabaseCell,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseFields,
  YDatabaseRow,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createCell, createField, createRowDoc } from './test-helpers';

type FilterConfig = {
  condition: number;
  content?: string;
  fieldId: string;
  fieldType: FieldType;
};

type SortConfig = {
  condition: SortCondition;
  fieldId: string;
};

type RowSeed = {
  checked?: boolean;
  date?: string;
  name: string;
  number?: string;
  type?: string;
};

const databaseId = 'list-desktop-parity';
const nameFieldId = 'name';
const numberFieldId = 'number';
const checkboxFieldId = 'checkbox';
const typeFieldId = 'type';
const dateFieldId = 'date';

const defaultSeeds: RowSeed[] = [
  { checked: true, date: '300', name: 'Charlie', number: '30', type: 'opt-b' },
  { checked: false, date: '100', name: 'Apple', number: '10', type: 'opt-a' },
  { checked: true, date: '200', name: 'Banana', number: '20' },
  { checked: false, date: '400', name: 'Application', number: '40', type: 'opt-c' },
  { checked: false, name: '' },
];

function createFilters(configs: FilterConfig[]): YDatabaseFilters {
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

  return { toArray: () => filters } as YDatabaseFilters;
}

function createSorts(configs: SortConfig[]): YDatabaseSorts {
  const sorts = configs.map((config, index) => {
    const doc = new Y.Doc();
    const sort = doc.getMap(`sort-${index}`) as YDatabaseSort;

    sort.set(YjsDatabaseKey.id, `sort-${index}`);
    sort.set(YjsDatabaseKey.field_id, config.fieldId);
    sort.set(YjsDatabaseKey.condition, config.condition);
    return sort;
  });

  return { toArray: () => sorts } as YDatabaseSorts;
}

function createViewConditionState() {
  const doc = new Y.Doc();
  const view = doc.getMap('view') as YDatabaseView;
  const filters = new Y.Array<YDatabaseFilter>() as YDatabaseFilters;
  const sorts = new Y.Array<YDatabaseSort>() as YDatabaseSorts;

  view.set(YjsDatabaseKey.filters, filters);
  view.set(YjsDatabaseKey.sorts, sorts);

  const addFilter = (config: FilterConfig) => {
    const filter = new Y.Map() as YDatabaseFilter;

    filter.set(YjsDatabaseKey.id, `filter-${filters.length}`);
    filter.set(YjsDatabaseKey.field_id, config.fieldId);
    filter.set(YjsDatabaseKey.type, config.fieldType);
    filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
    filter.set(YjsDatabaseKey.condition, config.condition);
    filter.set(YjsDatabaseKey.content, config.content ?? '');
    filters.push([filter]);
  };

  const addSort = (config: SortConfig) => {
    const sort = new Y.Map() as YDatabaseSort;

    sort.set(YjsDatabaseKey.id, `sort-${sorts.length}`);
    sort.set(YjsDatabaseKey.field_id, config.fieldId);
    sort.set(YjsDatabaseKey.condition, config.condition);
    sorts.push([sort]);
  };

  return { addFilter, addSort, doc, filters, sorts, view };
}

function createFixture(seeds: RowSeed[] = defaultSeeds) {
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(nameFieldId, createField(nameFieldId, FieldType.RichText));
  fields.set(numberFieldId, createField(numberFieldId, FieldType.Number));
  fields.set(checkboxFieldId, createField(checkboxFieldId, FieldType.Checkbox));
  fields.set(
    typeFieldId,
    createField(typeFieldId, FieldType.SingleSelect, {
      disable_color: false,
      options: [
        { color: 0, id: 'opt-a', name: 'A' },
        { color: 0, id: 'opt-b', name: 'B' },
        { color: 0, id: 'opt-c', name: 'C' },
      ],
    })
  );
  fields.set(dateFieldId, createField(dateFieldId, FieldType.DateTime));

  const rows: Row[] = [];
  const rowMetas: Record<RowId, YDoc> = {};

  const append = (seed: RowSeed) => {
    const rowId = `row-${rows.length + 1}`;

    rows.push({ height: 36, id: rowId });
    rowMetas[rowId] = createRowDoc(rowId, databaseId, {
      [checkboxFieldId]: createCell(FieldType.Checkbox, seed.checked ? 'Yes' : 'No'),
      [dateFieldId]: createCell(FieldType.DateTime, seed.date ?? ''),
      [nameFieldId]: createCell(FieldType.RichText, seed.name),
      [numberFieldId]: createCell(FieldType.Number, seed.number ?? ''),
      [typeFieldId]: createCell(FieldType.SingleSelect, seed.type ?? ''),
    });
    return rowId;
  };

  seeds.forEach(append);

  const update = (rowId: RowId, fieldId: string, data: string) => {
    const row = rowMetas[rowId].getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cell = row.get(YjsDatabaseKey.cells).get(fieldId) as YDatabaseCell;

    cell.set(YjsDatabaseKey.data, data);
  };

  const title = (row: Row) => {
    const rowMap = rowMetas[row.id].getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    return (rowMap.get(YjsDatabaseKey.cells).get(nameFieldId)?.get(YjsDatabaseKey.data) as string) ?? '';
  };

  return { append, fields, rowMetas, rows, title, update };
}

type Fixture = ReturnType<typeof createFixture>;

function apply(fixture: Fixture, filters: FilterConfig[] = [], sorts: SortConfig[] = []) {
  const filteredRows = filterBy(fixture.rows, createFilters(filters), fixture.fields, fixture.rowMetas);

  return sortBy(filteredRows, createSorts(sorts), fixture.fields, fixture.rowMetas);
}

function titles(fixture: Fixture, filters: FilterConfig[] = [], sorts: SortConfig[] = []) {
  return apply(fixture, filters, sorts).map(fixture.title);
}

function titlesForView(fixture: Fixture, viewState: ReturnType<typeof createViewConditionState>) {
  const filteredRows = filterBy(fixture.rows, viewState.filters, fixture.fields, fixture.rowMetas);

  return sortBy(filteredRows, viewState.sorts, fixture.fields, fixture.rowMetas).map(fixture.title);
}

const containsApp: FilterConfig = {
  condition: TextFilterCondition.TextContains,
  content: 'App',
  fieldId: nameFieldId,
  fieldType: FieldType.RichText,
};

const nameAscending: SortConfig = {
  condition: SortCondition.Ascending,
  fieldId: nameFieldId,
};

// These suites explicitly map every scenario from the four Flutter List
// filter/sort files. The row-order engine is shared by Grid and List, while
// List-specific rendering and persistence are exercised by Playwright.
describe('database_list_filter_test.dart', () => {
  it('create text filter in list view', () => {
    const fixture = createFixture();

    expect(titles(fixture, [containsApp])).toEqual(['Apple', 'Application']);
  });

  it('create checkbox filter in list view', () => {
    const fixture = createFixture();
    const filters: FilterConfig[] = [
      {
        condition: CheckboxFilterCondition.IsChecked,
        fieldId: checkboxFieldId,
        fieldType: FieldType.Checkbox,
      },
    ];

    expect(titles(fixture, filters)).toEqual(['Charlie', 'Banana']);
  });

  it('create select option filter in list view', () => {
    const fixture = createFixture();
    const filters: FilterConfig[] = [
      {
        condition: SelectOptionFilterCondition.OptionIs,
        content: 'opt-a',
        fieldId: typeFieldId,
        fieldType: FieldType.SingleSelect,
      },
    ];

    expect(titles(fixture, filters)).toEqual(['Apple']);
  });

  it('delete filter restores all rows in list view', () => {
    const fixture = createFixture();
    let activeFilters = [containsApp];

    expect(apply(fixture, activeFilters)).toHaveLength(2);
    activeFilters = [];
    expect(apply(fixture, activeFilters)).toHaveLength(5);
  });

  it('change filter condition updates list', () => {
    const fixture = createFixture();
    let activeFilters = [containsApp];

    expect(titles(fixture, activeFilters)).toEqual(['Apple', 'Application']);
    activeFilters = [
      {
        condition: TextFilterCondition.TextIsEmpty,
        fieldId: nameFieldId,
        fieldType: FieldType.RichText,
      },
    ];
    expect(titles(fixture, activeFilters)).toEqual(['']);
  });

  it('new row matching filter appears in list', () => {
    const fixture = createFixture();

    expect(apply(fixture, [containsApp])).toHaveLength(2);
    fixture.append({ name: 'Appetizer' });
    expect(titles(fixture, [containsApp])).toEqual(['Apple', 'Application', 'Appetizer']);
  });

  it('edit row to match filter makes it appear', () => {
    const fixture = createFixture();

    expect(apply(fixture, [containsApp])).toHaveLength(2);
    fixture.update('row-3', nameFieldId, 'Appetizer');
    expect(titles(fixture, [containsApp])).toEqual(['Apple', 'Appetizer', 'Application']);
  });

  it('edit row to not match filter hides it', () => {
    const fixture = createFixture();

    expect(apply(fixture, [containsApp])).toHaveLength(2);
    fixture.update('row-4', nameFieldId, 'Berry');
    expect(titles(fixture, [containsApp])).toEqual(['Apple']);
  });

  it('filter persists when switching to grid and back', () => {
    const fixture = createFixture();
    const listView = createViewConditionState();
    const gridView = createViewConditionState();

    listView.addFilter(containsApp);
    expect(titlesForView(fixture, listView)).toEqual(['Apple', 'Application']);
    expect(titlesForView(fixture, gridView)).toHaveLength(5);
    expect(titlesForView(fixture, listView)).toEqual(['Apple', 'Application']);
  });

  it('filter is isolated per view', () => {
    const fixture = createFixture();
    const firstList = createViewConditionState();
    const secondList = createViewConditionState();

    firstList.addFilter(containsApp);
    expect(titlesForView(fixture, firstList)).toEqual(['Apple', 'Application']);
    expect(titlesForView(fixture, secondList)).toEqual(['Charlie', 'Apple', 'Banana', 'Application', '']);
    expect(secondList.filters).toHaveLength(0);
    expect(firstList.filters).toHaveLength(1);
  });

  it('checkbox filter - unchecked condition', () => {
    const fixture = createFixture();
    const filters: FilterConfig[] = [
      {
        condition: CheckboxFilterCondition.IsUnChecked,
        fieldId: checkboxFieldId,
        fieldType: FieldType.Checkbox,
      },
    ];

    expect(titles(fixture, filters)).toEqual(['Apple', 'Application', '']);
  });

  it('select option filter - OptionIsNot condition', () => {
    const fixture = createFixture();
    const filters: FilterConfig[] = [
      {
        condition: SelectOptionFilterCondition.OptionIsNot,
        content: 'opt-a',
        fieldId: typeFieldId,
        fieldType: FieldType.SingleSelect,
      },
    ];

    expect(titles(fixture, filters)).toEqual(['Charlie', 'Banana', 'Application', '']);
  });

  it('select option filter - OptionIsEmpty condition', () => {
    const fixture = createFixture();
    const filters: FilterConfig[] = [
      {
        condition: SelectOptionFilterCondition.OptionIsEmpty,
        fieldId: typeFieldId,
        fieldType: FieldType.SingleSelect,
      },
    ];

    expect(titles(fixture, filters)).toEqual(['Banana', '']);
  });

  it('select option filter - OptionIsNotEmpty condition', () => {
    const fixture = createFixture();
    const filters: FilterConfig[] = [
      {
        condition: SelectOptionFilterCondition.OptionIsNotEmpty,
        fieldId: typeFieldId,
        fieldType: FieldType.SingleSelect,
      },
    ];

    expect(titles(fixture, filters)).toEqual(['Charlie', 'Apple', 'Application']);
  });
});

describe('database_list_sort_test.dart', () => {
  it('create ascending sort in list view', () => {
    const fixture = createFixture();

    expect(titles(fixture, [], [nameAscending])).toEqual(['Apple', 'Application', 'Banana', 'Charlie', '']);
  });

  it('create descending sort in list view', () => {
    const fixture = createFixture();

    expect(titles(fixture, [], [{ condition: SortCondition.Descending, fieldId: nameFieldId }])).toEqual([
      'Charlie',
      'Banana',
      'Application',
      'Apple',
      '',
    ]);
  });

  it('sort by number field in list view', () => {
    const fixture = createFixture();

    expect(titles(fixture, [], [{ condition: SortCondition.Ascending, fieldId: numberFieldId }])).toEqual([
      'Apple',
      'Banana',
      'Charlie',
      'Application',
      '',
    ]);
  });

  it('sort by checkbox field in list view', () => {
    const fixture = createFixture();

    expect(titles(fixture, [], [{ condition: SortCondition.Ascending, fieldId: checkboxFieldId }])).toEqual([
      'Apple',
      'Application',
      '',
      'Charlie',
      'Banana',
    ]);
  });

  it('sort by select option field in list view', () => {
    const fixture = createFixture();

    expect(titles(fixture, [], [{ condition: SortCondition.Ascending, fieldId: typeFieldId }])).toEqual([
      'Apple',
      'Charlie',
      'Application',
      'Banana',
      '',
    ]);
  });

  it('delete sort in list view', () => {
    const fixture = createFixture();
    let activeSorts = [nameAscending];

    expect(titles(fixture, [], activeSorts)).toEqual(['Apple', 'Application', 'Banana', 'Charlie', '']);
    activeSorts = [];
    expect(titles(fixture, [], activeSorts)).toEqual(['Charlie', 'Apple', 'Banana', 'Application', '']);
  });

  it('change sort direction in list view', () => {
    const fixture = createFixture();
    let activeSorts = [nameAscending];

    expect(titles(fixture, [], activeSorts)).toEqual(['Apple', 'Application', 'Banana', 'Charlie', '']);
    activeSorts = [{ condition: SortCondition.Descending, fieldId: nameFieldId }];
    expect(titles(fixture, [], activeSorts)).toEqual(['Charlie', 'Banana', 'Application', 'Apple', '']);
  });

  it('new row appears in list with active sort', () => {
    const fixture = createFixture([{ name: 'Alpha' }, { name: 'Charlie' }, { name: 'Echo' }]);

    fixture.append({ name: 'Bravo' });
    expect(titles(fixture, [], [nameAscending])).toEqual(['Alpha', 'Bravo', 'Charlie', 'Echo']);
  });

  it('edit row in grid updates list view with sort', () => {
    const fixture = createFixture([{ name: 'Alpha' }, { name: 'Bravo' }, { name: 'Charlie' }]);

    fixture.update('row-1', nameFieldId, 'Zulu');
    expect(titles(fixture, [], [nameAscending])).toEqual(['Bravo', 'Charlie', 'Zulu']);
  });

  it('create multiple sorts in list view', () => {
    const fixture = createFixture();
    const sorts: SortConfig[] = [{ condition: SortCondition.Ascending, fieldId: checkboxFieldId }, nameAscending];

    expect(titles(fixture, [], sorts)).toEqual(['Apple', 'Application', '', 'Banana', 'Charlie']);
  });

  it('sort persists when switching views', () => {
    const fixture = createFixture();
    const listView = createViewConditionState();
    const gridView = createViewConditionState();

    listView.addSort(nameAscending);
    expect(titlesForView(fixture, listView)).toEqual(['Apple', 'Application', 'Banana', 'Charlie', '']);
    expect(titlesForView(fixture, gridView)).toEqual(['Charlie', 'Apple', 'Banana', 'Application', '']);
    expect(titlesForView(fixture, listView)).toEqual(['Apple', 'Application', 'Banana', 'Charlie', '']);
  });

  it('sort is isolated per view', () => {
    const fixture = createFixture();
    const firstList = createViewConditionState();
    const secondList = createViewConditionState();

    firstList.addSort(nameAscending);
    expect(titlesForView(fixture, firstList)).toEqual(['Apple', 'Application', 'Banana', 'Charlie', '']);
    expect(titlesForView(fixture, secondList)).toEqual(['Charlie', 'Apple', 'Banana', 'Application', '']);
    expect(secondList.sorts).toHaveLength(0);
    expect(firstList.sorts).toHaveLength(1);
  });

  it('sort by date field in list view', () => {
    const fixture = createFixture();

    expect(titles(fixture, [], [{ condition: SortCondition.Ascending, fieldId: dateFieldId }])).toEqual([
      'Apple',
      'Banana',
      'Charlie',
      'Application',
      '',
    ]);
  });
});

describe('database_list_filter_and_sort_test.dart', () => {
  it('apply filter and sort in either order', () => {
    const fixture = createFixture();
    const nonEmpty: FilterConfig = {
      condition: TextFilterCondition.TextIsNotEmpty,
      fieldId: nameFieldId,
      fieldType: FieldType.RichText,
    };
    const filterThenSortView = createViewConditionState();
    const sortThenFilterView = createViewConditionState();

    filterThenSortView.addFilter(nonEmpty);
    filterThenSortView.addSort(nameAscending);
    sortThenFilterView.addSort(nameAscending);
    sortThenFilterView.addFilter(nonEmpty);
    const filterThenSort = titlesForView(fixture, filterThenSortView);
    const sortThenFilter = titlesForView(fixture, sortThenFilterView);

    expect(filterThenSort).toEqual(['Apple', 'Application', 'Banana', 'Charlie']);
    expect(sortThenFilter).toEqual(filterThenSort);

    const positiveNumbers: FilterConfig = {
      condition: NumberFilterCondition.GreaterThan,
      content: '0',
      fieldId: numberFieldId,
      fieldType: FieldType.Number,
    };

    expect(
      titles(fixture, [positiveNumbers], [{ condition: SortCondition.Descending, fieldId: numberFieldId }])
    ).toEqual(['Application', 'Charlie', 'Banana', 'Apple']);
  });

  it('delete filter or sort while other remains active', () => {
    const fixture = createFixture();
    const checked: FilterConfig = {
      condition: CheckboxFilterCondition.IsChecked,
      fieldId: checkboxFieldId,
      fieldType: FieldType.Checkbox,
    };

    expect(titles(fixture, [checked], [nameAscending])).toEqual(['Banana', 'Charlie']);
    expect(titles(fixture, [], [nameAscending])).toEqual(['Apple', 'Application', 'Banana', 'Charlie', '']);
    expect(titles(fixture, [checked], [])).toEqual(['Charlie', 'Banana']);
  });

  it('change filter condition with active sort in list view', () => {
    const fixture = createFixture();
    let filter: FilterConfig = {
      condition: NumberFilterCondition.GreaterThan,
      content: '20',
      fieldId: numberFieldId,
      fieldType: FieldType.Number,
    };

    expect(titles(fixture, [filter], [{ condition: SortCondition.Ascending, fieldId: numberFieldId }])).toEqual([
      'Charlie',
      'Application',
    ]);
    filter = { ...filter, condition: NumberFilterCondition.GreaterThanOrEqualTo };
    expect(titles(fixture, [filter], [{ condition: SortCondition.Ascending, fieldId: numberFieldId }])).toEqual([
      'Banana',
      'Charlie',
      'Application',
    ]);
  });

  it('change sort direction with active filter in list view', () => {
    const fixture = createFixture();

    expect(titles(fixture, [containsApp], [nameAscending])).toEqual(['Apple', 'Application']);
    expect(titles(fixture, [containsApp], [{ condition: SortCondition.Descending, fieldId: nameFieldId }])).toEqual([
      'Application',
      'Apple',
    ]);
  });

  it('new matching row appears with filter and sort active', () => {
    const fixture = createFixture([{ name: 'A' }, { name: 'C' }, { name: 'D' }]);
    const nonEmpty: FilterConfig = {
      condition: TextFilterCondition.TextIsNotEmpty,
      fieldId: nameFieldId,
      fieldType: FieldType.RichText,
    };

    fixture.append({ name: 'B' });
    expect(titles(fixture, [nonEmpty], [nameAscending])).toEqual(['A', 'B', 'C', 'D']);
  });

  it('new matching row is placed in correct sorted position with filter and sort', () => {
    const fixture = createFixture([{ name: 'Alpha' }, { name: 'Delta' }, { name: 'Zebra' }]);
    const containsA: FilterConfig = {
      condition: TextFilterCondition.TextContains,
      content: 'a',
      fieldId: nameFieldId,
      fieldType: FieldType.RichText,
    };

    fixture.append({ name: 'Baba' });
    expect(titles(fixture, [containsA], [nameAscending])).toEqual(['Alpha', 'Baba', 'Delta', 'Zebra']);
  });

  it('edit row to match filter shows it in list view', () => {
    const fixture = createFixture([{ name: 'Apple' }, { name: 'Banana' }, { name: 'Cherry' }]);
    const startsWithA: FilterConfig = {
      condition: TextFilterCondition.TextStartsWith,
      content: 'A',
      fieldId: nameFieldId,
      fieldType: FieldType.RichText,
    };

    expect(titles(fixture, [startsWithA], [nameAscending])).toEqual(['Apple']);
    fixture.update('row-2', nameFieldId, 'Acorn');
    expect(titles(fixture, [startsWithA], [nameAscending])).toEqual(['Acorn', 'Apple']);
  });

  it('empty then non-empty filter results with sort in list view', () => {
    const fixture = createFixture();
    let filter: FilterConfig = {
      condition: TextFilterCondition.TextIs,
      content: 'NonExistentValue',
      fieldId: nameFieldId,
      fieldType: FieldType.RichText,
    };

    expect(titles(fixture, [filter], [nameAscending])).toEqual([]);
    filter = { ...filter, condition: TextFilterCondition.TextIsNotEmpty, content: '' };
    expect(titles(fixture, [filter], [nameAscending])).toEqual(['Apple', 'Application', 'Banana', 'Charlie']);
  });

  it('cross-field filter/sort combinations in list view', () => {
    const fixture = createFixture();
    const nonEmpty: FilterConfig = {
      condition: TextFilterCondition.TextIsNotEmpty,
      fieldId: nameFieldId,
      fieldType: FieldType.RichText,
    };
    const checked: FilterConfig = {
      condition: CheckboxFilterCondition.IsChecked,
      fieldId: checkboxFieldId,
      fieldType: FieldType.Checkbox,
    };

    expect(titles(fixture, [nonEmpty], [{ condition: SortCondition.Ascending, fieldId: numberFieldId }])).toEqual([
      'Apple',
      'Banana',
      'Charlie',
      'Application',
    ]);
    expect(titles(fixture, [checked], [nameAscending])).toEqual(['Banana', 'Charlie']);
  });
});
