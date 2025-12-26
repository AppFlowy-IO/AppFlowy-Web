import { readFileSync } from 'fs';
import { resolve } from 'path';

import * as Y from 'yjs';

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { invalidateRelationCell, readRelationCellText, subscribeRelationCache } from '@/application/database-yjs/relation/cache';
import { invalidateRollupCell, readRollupCellSync, subscribeRollupCell } from '@/application/database-yjs/rollup/cache';
import { Row } from '@/application/database-yjs/selector';
import {
  RowId,
  YDatabase,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseFieldTypeOption,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YMapFieldTypeOption,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

type CellInput = {
  fieldType: FieldType;
  data?: unknown;
  sourceType?: FieldType;
  createdAt?: number | string;
  lastModified?: number | string;
  endTimestamp?: number | string;
  includeTime?: boolean;
  isRange?: boolean;
  reminderId?: string;
};

export function createField(
  fieldId: string,
  fieldType: FieldType,
  typeOptionContent?: unknown
): YDatabaseField {
  const doc = new Y.Doc();
  const field = doc.getMap('field') as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, fieldId);
  field.set(YjsDatabaseKey.type, fieldType);

  if (typeOptionContent !== undefined) {
    const typeOptionMap = new Y.Map();

    field.set(YjsDatabaseKey.type_option, typeOptionMap);

    const option = new Y.Map();

    typeOptionMap.set(String(fieldType), option);
    option.set(YjsDatabaseKey.content, JSON.stringify(typeOptionContent));
  }

  return field;
}

export function createFieldWithTypeOption(
  fieldId: string,
  fieldType: FieldType,
  typeOption: Record<string, unknown>
): YDatabaseField {
  const field = createField(fieldId, fieldType);
  const typeOptionMap = new Y.Map();
  const option = new Y.Map();

  field.set(YjsDatabaseKey.type_option, typeOptionMap);
  typeOptionMap.set(String(fieldType), option);
  Object.entries(typeOption).forEach(([key, value]) => {
    option.set(key, value);
  });
  return field;
}

export function createCell(fieldType: FieldType, data?: unknown, sourceType?: FieldType): CellInput {
  return { fieldType, data, sourceType };
}

export function createRowDoc(
  rowId: string,
  databaseId: string,
  cellMap: Record<string, CellInput>,
  createdAt: string = '0',
  lastModified: string = '0'
): YDoc {
  const doc = new Y.Doc() as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map() as YDatabaseRow;
  const cells = new Y.Map() as YDatabaseCells;

  sharedRoot.set(YjsEditorKey.database_row, row);

  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.database_id, databaseId);
  row.set(YjsDatabaseKey.cells, cells);
  row.set(YjsDatabaseKey.created_at, createdAt);
  row.set(YjsDatabaseKey.last_modified, lastModified);

  Object.entries(cellMap).forEach(([fieldId, cellInput]) => {
    const cell = new Y.Map() as YDatabaseCell;

    cells.set(fieldId, cell);
    cell.set(YjsDatabaseKey.field_type, cellInput.fieldType);
    if (cellInput.sourceType !== undefined) {
      cell.set(YjsDatabaseKey.source_field_type, cellInput.sourceType);
    }

    if (cellInput.data !== undefined) {
      cell.set(YjsDatabaseKey.data, cellInput.data);
    }

    if (cellInput.createdAt !== undefined) {
      cell.set(YjsDatabaseKey.created_at, cellInput.createdAt);
    }

    if (cellInput.lastModified !== undefined) {
      cell.set(YjsDatabaseKey.last_modified, cellInput.lastModified);
    }

    if (cellInput.endTimestamp !== undefined) {
      cell.set(YjsDatabaseKey.end_timestamp, cellInput.endTimestamp);
    }

    if (cellInput.includeTime !== undefined) {
      cell.set(YjsDatabaseKey.include_time, cellInput.includeTime);
    }

    if (cellInput.isRange !== undefined) {
      cell.set(YjsDatabaseKey.is_range, cellInput.isRange);
    }

    if (cellInput.reminderId !== undefined) {
      cell.set(YjsDatabaseKey.reminder_id, cellInput.reminderId);
    }
  });
  return doc;
}

type CsvFieldMeta = {
  id: string;
  name: string;
  field_type: number;
  type_options?: Record<string, Record<string, unknown>>;
  is_primary?: boolean;
};

type CsvCellMeta = {
  data?: unknown;
  created_at?: number | string;
  last_modified?: number | string;
  field_type?: number;
  source_field_type?: number;
  end_timestamp?: number | string;
  include_time?: boolean;
  is_range?: boolean;
  reminder_id?: string;
};

export type CsvDatabaseFixture = {
  databaseId: string;
  viewId: string;
  databaseDoc: YDoc;
  fields: YDatabaseFields;
  rowMetas: Record<RowId, YDoc>;
  rows: Row[];
  rowIds: RowId[];
  fieldIdByName: Map<string, string>;
};

export type RelationRollupFixture = {
  baseDoc: YDoc;
  baseDatabase: YDatabase;
  baseFields: YDatabaseFields;
  baseRows: Row[];
  baseRowIds: RowId[];
  baseRowMetas: Record<RowId, YDoc>;
  relationFieldId: string;
  rollupSumFieldId: string;
  rollupListFieldId: string;
  relatedFixture: CsvDatabaseFixture;
  relatedDatabaseId: string;
  relatedViewId: string;
  nameFieldId: string;
  amountFieldId: string;
  loadView: (viewId: string) => Promise<YDoc | null>;
  createRowDoc: (rowKey: string) => Promise<YDoc | null>;
  getViewIdFromDatabaseId: (databaseId: string) => Promise<string | null>;
};

export type AssetRelationRollupFixture = {
  baseFixture: CsvDatabaseFixture;
  relatedFixture: CsvDatabaseFixture;
  baseDoc: YDoc;
  baseDatabase: YDatabase;
  baseFields: YDatabaseFields;
  baseRows: Row[];
  baseRowIds: RowId[];
  baseRowMetas: Record<RowId, YDoc>;
  relationFieldId: string;
  relationField: YDatabaseField;
  loadView: (viewId: string) => Promise<YDoc | null>;
  createRowDoc: (rowKey: string) => Promise<YDoc | null>;
  getViewIdFromDatabaseId: (databaseId: string) => Promise<string | null>;
};

const CSV_FIXTURE_DIR = resolve(
  process.cwd(),
  'src/application/database-yjs/__tests__/__fixtures__'
);

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }

      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(current);
      current = '';
      continue;
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') {
        i += 1;
      }

      row.push(current);
      current = '';
      if (row.length > 1 || row[0] !== '') {
        rows.push(row);
      }

      row = [];
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function mapTypeOptionKey(key: string): string {
  if (key === 'date_format') return YjsDatabaseKey.date_format;
  if (key === 'time_format') return YjsDatabaseKey.time_format;
  return key;
}

function createTypeOptionMap(options: Record<string, unknown>): YMapFieldTypeOption {
  const optionMap = new Y.Map() as YMapFieldTypeOption;

  Object.entries(options).forEach(([key, value]) => {
    optionMap.set(mapTypeOptionKey(key), value);
  });
  return optionMap;
}

function createFieldFromMeta(meta: CsvFieldMeta): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;

  field.set(YjsDatabaseKey.id, meta.id);
  field.set(YjsDatabaseKey.name, meta.name);
  field.set(YjsDatabaseKey.type, meta.field_type);
  if (meta.is_primary) {
    field.set(YjsDatabaseKey.is_primary, true);
  }

  if (meta.type_options) {
    const typeOptionMap = new Y.Map() as YDatabaseFieldTypeOption;
    let hasOptions = false;

    Object.entries(meta.type_options).forEach(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        typeOptionMap.set(key, createTypeOptionMap(value));
        hasOptions = true;
      }
    });
    if (hasOptions) {
      field.set(YjsDatabaseKey.type_option, typeOptionMap);
    }
  }

  return field;
}

function safeJsonParse<T>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch (error) {
    return null;
  }
}

function normalizeCellData(fieldType: FieldType, data: unknown): unknown {
  if (fieldType === FieldType.FileMedia && Array.isArray(data)) {
    const files = data.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
    const yArray = new Y.Array<string>();

    if (files.length > 0) {
      yArray.push(files);
    }

    return yArray;
  }

  if (fieldType === FieldType.Relation && Array.isArray(data)) {
    const ids = data.map((item) => String(item));
    const yArray = new Y.Array<string>();

    if (ids.length > 0) {
      yArray.push(ids);
    }

    return yArray;
  }

  return data;
}

function createCellInput(fieldType: FieldType, meta: CsvCellMeta | null): CellInput {
  const cellType = Number(meta?.field_type ?? fieldType) as FieldType;
  const data = meta && 'data' in meta ? meta.data : '';

  return {
    fieldType: cellType,
    data: normalizeCellData(cellType, data),
    sourceType: meta?.source_field_type as FieldType | undefined,
    createdAt: meta?.created_at,
    lastModified: meta?.last_modified,
    endTimestamp: meta?.end_timestamp,
    includeTime: meta?.include_time,
    isRange: meta?.is_range,
    reminderId: meta?.reminder_id,
  };
}

export function loadCsvFixture(fileName: string): string {
  return readFileSync(resolve(CSV_FIXTURE_DIR, fileName), 'utf8');
}

export function createDatabaseFixtureFromCsv(
  content: string,
  databaseId: string = 'db-csv',
  viewId: string = `${databaseId}-view`
): CsvDatabaseFixture {
  const rows = parseCsvRows(content);
  const header = rows[0] ?? [];
  const dataRows = rows.slice(1);

  const fieldMetas: CsvFieldMeta[] = header.map((cell, index) => {
    const parsed = safeJsonParse<CsvFieldMeta>(cell);

    if (parsed) return parsed;
    return {
      id: `field-${index}`,
      name: cell || `Field ${index + 1}`,
      field_type: FieldType.RichText,
      is_primary: index === 0,
    };
  });

  const fields = new Y.Map() as YDatabaseFields;
  const fieldIdByName = new Map<string, string>();

  fieldMetas.forEach((meta) => {
    const field = createFieldFromMeta(meta);

    fields.set(meta.id, field);
    fieldIdByName.set(meta.name, meta.id);
  });

  const databaseDoc = new Y.Doc() as YDoc;

  databaseDoc.guid = viewId;
  databaseDoc.object_id = viewId;
  const databaseRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;

  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  databaseRoot.set(YjsEditorKey.database, database);

  const rowMetas: Record<RowId, YDoc> = {};
  const rowIds: RowId[] = [];
  const rowsResult: Row[] = [];
  const createdFieldId = fieldMetas.find((meta) => meta.field_type === FieldType.CreatedTime)?.id;
  const lastEditedFieldId = fieldMetas.find((meta) => meta.field_type === FieldType.LastEditedTime)?.id;

  dataRows.forEach((cells, rowIndex) => {
    const rowId = `row-${rowIndex}`;
    const cellMap: Record<string, CellInput> = {};

    fieldMetas.forEach((meta, columnIndex) => {
      const cellText = cells[columnIndex] ?? '';
      const cellMeta = cellText ? safeJsonParse<CsvCellMeta>(cellText) : null;

      cellMap[meta.id] = createCellInput(meta.field_type as FieldType, cellMeta);
    });

    const createdValue = createdFieldId ? cellMap[createdFieldId]?.data : undefined;
    const lastEditedValue = lastEditedFieldId ? cellMap[lastEditedFieldId]?.data : undefined;
    const createdAt =
      createdValue === undefined || createdValue === null || createdValue === '' ? '' : String(createdValue);
    const lastModified =
      lastEditedValue === undefined || lastEditedValue === null || lastEditedValue === '' ? '' : String(lastEditedValue);

    rowMetas[rowId] = createRowDoc(rowId, databaseId, cellMap, createdAt, lastModified);
    rowsResult.push({ id: rowId, height: 0 });
    rowIds.push(rowId);
  });

  return {
    databaseId,
    viewId,
    databaseDoc,
    fields,
    rowMetas,
    rows: rowsResult,
    rowIds,
    fieldIdByName,
  };
}

export function loadV069DatabaseFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('v069.afdb'), 'db-v069', 'view-v069');
}

export function loadV020DatabaseFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('v020.afdb'), 'db-v020', 'view-v020');
}

export function loadAuthorsDatabaseFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('authors.afdb'), 'db-authors', 'view-authors');
}

export function loadBlogPostsDatabaseFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('blog_posts.afdb'), 'db-blog-posts', 'view-blog-posts');
}

export function loadCustomersDatabaseFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('customers.afdb'), 'db-customers', 'view-customers');
}

export function loadOrdersDatabaseFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('orders.afdb'), 'db-orders', 'view-orders');
}

export function loadTasksDatabaseFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('tasks.afdb'), 'db-tasks', 'view-tasks');
}

export function loadRecipesDatabaseFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('recipes.afdb'), 'db-recipes', 'view-recipes');
}

export function loadIngredientsDatabaseFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('ingredients.afdb'), 'db-ingredients', 'view-ingredients');
}

export function loadDatabaseTemplateFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(
    loadCsvFixture('database_template_1.afdb'),
    'db-template-1',
    'view-template-1'
  );
}

export function loadProjectCsvFixture(): CsvDatabaseFixture {
  return createDatabaseFixtureFromCsv(loadCsvFixture('project.csv'), 'db-project', 'view-project');
}

export type DesktopFilterGridFixture = {
  databaseId: string;
  fields: YDatabaseFields;
  rows: Row[];
  rowIds: RowId[];
  rowMetas: Record<RowId, YDoc>;
  fieldIds: {
    text: string;
    number: string;
    date: string;
    singleSelect: string;
    multiSelect: string;
    checkbox: string;
    checklist: string;
    time: string;
    relation: string;
  };
  singleSelectOptions: Array<{ id: string; name: string }>;
  multiSelectOptions: Array<{ id: string; name: string }>;
};

export function createDesktopFilterGridFixture(): DesktopFilterGridFixture {
  const databaseId = 'db-desktop-grid';
  const fieldIds = {
    text: 'field-text',
    number: 'field-number',
    date: 'field-date',
    singleSelect: 'field-single-select',
    multiSelect: 'field-multi-select',
    checkbox: 'field-checkbox',
    checklist: 'field-checklist',
    time: 'field-time',
    relation: 'field-relation',
  };

  const singleSelectOptions = [
    { id: 'status-completed', name: 'Completed' },
    { id: 'status-planned', name: 'Planned' },
    { id: 'status-paused', name: 'Paused' },
  ];
  const multiSelectOptions = [
    { id: 'platform-google', name: 'Google' },
    { id: 'platform-facebook', name: 'Facebook' },
    { id: 'platform-twitter', name: 'Twitter' },
  ];

  const fields = new Map() as unknown as YDatabaseFields;

  fields.set(fieldIds.text, createField(fieldIds.text, FieldType.RichText));
  fields.set(fieldIds.number, createField(fieldIds.number, FieldType.Number));
  fields.set(fieldIds.date, createField(fieldIds.date, FieldType.DateTime));
  fields.set(
    fieldIds.singleSelect,
    createField(fieldIds.singleSelect, FieldType.SingleSelect, {
      options: singleSelectOptions.map((option, index) => ({
        ...option,
        color: index === 0 ? 'Purple' : index === 1 ? 'Orange' : 'Yellow',
      })),
      disable_color: false,
    })
  );
  fields.set(
    fieldIds.multiSelect,
    createField(fieldIds.multiSelect, FieldType.MultiSelect, {
      options: multiSelectOptions.map((option, index) => ({
        ...option,
        color: index === 0 ? 'Purple' : index === 1 ? 'Orange' : 'Yellow',
      })),
      disable_color: false,
    })
  );
  fields.set(fieldIds.checkbox, createField(fieldIds.checkbox, FieldType.Checkbox));
  fields.set(fieldIds.checklist, createField(fieldIds.checklist, FieldType.Checklist));
  fields.set(fieldIds.time, createField(fieldIds.time, FieldType.Time));
  fields.set(fieldIds.relation, createField(fieldIds.relation, FieldType.Relation));

  const rowIds = Array.from({ length: 7 }, (_, index) => `row-${index}`);
  const rows = rowIds.map((id) => ({ id, height: 0 }));
  const rowMetas: Record<RowId, YDoc> = {};

  const row0Checklist = JSON.stringify({
    options: [{ id: 'task-1', name: 'First thing', color: 'Purple' }],
    selected_option_ids: [],
  });
  const row1Checklist = JSON.stringify({
    options: [
      { id: 'task-2', name: 'Have breakfast', color: 'Purple' },
      { id: 'task-3', name: 'Have lunch', color: 'Purple' },
      { id: 'task-4', name: 'Take a nap', color: 'Purple' },
      { id: 'task-5', name: 'Have dinner', color: 'Purple' },
      { id: 'task-6', name: 'Shower and head to bed', color: 'Purple' },
    ],
    selected_option_ids: ['task-2', 'task-3', 'task-5'],
  });
  const row3Checklist = JSON.stringify({
    options: [{ id: 'task-7', name: 'Task 1', color: 'Purple' }],
    selected_option_ids: ['task-7'],
  });
  const row5Checklist = JSON.stringify({
    options: [
      { id: 'task-8', name: 'Sprint', color: 'Purple' },
      { id: 'task-9', name: 'Sprint some more', color: 'Purple' },
      { id: 'task-10', name: 'Rest', color: 'Purple' },
    ],
    selected_option_ids: ['task-8', 'task-10'],
  });

  rowMetas[rowIds[0]] = createRowDoc(rowIds[0], databaseId, {
    [fieldIds.text]: createCell(FieldType.RichText, 'A'),
    [fieldIds.number]: createCell(FieldType.Number, '1'),
    [fieldIds.date]: createCell(FieldType.DateTime, '1647251762'),
    [fieldIds.multiSelect]: createCell(
      FieldType.MultiSelect,
      `${multiSelectOptions[0].id},${multiSelectOptions[1].id}`
    ),
    [fieldIds.checkbox]: createCell(FieldType.Checkbox, 'true'),
    [fieldIds.checklist]: createCell(FieldType.Checklist, row0Checklist),
    [fieldIds.time]: createCell(FieldType.Time, '75'),
  });

  rowMetas[rowIds[1]] = createRowDoc(rowIds[1], databaseId, {
    [fieldIds.text]: createCell(FieldType.RichText, ''),
    [fieldIds.number]: createCell(FieldType.Number, '2'),
    [fieldIds.date]: createCell(FieldType.DateTime, '1647251762'),
    [fieldIds.multiSelect]: createCell(
      FieldType.MultiSelect,
      `${multiSelectOptions[0].id},${multiSelectOptions[2].id}`
    ),
    [fieldIds.checkbox]: createCell(FieldType.Checkbox, 'true'),
    [fieldIds.checklist]: createCell(FieldType.Checklist, row1Checklist),
  });

  rowMetas[rowIds[2]] = createRowDoc(rowIds[2], databaseId, {
    [fieldIds.text]: createCell(FieldType.RichText, 'C'),
    [fieldIds.number]: createCell(FieldType.Number, '3'),
    [fieldIds.date]: createCell(FieldType.DateTime, '1647251762'),
    [fieldIds.singleSelect]: createCell(FieldType.SingleSelect, singleSelectOptions[0].id),
    [fieldIds.multiSelect]: createCell(
      FieldType.MultiSelect,
      `${multiSelectOptions[1].id},${multiSelectOptions[0].id},${multiSelectOptions[2].id}`
    ),
    [fieldIds.checkbox]: createCell(FieldType.Checkbox, 'false'),
  });

  rowMetas[rowIds[3]] = createRowDoc(rowIds[3], databaseId, {
    [fieldIds.text]: createCell(FieldType.RichText, 'DA'),
    [fieldIds.number]: createCell(FieldType.Number, '14'),
    [fieldIds.date]: createCell(FieldType.DateTime, '1668704685'),
    [fieldIds.singleSelect]: createCell(FieldType.SingleSelect, singleSelectOptions[0].id),
    [fieldIds.checkbox]: createCell(FieldType.Checkbox, 'false'),
    [fieldIds.checklist]: createCell(FieldType.Checklist, row3Checklist),
  });

  rowMetas[rowIds[4]] = createRowDoc(rowIds[4], databaseId, {
    [fieldIds.text]: createCell(FieldType.RichText, 'AE'),
    [fieldIds.number]: createCell(FieldType.Number, ''),
    [fieldIds.date]: createCell(FieldType.DateTime, '1668359085'),
    [fieldIds.singleSelect]: createCell(FieldType.SingleSelect, singleSelectOptions[1].id),
    [fieldIds.multiSelect]: createCell(
      FieldType.MultiSelect,
      `${multiSelectOptions[1].id},${multiSelectOptions[2].id}`
    ),
    [fieldIds.checkbox]: createCell(FieldType.Checkbox, 'false'),
  });

  rowMetas[rowIds[5]] = createRowDoc(rowIds[5], databaseId, {
    [fieldIds.text]: createCell(FieldType.RichText, 'AE'),
    [fieldIds.number]: createCell(FieldType.Number, '5'),
    [fieldIds.date]: createCell(FieldType.DateTime, '1671938394'),
    [fieldIds.singleSelect]: createCell(FieldType.SingleSelect, singleSelectOptions[1].id),
    [fieldIds.multiSelect]: createCell(FieldType.MultiSelect, multiSelectOptions[1].id),
    [fieldIds.checkbox]: createCell(FieldType.Checkbox, 'true'),
    [fieldIds.checklist]: createCell(FieldType.Checklist, row5Checklist),
  });

  rowMetas[rowIds[6]] = createRowDoc(rowIds[6], databaseId, {
    [fieldIds.text]: createCell(FieldType.RichText, 'CB'),
  });

  return {
    databaseId,
    fields,
    rows,
    rowIds,
    rowMetas,
    fieldIds,
    singleSelectOptions,
    multiSelectOptions,
  };
}

function buildRowIdByNameMap(
  fixture: CsvDatabaseFixture,
  nameFieldId: string
): Map<string, RowId> {
  const map = new Map<string, RowId>();

  Object.entries(fixture.rowMetas).forEach(([rowId, rowDoc]) => {
    const row = rowDoc
      .getMap(YjsEditorKey.data_section)
      .get(YjsEditorKey.database_row) as YDatabaseRow;
    const name = row.get(YjsDatabaseKey.cells)?.get(nameFieldId)?.get(YjsDatabaseKey.data);

    if (typeof name === 'string' && name.trim() !== '') {
      map.set(name, rowId);
    }
  });
  return map;
}

export function setRelationCellRowIds(rowDoc: YDoc, fieldId: string, rowIds: RowId[]) {
  const row = rowDoc
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database_row) as YDatabaseRow;
  const cells = row.get(YjsDatabaseKey.cells);
  let cell = cells.get(fieldId) as YDatabaseCell | undefined;

  if (!cell) {
    cell = new Y.Map() as YDatabaseCell;
    cell.set(YjsDatabaseKey.field_type, FieldType.Relation);
    cells.set(fieldId, cell);
  }

  const relationIds = new Y.Array<string>();

  cell.set(YjsDatabaseKey.data, relationIds);
  if (rowIds.length > 0) {
    relationIds.push(rowIds);
  }
}

export function createBlogPostsAuthorsRelationFixture(
  options: { relationFieldId?: string; suffix?: string } = {}
): AssetRelationRollupFixture {
  const suffix = options.suffix ?? 'authors';
  const baseFixture = loadBlogPostsDatabaseFixture();
  const relatedFixture = loadAuthorsDatabaseFixture();
  const relatedViewId = `${relatedFixture.viewId}-${suffix}`;

  relatedFixture.viewId = relatedViewId;
  relatedFixture.databaseDoc.guid = relatedViewId;
  relatedFixture.databaseDoc.object_id = relatedViewId;

  const baseDoc = baseFixture.databaseDoc;
  const baseRoot = baseDoc.getMap(YjsEditorKey.data_section);
  const baseDatabase = baseRoot.get(YjsEditorKey.database) as YDatabase;
  const baseFields = baseDatabase.get(YjsDatabaseKey.fields);

  const relationFieldId = options.relationFieldId ?? `relation-${suffix}`;
  const relationField = createRelationField(relationFieldId);

  relationField.set(YjsDatabaseKey.name, 'Authors');
  baseFields.set(relationFieldId, relationField);

  const integratedRelationField = baseFields.get(relationFieldId) as YDatabaseField | undefined;
  const relationOption = integratedRelationField
    ?.get(YjsDatabaseKey.type_option)
    ?.get(String(FieldType.Relation));

  relationOption?.set(YjsDatabaseKey.database_id, relatedFixture.databaseId);

  baseFixture.rowIds.forEach((rowId) => {
    const rowDoc = baseFixture.rowMetas[rowId];

    setRelationCellRowIds(rowDoc, relationFieldId, []);
  });

  const createRowDoc = async (rowKey: string) => {
    const rowId = rowKey.includes('_rows_') ? rowKey.split('_rows_').pop() ?? '' : rowKey;

    return relatedFixture.rowMetas[rowId] ?? null;
  };

  const loadView = async (viewId: string) =>
    viewId === relatedFixture.viewId ? relatedFixture.databaseDoc : null;
  const getViewIdFromDatabaseId = async (databaseId: string) =>
    databaseId === relatedFixture.databaseId ? relatedFixture.viewId : null;

  return {
    baseFixture,
    relatedFixture,
    baseDoc,
    baseDatabase,
    baseFields,
    baseRows: baseFixture.rows,
    baseRowIds: baseFixture.rowIds,
    baseRowMetas: baseFixture.rowMetas,
    relationFieldId,
    relationField: integratedRelationField ?? relationField,
    loadView,
    createRowDoc,
    getViewIdFromDatabaseId,
  };
}

export function createRelationRollupFixtureFromV069(
  options: {
    suffix?: string;
    baseRows?: Array<{ title: string; relatedNames: string[] }>;
  } = {}
): RelationRollupFixture {
  const suffix = options.suffix ?? 'v069';
  const relatedDatabaseId = `related-db-${suffix}`;
  const relatedViewId = `related-view-${suffix}`;
  const relatedFixture = createDatabaseFixtureFromCsv(
    loadCsvFixture('v069.afdb'),
    relatedDatabaseId,
    relatedViewId
  );

  const nameFieldId = relatedFixture.fieldIdByName.get('Name') ?? '';
  const amountFieldId = relatedFixture.fieldIdByName.get('Amount') ?? '';
  const relatedRowIdByName = buildRowIdByNameMap(relatedFixture, nameFieldId);

  const baseDoc = new Y.Doc() as YDoc;
  const baseViewId = `base-view-${suffix}`;
  const baseDatabaseId = `base-db-${suffix}`;

  baseDoc.guid = baseViewId;
  baseDoc.object_id = baseViewId;
  const baseRoot = baseDoc.getMap(YjsEditorKey.data_section);
  const baseDatabase = new Y.Map() as YDatabase;
  const baseFields = new Y.Map() as YDatabaseFields;

  const baseNameFieldId = `base-name-${suffix}`;
  const relationFieldId = `relation-${suffix}`;
  const rollupSumFieldId = `rollup-sum-${suffix}`;
  const rollupListFieldId = `rollup-list-${suffix}`;

  const baseNameField = new Y.Map() as YDatabaseField;

  baseNameField.set(YjsDatabaseKey.id, baseNameFieldId);
  baseNameField.set(YjsDatabaseKey.name, 'Name');
  baseNameField.set(YjsDatabaseKey.type, FieldType.RichText);
  baseNameField.set(YjsDatabaseKey.is_primary, true);

  baseFields.set(baseNameFieldId, baseNameField);
  baseFields.set(relationFieldId, createRelationField(relationFieldId));
  baseFields.set(rollupSumFieldId, createRollupField(rollupSumFieldId));
  baseFields.set(rollupListFieldId, createRollupField(rollupListFieldId));

  baseDatabase.set(YjsDatabaseKey.id, baseDatabaseId);
  baseDatabase.set(YjsDatabaseKey.fields, baseFields);
  baseRoot.set(YjsEditorKey.database, baseDatabase);

  const integratedRelationField = baseDatabase
    .get(YjsDatabaseKey.fields)
    ?.get(relationFieldId) as YDatabaseField | undefined;
  const relationOption = integratedRelationField
    ?.get(YjsDatabaseKey.type_option)
    ?.get(String(FieldType.Relation));

  relationOption?.set(YjsDatabaseKey.database_id, relatedDatabaseId);

  const rollupSumField = baseDatabase
    .get(YjsDatabaseKey.fields)
    ?.get(rollupSumFieldId) as YDatabaseField | undefined;
  const rollupSumOption = rollupSumField
    ?.get(YjsDatabaseKey.type_option)
    ?.get(String(FieldType.Rollup));

  rollupSumOption?.set(YjsDatabaseKey.relation_field_id, relationFieldId);
  rollupSumOption?.set(YjsDatabaseKey.target_field_id, amountFieldId);
  rollupSumOption?.set(YjsDatabaseKey.calculation_type, CalculationType.Sum);
  rollupSumOption?.set(YjsDatabaseKey.show_as, RollupDisplayMode.Calculated);

  const rollupListField = baseDatabase
    .get(YjsDatabaseKey.fields)
    ?.get(rollupListFieldId) as YDatabaseField | undefined;
  const rollupListOption = rollupListField
    ?.get(YjsDatabaseKey.type_option)
    ?.get(String(FieldType.Rollup));

  rollupListOption?.set(YjsDatabaseKey.relation_field_id, relationFieldId);
  rollupListOption?.set(YjsDatabaseKey.target_field_id, nameFieldId);
  rollupListOption?.set(YjsDatabaseKey.calculation_type, CalculationType.Count);
  rollupListOption?.set(YjsDatabaseKey.show_as, RollupDisplayMode.OriginalList);

  const baseRowsConfig =
    options.baseRows ??
    [
      { title: 'Group A', relatedNames: ['Olaf', 'Lancelot'] },
      { title: 'Group B', relatedNames: ['Beatrice', 'Thomas'] },
      { title: 'Group C', relatedNames: [] },
    ];

  const baseRowMetas: Record<RowId, YDoc> = {};
  const baseRowIds: RowId[] = [];
  const baseRows: Row[] = [];

  baseRowsConfig.forEach((config, index) => {
    const rowId = `base-row-${suffix}-${index}`;

    baseRowIds.push(rowId);
    baseRows.push({ id: rowId, height: 0 });

    const rowDoc = createRowDoc(rowId, baseDatabaseId, {
      [baseNameFieldId]: createCell(FieldType.RichText, config.title),
      [relationFieldId]: createCell(FieldType.Relation),
      [rollupSumFieldId]: createCell(FieldType.Rollup),
      [rollupListFieldId]: createCell(FieldType.Rollup),
    });

    const relatedRowIds = config.relatedNames
      .map((name) => relatedRowIdByName.get(name))
      .filter((id): id is RowId => Boolean(id));

    setRelationCellRowIds(rowDoc, relationFieldId, relatedRowIds);
    baseRowMetas[rowId] = rowDoc;
  });

  const loadView = async (viewId: string) => (viewId === relatedViewId ? relatedFixture.databaseDoc : null);
  const createRowDocFn = async (rowKey: string) => {
    const rowId = rowKey.includes('_rows_') ? rowKey.split('_rows_').pop() ?? '' : rowKey;

    return relatedFixture.rowMetas[rowId] ?? null;
  };

  const getViewIdFromDatabaseId = async (databaseId: string) =>
    databaseId === relatedDatabaseId ? relatedViewId : null;

  return {
    baseDoc,
    baseDatabase,
    baseFields,
    baseRows,
    baseRowIds,
    baseRowMetas,
    relationFieldId,
    rollupSumFieldId,
    rollupListFieldId,
    relatedFixture,
    relatedDatabaseId,
    relatedViewId,
    nameFieldId,
    amountFieldId,
    loadView,
    createRowDoc: createRowDocFn,
    getViewIdFromDatabaseId,
  };
}

export async function resolveRelationText(context: {
  baseDoc: YDoc;
  database: YDatabase;
  relationField: YDatabaseField;
  row: YDatabaseRow;
  rowId: RowId;
  fieldId: string;
  loadView: (viewId: string) => Promise<YDoc | null>;
  createRowDoc: (rowKey: string) => Promise<YDoc | null>;
  getViewIdFromDatabaseId: (databaseId: string) => Promise<string | null>;
}): Promise<string> {
  const cellId = `${context.rowId}:${context.fieldId}`;

  invalidateRelationCell(cellId);
  return new Promise((resolve) => {
    const unsubscribe = subscribeRelationCache(() => {
      const value = readRelationCellText(context);

      unsubscribe();
      resolve(value);
    });

    readRelationCellText(context);
  });
}

export async function resolveRollupValue(context: {
  baseDoc: YDoc;
  database: YDatabase;
  rollupField: YDatabaseField;
  row: YDatabaseRow;
  rowId: RowId;
  fieldId: string;
  loadView: (viewId: string) => Promise<YDoc | null>;
  createRowDoc: (rowKey: string) => Promise<YDoc | null>;
  getViewIdFromDatabaseId: (databaseId: string) => Promise<string | null>;
}): Promise<{ value: string; rawNumeric?: number; list?: string[] }> {
  const cellId = `${context.rowId}:${context.fieldId}`;

  invalidateRollupCell(cellId);
  return new Promise((resolve) => {
    const unsubscribe = subscribeRollupCell(cellId, (value) => {
      unsubscribe();
      resolve(value);
    });

    readRollupCellSync(context);
  });
}
