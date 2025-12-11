import { FieldType, SortCondition } from '@/application/database-yjs/database.type';
import { decodeCellForSort } from '@/application/database-yjs/decode';
import { Row } from '@/application/database-yjs/selector';
import {
  RowId,
  YDatabaseFields,
  YDatabaseRow,
  YDatabaseSorts,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

type SortableValue = string | number | object | boolean | undefined;

export function sortBy(rows: Row[], sorts: YDatabaseSorts, fields: YDatabaseFields, rowMetas: Record<RowId, YDoc>) {
  const sortArray = sorts.toArray();

  if (sortArray.length === 0 || Object.keys(rowMetas).length === 0 || fields.size === 0) return rows;

  // Define collator for Unicode string comparison
  // Can adjust parameters based on application needs, such as locale, sensitivity, etc.
  const collator = new Intl.Collator('en', {
    sensitivity: 'variant',
    numeric: true, // Use numeric sorting, such as "2" before "10"
    usage: 'sort', // Used specifically for sorting
  });

  // Create a function for comparison
  const compare = (a: SortableValue, b: SortableValue, order: string): number => {
    if (a === undefined && b === undefined) return 0;
    // undefined value is placed at the end
    if (a === undefined) return order === 'asc' ? 1 : -1;
    if (b === undefined) return order === 'asc' ? -1 : 1;

    // Handle strings
    if (typeof a === 'string' && typeof b === 'string') {
      return order === 'asc' ? collator.compare(a, b) : collator.compare(b, a);
    }

    // Handle other types
    if (order === 'asc') {
      return a < b ? -1 : a > b ? 1 : 0;
    } else {
      return a > b ? -1 : a < b ? 1 : 0;
    }
  };

  // Prepare sort data, pre-calculate all values to avoid multiple calculations
  const sortData = rows.map((row) => {
    const values = sortArray.map((sort) => {
      const fieldId = sort.get(YjsDatabaseKey.field_id);

      if (!fieldId) return '';

      const field = fields.get(fieldId);
      const fieldType = Number(field.get(YjsDatabaseKey.type));

      const rowId = row.id;
      const rowMeta = rowMetas[rowId];
      const meta = rowMeta?.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

      const defaultData = defaultValueForSort(fieldType, Number(sort.get(YjsDatabaseKey.condition)));

      if (!meta) return defaultData;

      if (fieldType === FieldType.LastEditedTime) {
        return meta.get(YjsDatabaseKey.last_modified);
      }

      if (fieldType === FieldType.CreatedTime) {
        return meta.get(YjsDatabaseKey.created_at);
      }

      const cells = meta.get(YjsDatabaseKey.cells);
      const cell = cells.get(fieldId);

      if (!cell) return defaultData;
      const decoded = decodeCellForSort(cell, field);

      if (decoded === undefined || decoded === null || decoded === '') {
        return defaultData;
      }

      return decoded;
    });

    return { row, values };
  });

  sortData.sort((a, b) => {
    for (let i = 0; i < sortArray.length; i++) {
      const order = Number(sortArray[i].get(YjsDatabaseKey.condition)) === SortCondition.Descending ? 'desc' : 'asc';
      const result = compare(a.values[i], b.values[i], order);

      if (result !== 0) return result;
    }

    return 0;
  });

  return sortData.map((item) => item.row);
}

export function defaultValueForSort(fieldType: FieldType, condition: SortCondition) {
  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
    case FieldType.SingleSelect:
    case FieldType.MultiSelect:
      return condition === SortCondition.Descending ? '\u0000' : '\uFFFF';
    case FieldType.Number:
    case FieldType.Checklist:
    case FieldType.DateTime:
      return condition === SortCondition.Descending ? -Infinity : Infinity;
    case FieldType.Checkbox:
      return false;
    default:
      return condition === SortCondition.Descending ? '\u0000' : '\uFFFF';
  }
}
