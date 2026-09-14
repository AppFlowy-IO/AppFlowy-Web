import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { DateTimeCell, FileMediaCellData } from '@/application/database-yjs/cell.type';
import { FieldType } from '@/application/database-yjs/database.type';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { parseChecklistFlexible } from '@/application/database-yjs/fields/checklist/parse';
import { parsePersonCellData } from '@/application/database-yjs/fields/person/parse';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { YDatabaseCell, YDatabaseRow, YjsDatabaseKey } from '@/application/types';

import { FormulaFieldSchema } from './schema';
import { bool, date, EMPTY, FormulaType, FormulaValue, list, listOf, num, text } from './values';

/**
 * Static formula type of a `prop()` reference to a field of this type.
 * Formula fields are resolved by the compiler (their type is their result).
 */
export function formulaTypeOfFieldType(fieldType: FieldType): FormulaType {
  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
    case FieldType.SingleSelect:
    case FieldType.Summary:
    case FieldType.Translate:
      return 'text';
    case FieldType.Number:
    case FieldType.Checklist:
    case FieldType.Time:
      return 'number';
    case FieldType.Checkbox:
      return 'boolean';
    case FieldType.DateTime:
    case FieldType.CreatedTime:
    case FieldType.LastEditedTime:
      return 'date';
    case FieldType.MultiSelect:
    case FieldType.Person:
    case FieldType.CreatedBy:
    case FieldType.LastEditedBy:
    case FieldType.Relation:
    case FieldType.Media:
      return listOf('text');
    default:
      return 'any';
  }
}

function toMilliseconds(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);

  if (!Number.isFinite(value)) return null;
  // AppFlowy stores unix seconds; tolerate millisecond payloads from imports.
  return value > 1e12 ? value : value * 1000;
}

function dateCellToValue(cell: DateTimeCell | undefined): FormulaValue {
  const start = toMilliseconds(cell?.data);

  if (start === null) return EMPTY;
  const end = cell?.isRange ? toMilliseconds(cell.endTimestamp) : null;

  return date({ start, end: end === null ? undefined : end, includeTime: Boolean(cell?.includeTime) });
}

function selectOptionNames(entry: FormulaFieldSchema, data: unknown): string[] {
  if (typeof data !== 'string' || data === '') return [];
  const options = parseSelectOptionTypeOptions(entry.field)?.options ?? [];

  return data
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => options.find((option) => option.id === id || option.name === id)?.name ?? id);
}

export interface ReadFieldValueContext {
  /** Display name for a workspace member id, when a resolver is available. */
  getUserName?: (uid: string) => string | undefined;
}

/**
 * Converts a row's cell for `entry` into a formula value. Formula fields are
 * handled by the evaluator (recursively); they fall through to `EMPTY` here.
 */
export function readFieldFormulaValue(
  entry: FormulaFieldSchema,
  row: YDatabaseRow,
  context: ReadFieldValueContext = {}
): FormulaValue {
  const cell: YDatabaseCell | undefined = row.get(YjsDatabaseKey.cells)?.get(entry.id);

  switch (entry.type) {
    case FieldType.CreatedTime: {
      const start = toMilliseconds(row.get(YjsDatabaseKey.created_at));

      return start === null ? EMPTY : date({ start, includeTime: true });
    }

    case FieldType.LastEditedTime: {
      const start = toMilliseconds(row.get(YjsDatabaseKey.last_modified));

      return start === null ? EMPTY : date({ start, includeTime: true });
    }

    case FieldType.CreatedBy:
    case FieldType.LastEditedBy: {
      const raw = row.get(entry.type === FieldType.CreatedBy ? YjsDatabaseKey.created_by : YjsDatabaseKey.last_edited_by);
      const uid = raw === undefined || raw === null || raw === '' ? null : String(raw);

      if (uid === null) return list([]);
      return list([text(context.getUserName?.(uid) ?? uid)]);
    }

    default:
      break;
  }

  if (!cell) {
    return entry.type === FieldType.MultiSelect ||
      entry.type === FieldType.Person ||
      entry.type === FieldType.Relation ||
      entry.type === FieldType.Media
      ? list([])
      : EMPTY;
  }

  const parsed = parseYDatabaseCellToCell(cell, entry.field);
  const data = parsed.data;

  switch (entry.type) {
    case FieldType.RichText:
    case FieldType.URL:
    case FieldType.Summary:
    case FieldType.Translate:
      return text(typeof data === 'string' || typeof data === 'number' ? String(data) : '');

    case FieldType.Number:
    case FieldType.Time: {
      if (data === undefined || data === null || data === '') return EMPTY;
      const value = Number(data);

      return Number.isFinite(value) ? num(value) : EMPTY;
    }

    case FieldType.Checkbox:
      return bool(typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean' ? getChecked(data) : false);

    case FieldType.DateTime:
      return dateCellToValue(parsed as DateTimeCell);

    case FieldType.SingleSelect: {
      const [name] = selectOptionNames(entry, data);

      return name === undefined ? EMPTY : text(name);
    }

    case FieldType.MultiSelect:
      return list(selectOptionNames(entry, data).map((name) => text(name)));

    case FieldType.Checklist: {
      if (typeof data !== 'string' || data === '') return EMPTY;
      const checklist = parseChecklistFlexible(data);

      if (!checklist) return EMPTY;
      return num(Math.round(checklist.percentage * 100));
    }

    case FieldType.Person: {
      const people = typeof data === 'string' ? parsePersonCellData(entry.field, data) : null;

      return list((people?.users ?? []).map((user) => text(context.getUserName?.(user.id) ?? user.name ?? user.id)));
    }

    case FieldType.Relation:
      return list(getRelationRowIdsFromCell(cell).map((id) => text(id)));

    case FieldType.Media: {
      const items = Array.isArray(data) ? (data as FileMediaCellData) : [];

      return list(items.map((item) => text(item.name ?? '')));
    }

    default:
      return EMPTY;
  }
}
