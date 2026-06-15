import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { filterBy } from '@/application/database-yjs/filter';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import { TextFilterCondition } from '@/application/database-yjs/fields/text/text.type';
import { Row } from '@/application/database-yjs/selector';
import {
  RowId,
  YDatabase,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

type FilterCase = {
  name: string;
  condition: TextFilterCondition;
  content?: string;
  relationExpected: string[];
  rollupExpected: string[];
};

function createField(fieldId: string, fieldType: FieldType): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, fieldId);
  field.set(YjsDatabaseKey.type, fieldType);
  return field;
}

function createCell(fieldType: FieldType, data?: unknown): YDatabaseCell {
  const cell = new Y.Map() as YDatabaseCell;
  cell.set(YjsDatabaseKey.field_type, fieldType);
  if (data !== undefined) {
    cell.set(YjsDatabaseKey.data, data);
  }
  return cell;
}

function createRowDoc(rowId: string, databaseId: string, cellMap: Record<string, YDatabaseCell>): YDoc {
  const doc = new Y.Doc() as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map() as YDatabaseRow;
  const cells = new Y.Map() as YDatabaseCells;

  Object.entries(cellMap).forEach(([fieldId, cell]) => {
    cells.set(fieldId, cell);
  });

  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.database_id, databaseId);
  row.set(YjsDatabaseKey.cells, cells);
  row.set(YjsDatabaseKey.created_at, '0');
  row.set(YjsDatabaseKey.last_modified, '0');
  sharedRoot.set(YjsEditorKey.database_row, row);
  return doc;
}

function createFixture() {
  const databaseId = 'db-filter';
  const relationFieldId = 'relation-field';
  const rollupFieldId = 'rollup-field';
  const rowIds = ['row-a', 'row-b', 'row-c'];

  const doc = new Y.Doc() as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  sharedRoot.set(YjsEditorKey.database, database);
  database.set(YjsDatabaseKey.fields, fields);

  fields.set(relationFieldId, createField(relationFieldId, FieldType.Relation));
  fields.set(rollupFieldId, createField(rollupFieldId, FieldType.Rollup));

  const rows: Row[] = rowIds.map((id) => ({ id, height: 0 }));
  const rowMetas: Record<RowId, YDoc> = {};

  rowIds.forEach((rowId) => {
    rowMetas[rowId] = createRowDoc(rowId, databaseId, {
      [relationFieldId]: createCell(FieldType.Relation, new Y.Array<string>()),
      [rollupFieldId]: createCell(FieldType.Rollup, ''),
    });
  });

  const relationTexts: Record<RowId, string> = {
    'row-a': 'Alpha, Beta',
    'row-b': '',
    'row-c': 'Beta',
  };
  const rollupTexts: Record<RowId, string> = {
    'row-a': 'Gamma',
    'row-b': 'Alpha',
    'row-c': '',
  };

  return {
    fields,
    rows,
    rowMetas,
    relationFieldId,
    rollupFieldId,
    relationTexts,
    rollupTexts,
  };
}

function applyTextFilter({
  fieldId,
  condition,
  content,
  fields,
  rows,
  rowMetas,
  relationTexts,
  rollupTexts,
}: {
  fieldId: string;
  condition: TextFilterCondition;
  content?: string;
  fields: YDatabaseFields;
  rows: Row[];
  rowMetas: Record<RowId, YDoc>;
  relationTexts: Record<RowId, string>;
  rollupTexts: Record<RowId, string>;
}) {
  const filtersDoc = new Y.Doc();
  const filters = new Y.Array() as YDatabaseFilters;
  filtersDoc.getMap('root').set('filters', filters);
  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, `filter-${fieldId}-${condition}`);
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.type, Number(fields.get(fieldId)?.get(YjsDatabaseKey.type)));
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, condition);
  filter.set(YjsDatabaseKey.content, content ?? '');
  filters.push([filter]);

  return filterBy(rows, filters, fields, rowMetas, {
    getRelationCellText: (rowId) => relationTexts[rowId] ?? '',
    getRollupCellText: (rowId) => rollupTexts[rowId] ?? '',
  }).map((row) => row.id);
}

const cases: FilterCase[] = [
  {
    name: 'contains',
    condition: TextFilterCondition.TextContains,
    content: 'alpha',
    relationExpected: ['row-a'],
    rollupExpected: ['row-b'],
  },
  {
    name: 'does not contain',
    condition: TextFilterCondition.TextDoesNotContain,
    content: 'alpha',
    relationExpected: ['row-b', 'row-c'],
    rollupExpected: ['row-a', 'row-c'],
  },
  {
    name: 'is empty',
    condition: TextFilterCondition.TextIsEmpty,
    relationExpected: ['row-b'],
    rollupExpected: ['row-c'],
  },
  {
    name: 'is not empty',
    condition: TextFilterCondition.TextIsNotEmpty,
    relationExpected: ['row-a', 'row-c'],
    rollupExpected: ['row-a', 'row-b'],
  },
  {
    name: 'starts with',
    condition: TextFilterCondition.TextStartsWith,
    content: 'Alpha',
    relationExpected: ['row-a'],
    rollupExpected: ['row-b'],
  },
  {
    name: 'ends with',
    condition: TextFilterCondition.TextEndsWith,
    content: 'Beta',
    relationExpected: ['row-a', 'row-c'],
    rollupExpected: [],
  },
  {
    name: 'is',
    condition: TextFilterCondition.TextIs,
    content: 'Beta',
    relationExpected: ['row-c'],
    rollupExpected: [],
  },
  {
    name: 'is not',
    condition: TextFilterCondition.TextIsNot,
    content: 'Gamma',
    relationExpected: ['row-a', 'row-b', 'row-c'],
    rollupExpected: ['row-b', 'row-c'],
  },
];

describe('relation + rollup filters (text conditions)', () => {
  const fixture = createFixture();

  test.each(cases)('relation %s', ({ condition, content, relationExpected }) => {
    const result = applyTextFilter({
      ...fixture,
      fieldId: fixture.relationFieldId,
      condition,
      content,
    });

    expect(result).toEqual(relationExpected);
  });

  test.each(cases)('rollup %s', ({ condition, content, rollupExpected }) => {
    const result = applyTextFilter({
      ...fixture,
      fieldId: fixture.rollupFieldId,
      condition,
      content,
    });

    expect(result).toEqual(rollupExpected);
  });
});
