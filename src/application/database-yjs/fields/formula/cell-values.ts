import { parseYDatabaseCellToCell } from '@/application/database-yjs/cell.parse';
import { DateTimeCell, FileMediaCellData } from '@/application/database-yjs/cell.type';
import { FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { parseChecklistFlexible } from '@/application/database-yjs/fields/checklist/parse';
import { parsePersonTypeOptions } from '@/application/database-yjs/fields/person/parse';
import { parseRollupTypeOption } from '@/application/database-yjs/fields/rollup/parse';
import { parseRollupPersonIds } from '@/application/database-yjs/fields/rollup/person';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import { parseTimeStringToMs } from '@/application/database-yjs/fields/text/utils';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import type { RollupCellValue } from '@/application/database-yjs/rollup/cache';
import { isNumericRollupField } from '@/application/database-yjs/rollup/utils';
import { YDatabaseCell, YDatabaseField, YDatabaseRow, YjsDatabaseKey } from '@/application/types';

import { FormulaFieldSchema } from './schema';
import { bool, date, EMPTY, FormulaType, FormulaValue, list, listOf, num, text } from './values';

/**
 * Static formula type of a `prop()` reference to a field of this type.
 * Formula fields are resolved by the compiler (their type is their result);
 * a Rollup's type depends on its settings, see `formulaTypeOfField`.
 */
export function formulaTypeOfFieldType(fieldType: FieldType): FormulaType {
  switch (fieldType) {
    case FieldType.RichText:
    case FieldType.URL:
    case FieldType.SingleSelect:
    case FieldType.Summary:
    case FieldType.Translate:
    case FieldType.Rollup:
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

/** How a Rollup reads in a formula: its number, its text, or its list of values. */
function rollupFormulaType(field: YDatabaseField): FormulaType {
  if (isNumericRollupField(field)) return 'number';
  const showAs = Number(parseRollupTypeOption(field)?.show_as ?? RollupDisplayMode.Calculated);

  return showAs === RollupDisplayMode.OriginalList || showAs === RollupDisplayMode.UniqueList ? listOf('text') : 'text';
}

/** Static formula type of a `prop()` reference to this field. */
export function formulaTypeOfField(entry: Pick<FormulaFieldSchema, 'type' | 'field'>): FormulaType {
  return entry.type === FieldType.Rollup ? rollupFormulaType(entry.field) : formulaTypeOfFieldType(entry.type);
}

function toMilliseconds(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);

  if (!Number.isFinite(value)) return null;
  // AppFlowy stores unix seconds; tolerate millisecond payloads from imports.
  return Math.abs(value) > 1e12 ? value : value * 1000;
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

/** Values that live outside the row document; each resolver is optional. */
export interface ReadFieldValueContext {
  /** Display name of a workspace member by numeric uid (Created by / Last edited by). */
  getUserName?: (uid: string) => string | undefined;
  /** Display name of a workspace member by person id (Person cells). */
  getPersonName?: (personId: string) => string | undefined;
  /** Title of a related row; null means deleted, undefined means not loaded yet. */
  getRelatedRowTitle?: (relationField: YDatabaseField, relatedRowId: string) => string | null | undefined;
  /** Computed value of this row's cell for a Rollup field; undefined while it is not computed. */
  getRollupValue?: (rollupFieldId: string) => RollupCellValue | undefined;
}

/** Form responses store this id for an anonymous respondent. */
const ANONYMOUS_PERSON_ID = '00000000-0000-0000-0000-000000000000';

function personIds(data: unknown): string[] {
  if (typeof data !== 'string' || data === '') return [];
  try {
    const parsed = JSON.parse(data) as unknown;

    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rollupValue(
  entry: FormulaFieldSchema,
  value: RollupCellValue | undefined,
  context: ReadFieldValueContext
): FormulaValue {
  const type = rollupFormulaType(entry.field);

  if (typeof type !== 'string') {
    const items = (value?.list ?? []).filter((item) => item !== '');

    if (value?.targetFieldType === FieldType.Person) {
      const recorded = value.targetField ? parsePersonTypeOptions(value.targetField).persons : [];

      return list(
        items
          .flatMap(parseRollupPersonIds)
          .map((id) =>
            text(
              id === ANONYMOUS_PERSON_ID
                ? 'Anonymous'
                : context.getPersonName?.(id) || recorded.find((person) => person.id === id)?.name || id
            )
          )
      );
    }

    if (value?.targetFieldType === FieldType.CreatedBy || value?.targetFieldType === FieldType.LastEditedBy) {
      return list(items.flatMap(parseRollupPersonIds).map((uid) => text(context.getUserName?.(uid) || uid)));
    }

    return list(items.map((item) => text(item)));
  }

  if (type === 'number') {
    const raw = value?.rawNumeric;

    return raw !== undefined && Number.isFinite(raw) ? num(raw) : EMPTY;
  }

  return value?.value ? text(value.value) : EMPTY;
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

      return start === null || start <= 0 ? EMPTY : date({ start, includeTime: true });
    }

    case FieldType.LastEditedTime: {
      const start = toMilliseconds(row.get(YjsDatabaseKey.last_modified));

      return start === null || start <= 0 ? EMPTY : date({ start, includeTime: true });
    }

    case FieldType.CreatedBy:
    case FieldType.LastEditedBy: {
      const raw = row.get(
        entry.type === FieldType.CreatedBy ? YjsDatabaseKey.created_by : YjsDatabaseKey.last_edited_by
      );
      const uid = raw === undefined || raw === null || raw === '' ? null : String(raw);

      if (uid === null) return list([]);
      // Same fallback as the cell while the member list loads.
      return list([text(context.getUserName?.(uid) || `User ${uid}`)]);
    }

    case FieldType.Rollup:
      // Rollups are computed from related rows; they have no stored cell.
      return rollupValue(entry, context.getRollupValue?.(entry.id), context);

    default:
      break;
  }

  if (!cell) {
    // An untouched checkbox is unchecked, as the cell shows it.
    if (entry.type === FieldType.Checkbox) return bool(false);
    // Keep blank text typed, so addition concatenates just as it does for a
    // stored empty string (including through variables and other formulas).
    if (formulaTypeOfField(entry) === 'text') return text('');
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

    case FieldType.Number: {
      if (data === undefined || data === null || data === '') return EMPTY;
      const value = Number(data);

      return Number.isFinite(value) ? num(value) : EMPTY;
    }

    case FieldType.Time: {
      // Milliseconds; typed text such as "1h30m" or "08:30" reads as the cell shows it.
      const ms =
        typeof data === 'number' ? data : typeof data === 'string' ? Number(parseTimeStringToMs(data) || NaN) : NaN;

      return Number.isFinite(ms) ? num(ms) : EMPTY;
    }

    case FieldType.Checkbox:
      return bool(
        typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean' ? getChecked(data) : false
      );

    case FieldType.DateTime:
      return dateCellToValue(parsed as DateTimeCell);

    case FieldType.SingleSelect: {
      const [name] = selectOptionNames(entry, data);

      return text(name ?? '');
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
      // The cell stores person ids; names come from the workspace members,
      // then from any names the field itself recorded.
      const recorded = new Map(parsePersonTypeOptions(entry.field).persons.map((person) => [person.id, person.name]));

      return list(
        personIds(data).map((id) =>
          text(id === ANONYMOUS_PERSON_ID ? 'Anonymous' : context.getPersonName?.(id) || recorded.get(id) || '')
        )
      );
    }

    case FieldType.Relation:
      // Deleted rows are absent; a live row with an empty/unloaded title still counts.
      return list(
        getRelationRowIdsFromCell(cell).flatMap((id) => {
          const title = context.getRelatedRowTitle?.(entry.field, id);

          return title === null ? [] : [text(title ?? '')];
        })
      );

    case FieldType.Media: {
      const items = Array.isArray(data) ? (data as FileMediaCellData) : [];

      return list(items.map((item) => text(item.name ?? '')));
    }

    default:
      return EMPTY;
  }
}
