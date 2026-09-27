/**
 * Yjs database fixtures for formula tests: fields with type options and row
 * documents whose cells are stored the way the app stores them.
 */
import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import {
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

export type FieldSpec = { id: string; name: string; type: FieldType; typeOption?: Record<string, unknown> };

export function createFields(specs: FieldSpec[]): YDatabaseFields {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;

  doc.transact(() => {
    specs.forEach((spec) => {
      const field = new Y.Map() as YDatabaseField;

      fields.set(spec.id, field);
      field.set(YjsDatabaseKey.id, spec.id);
      field.set(YjsDatabaseKey.name, spec.name);
      field.set(YjsDatabaseKey.type, spec.type);
      if (spec.typeOption) {
        const typeOptions = new Y.Map();
        const option = new Y.Map();

        field.set(YjsDatabaseKey.type_option, typeOptions);
        typeOptions.set(String(spec.type), option);
        Object.entries(spec.typeOption).forEach(([key, value]) => option.set(key, value));
      }
    });
  });

  return fields;
}

/** Cell data: a stored string, or `{ yArray }` for Relation and Media cells. */
export type CellData = string | { yArray: string[] };

export interface CellSpec {
  type: FieldType;
  data: CellData;
  /** Other cell keys, e.g. a date's `end_timestamp`. */
  extra?: Record<string, unknown>;
}

export interface RowMeta {
  createdAt?: string;
  lastModified?: string;
  createdBy?: string | number;
  lastEditedBy?: string | number;
}

export function createRow(
  rowId: string,
  cells: Record<string, CellSpec>,
  meta: RowMeta = {}
): { doc: YDoc; row: YDatabaseRow } {
  const doc = new Y.Doc() as YDoc;
  const root = doc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map() as YDatabaseRow;
  const cellMap = new Y.Map() as YDatabaseCells;

  root.set(YjsEditorKey.database_row, row);
  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.cells, cellMap);
  if (meta.createdAt !== undefined) row.set(YjsDatabaseKey.created_at, meta.createdAt);
  if (meta.lastModified !== undefined) row.set(YjsDatabaseKey.last_modified, meta.lastModified);
  if (meta.createdBy !== undefined) row.set(YjsDatabaseKey.created_by, meta.createdBy);
  if (meta.lastEditedBy !== undefined) row.set(YjsDatabaseKey.last_edited_by, meta.lastEditedBy);
  Object.entries(cells).forEach(([fieldId, spec]) => {
    const cell = new Y.Map() as YDatabaseCell;

    cellMap.set(fieldId, cell);
    cell.set(YjsDatabaseKey.field_type, spec.type);
    if (typeof spec.data === 'string') {
      cell.set(YjsDatabaseKey.data, spec.data);
    } else {
      const array = new Y.Array<string>();

      array.push(spec.data.yArray);
      cell.set(YjsDatabaseKey.data, array);
    }

    Object.entries(spec.extra ?? {}).forEach(([key, value]) => cell.set(key, value));
  });

  return { doc, row };
}

/** Select option type option content; option ids are the given ids. */
export function selectOptions(options: Array<[id: string, name: string]>): string {
  return JSON.stringify({ options: options.map(([id, name]) => ({ id, name, color: 'Blue' })), disable_color: false });
}

/** One stored Media item. */
export function mediaItem(id: string, name: string): string {
  return JSON.stringify({ id, name, url: `https://example.com/${name}`, file_type: 1, upload_type: 1 });
}

/** A Checklist cell with `total` tasks, the first `done` of them checked. */
export function checklistData(done: number, total: number): string {
  const options = Array.from({ length: total }, (_, index) => ({ id: `task-${index}`, name: `Task ${index + 1}` }));

  return JSON.stringify({ options, selected_option_ids: options.slice(0, done).map((option) => option.id) });
}
