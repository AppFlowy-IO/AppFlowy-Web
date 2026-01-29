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

describe('rows without loaded metas (board loading scenario)', () => {
  const databaseId = 'db-loading-test';

  it('checkbox: puts unloaded rows in No group', () => {
    const fieldId = 'checkbox-field';
    const field = createField(fieldId, FieldType.Checkbox);

    const rows: Row[] = [
      { id: 'row-loaded', height: 0 },
      { id: 'row-unloaded-1', height: 0 },
      { id: 'row-unloaded-2', height: 0 },
    ];

    // Only row-loaded has meta
    const rowMetas: Record<RowId, YDoc> = {
      'row-loaded': createRowDoc('row-loaded', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
      }),
    };

    const result = groupByCheckbox(rows, rowMetas, field);

    // Loaded row with Yes goes to Yes group
    expect(result?.get('Yes')?.map((r) => r.id)).toEqual(['row-loaded']);

    // Unloaded rows default to No group
    expect(result?.get('No')?.map((r) => r.id)).toEqual(['row-unloaded-1', 'row-unloaded-2']);
  });

  it('select option: puts unloaded rows in No Status group', () => {
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

    // Only row-loaded has meta
    const rowMetas: Record<RowId, YDoc> = {
      'row-loaded': createRowDoc('row-loaded', databaseId, {
        [fieldId]: createCell(FieldType.SingleSelect, 'opt-a'),
      }),
    };

    const result = groupBySelectOption(rows, rowMetas, field);

    // Loaded row goes to its option group
    expect(result?.get('opt-a')?.map((r) => r.id)).toEqual(['row-loaded']);

    // Unloaded rows default to No Status group (fieldId)
    expect(result?.get(fieldId)?.map((r) => r.id)).toEqual(['row-unloaded-1', 'row-unloaded-2']);
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

    // All groups should exist
    expect(result?.has(fieldId)).toBe(true); // No Status
    expect(result?.has('opt-a')).toBe(true);
    expect(result?.has('opt-b')).toBe(true);

    // opt-b should be empty but exist
    expect(result?.get('opt-b')).toEqual([]);
  });

  it('handles all rows unloaded', () => {
    const fieldId = 'checkbox-field';
    const field = createField(fieldId, FieldType.Checkbox);

    const rows: Row[] = [
      { id: 'row-1', height: 0 },
      { id: 'row-2', height: 0 },
    ];

    // No metas loaded
    const rowMetas: Record<RowId, YDoc> = {};

    const result = groupByCheckbox(rows, rowMetas, field);

    // All rows should be in No group
    expect(result?.get('Yes')).toEqual([]);
    expect(result?.get('No')?.map((r) => r.id)).toEqual(['row-1', 'row-2']);
  });

  it('handles empty rows array', () => {
    const fieldId = 'checkbox-field';
    const field = createField(fieldId, FieldType.Checkbox);

    const result = groupByCheckbox([], {}, field);

    expect(result?.get('Yes')).toEqual([]);
    expect(result?.get('No')).toEqual([]);
  });

  it('progressively updates groups as metas load', () => {
    const fieldId = 'checkbox-field';
    const field = createField(fieldId, FieldType.Checkbox);

    const rows: Row[] = [
      { id: 'row-1', height: 0 },
      { id: 'row-2', height: 0 },
      { id: 'row-3', height: 0 },
    ];

    // Simulate progressive loading: first no metas
    let rowMetas: Record<RowId, YDoc> = {};
    let result = groupByCheckbox(rows, rowMetas, field);

    expect(result?.get('Yes')).toEqual([]);
    expect(result?.get('No')?.length).toBe(3);

    // Then row-1 meta loads with Yes
    rowMetas = {
      'row-1': createRowDoc('row-1', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
      }),
    };
    result = groupByCheckbox(rows, rowMetas, field);

    expect(result?.get('Yes')?.map((r) => r.id)).toEqual(['row-1']);
    expect(result?.get('No')?.length).toBe(2);

    // Then all metas load
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
  });
});
