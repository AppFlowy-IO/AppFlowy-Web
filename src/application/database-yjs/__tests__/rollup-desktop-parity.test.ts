import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import { CalculationType, FieldType, FilterType, RollupDisplayMode, SortCondition } from '@/application/database-yjs/database.type';
import { parseYDatabaseDateTimeCellToCell } from '@/application/database-yjs/cell.parse';
import { TextFilterCondition, parseSelectOptionTypeOptions } from '@/application/database-yjs/fields';
import { getDateCellStr } from '@/application/database-yjs/fields/date/utils';
import { filterBy } from '@/application/database-yjs/filter';
import { readRollupCellSync } from '@/application/database-yjs/rollup/cache';
import { sortBy } from '@/application/database-yjs/sort';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import {
  createBlogPostsAuthorsRelationFixture,
  createCell,
  createRowDoc,
  resolveRollupValue,
  setRelationCellRowIds,
} from './test-helpers';
import {
  RowId,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YDatabaseSort,
  YDatabaseSorts,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

type RollupContext = {
  baseDoc: YDoc;
  database: ReturnType<typeof createBlogPostsAuthorsRelationFixture>['baseDatabase'];
  rollupField: YDatabaseField;
  row: YDatabaseRow;
  rowId: RowId;
  fieldId: string;
  loadView: ReturnType<typeof createBlogPostsAuthorsRelationFixture>['loadView'];
  createRowDoc: ReturnType<typeof createBlogPostsAuthorsRelationFixture>['createRowDoc'];
  getViewIdFromDatabaseId: ReturnType<typeof createBlogPostsAuthorsRelationFixture>['getViewIdFromDatabaseId'];
};

function getRowFromDoc(rowDoc: YDoc): YDatabaseRow {
  return rowDoc
    .getMap(YjsEditorKey.data_section)
    .get(YjsEditorKey.database_row) as YDatabaseRow;
}

function setCellValue(rowDoc: YDoc, fieldId: string, fieldType: FieldType, value: unknown) {
  const row = getRowFromDoc(rowDoc);
  const cells = row.get(YjsDatabaseKey.cells);
  let cell = cells.get(fieldId) as YDatabaseCell | undefined;

  if (!cell) {
    cell = new Y.Map() as YDatabaseCell;
    cells.set(fieldId, cell);
  }

  cell.set(YjsDatabaseKey.field_type, fieldType);
  if (value === undefined) {
    cell.delete(YjsDatabaseKey.data);
  } else {
    cell.set(YjsDatabaseKey.data, value);
  }
}

function findFieldIdByType(fields: YDatabaseFields, fieldType: FieldType): string | null {
  let found: string | null = null;
  fields.forEach((field, id) => {
    if (Number(field.get(YjsDatabaseKey.type)) === fieldType && !found) {
      found = id;
    }
  });
  return found;
}

function ensureField(fields: YDatabaseFields, fieldType: FieldType, fallbackId: string): string {
  const existing = findFieldIdByType(fields, fieldType);
  if (existing) return existing;
  const field = new Y.Map() as YDatabaseField;
  fields.set(fallbackId, field);
  field.set(YjsDatabaseKey.id, fallbackId);
  field.set(YjsDatabaseKey.name, fallbackId);
  field.set(YjsDatabaseKey.type, fieldType);
  return fallbackId;
}

function addRollupField(
  fields: YDatabaseFields,
  fieldId: string,
  options: {
    relationFieldId: string;
    targetFieldId: string;
    calculationType: CalculationType;
    showAs: RollupDisplayMode;
    conditionValue?: string;
  }
) {
  const rollupField = createRollupField(fieldId);
  fields.set(fieldId, rollupField);

  const integratedField = fields.get(fieldId) as YDatabaseField | undefined;
  const rollupOption = integratedField
    ?.get(YjsDatabaseKey.type_option)
    ?.get(String(FieldType.Rollup));

  rollupOption?.set(YjsDatabaseKey.relation_field_id, options.relationFieldId);
  rollupOption?.set(YjsDatabaseKey.target_field_id, options.targetFieldId);
  rollupOption?.set(YjsDatabaseKey.calculation_type, options.calculationType);
  rollupOption?.set(YjsDatabaseKey.show_as, options.showAs);
  rollupOption?.set(YjsDatabaseKey.condition_value, options.conditionValue ?? '');

  return integratedField ?? rollupField;
}

function addRelatedRow(
  fixture: ReturnType<typeof createBlogPostsAuthorsRelationFixture>['relatedFixture'],
  cellMap: Record<string, { fieldType: FieldType; data?: unknown }>
): RowId {
  const rowId = `row-${fixture.rowIds.length}` as RowId;
  const rowDoc = createRowDoc(rowId, fixture.databaseId, cellMap);

  fixture.rowMetas[rowId] = rowDoc;
  fixture.rowIds.push(rowId);
  fixture.rows.push({ id: rowId, height: 0 });

  return rowId;
}

function createFilters(fieldId: string, condition: TextFilterCondition, content = ''): YDatabaseFilters {
  const filtersDoc = new Y.Doc();
  const filters = new Y.Array() as YDatabaseFilters;
  filtersDoc.getMap('root').set('filters', filters);

  const filter = new Y.Map() as YDatabaseFilter;
  filter.set(YjsDatabaseKey.id, `filter-${fieldId}-${condition}`);
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.type, FieldType.Rollup);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, condition);
  filter.set(YjsDatabaseKey.content, content);

  filters.push([filter]);
  return filters;
}

function createSorts(fieldId: string, condition: SortCondition): YDatabaseSorts {
  const doc = new Y.Doc();
  const sorts = new Y.Array() as YDatabaseSorts;
  doc.getMap('root').set('sorts', sorts);

  const sort = new Y.Map() as YDatabaseSort;
  sort.set(YjsDatabaseKey.id, `sort-${fieldId}`);
  sort.set(YjsDatabaseKey.field_id, fieldId);
  sort.set(YjsDatabaseKey.condition, condition);
  sorts.push([sort]);

  return sorts;
}

async function primeRollupCache(contexts: RollupContext[]) {
  await Promise.all(
    contexts.map((context) =>
      resolveRollupValue({
        baseDoc: context.baseDoc,
        database: context.database,
        rollupField: context.rollupField,
        row: context.row,
        rowId: context.rowId,
        fieldId: context.fieldId,
        loadView: context.loadView,
        createRowDoc: context.createRowDoc,
        getViewIdFromDatabaseId: context.getViewIdFromDatabaseId,
      })
    )
  );
}

describe('rollup desktop parity (blog_posts + authors)', () => {
  it('filters rollup list output with text conditions', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'filter' });
    const baseRow1 = fixture.baseRows[0].id as RowId;
    const baseRow2 = fixture.baseRows[1].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const relatedPrimaryFieldId = findFieldIdByType(fixture.relatedFixture.fields, FieldType.RichText);
    if (!relatedPrimaryFieldId) {
      throw new Error('Primary field missing in authors fixture');
    }

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], relatedPrimaryFieldId, FieldType.RichText, 'Same');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], relatedPrimaryFieldId, FieldType.RichText, 'Other');

    setRelationCellRowIds(fixture.baseRowMetas[baseRow1], fixture.relationFieldId, [relatedRow1]);
    setRelationCellRowIds(fixture.baseRowMetas[baseRow2], fixture.relationFieldId, [relatedRow2]);

    const rollupFieldId = 'rollup-filter';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: relatedPrimaryFieldId,
      calculationType: CalculationType.Count,
      showAs: RollupDisplayMode.OriginalList,
    });

    const baseRows = fixture.baseRows.slice(0, 2);
    await primeRollupCache(
      baseRows.map((row) => ({
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[row.id as RowId]),
        rowId: row.id as RowId,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      }))
    );

    const getRollupText = (rowId: string) => {
      const row = getRowFromDoc(fixture.baseRowMetas[rowId as RowId]);
      return readRollupCellSync({
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row,
        rowId: rowId as RowId,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      }).value;
    };

    const cases: Array<{ condition: TextFilterCondition; content: string; expected: RowId }> = [
      { condition: TextFilterCondition.TextIs, content: 'Same', expected: baseRow1 },
      { condition: TextFilterCondition.TextIsNot, content: 'Same', expected: baseRow2 },
      { condition: TextFilterCondition.TextContains, content: 'Same', expected: baseRow1 },
      { condition: TextFilterCondition.TextDoesNotContain, content: 'Same', expected: baseRow2 },
      { condition: TextFilterCondition.TextStartsWith, content: 'Sa', expected: baseRow1 },
      { condition: TextFilterCondition.TextEndsWith, content: 'er', expected: baseRow2 },
    ];

    cases.forEach(({ condition, content, expected }) => {
      const filtered = filterBy(
        baseRows,
        createFilters(rollupFieldId, condition, content),
        fixture.baseFields,
        fixture.baseRowMetas,
        {
          getRollupCellText: getRollupText,
        }
      );
      expect(filtered.map((row) => row.id)).toEqual([expected]);
    });

    setRelationCellRowIds(fixture.baseRowMetas[baseRow1], fixture.relationFieldId, []);
    await primeRollupCache([
      {
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[baseRow1]),
        rowId: baseRow1,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      },
    ]);

    const emptyFiltered = filterBy(
      baseRows,
      createFilters(rollupFieldId, TextFilterCondition.TextIsEmpty),
      fixture.baseFields,
      fixture.baseRowMetas,
      {
        getRollupCellText: getRollupText,
      }
    );
    expect(emptyFiltered.map((row) => row.id)).toEqual([baseRow1]);

    const nonEmptyFiltered = filterBy(
      baseRows,
      createFilters(rollupFieldId, TextFilterCondition.TextIsNotEmpty),
      fixture.baseFields,
      fixture.baseRowMetas,
      {
        getRollupCellText: getRollupText,
      }
    );
    expect(nonEmptyFiltered.map((row) => row.id)).toEqual([baseRow2]);
  });

  it('ignores list-output rollup when sorting', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'sort-list' });
    const baseRow1 = fixture.baseRows[0].id as RowId;
    const baseRow2 = fixture.baseRows[1].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const relatedPrimaryFieldId = findFieldIdByType(fixture.relatedFixture.fields, FieldType.RichText);
    if (!relatedPrimaryFieldId) {
      throw new Error('Primary field missing in authors fixture');
    }

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], relatedPrimaryFieldId, FieldType.RichText, 'B');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], relatedPrimaryFieldId, FieldType.RichText, 'A');

    setRelationCellRowIds(fixture.baseRowMetas[baseRow1], fixture.relationFieldId, [relatedRow1]);
    setRelationCellRowIds(fixture.baseRowMetas[baseRow2], fixture.relationFieldId, [relatedRow2]);

    const rollupFieldId = 'rollup-list-sort';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: relatedPrimaryFieldId,
      calculationType: CalculationType.Count,
      showAs: RollupDisplayMode.OriginalList,
    });

    await primeRollupCache([
      {
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[baseRow1]),
        rowId: baseRow1,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      },
      {
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[baseRow2]),
        rowId: baseRow2,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      },
    ]);

    const sorted = sortBy(
      fixture.baseRows.slice(0, 2),
      createSorts(rollupFieldId, SortCondition.Ascending),
      fixture.baseFields,
      fixture.baseRowMetas,
      {
        getRollupCellValue: (rowId, fieldId) => {
          const row = getRowFromDoc(fixture.baseRowMetas[rowId as RowId]);
          return readRollupCellSync({
            baseDoc: fixture.baseDoc,
            database: fixture.baseDatabase,
            rollupField,
            row,
            rowId: rowId as RowId,
            fieldId,
            loadView: fixture.loadView,
            createRowDoc: fixture.createRowDoc,
            getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
          });
        },
      }
    );

    expect(sorted.map((row) => row.id)).toEqual([baseRow1, baseRow2]);
  });

  it('sorts numeric rollup by raw numeric value', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'sort-numeric' });
    const baseRow1 = fixture.baseRows[0].id as RowId;
    const baseRow2 = fixture.baseRows[1].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const numberFieldId = ensureField(fixture.relatedFixture.fields, FieldType.Number, 'author-number');

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], numberFieldId, FieldType.Number, '10');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], numberFieldId, FieldType.Number, '2');

    setRelationCellRowIds(fixture.baseRowMetas[baseRow1], fixture.relationFieldId, [relatedRow1]);
    setRelationCellRowIds(fixture.baseRowMetas[baseRow2], fixture.relationFieldId, [relatedRow2]);

    const rollupFieldId = 'rollup-numeric-sort';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: numberFieldId,
      calculationType: CalculationType.Sum,
      showAs: RollupDisplayMode.Calculated,
    });
    const rollupOption = rollupField
      .get(YjsDatabaseKey.type_option)
      ?.get(String(FieldType.Rollup));
    expect(rollupOption?.get(YjsDatabaseKey.calculation_type)).toBe(CalculationType.Sum);
    expect(rollupOption?.get(YjsDatabaseKey.show_as)).toBe(RollupDisplayMode.Calculated);
    const targetField = fixture.relatedFixture.fields.get(numberFieldId) as YDatabaseField | undefined;
    expect(Number(targetField?.get(YjsDatabaseKey.type))).toBe(FieldType.Number);
    const row1Cell = getRowFromDoc(fixture.relatedFixture.rowMetas[relatedRow1])
      .get(YjsDatabaseKey.cells)
      .get(numberFieldId) as YDatabaseCell | undefined;
    const row2Cell = getRowFromDoc(fixture.relatedFixture.rowMetas[relatedRow2])
      .get(YjsDatabaseKey.cells)
      .get(numberFieldId) as YDatabaseCell | undefined;
    expect(row1Cell?.get(YjsDatabaseKey.data)).toBe('10');
    expect(row2Cell?.get(YjsDatabaseKey.data)).toBe('2');

    await primeRollupCache([
      {
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[baseRow1]),
        rowId: baseRow1,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      },
      {
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[baseRow2]),
        rowId: baseRow2,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      },
    ]);

    const sorted = sortBy(
      fixture.baseRows.slice(0, 2),
      createSorts(rollupFieldId, SortCondition.Ascending),
      fixture.baseFields,
      fixture.baseRowMetas,
      {
        getRollupCellValue: (rowId, fieldId) => {
          const row = getRowFromDoc(fixture.baseRowMetas[rowId as RowId]);
          return readRollupCellSync({
            baseDoc: fixture.baseDoc,
            database: fixture.baseDatabase,
            rollupField,
            row,
            rowId: rowId as RowId,
            fieldId,
            loadView: fixture.loadView,
            createRowDoc: fixture.createRowDoc,
            getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
          });
        },
      }
    );

    expect(sorted.map((row) => row.id)).toEqual([baseRow2, baseRow1]);
  });

  it('handles original vs unique list rollups', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'list' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const relatedPrimaryFieldId = findFieldIdByType(fixture.relatedFixture.fields, FieldType.RichText);
    if (!relatedPrimaryFieldId) {
      throw new Error('Primary field missing in authors fixture');
    }

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], relatedPrimaryFieldId, FieldType.RichText, 'Same');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], relatedPrimaryFieldId, FieldType.RichText, 'Same');

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1, relatedRow2]);

    const originalRollupId = 'rollup-original';
    const originalField = addRollupField(fixture.baseFields, originalRollupId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: relatedPrimaryFieldId,
      calculationType: CalculationType.Count,
      showAs: RollupDisplayMode.OriginalList,
    });

    const uniqueRollupId = 'rollup-unique';
    const uniqueField = addRollupField(fixture.baseFields, uniqueRollupId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: relatedPrimaryFieldId,
      calculationType: CalculationType.Count,
      showAs: RollupDisplayMode.UniqueList,
    });

    const original = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: originalField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: originalRollupId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    const unique = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: uniqueField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: uniqueRollupId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    expect(original.value).toBe('Same, Same');
    expect(unique.value).toBe('Same');
  });

  it('counts matching select option with CountValue', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'count-value' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const selectFieldId = fixture.relatedFixture.fieldIdByName.get('Department');
    if (!selectFieldId) {
      throw new Error('Department field missing in authors fixture');
    }

    const selectField = fixture.relatedFixture.fields.get(selectFieldId) as YDatabaseField;
    const selectOptions = parseSelectOptionTypeOptions(selectField).options;
    if (selectOptions.length < 2) {
      throw new Error('Expected at least 2 select options');
    }

    const optionA = selectOptions[0].id;
    const optionB = selectOptions[1].id;

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], selectFieldId, FieldType.SingleSelect, optionA);
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], selectFieldId, FieldType.SingleSelect, optionB);

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1, relatedRow2]);

    const rollupFieldId = 'rollup-count-value';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: selectFieldId,
      calculationType: CalculationType.CountValue,
      showAs: RollupDisplayMode.Calculated,
      conditionValue: optionA,
    });

    const value = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: rollupFieldId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    expect(value.value).toBe('1');
  });

  it('counts related rows when target field is empty', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'count-related' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1, relatedRow2]);

    const rollupFieldId = 'rollup-count-related';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: '',
      calculationType: CalculationType.Count,
      showAs: RollupDisplayMode.Calculated,
    });

    const value = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: rollupFieldId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    expect(value.value).toBe('2');
  });

  it('calculates numeric rollups (min/max/avg/sum/range)', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'numeric' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const numberFieldId = ensureField(fixture.relatedFixture.fields, FieldType.Number, 'author-number');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], numberFieldId, FieldType.Number, '10');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], numberFieldId, FieldType.Number, '2');

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1, relatedRow2]);

    const cases: Array<[string, CalculationType, number]> = [
      ['rollup-min', CalculationType.Min, 2],
      ['rollup-max', CalculationType.Max, 10],
      ['rollup-avg', CalculationType.Average, 6],
      ['rollup-sum', CalculationType.Sum, 12],
      ['rollup-range', CalculationType.NumberRange, 8],
    ];

    for (const [fieldId, calc, expected] of cases) {
      const rollupField = addRollupField(fixture.baseFields, fieldId, {
        relationFieldId: fixture.relationFieldId,
        targetFieldId: numberFieldId,
        calculationType: calc,
        showAs: RollupDisplayMode.Calculated,
      });
      const value = await resolveRollupValue({
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
        rowId: baseRowId,
        fieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      });
      expect(value.rawNumeric).toBeDefined();
      expect(Math.abs((value.rawNumeric ?? 0) - expected)).toBeLessThan(0.001);
    }
  });

  it('calculates empty/non-empty counts and percents', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'empty' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const numberFieldId = ensureField(fixture.relatedFixture.fields, FieldType.Number, 'author-number');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], numberFieldId, FieldType.Number, '1');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], numberFieldId, FieldType.Number, '');

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1, relatedRow2]);

    const countEmptyId = 'rollup-count-empty';
    const countEmptyField = addRollupField(fixture.baseFields, countEmptyId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: numberFieldId,
      calculationType: CalculationType.CountEmpty,
      showAs: RollupDisplayMode.Calculated,
    });

    const countNonEmptyId = 'rollup-count-non-empty';
    const countNonEmptyField = addRollupField(fixture.baseFields, countNonEmptyId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: numberFieldId,
      calculationType: CalculationType.CountNonEmpty,
      showAs: RollupDisplayMode.Calculated,
    });

    const percentEmptyId = 'rollup-percent-empty';
    const percentEmptyField = addRollupField(fixture.baseFields, percentEmptyId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: numberFieldId,
      calculationType: CalculationType.PercentEmpty,
      showAs: RollupDisplayMode.Calculated,
    });

    const percentNotEmptyId = 'rollup-percent-not-empty';
    const percentNotEmptyField = addRollupField(fixture.baseFields, percentNotEmptyId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: numberFieldId,
      calculationType: CalculationType.PercentNotEmpty,
      showAs: RollupDisplayMode.Calculated,
    });

    const countEmpty = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: countEmptyField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: countEmptyId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    const countNonEmpty = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: countNonEmptyField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: countNonEmptyId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    const percentEmpty = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: percentEmptyField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: percentEmptyId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    const percentNotEmpty = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: percentNotEmptyField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: percentNotEmptyId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    expect(countEmpty.rawNumeric).toBe(1);
    expect(countNonEmpty.rawNumeric).toBe(1);
    expect(percentEmpty.value).toContain('%');
    expect(percentNotEmpty.value).toContain('%');
  });

  it('deduplicates related values for CountUnique', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'unique' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const relatedPrimaryFieldId = findFieldIdByType(fixture.relatedFixture.fields, FieldType.RichText);
    if (!relatedPrimaryFieldId) {
      throw new Error('Primary field missing in authors fixture');
    }

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], relatedPrimaryFieldId, FieldType.RichText, 'Same');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], relatedPrimaryFieldId, FieldType.RichText, 'Same');

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1, relatedRow2]);

    const rollupFieldId = 'rollup-unique-count';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: relatedPrimaryFieldId,
      calculationType: CalculationType.CountUnique,
      showAs: RollupDisplayMode.Calculated,
    });

    const value = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: rollupFieldId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    expect(value.value).toBe('1');
  });

  it('updates rollup values when related data changes', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'reactive' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const relatedPrimaryFieldId = findFieldIdByType(fixture.relatedFixture.fields, FieldType.RichText);
    if (!relatedPrimaryFieldId) {
      throw new Error('Primary field missing in authors fixture');
    }

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], relatedPrimaryFieldId, FieldType.RichText, 'Before');
    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1]);

    const listRollupId = 'rollup-list-reactive';
    const listRollupField = addRollupField(fixture.baseFields, listRollupId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: relatedPrimaryFieldId,
      calculationType: CalculationType.Count,
      showAs: RollupDisplayMode.OriginalList,
    });

    const countRollupId = 'rollup-count-reactive';
    const countRollupField = addRollupField(fixture.baseFields, countRollupId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: '',
      calculationType: CalculationType.Count,
      showAs: RollupDisplayMode.Calculated,
    });

    const initialList = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: listRollupField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: listRollupId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    expect(initialList.value).toBe('Before');

    const initialCount = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: countRollupField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: countRollupId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    expect(initialCount.value).toBe('1');

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], relatedPrimaryFieldId, FieldType.RichText, 'After');
    const updatedList = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: listRollupField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: listRollupId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    expect(updatedList.value).toBe('After');

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1, relatedRow2]);
    const updatedCount = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: countRollupField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: countRollupId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    expect(updatedCount.value).toBe('2');
  });

  it('calculates earliest/latest/range for dates', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'date' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const dateFieldId = ensureField(fixture.relatedFixture.fields, FieldType.DateTime, 'author-date');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], dateFieldId, FieldType.DateTime, '0');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], dateFieldId, FieldType.DateTime, String(2 * 86400));

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1, relatedRow2]);

    const earliestId = 'rollup-date-earliest';
    const earliestField = addRollupField(fixture.baseFields, earliestId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: dateFieldId,
      calculationType: CalculationType.DateEarliest,
      showAs: RollupDisplayMode.Calculated,
    });

    const latestId = 'rollup-date-latest';
    const latestField = addRollupField(fixture.baseFields, latestId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: dateFieldId,
      calculationType: CalculationType.DateLatest,
      showAs: RollupDisplayMode.Calculated,
    });

    const rangeId = 'rollup-date-range';
    const rangeField = addRollupField(fixture.baseFields, rangeId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: dateFieldId,
      calculationType: CalculationType.DateRange,
      showAs: RollupDisplayMode.Calculated,
    });

    const earliestValue = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: earliestField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: earliestId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    const latestValue = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: latestField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: latestId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    const rangeValue = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: rangeField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: rangeId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    const relatedRowDoc1 = fixture.relatedFixture.rowMetas[relatedRow1];
    const relatedRowDoc2 = fixture.relatedFixture.rowMetas[relatedRow2];
    const relatedRow1Cell = getRowFromDoc(relatedRowDoc1)
      .get(YjsDatabaseKey.cells)
      .get(dateFieldId) as YDatabaseCell;
    const relatedRow2Cell = getRowFromDoc(relatedRowDoc2)
      .get(YjsDatabaseKey.cells)
      .get(dateFieldId) as YDatabaseCell;

    const dateField = fixture.relatedFixture.fields.get(dateFieldId) as YDatabaseField;
    const expectedEarliest = getDateCellStr({
      cell: parseYDatabaseDateTimeCellToCell(relatedRow1Cell),
      field: dateField,
    });
    const expectedLatest = getDateCellStr({
      cell: parseYDatabaseDateTimeCellToCell(relatedRow2Cell),
      field: dateField,
    });

    expect(earliestValue.value).toBe(expectedEarliest);
    expect(latestValue.value).toBe(expectedLatest);
    expect(rangeValue.value).toBe('2 days');
  });

  it('calculates checked/unchecked counts and percents', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'checkbox' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const checkboxFieldId = ensureField(fixture.relatedFixture.fields, FieldType.Checkbox, 'author-checkbox');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], checkboxFieldId, FieldType.Checkbox, 'Yes');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], checkboxFieldId, FieldType.Checkbox, 'No');

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [relatedRow1, relatedRow2]);

    const checkedId = 'rollup-checked';
    const checkedField = addRollupField(fixture.baseFields, checkedId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: checkboxFieldId,
      calculationType: CalculationType.CountChecked,
      showAs: RollupDisplayMode.Calculated,
    });

    const uncheckedId = 'rollup-unchecked';
    const uncheckedField = addRollupField(fixture.baseFields, uncheckedId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: checkboxFieldId,
      calculationType: CalculationType.CountUnchecked,
      showAs: RollupDisplayMode.Calculated,
    });

    const checked = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: checkedField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: checkedId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    const unchecked = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: uncheckedField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: uncheckedId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    expect(checked.value).toBe('1');
    expect(unchecked.value).toBe('1');

    const percentCheckedId = 'rollup-percent-checked';
    const percentCheckedField = addRollupField(fixture.baseFields, percentCheckedId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: checkboxFieldId,
      calculationType: CalculationType.PercentChecked,
      showAs: RollupDisplayMode.Calculated,
    });

    const percentUncheckedId = 'rollup-percent-unchecked';
    const percentUncheckedField = addRollupField(fixture.baseFields, percentUncheckedId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: checkboxFieldId,
      calculationType: CalculationType.PercentUnchecked,
      showAs: RollupDisplayMode.Calculated,
    });

    const percentChecked = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: percentCheckedField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: percentCheckedId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    const percentUnchecked = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: percentUncheckedField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: percentUncheckedId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    expect(percentChecked.value).toBe('50.0%');
    expect(percentUnchecked.value).toBe('50.0%');
  });

  it('calculates median and mode for numeric rollups', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'median' });
    const baseRowId = fixture.baseRows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const numberFieldId = ensureField(fixture.relatedFixture.fields, FieldType.Number, 'author-number');

    const relatedRow3 = addRelatedRow(fixture.relatedFixture, {
      [numberFieldId]: createCell(FieldType.Number, '10'),
    });

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], numberFieldId, FieldType.Number, '2');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], numberFieldId, FieldType.Number, '2');

    setRelationCellRowIds(fixture.baseRowMetas[baseRowId], fixture.relationFieldId, [
      relatedRow1,
      relatedRow2,
      relatedRow3,
    ]);

    const medianId = 'rollup-median';
    const medianField = addRollupField(fixture.baseFields, medianId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: numberFieldId,
      calculationType: CalculationType.Median,
      showAs: RollupDisplayMode.Calculated,
    });

    const modeId = 'rollup-mode';
    const modeField = addRollupField(fixture.baseFields, modeId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: numberFieldId,
      calculationType: CalculationType.NumberMode,
      showAs: RollupDisplayMode.Calculated,
    });

    const median = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: medianField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: medianId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });
    const mode = await resolveRollupValue({
      baseDoc: fixture.baseDoc,
      database: fixture.baseDatabase,
      rollupField: modeField,
      row: getRowFromDoc(fixture.baseRowMetas[baseRowId]),
      rowId: baseRowId,
      fieldId: modeId,
      loadView: fixture.loadView,
      createRowDoc: fixture.createRowDoc,
      getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
    });

    expect(median.rawNumeric).toBeCloseTo(2, 3);
    expect(mode.rawNumeric).toBeCloseTo(2, 3);
  });

  it('sorts percent-checked rollup by raw numeric value', async () => {
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'percent-sort' });
    const baseRow1 = fixture.baseRows[0].id as RowId;
    const baseRow2 = fixture.baseRows[1].id as RowId;

    const checkboxFieldId = ensureField(fixture.relatedFixture.fields, FieldType.Checkbox, 'author-checkbox');
    const relatedRow1 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow2 = fixture.relatedFixture.rows[1].id as RowId;

    const relatedRow3 = addRelatedRow(fixture.relatedFixture, {
      [checkboxFieldId]: createCell(FieldType.Checkbox, 'Yes'),
    });
    const relatedRow4 = addRelatedRow(fixture.relatedFixture, {
      [checkboxFieldId]: createCell(FieldType.Checkbox, 'Yes'),
    });

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], checkboxFieldId, FieldType.Checkbox, 'Yes');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow2], checkboxFieldId, FieldType.Checkbox, 'No');

    setRelationCellRowIds(fixture.baseRowMetas[baseRow1], fixture.relationFieldId, [relatedRow1, relatedRow2]);
    setRelationCellRowIds(fixture.baseRowMetas[baseRow2], fixture.relationFieldId, [relatedRow3, relatedRow4]);

    const rollupFieldId = 'rollup-percent-sort';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: checkboxFieldId,
      calculationType: CalculationType.PercentChecked,
      showAs: RollupDisplayMode.Calculated,
    });

    await primeRollupCache([
      {
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[baseRow1]),
        rowId: baseRow1,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      },
      {
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[baseRow2]),
        rowId: baseRow2,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRowDoc: fixture.createRowDoc,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      },
    ]);

    const sorted = sortBy(
      fixture.baseRows.slice(0, 2),
      createSorts(rollupFieldId, SortCondition.Ascending),
      fixture.baseFields,
      fixture.baseRowMetas,
      {
        getRollupCellValue: (rowId, fieldId) => {
          const row = getRowFromDoc(fixture.baseRowMetas[rowId as RowId]);
          return readRollupCellSync({
            baseDoc: fixture.baseDoc,
            database: fixture.baseDatabase,
            rollupField,
            row,
            rowId: rowId as RowId,
            fieldId,
            loadView: fixture.loadView,
            createRowDoc: fixture.createRowDoc,
            getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
          });
        },
      }
    );

    expect(sorted.map((row) => row.id)).toEqual([baseRow1, baseRow2]);
  });
});
