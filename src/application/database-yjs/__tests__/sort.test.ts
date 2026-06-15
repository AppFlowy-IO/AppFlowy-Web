import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { sortBy } from '@/application/database-yjs/sort';
import { CalculationType, FieldType, RollupDisplayMode, SortCondition } from '@/application/database-yjs/database.type';
import { Row } from '@/application/database-yjs/selector';
import {
  RowId,
  YDatabaseField,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import {
  createCell,
  createField,
  createFieldWithTypeOption,
  createRelationRollupFixtureFromV069,
  createRowDoc,
  resolveRelationText,
  resolveRollupValue,
} from './test-helpers';

function createSorts(configs: { fieldId: string; condition: SortCondition }[]): YDatabaseSorts {
  const sorts = configs.map((config, index) => {
    const doc = new Y.Doc();
    const sort = doc.getMap(`sort-${index}`) as YDatabaseSort;

    sort.set(YjsDatabaseKey.id, `sort-${index}`);
    sort.set(YjsDatabaseKey.field_id, config.fieldId);
    sort.set(YjsDatabaseKey.condition, config.condition);

    return sort;
  });

  return {
    toArray: () => sorts,
  } as YDatabaseSorts;
}

describe('text sort tests', () => {
  const databaseId = 'db-sort-text';
  const fieldId = 'text-field';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(fieldId, createField(fieldId, FieldType.RichText));

  it('sorts text field ascending', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'Banana'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'Apple'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.RichText, ''),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a', 'row-c']);
  });

  it('sorts text field descending', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'Banana'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'Apple'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.RichText, ''),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Descending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a', 'row-b', 'row-c']);
  });

  it('sorts text field case insensitive', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'alpha'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'Alpha'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'beta'),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Descending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-c', 'row-a', 'row-b']);
  });

  it('places empty values at end for ascending', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, ''),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'Alpha'),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a']);
  });

  it('places empty values at end for descending', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.RichText, ''),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.RichText, 'Alpha'),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Descending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a']);
  });
});

describe('number sort tests', () => {
  const databaseId = 'db-sort-number';
  const fieldId = 'number-field';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(fieldId, createField(fieldId, FieldType.Number));

  it('sorts number field ascending', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c', 'row-d'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.Number, '10'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.Number, '-5'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.Number, '1.2'),
      }),
      'row-d': createRowDoc('row-d', databaseId, {
        [fieldId]: createCell(FieldType.Number, ''),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-c', 'row-a', 'row-d']);
  });

  it('sorts number field descending', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c', 'row-d'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.Number, '10'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.Number, '-5'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.Number, '1.2'),
      }),
      'row-d': createRowDoc('row-d', databaseId, {
        [fieldId]: createCell(FieldType.Number, ''),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Descending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a', 'row-c', 'row-b', 'row-d']);
  });

  it('handles negative numbers', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.Number, '-1'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.Number, '1'),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a', 'row-b']);
  });

  it('handles decimal numbers', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.Number, '1.5'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.Number, '1.05'),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a']);
  });

  it('places empty values at end', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.Number, ''),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.Number, '2'),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a']);
  });
});

describe('checkbox sort tests', () => {
  const databaseId = 'db-sort-checkbox';
  const fieldId = 'checkbox-field';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(fieldId, createField(fieldId, FieldType.Checkbox));

  it('sorts checkbox ascending (unchecked first)', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'No'),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a']);
  });

  it('sorts checkbox descending (checked first)', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'Yes'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.Checkbox, 'No'),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Descending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a', 'row-b']);
  });
});

describe('date sort tests', () => {
  const databaseId = 'db-sort-date';
  const fieldId = 'date-field';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(fieldId, createField(fieldId, FieldType.DateTime));

  it('sorts date field ascending', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.DateTime, '100'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.DateTime, '50'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.DateTime, ''),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a', 'row-c']);
  });

  it('sorts date field descending', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.DateTime, '100'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.DateTime, '50'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.DateTime, ''),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Descending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a', 'row-b', 'row-c']);
  });

  it('handles empty date values', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.DateTime, ''),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.DateTime, '10'),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a']);
  });
});

describe('select option sort tests', () => {
  const databaseId = 'db-sort-select';
  const singleFieldId = 'single-select';
  const multiFieldId = 'multi-select';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(
    singleFieldId,
    createField(singleFieldId, FieldType.SingleSelect, {
      options: [
        { id: 'opt-a', name: 'Alpha', color: 0 },
        { id: 'opt-b', name: 'Beta', color: 0 },
      ],
      disable_color: false,
    })
  );
  fields.set(
    multiFieldId,
    createField(multiFieldId, FieldType.MultiSelect, {
      options: [
        { id: 'opt-a', name: 'Alpha', color: 0 },
        { id: 'opt-b', name: 'Beta', color: 0 },
      ],
      disable_color: false,
    })
  );

  it('sorts single select by option order', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [singleFieldId]: createCell(FieldType.SingleSelect, 'opt-b'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [singleFieldId]: createCell(FieldType.SingleSelect, 'opt-a'),
      }),
    };

    const sorts = createSorts([{ fieldId: singleFieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a']);
  });

  it('sorts multi-select by first option', () => {
    const rows: Row[] = ['row-a', 'row-b'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [multiFieldId]: createCell(FieldType.MultiSelect, 'opt-b,opt-a'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [multiFieldId]: createCell(FieldType.MultiSelect, 'opt-a'),
      }),
    };

    const sorts = createSorts([{ fieldId: multiFieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a']);
  });
});

describe('checklist sort tests', () => {
  const databaseId = 'db-sort-checklist';
  const fieldId = 'checklist-field';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(fieldId, createField(fieldId, FieldType.Checklist));

  const complete = JSON.stringify({
    options: [{ id: '1', name: 'Task', color: 0 }],
    selected_option_ids: ['1'],
  });
  const partial = JSON.stringify({
    options: [
      { id: '1', name: 'Task', color: 0 },
      { id: '2', name: 'Other', color: 0 },
    ],
    selected_option_ids: ['1'],
  });

  it('sorts checklist by completion percentage ascending', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.Checklist, ''),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.Checklist, partial),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.Checklist, complete),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a', 'row-b', 'row-c']);
  });

  it('sorts checklist by completion percentage descending', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [fieldId]: createCell(FieldType.Checklist, ''),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [fieldId]: createCell(FieldType.Checklist, partial),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [fieldId]: createCell(FieldType.Checklist, complete),
      }),
    };

    const sorts = createSorts([{ fieldId, condition: SortCondition.Descending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-c', 'row-b', 'row-a']);
  });
});

describe('multi-sort tests', () => {
  const databaseId = 'db-sort-multi';
  const textFieldId = 'text-field';
  const numberFieldId = 'number-field';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(textFieldId, createField(textFieldId, FieldType.RichText));
  fields.set(numberFieldId, createField(numberFieldId, FieldType.Number));

  it('sorts by primary field then secondary field', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Alpha'),
        [numberFieldId]: createCell(FieldType.Number, '2'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Alpha'),
        [numberFieldId]: createCell(FieldType.Number, '1'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Beta'),
        [numberFieldId]: createCell(FieldType.Number, '0'),
      }),
    };

    const sorts = createSorts([
      { fieldId: textFieldId, condition: SortCondition.Ascending },
      { fieldId: numberFieldId, condition: SortCondition.Ascending },
    ]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a', 'row-c']);
  });

  it('sorts by three fields with ties', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Alpha'),
        [numberFieldId]: createCell(FieldType.Number, '1'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Alpha'),
        [numberFieldId]: createCell(FieldType.Number, '1'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Beta'),
        [numberFieldId]: createCell(FieldType.Number, '1'),
      }),
    };

    const sorts = createSorts([
      { fieldId: textFieldId, condition: SortCondition.Ascending },
      { fieldId: numberFieldId, condition: SortCondition.Ascending },
    ]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a', 'row-b', 'row-c']);
  });

  it('handles nulls in multi-sort', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Alpha'),
        [numberFieldId]: createCell(FieldType.Number, ''),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Alpha'),
        [numberFieldId]: createCell(FieldType.Number, '2'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Beta'),
        [numberFieldId]: createCell(FieldType.Number, '1'),
      }),
    };

    const sorts = createSorts([
      { fieldId: textFieldId, condition: SortCondition.Ascending },
      { fieldId: numberFieldId, condition: SortCondition.Ascending },
    ]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-b', 'row-a', 'row-c']);
  });

  it('multi-sort is deterministic', () => {
    const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = {
      'row-a': createRowDoc('row-a', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Gamma'),
        [numberFieldId]: createCell(FieldType.Number, '1'),
      }),
      'row-b': createRowDoc('row-b', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Gamma'),
        [numberFieldId]: createCell(FieldType.Number, '1'),
      }),
      'row-c': createRowDoc('row-c', databaseId, {
        [textFieldId]: createCell(FieldType.RichText, 'Gamma'),
        [numberFieldId]: createCell(FieldType.Number, '1'),
      }),
    };

    const sorts = createSorts([
      { fieldId: textFieldId, condition: SortCondition.Ascending },
      { fieldId: numberFieldId, condition: SortCondition.Ascending },
    ]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);
    expect(result).toEqual(['row-a', 'row-b', 'row-c']);
  });
});

describe('unicode sort tests', () => {
  const databaseId = 'db-sort-unicode';
  const fieldId = 'text-field';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(fieldId, createField(fieldId, FieldType.RichText));

  it('sorts unicode characters correctly', () => {
    const values: Record<RowId, string> = {
      'row-a': 'Älpha',
      'row-b': 'alpha',
      'row-c': 'Éclair',
      'row-d': '日本',
    };
    const rows: Row[] = Object.keys(values).map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = Object.fromEntries(
      Object.entries(values).map(([rowId, value]) => [
        rowId,
        createRowDoc(rowId, databaseId, {
          [fieldId]: createCell(FieldType.RichText, value),
        }),
      ])
    );

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);

    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true, usage: 'sort' });
    const expected = [...rows]
      .sort((a, b) => collator.compare(values[a.id], values[b.id]))
      .map((row) => row.id);

    expect(result).toEqual(expected);
  });

  it('sorts mixed ascii and unicode', () => {
    const values: Record<RowId, string> = {
      'row-a': 'Zebra',
      'row-b': 'alpha',
      'row-c': 'βeta',
      'row-d': '😀',
    };
    const rows: Row[] = Object.keys(values).map((id) => ({ id, height: 0 }));
    const rowMetas: Record<RowId, YDoc> = Object.fromEntries(
      Object.entries(values).map(([rowId, value]) => [
        rowId,
        createRowDoc(rowId, databaseId, {
          [fieldId]: createCell(FieldType.RichText, value),
        }),
      ])
    );

    const sorts = createSorts([{ fieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas).map((row) => row.id);

    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true, usage: 'sort' });
    const expected = [...rows]
      .sort((a, b) => collator.compare(values[a.id], values[b.id]))
      .map((row) => row.id);

    expect(result).toEqual(expected);
  });
});

describe('relation and rollup sort tests', () => {
  const databaseId = 'db-sort-relation';
  const relationFieldId = 'relation-field';
  const rollupTextFieldId = 'rollup-text-field';
  const rollupNumericFieldId = 'rollup-numeric-field';
  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(relationFieldId, createField(relationFieldId, FieldType.Relation));
  fields.set(
    rollupTextFieldId,
    createFieldWithTypeOption(rollupTextFieldId, FieldType.Rollup, {
      [YjsDatabaseKey.show_as]: RollupDisplayMode.OriginalList,
      [YjsDatabaseKey.calculation_type]: CalculationType.Count,
    })
  );
  fields.set(
    rollupNumericFieldId,
    createFieldWithTypeOption(rollupNumericFieldId, FieldType.Rollup, {
      [YjsDatabaseKey.show_as]: RollupDisplayMode.Calculated,
      [YjsDatabaseKey.calculation_type]: CalculationType.Sum,
    })
  );

  const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
  const rowMetas: Record<RowId, YDoc> = {
    'row-a': createRowDoc('row-a', databaseId, {
      [relationFieldId]: createCell(FieldType.Relation, ''),
    }),
    'row-b': createRowDoc('row-b', databaseId, {
      [relationFieldId]: createCell(FieldType.Relation, ''),
    }),
    'row-c': createRowDoc('row-c', databaseId, {
      [relationFieldId]: createCell(FieldType.Relation, ''),
    }),
  };

  const relationTexts: Record<RowId, string> = {
    'row-a': 'Beta',
    'row-b': 'Alpha',
    'row-c': '',
  };

  const rollupTextValues: Record<RowId, { value: string }> = {
    'row-a': { value: 'Gamma' },
    'row-b': { value: 'Alpha' },
    'row-c': { value: '' },
  };

  const rollupNumericValues: Record<RowId, { value: string; rawNumeric?: number }> = {
    'row-a': { value: '10', rawNumeric: 10 },
    'row-b': { value: '2', rawNumeric: 2 },
    'row-c': { value: '', rawNumeric: undefined },
  };

  it('sorts relation field by linked row text', () => {
    const sorts = createSorts([{ fieldId: relationFieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas, {
      getRelationCellText: (rowId) => relationTexts[rowId] ?? '',
    }).map((row) => row.id);

    expect(result).toEqual(['row-b', 'row-a', 'row-c']);
  });

  it('ignores list-output rollup field in sorting', () => {
    const sorts = createSorts([{ fieldId: rollupTextFieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas, {
      getRollupCellValue: (rowId) => rollupTextValues[rowId] ?? { value: '' },
    }).map((row) => row.id);

    expect(result).toEqual(['row-a', 'row-b', 'row-c']);
  });

  it('sorts numeric rollup field', () => {
    const sorts = createSorts([{ fieldId: rollupNumericFieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(rows, sorts, fields, rowMetas, {
      getRollupCellValue: (rowId) => rollupNumericValues[rowId] ?? { value: '' },
    }).map((row) => row.id);

    expect(result).toEqual(['row-b', 'row-a', 'row-c']);
  });
});

describe('relation and rollup sort tests (v069)', () => {
  const fixture = createRelationRollupFixtureFromV069({ suffix: 'sort' });
  const relationField = fixture.baseDatabase
    .get(YjsDatabaseKey.fields)
    ?.get(fixture.relationFieldId) as YDatabaseField;
  const rollupField = fixture.baseDatabase
    .get(YjsDatabaseKey.fields)
    ?.get(fixture.rollupSumFieldId) as YDatabaseField;

  let relationTexts: Record<RowId, string>;
  let rollupValues: Record<RowId, { value: string; rawNumeric?: number }>;

  beforeAll(async () => {
    relationTexts = {};
    rollupValues = {};
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
      rollupValues[rowId] = await resolveRollupValue({
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row,
        rowId,
        fieldId: fixture.rollupSumFieldId,
        loadView: fixture.loadView,
        createRow: fixture.createRow,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      });
    }
  });

  it('sorts relation field by related names from v069', () => {
    const sorts = createSorts([{ fieldId: fixture.relationFieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(fixture.baseRows, sorts, fixture.baseFields, fixture.baseRowMetas, {
      getRelationCellText: (rowId) => relationTexts[rowId] ?? '',
    }).map((row) => row.id);

    expect(result).toEqual([fixture.baseRowIds[1], fixture.baseRowIds[0], fixture.baseRowIds[2]]);
  });

  it('sorts numeric rollup sum from v069', () => {
    const sorts = createSorts([{ fieldId: fixture.rollupSumFieldId, condition: SortCondition.Ascending }]);
    const result = sortBy(fixture.baseRows, sorts, fixture.baseFields, fixture.baseRowMetas, {
      getRollupCellValue: (rowId) => rollupValues[rowId] ?? { value: '' },
    }).map((row) => row.id);

    expect(rollupValues[fixture.baseRowIds[0]].rawNumeric).toBe(77700);
    expect(rollupValues[fixture.baseRowIds[1]].rawNumeric).toBe(1294400);
    expect(result).toEqual([fixture.baseRowIds[0], fixture.baseRowIds[1], fixture.baseRowIds[2]]);
  });
});
