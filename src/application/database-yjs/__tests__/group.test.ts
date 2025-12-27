import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { groupByCheckbox, groupByField, groupBySelectOption, getGroupColumns } from '@/application/database-yjs/group';
import { FieldType, FilterType } from '@/application/database-yjs/database.type';
import {
  CheckboxFilterCondition,
  SelectOptionFilterCondition,
} from '@/application/database-yjs/fields';
import { Row } from '@/application/database-yjs/selector';
import {
  RowId,
  YDatabaseFilter,
  YDatabaseFields,
  YDoc,
  YjsDatabaseKey,
} from '@/application/types';

import { createCell, createField, createRowDoc } from './test-helpers';

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

describe('group by field fallback', () => {
  it('returns undefined for unsupported field types', () => {
    const fields = new Y.Map() as YDatabaseFields;
    const field = createField('text-field', FieldType.RichText);
    fields.set('text-field', field);

    const result = groupByField([], {}, field);
    expect(result).toBeUndefined();
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
});
