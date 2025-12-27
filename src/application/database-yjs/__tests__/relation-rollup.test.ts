import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { parseRelationTypeOption } from '@/application/database-yjs/fields/relation/parse';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { readRelationCellText, subscribeRelationCache } from '@/application/database-yjs/relation/cache';
import { readRollupCellSync, subscribeRollupCell } from '@/application/database-yjs/rollup/cache';
import {
  YDatabase,
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

function createTextField(fieldId: string, name: string, isPrimary = false): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, FieldType.RichText);
  if (isPrimary) {
    field.set(YjsDatabaseKey.is_primary, true);
  }
  return field;
}

function createNumberField(fieldId: string, name: string): YDatabaseField {
  const field = new Y.Map() as YDatabaseField;
  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, name);
  field.set(YjsDatabaseKey.type, FieldType.Number);
  return field;
}

function createDatabaseDoc(databaseId: string, viewId: string, fields: YDatabaseFields): YDoc {
  const doc = new Y.Doc() as YDoc;
  doc.guid = viewId;
  doc.object_id = viewId;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map() as YDatabase;
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function createCell(data: unknown, fieldType: FieldType): YDatabaseCell {
  const cell = new Y.Map() as YDatabaseCell;
  cell.set(YjsDatabaseKey.data, data);
  cell.set(YjsDatabaseKey.field_type, fieldType);
  return cell;
}

function createRowDoc(
  rowId: string,
  databaseId: string,
  cellMap: Record<string, YDatabaseCell>
): YDoc {
  const doc = new Y.Doc() as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map() as YDatabaseRow;
  const cells = new Y.Map() as YDatabaseCells;

  Object.entries(cellMap).forEach(([fieldId, cell]) => {
    cells.set(fieldId, cell);
  });

  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.database_id, databaseId);
  row.set(YjsDatabaseKey.cells, cells);
  row.set(YjsDatabaseKey.created_at, '0');
  row.set(YjsDatabaseKey.last_modified, '0');
  sharedRoot.set(YjsEditorKey.database_row, row);
  return doc;
}

function createFixture({
  suffix,
  rollups = [],
}: {
  suffix: string;
  rollups?: Array<{
    fieldId: string;
    targetFieldId: string;
    calculationType: CalculationType;
    showAs: RollupDisplayMode;
  }>;
}) {
  const relatedDatabaseId = `related-db-${suffix}`;
  const relatedViewId = `related-view-${suffix}`;
  const baseDatabaseId = `base-db-${suffix}`;
  const baseViewId = `base-view-${suffix}`;

  const relationFieldId = `relation-${suffix}`;
  const primaryFieldId = `name-${suffix}`;
  const scoreFieldId = `score-${suffix}`;
  const baseRowId = `base-row-${suffix}`;
  const relatedRowIds = [`rel-row-1-${suffix}`, `rel-row-2-${suffix}`];

  const relatedFields = new Y.Map() as YDatabaseFields;
  relatedFields.set(primaryFieldId, createTextField(primaryFieldId, 'Name', true));
  relatedFields.set(scoreFieldId, createNumberField(scoreFieldId, 'Score'));
  const relatedDoc = createDatabaseDoc(relatedDatabaseId, relatedViewId, relatedFields);

  const relatedRowDocs = new Map<string, YDoc>();
  const relatedRows = [
    { id: relatedRowIds[0], name: 'Alice', score: '10' },
    { id: relatedRowIds[1], name: 'Bob', score: '20' },
  ];
  relatedRows.forEach((row) => {
    const rowDoc = createRowDoc(row.id, relatedDatabaseId, {
      [primaryFieldId]: createCell(row.name, FieldType.RichText),
      [scoreFieldId]: createCell(row.score, FieldType.Number),
    });
    relatedRowDocs.set(row.id, rowDoc);
  });

  const relationField = createRelationField(relationFieldId);
  relationField.set(YjsDatabaseKey.name, 'Authors');

  const baseFields = new Y.Map() as YDatabaseFields;
  baseFields.set(`title-${suffix}`, createTextField(`title-${suffix}`, 'Title', true));
  baseFields.set(relationFieldId, relationField);

  rollups.forEach((rollupConfig) => {
    const rollupField = createRollupField(rollupConfig.fieldId);
    baseFields.set(rollupConfig.fieldId, rollupField);
  });

  const baseDoc = createDatabaseDoc(baseDatabaseId, baseViewId, baseFields);
  const relationIds = new Y.Array<string>();
  relationIds.push(relatedRowIds);

  const baseRowDoc = createRowDoc(baseRowId, baseDatabaseId, {
    [relationFieldId]: createCell(relationIds, FieldType.Relation),
  });
  const baseRow = baseRowDoc
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database_row) as YDatabaseRow;

  const createRowDocFn = async (rowKey: string) => {
    const rowId = rowKey.includes('_rows_') ? rowKey.split('_rows_').pop() ?? '' : rowKey;
    return relatedRowDocs.get(rowId) ?? null;
  };
  const loadView = async (viewId: string) => (viewId === relatedViewId ? relatedDoc : null);
  const getViewIdFromDatabaseId = async (databaseId: string) =>
    databaseId === relatedDatabaseId ? relatedViewId : null;

  const baseDatabase = baseDoc
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database) as YDatabase;

  const integratedRelationField = baseDatabase
    .get(YjsDatabaseKey.fields)
    ?.get(relationFieldId) as YDatabaseField | undefined;
  const integratedRelationOption = integratedRelationField
    ?.get(YjsDatabaseKey.type_option)
    ?.get(String(FieldType.Relation));
  integratedRelationOption?.set(YjsDatabaseKey.database_id, relatedDatabaseId);

  rollups.forEach((rollupConfig) => {
    const rollupField = baseDatabase
      .get(YjsDatabaseKey.fields)
      ?.get(rollupConfig.fieldId) as YDatabaseField | undefined;
    const rollupOption = rollupField
      ?.get(YjsDatabaseKey.type_option)
      ?.get(String(FieldType.Rollup));
    rollupOption?.set(YjsDatabaseKey.relation_field_id, relationFieldId);
    rollupOption?.set(YjsDatabaseKey.target_field_id, rollupConfig.targetFieldId);
    rollupOption?.set(YjsDatabaseKey.calculation_type, rollupConfig.calculationType);
    rollupOption?.set(YjsDatabaseKey.show_as, rollupConfig.showAs);
  });

  return {
    baseDoc,
    baseDatabase,
    baseRow,
    baseRowId,
    relationField,
    relationFieldId,
    primaryFieldId,
    scoreFieldId,
    relatedDatabaseId,
    relatedViewId,
    relatedRowIds,
    createRowDocFn,
    loadView,
    getViewIdFromDatabaseId,
  };
}

describe('relation and rollup basics', () => {
  it('resolves relation cell text from related primary field values', async () => {
    const fixture = createFixture({ suffix: 'relation' });
    const relationOption = parseRelationTypeOption(fixture.relationField);
    expect(relationOption?.database_id).toBe(fixture.relatedDatabaseId);
    const relationCell = fixture.baseRow.get(YjsDatabaseKey.cells)?.get(fixture.relationFieldId);
    const relationData = relationCell?.get(YjsDatabaseKey.data);
    expect(
      relationData && typeof relationData === 'object' && 'toJSON' in relationData
        ? (relationData as { toJSON: () => unknown }).toJSON()
        : []
    ).toEqual(fixture.relatedRowIds);
    const rowKey = `${fixture.relatedViewId}_rows_${fixture.relatedRowIds[0]}`;
    const relatedRowDoc = await fixture.createRowDocFn(rowKey);
    expect(relatedRowDoc).not.toBeNull();
    const context = {
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      relationField: fixture.relationField,
      row: fixture.baseRow,
      rowId: fixture.baseRowId,
      fieldId: fixture.relationFieldId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDocFn,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    };

    const resultPromise = new Promise<string>((resolve) => {
      const unsubscribe = subscribeRelationCache(() => {
        const value = readRelationCellText(context);
        unsubscribe();
        resolve(value);
      });
    });

    readRelationCellText(context);
    const value = await resultPromise;

    expect(value).toBe('Alice, Bob');
  });

  it('computes rollup sum for numeric target fields', async () => {
    const rollupFieldId = 'rollup-sum';
    const suffix = 'rollup-sum';
    const fixture = createFixture({
      suffix,
      rollups: [
        {
          fieldId: rollupFieldId,
          targetFieldId: `score-${suffix}`,
          calculationType: CalculationType.Sum,
          showAs: RollupDisplayMode.Calculated,
        },
      ],
    });

    const cellId = `${fixture.baseRowId}:${rollupFieldId}`;
    const resultPromise = new Promise<ReturnType<typeof readRollupCellSync>>((resolve) => {
      const unsubscribe = subscribeRollupCell(cellId, (value) => {
        unsubscribe();
        resolve(value);
      });
    });

    readRollupCellSync({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: fixture.baseDatabase.get(YjsDatabaseKey.fields).get(rollupFieldId) as YDatabaseField,
      row: fixture.baseRow,
      rowId: fixture.baseRowId,
      fieldId: rollupFieldId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDocFn,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    const value = await resultPromise;
    expect(value.value).toBe('30');
    expect(value.rawNumeric).toBe(30);
  });

  it('returns rollup original list values when configured', async () => {
    const rollupFieldId = 'rollup-list';
    const suffix = 'rollup-list';
    const fixture = createFixture({
      suffix,
      rollups: [
        {
          fieldId: rollupFieldId,
          targetFieldId: `name-${suffix}`,
          calculationType: CalculationType.Count,
          showAs: RollupDisplayMode.OriginalList,
        },
      ],
    });

    const cellId = `${fixture.baseRowId}:${rollupFieldId}`;
    const resultPromise = new Promise<ReturnType<typeof readRollupCellSync>>((resolve) => {
      const unsubscribe = subscribeRollupCell(cellId, (value) => {
        unsubscribe();
        resolve(value);
      });
    });

    readRollupCellSync({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: fixture.baseDatabase.get(YjsDatabaseKey.fields).get(rollupFieldId) as YDatabaseField,
      row: fixture.baseRow,
      rowId: fixture.baseRowId,
      fieldId: rollupFieldId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDocFn,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    const value = await resultPromise;
    expect(value.value).toBe('Alice, Bob');
    expect(value.list).toEqual(['Alice', 'Bob']);
  });
});
