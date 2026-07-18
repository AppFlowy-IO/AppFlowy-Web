import { getCellFieldTypeContext } from '@/application/database-yjs/cell.field-type';
import { isCellDataTransformable, parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { DateTimeCell } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  parseChecklistFlexible,
  parseSelectOptionTypeOptions,
  stringifyChecklist,
} from '@/application/database-yjs/fields';
import { getDateCellStr } from '@/application/database-yjs/fields/date/utils';
import { parseTimeStringToMs, parseCheckboxValue } from '@/application/database-yjs/fields/text/utils';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { User, YDatabaseCell, YDatabaseField } from '@/application/types';

/**
 * Decode a cell to a string representation for rendering/filtering/sorting,
 * using the cell's recorded source type when it differs from the field's current type.
 */
export function decodeCellToText(cell: YDatabaseCell, field: YDatabaseField, currentUser?: User): string {
  const { storedType, targetType } = getCellFieldTypeContext(cell, field);

  if (storedType !== targetType && !isCellDataTransformable(storedType, targetType)) return '';

  const parsedCell = parseYDatabaseCellToCell(cell, field);
  const data = parsedCell.data;

  switch (targetType) {
    case FieldType.Checkbox:
      if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        return parseCheckboxValue(data) ? 'Yes' : 'No';
      }

      return 'No';

    case FieldType.Time: {
      if (typeof data === 'number') return String(data);
      if (typeof data === 'string') return parseTimeStringToMs(data) ?? '';
      return '';
    }

    case FieldType.URL:
      return typeof data === 'string' || typeof data === 'number' ? String(data).trim() : '';

    case FieldType.Checklist: {
      if (typeof data !== 'string') return '';
      const parsed = parseChecklistFlexible(data);

      if (!parsed) return '';
      return stringifyChecklist(parsed.options || [], parsed.selectedOptionIds || []);
    }

    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      if (typeof data !== 'string') return '';
      const options = parseSelectOptionTypeOptions(field)?.options || [];

      return data
        .split(',')
        .map((id) => options.find((opt) => opt.id === id || opt.name === id)?.name)
        .filter(Boolean)
        .join(',');
    }

    case FieldType.DateTime: {
      return getDateCellStr({ cell: parsedCell as DateTimeCell, field, currentUser });
    }

    case FieldType.Relation:
      return getRelationRowIdsFromCell(cell).join(',');

    default:
      return typeof data === 'string' || typeof data === 'number' ? String(data) : '';
  }
}

/**
 * Decode to a sortable primitive. Falls back to text decode when no specialized handling.
 */
export function decodeCellForSort(
  cell: YDatabaseCell,
  field: YDatabaseField,
  currentUser?: User
): string | number | boolean {
  const { storedType, targetType } = getCellFieldTypeContext(cell, field);

  if (storedType !== targetType && !isCellDataTransformable(storedType, targetType)) return '';

  const data = parseYDatabaseCellToCell(cell, field).data;

  switch (targetType) {
    case FieldType.Relation:
      return getRelationRowIdsFromCell(cell).join(',');

    case FieldType.Checkbox:
      if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
        return parseCheckboxValue(data);
      }

      return false;
    case FieldType.Number:
      if (typeof data === 'number') return data;
      if (typeof data === 'string' && data.trim() !== '' && !Number.isNaN(Number(data))) {
        return Number(data);
      }

      return '';
    case FieldType.DateTime:
      if (typeof data === 'number') return data;
      if (typeof data === 'string' && data.trim() !== '' && !Number.isNaN(Number(data))) {
        return Number(data);
      }

      return '';
    case FieldType.Checklist: {
      if (typeof data !== 'string') return 0;
      const parsed = parseChecklistFlexible(data);

      return parsed?.percentage ?? 0;
    }

    case FieldType.SingleSelect:
    case FieldType.MultiSelect: {
      if (typeof data !== 'string') return '';
      const options = parseSelectOptionTypeOptions(field)?.options || [];

      return data
        .split(',')
        .map((id) => options.find((opt) => opt.id === id || opt.name === id)?.name)
        .filter(Boolean)
        .join(',');
    }

    default:
      return decodeCellToText(cell, field, currentUser);
  }
}
