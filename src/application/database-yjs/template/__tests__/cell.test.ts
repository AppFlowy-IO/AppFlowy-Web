import * as Y from 'yjs';

import { FieldType, RowMetaKey } from '@/application/database-yjs/database.type';
import { initialDatabaseRow } from '@/application/database-yjs/row';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import {
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import {
  applyTemplateCellsToRow,
  extractTemplateCellsFromRow,
  initializeTemplateSourceRow,
  sanitizeTemplateCells,
  updateTemplateFromSourceRow,
} from '../cell';
import { DatabaseRowTemplate, TemplateCellValue } from '../types';

const databaseId = 'database-id';
const rowId = 'f73d479a-ae7e-438f-8fc8-e62b985f8126';
const personId = '6ca46703-b9ad-4476-912a-273d78e53cc0';

function field(id: string, type: FieldType, primary = false, optionIds: string[] = []): YDatabaseField {
  const value = new Y.Map() as YDatabaseField;

  value.set(YjsDatabaseKey.id, id);
  value.set(YjsDatabaseKey.name, id);
  value.set(YjsDatabaseKey.type, type);
  value.set(YjsDatabaseKey.is_primary, primary);

  if (optionIds.length > 0) {
    const typeOptions = new Y.Map<Y.Map<unknown>>();
    const option = new Y.Map<unknown>();

    option.set(
      YjsDatabaseKey.content,
      JSON.stringify({ options: optionIds.map((optionId) => ({ id: optionId, name: optionId, color: 0 })) })
    );
    typeOptions.set(String(type), option);
    value.set(YjsDatabaseKey.type_option, typeOptions);
  }

  return value;
}

function database(): YDatabase {
  const doc = new Y.Doc();
  const root = doc.getMap(YjsEditorKey.data_section);
  const value = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();

  fields.set('name', field('name', FieldType.RichText, true));
  fields.set('number', field('number', FieldType.Number));
  fields.set('check', field('check', FieldType.Checkbox));
  fields.set('date', field('date', FieldType.DateTime));
  fields.set('time', field('time', FieldType.Time));
  fields.set('url', field('url', FieldType.URL));
  fields.set('single', field('single', FieldType.SingleSelect, false, ['one', 'two']));
  fields.set('multi', field('multi', FieldType.MultiSelect, false, ['one', 'two']));
  fields.set('person', field('person', FieldType.Person));
  fields.set('unsupported', field('unsupported', FieldType.Relation));
  value.set(YjsDatabaseKey.id, databaseId);
  value.set(YjsDatabaseKey.fields, fields);
  root.set(YjsEditorKey.database, value);
  return value;
}

function template(defaultCells: Record<string, TemplateCellValue>): DatabaseRowTemplate {
  return {
    templateId: rowId,
    name: 'Bug report',
    docViewId: 'template-document-id',
    isDocumentEmpty: false,
    embeddedDatabases: [],
    defaultCells,
    icon: '🐛',
    cover: JSON.stringify({ data: 'cover-url', cover_type: 0 }),
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

describe('database row template cells', () => {
  it('sanitizes typed and legacy values using Desktop-compatible rules', () => {
    const result = sanitizeTemplateCells(database(), {
      name: { type: 'legacy', value: '  Issue  ' },
      number: { type: 'text', value: '12.5' },
      check: { type: 'legacy', value: 'yes' },
      date: { type: 'legacy', value: '1710000000' },
      time: { type: 'time', value: 75 },
      url: { type: 'url', value: ' https://appflowy.io ' },
      single: { type: 'select', value: ['missing', 'two', 'one'] },
      multi: { type: 'select', value: ['one', 'missing', 'one', 'two'] },
      person: { type: 'person', value: ['not-a-uuid', personId] },
      deleted: { type: 'text', value: 'drop me' },
      unsupported: { type: 'text', value: 'drop me too' },
    });

    expect(result).toEqual({
      name: { type: 'text', value: 'Issue' },
      number: { type: 'number', value: '12.5' },
      check: { type: 'checkbox', value: true },
      date: { type: 'date_time', value: 1710000000 },
      time: { type: 'time', value: 75 },
      url: { type: 'url', value: 'https://appflowy.io' },
      single: { type: 'select', value: ['two'] },
      multi: { type: 'select', value: ['one', 'two'] },
      person: { type: 'person', value: ['not-a-uuid', personId] },
    });
  });

  it('writes web cells and round-trips them to the typed template codec', () => {
    const db = database();
    const doc = new Y.Doc() as YDoc;

    initialDatabaseRow(rowId, databaseId, doc);
    const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

    applyTemplateCellsToRow(row, db, {
      name: { type: 'text', value: 'Issue' },
      check: { type: 'checkbox', value: false },
      multi: { type: 'select', value: ['one', 'two'] },
      person: { type: 'person', value: [personId] },
    });

    const cells = row.get(YjsDatabaseKey.cells);

    expect(cells.get('check')?.get(YjsDatabaseKey.data)).toBe('false');
    expect(cells.get('multi')?.get(YjsDatabaseKey.data)).toBe('one,two');
    expect(cells.get('person')?.get(YjsDatabaseKey.data)).toBe(JSON.stringify([personId]));
    expect(extractTemplateCellsFromRow(row, db)).toEqual({
      name: { type: 'text', value: 'Issue' },
      check: { type: 'checkbox', value: false },
      multi: { type: 'select', value: ['one', 'two'] },
      person: { type: 'person', value: [personId] },
    });
  });

  it('initializes a hidden editable row and updates its template metadata', () => {
    const db = database();
    const doc = new Y.Doc() as YDoc;
    const initial = template({ name: { type: 'text', value: 'Bug report' } });

    const row = initializeTemplateSourceRow(doc, db, initial);
    const root = doc.getMap(YjsEditorKey.data_section);
    const meta = root.get(YjsEditorKey.meta) as Y.Map<unknown>;

    expect(row.get(YjsDatabaseKey.id)).toBe(rowId);
    expect(meta.get(getMetaIdMap(rowId).get(RowMetaKey.IsDocumentEmpty) ?? '')).toBe(false);

    row.get(YjsDatabaseKey.cells).get('name')?.set(YjsDatabaseKey.data, 'Regression');
    const updated = updateTemplateFromSourceRow(initial, doc, db);

    expect(updated.name).toBe('Regression');
    expect(updated.defaultCells.name).toEqual({ type: 'text', value: 'Regression' });
    expect(updated.icon).toBe('🐛');
  });

  it('drops empty and invalid scalar values while matching Desktop checkbox coercion', () => {
    const result = sanitizeTemplateCells(database(), {
      name: { type: 'text', value: '   ' },
      number: { type: 'number', value: 'NaN' },
      check: { type: 'legacy', value: 'maybe' },
      date: { type: 'legacy', value: 'tomorrow' },
      time: { type: 'legacy', value: '' },
      url: { type: 'url', value: ' ' },
      single: { type: 'select', value: ['deleted-option'] },
      person: { type: 'legacy', value: 'not-a-uuid' },
    });

    expect(result).toEqual({ check: { type: 'checkbox', value: false } });
  });

  it('preserves typed person IDs and boolean false cells exactly as Desktop does', () => {
    const db = database();
    const typedPersonIds = ['desktop-owned-id', personId, personId];
    const sanitized = sanitizeTemplateCells(db, {
      person: { type: 'person', value: typedPersonIds },
    });
    const doc = new Y.Doc() as YDoc;

    initialDatabaseRow(rowId, databaseId, doc);
    const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const checkbox = new Y.Map() as YDatabaseCell;

    checkbox.set(YjsDatabaseKey.data, false);
    checkbox.set(YjsDatabaseKey.field_type, FieldType.Checkbox);
    row.get(YjsDatabaseKey.cells).set('check', checkbox);

    expect(sanitized.person).toEqual({ type: 'person', value: typedPersonIds });
    expect(extractTemplateCellsFromRow(row, db).check).toEqual({ type: 'checkbox', value: false });
  });

  it('accepts legacy JSON/comma lists and removes deleted select options', () => {
    const result = sanitizeTemplateCells(database(), {
      single: { type: 'legacy', value: '["missing","one","two"]' },
      multi: { type: 'legacy', value: 'two, missing, one, two' },
      person: { type: 'legacy', value: `${personId},not-valid` },
    });

    expect(result).toEqual({
      single: { type: 'select', value: ['one'] },
      multi: { type: 'select', value: ['two', 'one'] },
      person: { type: 'person', value: [personId] },
    });
  });

  it('does not turn empty date and time cells into Unix zero', () => {
    const db = database();
    const doc = new Y.Doc() as YDoc;

    initialDatabaseRow(rowId, databaseId, doc);
    const row = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;
    const cells = row.get(YjsDatabaseKey.cells);
    const emptyDate = new Y.Map() as YDatabaseCell;
    const emptyTime = new Y.Map() as YDatabaseCell;

    emptyDate.set(YjsDatabaseKey.data, '');
    emptyDate.set(YjsDatabaseKey.field_type, FieldType.DateTime);
    emptyTime.set(YjsDatabaseKey.data, '');
    emptyTime.set(YjsDatabaseKey.field_type, FieldType.Time);
    cells.set('date', emptyDate);
    cells.set('time', emptyTime);

    expect(extractTemplateCellsFromRow(row, db)).toEqual({});
  });

  it('resets stale hidden-row cells when initializing from persisted metadata', () => {
    const db = database();
    const doc = new Y.Doc() as YDoc;

    initialDatabaseRow(rowId, databaseId, doc);
    const root = doc.getMap(YjsEditorKey.data_section);
    const row = root.get(YjsEditorKey.database_row) as YDatabaseRow;
    const meta = root.get(YjsEditorKey.meta) as Y.Map<unknown>;
    const metaIds = getMetaIdMap(rowId);

    applyTemplateCellsToRow(row, db, { number: { type: 'number', value: '99' } });
    meta.set(metaIds.get(RowMetaKey.IconId) as string, 'stale icon');
    meta.set(metaIds.get(RowMetaKey.CoverId) as string, '{"data":"stale"}');
    initializeTemplateSourceRow(doc, db, {
      ...template({ name: { type: 'text', value: 'Fresh' } }),
      icon: undefined,
      cover: undefined,
    });

    expect(row.get(YjsDatabaseKey.cells).has('number')).toBe(false);
    expect(row.get(YjsDatabaseKey.cells).get('name')?.get(YjsDatabaseKey.data)).toBe('Fresh');
    expect(meta.has(metaIds.get(RowMetaKey.IconId) as string)).toBe(false);
    expect(meta.has(metaIds.get(RowMetaKey.CoverId) as string)).toBe(false);
  });
});
