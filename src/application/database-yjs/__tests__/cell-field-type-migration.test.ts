import * as Y from 'yjs';

import { installLegacyCellFieldTypeNormalizer } from '@/application/database-yjs/cell.field-type';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  DATABASE_SCHEMA_VERSION,
  migrateDatabaseFieldTypes,
} from '@/application/database-yjs/migrations/rollup_fieldtype';
import {
  YDatabase,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseMetas,
  YDatabaseRow,
  YDatabaseView,
  YDatabaseViews,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import { createRowDoc } from './test-helpers';

function createMigrationFixture(schemaVersion = 2) {
  const databaseId = 'database-id';
  const fieldId = 'field-id';
  const rowId = 'row-id';
  const doc = new Y.Doc({ guid: databaseId }) as YDoc;
  const root = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>() as YDatabaseFields;
  const field = new Y.Map() as YDatabaseField;
  const views = new Y.Map<YDatabaseView>() as YDatabaseViews;
  const view = new Y.Map() as YDatabaseView;
  const rowOrders = new Y.Array<{ id: string; height: number }>();
  const metas = new Y.Map() as YDatabaseMetas;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  fields.set(fieldId, field);
  rowOrders.push([{ id: rowId, height: 36 }]);
  view.set(YjsDatabaseKey.row_orders, rowOrders);
  views.set('view-id', view);
  metas.set(YjsDatabaseKey.schema_version, schemaVersion);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, metas);
  root.set(YjsEditorKey.database, database);

  return { databaseId, fieldId, rowId, doc, metas };
}

function getCell(rowDoc: YDoc, fieldId: string) {
  const row = rowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

  return row.get(YjsDatabaseKey.cells).get(fieldId) as YDatabaseCell;
}

describe('legacy Web cell field-type migration', () => {
  it('rewrites source_field_type into Desktop-compatible field_type without touching data', async () => {
    const { databaseId, fieldId, rowId, doc, metas } = createMigrationFixture();

    const rawData = 'opt-a,opt-b';
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: {
        data: rawData,
        fieldType: FieldType.RichText,
        sourceType: FieldType.MultiSelect,
      },
    });
    const loadRow = jest.fn(async () => rowDoc);

    await expect(migrateDatabaseFieldTypes(doc, { loadRow })).resolves.toBe(true);

    const cell = getCell(rowDoc, fieldId);

    expect(cell.get(YjsDatabaseKey.data)).toBe(rawData);
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.MultiSelect);
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
    expect(metas.get(YjsDatabaseKey.schema_version)).toBe(DATABASE_SCHEMA_VERSION);
    expect(loadRow).toHaveBeenCalledTimes(1);

    await expect(migrateDatabaseFieldTypes(doc, { loadRow })).resolves.toBe(false);
    expect(loadRow).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes string field_type values that Desktop cannot read as i64', async () => {
    const { databaseId, fieldId, rowId, doc } = createMigrationFixture();
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { data: 'Yes', fieldType: FieldType.Checkbox },
    });
    const cell = getCell(rowDoc, fieldId);

    cell.set(YjsDatabaseKey.field_type, String(FieldType.Checkbox));

    await migrateDatabaseFieldTypes(doc, { loadRow: async () => rowDoc });

    expect(cell.get(YjsDatabaseKey.data)).toBe('Yes');
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.Checkbox);
  });

  it('defers the schema version until row documents are available', async () => {
    const { databaseId, fieldId, rowId, doc, metas } = createMigrationFixture();
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: {
        data: 'option-id',
        fieldType: FieldType.RichText,
        sourceType: FieldType.SingleSelect,
      },
    });

    await expect(migrateDatabaseFieldTypes(doc)).resolves.toBe(true);
    expect(metas.get(YjsDatabaseKey.schema_version)).toBe(2);

    await expect(migrateDatabaseFieldTypes(doc, { loadRow: async () => new Y.Doc() as YDoc })).resolves.toBe(true);
    expect(metas.get(YjsDatabaseKey.schema_version)).toBe(2);

    await expect(migrateDatabaseFieldTypes(doc, { loadRow: async () => rowDoc })).resolves.toBe(true);
    expect(getCell(rowDoc, fieldId).get(YjsDatabaseKey.field_type)).toBe(FieldType.SingleSelect);
    expect(metas.get(YjsDatabaseKey.schema_version)).toBe(DATABASE_SCHEMA_VERSION);
  });

  it('normalizes newly downloaded rows even after the shared schema version advanced', async () => {
    const { databaseId, fieldId, rowId, doc, metas } = createMigrationFixture(DATABASE_SCHEMA_VERSION);
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: {
        data: 'option-id',
        fieldType: FieldType.RichText,
        sourceType: FieldType.SingleSelect,
      },
    });

    await expect(
      migrateDatabaseFieldTypes(doc, {
        loadRow: async () => rowDoc,
        rowIds: [rowId],
      })
    ).resolves.toBe(true);

    expect(getCell(rowDoc, fieldId).get(YjsDatabaseKey.field_type)).toBe(FieldType.SingleSelect);
    expect(getCell(rowDoc, fieldId).get(YjsDatabaseKey.source_field_type)).toBeUndefined();
    expect(metas.get(YjsDatabaseKey.schema_version)).toBe(DATABASE_SCHEMA_VERSION);
  });

  it('normalizes legacy metadata synced by an older Web client after the row is loaded', () => {
    const { databaseId, fieldId, rowId } = createMigrationFixture(DATABASE_SCHEMA_VERSION);
    const rowDoc = createRowDoc(rowId, databaseId, {
      [fieldId]: { data: 'option-id', fieldType: FieldType.RichText },
    });
    const cell = getCell(rowDoc, fieldId);

    installLegacyCellFieldTypeNormalizer(rowDoc);
    rowDoc.transact(() => {
      cell.set(YjsDatabaseKey.field_type, String(FieldType.RichText));
      cell.set(YjsDatabaseKey.source_field_type, String(FieldType.SingleSelect));
    });

    expect(cell.get(YjsDatabaseKey.data)).toBe('option-id');
    expect(cell.get(YjsDatabaseKey.field_type)).toBe(FieldType.SingleSelect);
    expect(cell.get(YjsDatabaseKey.source_field_type)).toBeUndefined();
  });
});
