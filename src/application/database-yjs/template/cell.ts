import dayjs from 'dayjs';
import { validate as isUuid } from 'uuid';
import * as Y from 'yjs';

import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { getChecked } from '@/application/database-yjs/fields/checkbox/utils';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { parseSelectOptionTypeOptions } from '@/application/database-yjs/fields/select-option/parse';
import { getRelationRowIdsFromCell } from '@/application/database-yjs/relation/cell';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { generateRowMeta, getMetaIdMap, getMetaJSON } from '@/application/database-yjs/row_meta';
import {
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
  YSharedRoot,
} from '@/application/types';

import { DatabaseRowTemplate, TemplateCellValue } from './types';

const TEXT_FIELD_TYPES = new Set([FieldType.RichText, FieldType.Translate, FieldType.Summary]);

function stringValue(value: TemplateCellValue): string | null {
  switch (value.type) {
    case 'text':
    case 'number':
    case 'url':
    case 'legacy':
      return value.value;
    default:
      return null;
  }
}

function parseStringList(raw: string): string[] {
  const trimmed = raw.trim();

  if (!trimmed) return [];

  try {
    const parsed: unknown = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
  } catch {
    // Desktop's legacy representation is comma-separated.
  }

  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeSelect(value: TemplateCellValue, field: YDatabaseField, single: boolean): TemplateCellValue | null {
  const ids =
    value.type === 'select' ? value.value : stringValue(value) ? parseStringList(stringValue(value) as string) : [];
  const allowedIds = new Set(parseSelectOptionTypeOptions(field)?.options?.map((option) => option.id) ?? []);
  const seen = new Set<string>();
  const validIds = ids.filter((id) => allowedIds.has(id) && !seen.has(id) && seen.add(id));

  if (validIds.length === 0) return null;

  return { type: 'select', value: single ? validIds.slice(0, 1) : validIds };
}

/**
 * Applies Desktop's row-template sanitization rules against the database's
 * current field schema. Deleted fields/options and incompatible values are
 * deliberately ignored instead of leaking stale cell data into a new row.
 */
export function sanitizeTemplateCells(
  database: YDatabase,
  values: Record<string, TemplateCellValue>
): Record<string, TemplateCellValue> {
  const result: Record<string, TemplateCellValue> = {};
  const fields = database.get(YjsDatabaseKey.fields);

  Object.entries(values).forEach(([fieldId, value]) => {
    const field = fields?.get(fieldId);

    if (!field) return;

    const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
    let sanitized: TemplateCellValue | null = null;

    if (TEXT_FIELD_TYPES.has(fieldType)) {
      const raw = stringValue(value)?.trim();

      if (raw) sanitized = { type: 'text', value: raw };
    } else if (fieldType === FieldType.URL) {
      const raw = stringValue(value)?.trim();

      if (raw) sanitized = { type: 'url', value: raw };
    } else if (fieldType === FieldType.Number) {
      const raw = stringValue(value)?.trim();

      if (raw && Number.isFinite(Number(raw))) sanitized = { type: 'number', value: raw };
    } else if (fieldType === FieldType.DateTime || fieldType === FieldType.Time) {
      const string = stringValue(value)?.trim();
      const typedRaw =
        (fieldType === FieldType.DateTime && value.type === 'date_time') ||
        (fieldType === FieldType.Time && value.type === 'time')
          ? value.value
          : undefined;
      const raw = typedRaw ?? (string ? Number(string) : Number.NaN);

      if (Number.isSafeInteger(raw)) {
        sanitized = fieldType === FieldType.DateTime ? { type: 'date_time', value: raw } : { type: 'time', value: raw };
      }
    } else if (fieldType === FieldType.Checkbox) {
      if (value.type === 'checkbox') {
        sanitized = value;
      } else {
        const raw = stringValue(value)?.trim().toLowerCase();

        // Desktop's CheckboxCellDataPB parser treats every non-empty,
        // unrecognized legacy string as unchecked.
        if (raw) sanitized = { type: 'checkbox', value: getChecked(raw) };
      }
    } else if (fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect) {
      sanitized = sanitizeSelect(value, field, fieldType === FieldType.SingleSelect);
    } else if (fieldType === FieldType.Person) {
      const ids =
        value.type === 'person'
          ? value.value
          : (stringValue(value) ?? '')
              .split(',')
              .map((id) => id.trim())
              .filter((id) => id.length > 0 && isUuid(id));

      if (ids.length > 0) sanitized = { type: 'person', value: ids };
    } else if (fieldType === FieldType.Relation) {
      const rawIds =
        value.type === 'relation'
          ? value.value
          : (stringValue(value) ?? '')
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean);
      const seen = new Set<string>();
      const validIds = rawIds.filter((id) => isUuid(id) && !seen.has(id) && seen.add(id));

      if (validIds.length > 0) {
        const typeOption = parseRelationTypeOption(field);

        // Desktop drops relation defaults whose field has no target database;
        // whether the linked rows still exist is resolved lazily on display.
        if (typeOption.database_id) {
          sanitized = {
            type: 'relation',
            value: typeOption.source_limit === RelationLimit.OneOnly ? validIds.slice(0, 1) : validIds,
          };
        }
      }
    }

    if (sanitized) result[fieldId] = sanitized;
  });

  return result;
}

export function templateCellToRawData(value: TemplateCellValue, fieldType: FieldType): string {
  switch (value.type) {
    case 'text':
    case 'number':
    case 'url':
    case 'legacy':
      return value.value;
    case 'checkbox':
      return String(value.value);
    case 'date_time':
    case 'time':
      return String(value.value);
    case 'select':
      return value.value.join(',');
    case 'person':
      // Web's person-cell codec is a JSON string; Desktop's template codec is
      // an ID list, so the boundary conversion intentionally happens here.
      return fieldType === FieldType.Person ? JSON.stringify(value.value) : value.value.join(',');
    case 'relation':
      return value.value.join(',');
  }
}

export function createTemplateCell(fieldId: string, fieldType: FieldType, value: TemplateCellValue): YDatabaseCell {
  const now = String(dayjs().unix());
  const cell = new Y.Map() as YDatabaseCell;

  cell.set(YjsDatabaseKey.id, fieldId);
  if (value.type === 'relation' && fieldType === FieldType.Relation) {
    // Relation cells store a Y.Array of row ids, not a string payload.
    const data = new Y.Array<string>();

    data.push([...value.value]);
    cell.set(YjsDatabaseKey.data, data);
  } else {
    cell.set(YjsDatabaseKey.data, templateCellToRawData(value, fieldType));
  }

  cell.set(YjsDatabaseKey.field_type, fieldType);
  cell.set(YjsDatabaseKey.created_at, now);
  cell.set(YjsDatabaseKey.last_modified, now);

  return cell;
}

export function applyTemplateCellsToRow(
  row: YDatabaseRow,
  database: YDatabase,
  values: Record<string, TemplateCellValue>
): Record<string, TemplateCellValue> {
  const sanitized = sanitizeTemplateCells(database, values);
  const fields = database.get(YjsDatabaseKey.fields);
  const cells = row.get(YjsDatabaseKey.cells);

  Object.entries(sanitized).forEach(([fieldId, value]) => {
    const fieldType = Number(fields?.get(fieldId)?.get(YjsDatabaseKey.type)) as FieldType;

    cells.set(fieldId, createTemplateCell(fieldId, fieldType, value));
  });

  return sanitized;
}

function parsePersonIds(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];

  return parseStringList(raw).filter(isUuid);
}

export function extractTemplateCellsFromRow(row: YDatabaseRow, database: YDatabase): Record<string, TemplateCellValue> {
  const values: Record<string, TemplateCellValue> = {};
  const fields = database.get(YjsDatabaseKey.fields);
  const cells = row.get(YjsDatabaseKey.cells);

  fields?.forEach((field, fieldId) => {
    const cell = cells.get(fieldId);

    if (!cell) return;

    const fieldType = Number(field.get(YjsDatabaseKey.type)) as FieldType;
    const raw = cell.get(YjsDatabaseKey.data);
    const rawString = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';

    if (TEXT_FIELD_TYPES.has(fieldType) && rawString.trim()) {
      values[fieldId] = { type: 'text', value: rawString.trim() };
    } else if (fieldType === FieldType.URL && rawString.trim()) {
      values[fieldId] = { type: 'url', value: rawString.trim() };
    } else if (fieldType === FieldType.Number && rawString.trim() && Number.isFinite(Number(rawString))) {
      values[fieldId] = { type: 'number', value: rawString.trim() };
    } else if (fieldType === FieldType.DateTime && rawString.trim() && Number.isSafeInteger(Number(rawString))) {
      values[fieldId] = { type: 'date_time', value: Number(rawString) };
    } else if (fieldType === FieldType.Time && rawString.trim() && Number.isSafeInteger(Number(rawString))) {
      values[fieldId] = { type: 'time', value: Number(rawString) };
    } else if (
      fieldType === FieldType.Checkbox &&
      raw !== undefined &&
      raw !== null &&
      (typeof raw !== 'string' || raw !== '')
    ) {
      values[fieldId] = { type: 'checkbox', value: getChecked(raw as string | number | boolean) };
    } else if (fieldType === FieldType.SingleSelect || fieldType === FieldType.MultiSelect) {
      const sanitized = sanitizeSelect(
        { type: 'select', value: parseStringList(rawString) },
        field,
        fieldType === FieldType.SingleSelect
      );

      if (sanitized) values[fieldId] = sanitized;
    } else if (fieldType === FieldType.Person) {
      const ids = parsePersonIds(raw);

      if (ids.length > 0) values[fieldId] = { type: 'person', value: Array.from(new Set(ids)) };
    } else if (fieldType === FieldType.Relation) {
      const ids = getRelationRowIdsFromCell(cell);

      if (ids.length > 0) values[fieldId] = { type: 'relation', value: [...ids] };
    }
  });

  return values;
}

/** Initializes (or resets) the hidden row collab used as a live Web template editor. */
export function initializeTemplateSourceRow(
  rowDoc: YDoc,
  database: YDatabase,
  template: DatabaseRowTemplate
): YDatabaseRow {
  rowDoc.transact(() => {
    const root = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;

    if (!root.get(YjsEditorKey.database_row)) {
      initialDatabaseRow(template.templateId, database.get(YjsDatabaseKey.id), rowDoc);
    }

    const row = root.get(YjsEditorKey.database_row);
    const cells = row.get(YjsDatabaseKey.cells);

    cells.clear();
    applyTemplateCellsToRow(row, database, template.defaultCells);

    const meta = root.get(YjsEditorKey.meta);
    const metaIds = getMetaIdMap(template.templateId);

    [RowMetaKey.IconId, RowMetaKey.CoverId].forEach((key) => {
      const metaId = metaIds.get(key);

      if (metaId) meta.delete(metaId);
    });
    const generated = generateRowMeta(template.templateId, {
      [RowMetaKey.IsDocumentEmpty]: template.isDocumentEmpty,
      [RowMetaKey.IconId]: template.icon ?? null,
      [RowMetaKey.CoverId]: template.cover ?? null,
    });

    Object.entries(generated).forEach(([key, value]) => {
      if (value !== undefined && value !== null) meta.set(key, value);
    });
  }, 'database-row-template');

  return rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
}

export function updateTemplateFromSourceRow(
  template: DatabaseRowTemplate,
  rowDoc: YDoc,
  database: YDatabase
): DatabaseRowTemplate {
  const root = rowDoc.getMap(YjsEditorKey.data_section) as YSharedRoot;
  const row = root.get(YjsEditorKey.database_row);
  const meta = getMetaJSON(template.templateId, root.get(YjsEditorKey.meta));
  const primaryField = Array.from(database.get(YjsDatabaseKey.fields)?.values() ?? []).find((field) =>
    Boolean(field.get(YjsDatabaseKey.is_primary))
  );
  const primaryFieldId = primaryField?.get(YjsDatabaseKey.id);
  const primaryName = primaryFieldId
    ? String(row.get(YjsDatabaseKey.cells).get(primaryFieldId)?.get(YjsDatabaseKey.data) ?? '').trim()
    : '';

  return {
    ...template,
    name: primaryName || template.name,
    defaultCells: extractTemplateCellsFromRow(row, database),
    isDocumentEmpty: meta.isEmptyDocument ?? template.isDocumentEmpty,
    icon: meta.icon || '',
    cover: meta.cover ? JSON.stringify(meta.cover) : '',
  };
}
