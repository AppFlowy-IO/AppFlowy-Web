import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';
import { createRelationField } from '@/application/database-yjs/fields/relation/utils';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { readRollupCell } from '@/application/database-yjs/rollup/cache';
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

function createRelationCell(rowIds: string[]): YDatabaseCell {
  const ids = new Y.Array<string>();

  ids.push(rowIds);
  return createCell(ids, FieldType.Relation);
}

function createRowDoc(rowId: string, databaseId: string, cellMap: Record<string, YDatabaseCell>): YDoc {
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

/**
 * Reproduces the `project_templates` workspace: `03_epics.Opportunity` is a
 * Rollup that walks `Related Proj` into `02_projects` and reads `Primary Opp`,
 * which is itself a Relation into `01_opportunities`. The rolled-up value is a
 * row id, so it only reads as a name after the second hop is resolved.
 */
function createChainFixture(
  suffix: string,
  showAs: RollupDisplayMode,
  projectOpportunityIndexes: number[][] = [[0], [0]]
) {
  const opportunityDatabaseId = `opportunity-db-${suffix}`;
  const opportunityViewId = `opportunity-view-${suffix}`;
  const projectDatabaseId = `project-db-${suffix}`;
  const projectViewId = `project-view-${suffix}`;
  const epicDatabaseId = `epic-db-${suffix}`;
  const epicViewId = `epic-view-${suffix}`;

  const opportunityNameFieldId = `opportunity-name-${suffix}`;
  const projectNameFieldId = `project-name-${suffix}`;
  const projectOpportunityFieldId = `primary-opp-${suffix}`;
  const epicNameFieldId = `epic-name-${suffix}`;
  const epicProjectFieldId = `related-proj-${suffix}`;
  const rollupFieldId = `opportunity-rollup-${suffix}`;

  const opportunityRowIds = [`opp-row-1-${suffix}`, `opp-row-2-${suffix}`];
  const projectRowIds = [`project-row-1-${suffix}`, `project-row-2-${suffix}`];
  const epicRowId = `epic-row-${suffix}`;

  // 01_opportunities
  const opportunityFields = new Y.Map() as YDatabaseFields;

  opportunityFields.set(opportunityNameFieldId, createTextField(opportunityNameFieldId, 'Opportunity ID', true));
  const opportunityDoc = createDatabaseDoc(opportunityDatabaseId, opportunityViewId, opportunityFields);

  // 02_projects, holding a Relation into 01_opportunities
  const projectOpportunityField = createRelationField(projectOpportunityFieldId, {
    name: 'Primary Opp',
    database_id: opportunityDatabaseId,
  });
  const projectFields = new Y.Map() as YDatabaseFields;

  projectFields.set(projectNameFieldId, createTextField(projectNameFieldId, 'Project ID', true));
  projectFields.set(projectOpportunityFieldId, projectOpportunityField);
  const projectDoc = createDatabaseDoc(projectDatabaseId, projectViewId, projectFields);

  // 03_epics, holding a Relation into 02_projects plus the Rollup under test
  const epicProjectField = createRelationField(epicProjectFieldId, {
    name: 'Related Proj',
    database_id: projectDatabaseId,
  });
  const epicFields = new Y.Map() as YDatabaseFields;

  epicFields.set(epicNameFieldId, createTextField(epicNameFieldId, 'Epic ID', true));
  epicFields.set(epicProjectFieldId, epicProjectField);
  epicFields.set(rollupFieldId, createRollupField(rollupFieldId));
  const epicDoc = createDatabaseDoc(epicDatabaseId, epicViewId, epicFields);

  const epicDatabase = epicDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
  const rollupOption = (epicDatabase.get(YjsDatabaseKey.fields)?.get(rollupFieldId) as YDatabaseField | undefined)
    ?.get(YjsDatabaseKey.type_option)
    ?.get(String(FieldType.Rollup));

  rollupOption?.set(YjsDatabaseKey.relation_field_id, epicProjectFieldId);
  rollupOption?.set(YjsDatabaseKey.target_field_id, projectOpportunityFieldId);
  rollupOption?.set(YjsDatabaseKey.calculation_type, CalculationType.Count);
  rollupOption?.set(YjsDatabaseKey.show_as, showAs);

  const rowDocs = new Map<string, YDoc>();

  rowDocs.set(
    opportunityRowIds[0],
    createRowDoc(opportunityRowIds[0], opportunityDatabaseId, {
      [opportunityNameFieldId]: createCell('OPP-001', FieldType.RichText),
    })
  );
  rowDocs.set(
    opportunityRowIds[1],
    createRowDoc(opportunityRowIds[1], opportunityDatabaseId, {
      [opportunityNameFieldId]: createCell('OPP-002', FieldType.RichText),
    })
  );
  // Both projects point at the same opportunity by default, so UniqueList must collapse them.
  rowDocs.set(
    projectRowIds[0],
    createRowDoc(projectRowIds[0], projectDatabaseId, {
      [projectNameFieldId]: createCell('PRJ-001', FieldType.RichText),
      [projectOpportunityFieldId]: createRelationCell(
        projectOpportunityIndexes[0].map((index) => opportunityRowIds[index])
      ),
    })
  );
  rowDocs.set(
    projectRowIds[1],
    createRowDoc(projectRowIds[1], projectDatabaseId, {
      [projectNameFieldId]: createCell('PRJ-002', FieldType.RichText),
      [projectOpportunityFieldId]: createRelationCell(
        projectOpportunityIndexes[1].map((index) => opportunityRowIds[index])
      ),
    })
  );

  const epicRowDoc = createRowDoc(epicRowId, epicDatabaseId, {
    [epicNameFieldId]: createCell('EPC-001', FieldType.RichText),
    [epicProjectFieldId]: createRelationCell(projectRowIds),
  });
  const epicRow = epicRowDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database_row) as YDatabaseRow;

  const docsByView: Record<string, YDoc> = {
    [opportunityViewId]: opportunityDoc,
    [projectViewId]: projectDoc,
    [epicViewId]: epicDoc,
  };
  const viewIdByDatabaseId: Record<string, string> = {
    [opportunityDatabaseId]: opportunityViewId,
    [projectDatabaseId]: projectViewId,
    [epicDatabaseId]: epicViewId,
  };

  return {
    context: {
      baseDoc: epicDoc,
      database: epicDatabase,
      rollupField: epicDatabase.get(YjsDatabaseKey.fields)?.get(rollupFieldId) as YDatabaseField,
      row: epicRow,
      rowId: epicRowId,
      fieldId: rollupFieldId,
      loadView: async (viewId: string) => docsByView[viewId] ?? null,
      createRow: async (rowKey: string) => {
        const rowId = rowKey.includes('_rows_') ? rowKey.split('_rows_').pop() ?? '' : rowKey;

        return rowDocs.get(rowId) as YDoc;
      },
      getViewIdFromDatabaseId: async (databaseId: string) => viewIdByDatabaseId[databaseId] ?? null,
    },
    opportunityRowIds,
    opportunityViewId,
  };
}

describe('rollup over a Relation target field', () => {
  it('resolves the second hop to related row names instead of raw row ids', async () => {
    const { context, opportunityRowIds, opportunityViewId } = createChainFixture(
      'original-list',
      RollupDisplayMode.OriginalList
    );

    const result = await readRollupCell(context);

    expect(result.list).toEqual(['OPP-001', 'OPP-001']);
    expect(result.listItems).toEqual([
      { label: 'OPP-001', rowId: opportunityRowIds[0], viewId: opportunityViewId },
      { label: 'OPP-001', rowId: opportunityRowIds[0], viewId: opportunityViewId },
    ]);
    expect(result.value).toBe('OPP-001, OPP-001');
    opportunityRowIds.forEach((rowId) => {
      expect(result.value).not.toContain(rowId);
    });
  });

  it('deduplicates resolved names for UniqueList', async () => {
    const { context, opportunityRowIds, opportunityViewId } = createChainFixture(
      'unique-list',
      RollupDisplayMode.UniqueList
    );

    const result = await readRollupCell(context);

    expect(result.list).toEqual(['OPP-001']);
    expect(result.listItems).toEqual([{ label: 'OPP-001', rowId: opportunityRowIds[0], viewId: opportunityViewId }]);
    expect(result.value).toBe('OPP-001');
  });

  it('flattens multiple second-hop rows before applying UniqueList', async () => {
    const { context, opportunityRowIds, opportunityViewId } = createChainFixture(
      'unique-multiple',
      RollupDisplayMode.UniqueList,
      [[0, 1], [0]]
    );

    const result = await readRollupCell(context);

    expect(result.list).toEqual(['OPP-001', 'OPP-002']);
    expect(result.listItems).toEqual([
      { label: 'OPP-001', rowId: opportunityRowIds[0], viewId: opportunityViewId },
      { label: 'OPP-002', rowId: opportunityRowIds[1], viewId: opportunityViewId },
    ]);
    expect(result.value).toBe('OPP-001, OPP-002');
  });

  it('counts related rows whose Relation target resolves to a name', async () => {
    const { context } = createChainFixture('calculated', RollupDisplayMode.Calculated);
    const countingContext = { ...context };

    (
      countingContext.rollupField.get(YjsDatabaseKey.type_option)?.get(String(FieldType.Rollup)) as
        | { set: (key: string, value: unknown) => void }
        | undefined
    )?.set(YjsDatabaseKey.calculation_type, CalculationType.CountNonEmpty);

    const result = await readRollupCell(countingContext);

    expect(result.value).toBe('2');
  });
});
