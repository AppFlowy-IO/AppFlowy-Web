/**
 * Rollup filter condition matrix — desktop parity.
 *
 * Mirrors two desktop integration tests:
 *
 *   1. database_rollup_filter_number_conditions_test.dart
 *      "rollup number filter supports all conditions"
 *      Verifies all 8 NumberFilterConditionPB values applied to a numeric rollup.
 *
 *   2. database_rollup_filter_select_dropdown_test.dart
 *      "rollup filter shows option dropdown when target is SingleSelect"
 *      Verifies a rollup whose target is SingleSelect filters by option name.
 *      (We test the data-layer matching here; the option-picker UI is covered
 *      by playwright/e2e/database/filter-editors-desktop-parity.spec.ts.)
 *
 * The text-condition matrix for list-output rollups is already covered by
 * `rollup-desktop-parity.test.ts`'s "filters rollup list output with text
 * conditions" — not duplicated here.
 */
import * as Y from 'yjs';

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, defaultValue: string) => defaultValue,
}));

import {
  CalculationType,
  FieldType,
  FilterType,
  RollupDisplayMode,
} from '@/application/database-yjs/database.type';
import {
  NumberFilterCondition,
  TextFilterCondition,
} from '@/application/database-yjs/fields';
import { createRollupField } from '@/application/database-yjs/fields/rollup/utils';
import { filterBy } from '@/application/database-yjs/filter';
import { readRollupCellSync } from '@/application/database-yjs/rollup/cache';
import {
  RowId,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

import {
  createBlogPostsAuthorsRelationFixture,
  resolveRollupValue,
  setRelationCellRowIds,
} from './test-helpers';

// ---------- shared helpers ----------

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

function ensureField(fields: YDatabaseFields, fieldType: FieldType, fallbackId: string): string {
  let existing: string | null = null;

  fields.forEach((field, id) => {
    if (Number(field.get(YjsDatabaseKey.type)) === fieldType && !existing) {
      existing = id;
    }
  });
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
  },
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

function makeFilters(fieldId: string, condition: number, content = ''): YDatabaseFilters {
  // Wrap a single filter in a Y.Array so it matches the runtime structure
  // filterBy expects (mirrors rollup-desktop-parity.test.ts).
  const doc = new Y.Doc();
  const filters = new Y.Array() as YDatabaseFilters;

  doc.getMap('root').set('filters', filters);

  const filter = new Y.Map() as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, `filter-${fieldId}-${condition}`);
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.condition, condition);
  filter.set(YjsDatabaseKey.content, content);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filters.push([filter]);

  return filters;
}

async function primeRollupFor(
  baseDoc: YDoc,
  database: ReturnType<typeof createBlogPostsAuthorsRelationFixture>['baseDatabase'],
  rollupField: YDatabaseField,
  rowMetas: Record<RowId, YDoc>,
  rowIds: RowId[],
  fieldId: string,
  loadView: ReturnType<typeof createBlogPostsAuthorsRelationFixture>['loadView'],
  createRow: ReturnType<typeof createBlogPostsAuthorsRelationFixture>['createRow'],
  getViewIdFromDatabaseId: ReturnType<
    typeof createBlogPostsAuthorsRelationFixture
  >['getViewIdFromDatabaseId'],
) {
  await Promise.all(
    rowIds.map((rowId) =>
      resolveRollupValue({
        baseDoc,
        database,
        rollupField,
        row: getRowFromDoc(rowMetas[rowId]),
        rowId,
        fieldId,
        loadView,
        createRow,
        getViewIdFromDatabaseId,
      }),
    ),
  );
}

// ---------- tests ----------

describe('rollup number filter parity (desktop database_rollup_filter_number_conditions_test)', () => {
  it('supports all 8 NumberFilterCondition values on a Sum rollup', async () => {
    // Setup: blog_posts ⇄ authors with Sum-of-author-Amount rollup.
    // Each blog row links to exactly one author so the Sum equals that
    // author's Amount — same shape as desktop's test.
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'num-conds' });
    const baseRow0 = fixture.baseRows[0].id as RowId;
    const baseRow1 = fixture.baseRows[1].id as RowId;
    const relatedRow0 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[1].id as RowId;

    const amountFieldId = ensureField(
      fixture.relatedFixture.fields,
      FieldType.Number,
      'author-amount',
    );

    setCellValue(fixture.relatedFixture.rowMetas[relatedRow0], amountFieldId, FieldType.Number, '10');
    setCellValue(fixture.relatedFixture.rowMetas[relatedRow1], amountFieldId, FieldType.Number, '20');

    setRelationCellRowIds(fixture.baseRowMetas[baseRow0], fixture.relationFieldId, [relatedRow0]);
    setRelationCellRowIds(fixture.baseRowMetas[baseRow1], fixture.relationFieldId, [relatedRow1]);

    const rollupFieldId = 'rollup-num-conds';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: amountFieldId,
      calculationType: CalculationType.Sum,
      showAs: RollupDisplayMode.Calculated,
    });

    const baseRows = fixture.baseRows.slice(0, 2);

    await primeRollupFor(
      fixture.baseDoc,
      fixture.baseDatabase,
      rollupField,
      fixture.baseRowMetas,
      [baseRow0, baseRow1],
      rollupFieldId,
      fixture.loadView,
      fixture.createRow,
      fixture.getViewIdFromDatabaseId,
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
        createRow: fixture.createRow,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      }).value;
    };

    // Sanity: rollup values are 10 and 20.
    expect(getRollupText(baseRow0)).toBe('10');
    expect(getRollupText(baseRow1)).toBe('20');

    // Test matrix mirrors desktop's applyRollupNumberFilter calls. Note we use
    // EQUAL between rollup and content so the assertions read naturally.
    const cases: Array<{
      condition: NumberFilterCondition;
      content: string;
      expected: RowId[];
      label: string;
    }> = [
      { condition: NumberFilterCondition.Equal, content: '10', expected: [baseRow0], label: '= 10' },
      { condition: NumberFilterCondition.NotEqual, content: '10', expected: [baseRow1], label: '≠ 10' },
      { condition: NumberFilterCondition.GreaterThan, content: '10', expected: [baseRow1], label: '> 10' },
      { condition: NumberFilterCondition.LessThan, content: '20', expected: [baseRow0], label: '< 20' },
      { condition: NumberFilterCondition.GreaterThanOrEqualTo, content: '20', expected: [baseRow1], label: '≥ 20' },
      { condition: NumberFilterCondition.LessThanOrEqualTo, content: '10', expected: [baseRow0], label: '≤ 10' },
    ];

    for (const { condition, content, expected, label } of cases) {
      const filtered = filterBy(
        baseRows,
        makeFilters(rollupFieldId, condition, content),
        fixture.baseFields,
        fixture.baseRowMetas,
        { getRollupCellText: getRollupText },
      );

      expect({ label, ids: filtered.map((row) => row.id) }).toEqual({ label, ids: expected });
    }

    // Empty / non-empty: clear baseRow0's relation so its rollup becomes empty.
    setRelationCellRowIds(fixture.baseRowMetas[baseRow0], fixture.relationFieldId, []);
    await primeRollupFor(
      fixture.baseDoc,
      fixture.baseDatabase,
      rollupField,
      fixture.baseRowMetas,
      [baseRow0],
      rollupFieldId,
      fixture.loadView,
      fixture.createRow,
      fixture.getViewIdFromDatabaseId,
    );

    expect(getRollupText(baseRow0)).toBe('');
    expect(getRollupText(baseRow1)).toBe('20');

    const emptyFiltered = filterBy(
      baseRows,
      makeFilters(rollupFieldId, NumberFilterCondition.NumberIsEmpty),
      fixture.baseFields,
      fixture.baseRowMetas,
      { getRollupCellText: getRollupText },
    );

    expect(emptyFiltered.map((row) => row.id)).toEqual([baseRow0]);

    const nonEmptyFiltered = filterBy(
      baseRows,
      makeFilters(rollupFieldId, NumberFilterCondition.NumberIsNotEmpty),
      fixture.baseFields,
      fixture.baseRowMetas,
      { getRollupCellText: getRollupText },
    );

    expect(nonEmptyFiltered.map((row) => row.id)).toEqual([baseRow1]);
  });

  it('Count rollup filters by the count value', async () => {
    // Quick coverage that Count (also numeric) flows through the same path as
    // Sum — desktop relies on the same filter code path for both.
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'num-count' });
    const baseRow0 = fixture.baseRows[0].id as RowId;
    const baseRow1 = fixture.baseRows[1].id as RowId;
    const relatedRow0 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[1].id as RowId;

    // baseRow0 links to two authors (count=2), baseRow1 to one (count=1)
    setRelationCellRowIds(fixture.baseRowMetas[baseRow0], fixture.relationFieldId, [
      relatedRow0,
      relatedRow1,
    ]);
    setRelationCellRowIds(fixture.baseRowMetas[baseRow1], fixture.relationFieldId, [relatedRow0]);

    const rollupFieldId = 'rollup-count';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: '',
      calculationType: CalculationType.Count,
      showAs: RollupDisplayMode.Calculated,
    });

    const baseRows = fixture.baseRows.slice(0, 2);

    await primeRollupFor(
      fixture.baseDoc,
      fixture.baseDatabase,
      rollupField,
      fixture.baseRowMetas,
      [baseRow0, baseRow1],
      rollupFieldId,
      fixture.loadView,
      fixture.createRow,
      fixture.getViewIdFromDatabaseId,
    );

    const getRollupText = (rowId: string) =>
      readRollupCellSync({
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[rowId as RowId]),
        rowId: rowId as RowId,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRow: fixture.createRow,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      }).value;

    expect(getRollupText(baseRow0)).toBe('2');
    expect(getRollupText(baseRow1)).toBe('1');

    const onlyTwo = filterBy(
      baseRows,
      makeFilters(rollupFieldId, NumberFilterCondition.Equal, '2'),
      fixture.baseFields,
      fixture.baseRowMetas,
      { getRollupCellText: getRollupText },
    );

    expect(onlyTwo.map((row) => row.id)).toEqual([baseRow0]);
  });
});

describe('rollup select-target filter parity (desktop database_rollup_filter_select_dropdown_test)', () => {
  it('text-style filter against an OriginalList rollup of SingleSelect matches by option name', async () => {
    // Setup: authors gets a SingleSelect "Color" (Red/Blue/Green); each author
    // has a color; blog posts roll up the colors as OriginalList. The filter
    // editor's option picker writes the option NAME into filter.content (matches
    // desktop's _RollupSelectOptionList behavior in rollup.dart). We assert the
    // text matching path here.
    const fixture = createBlogPostsAuthorsRelationFixture({ suffix: 'select-rollup' });
    const baseRow0 = fixture.baseRows[0].id as RowId;
    const baseRow1 = fixture.baseRows[1].id as RowId;
    const relatedRow0 = fixture.relatedFixture.rows[0].id as RowId;
    const relatedRow1 = fixture.relatedFixture.rows[1].id as RowId;

    // Add a SingleSelect "Color" field to authors with three fixed options.
    // We attach the field directly so the option ids are known and stable.
    const colorFieldId = 'author-color';
    const redOptionId = 'opt-red';
    const greenOptionId = 'opt-green';
    const blueOptionId = 'opt-blue';
    const fields = fixture.relatedFixture.fields;
    const colorY = new Y.Map() as YDatabaseField;

    fields.set(colorFieldId, colorY);
    colorY.set(YjsDatabaseKey.id, colorFieldId);
    colorY.set(YjsDatabaseKey.name, 'Color');
    colorY.set(YjsDatabaseKey.type, FieldType.SingleSelect);
    const typeOptionMap = new Y.Map();

    colorY.set(YjsDatabaseKey.type_option, typeOptionMap);
    const colorTypeOption = new Y.Map();

    typeOptionMap.set(String(FieldType.SingleSelect), colorTypeOption);
    colorTypeOption.set(
      YjsDatabaseKey.content,
      JSON.stringify({
        disable_color: false,
        options: [
          { id: redOptionId, name: 'Red', color: 'Red' },
          { id: greenOptionId, name: 'Green', color: 'Green' },
          { id: blueOptionId, name: 'Blue', color: 'Blue' },
        ],
      }),
    );

    // Cell values store the option id (not the name) — the rollup renders the name.
    setCellValue(
      fixture.relatedFixture.rowMetas[relatedRow0],
      colorFieldId,
      FieldType.SingleSelect,
      redOptionId,
    );
    setCellValue(
      fixture.relatedFixture.rowMetas[relatedRow1],
      colorFieldId,
      FieldType.SingleSelect,
      blueOptionId,
    );

    setRelationCellRowIds(fixture.baseRowMetas[baseRow0], fixture.relationFieldId, [relatedRow0]);
    setRelationCellRowIds(fixture.baseRowMetas[baseRow1], fixture.relationFieldId, [relatedRow1]);

    const rollupFieldId = 'rollup-color';
    const rollupField = addRollupField(fixture.baseFields, rollupFieldId, {
      relationFieldId: fixture.relationFieldId,
      targetFieldId: colorFieldId,
      calculationType: CalculationType.Count,
      showAs: RollupDisplayMode.OriginalList, // produces "Red", "Blue" — same as desktop's text rollup branch
    });

    const baseRows = fixture.baseRows.slice(0, 2);

    await primeRollupFor(
      fixture.baseDoc,
      fixture.baseDatabase,
      rollupField,
      fixture.baseRowMetas,
      [baseRow0, baseRow1],
      rollupFieldId,
      fixture.loadView,
      fixture.createRow,
      fixture.getViewIdFromDatabaseId,
    );

    const getRollupText = (rowId: string) =>
      readRollupCellSync({
        baseDoc: fixture.baseDoc,
        database: fixture.baseDatabase,
        rollupField,
        row: getRowFromDoc(fixture.baseRowMetas[rowId as RowId]),
        rowId: rowId as RowId,
        fieldId: rollupFieldId,
        loadView: fixture.loadView,
        createRow: fixture.createRow,
        getViewIdFromDatabaseId: fixture.getViewIdFromDatabaseId,
      }).value;

    // Sanity: the rendered text is the option name (what the picker writes).
    expect(getRollupText(baseRow0)).toBe('Red');
    expect(getRollupText(baseRow1)).toBe('Blue');

    // Picking "Red" from the option picker writes filter.content='Red' with
    // a TextContains condition (same path TextFilterMenu would use).
    const redFiltered = filterBy(
      baseRows,
      makeFilters(rollupFieldId, TextFilterCondition.TextIs, 'Red'),
      fixture.baseFields,
      fixture.baseRowMetas,
      { getRollupCellText: getRollupText },
    );

    expect(redFiltered.map((row) => row.id)).toEqual([baseRow0]);

    const blueFiltered = filterBy(
      baseRows,
      makeFilters(rollupFieldId, TextFilterCondition.TextIs, 'Blue'),
      fixture.baseFields,
      fixture.baseRowMetas,
      { getRollupCellText: getRollupText },
    );

    expect(blueFiltered.map((row) => row.id)).toEqual([baseRow1]);

    // Toggling the option clears content (filter.content = '') — should match
    // both rows since "" matches everything for TextIs would mean exact match
    // against empty, but for TextContains '' matches all. The picker uses the
    // existing TextFilterMenu's TextContains so '' matches both.
    const allWithEmpty = filterBy(
      baseRows,
      makeFilters(rollupFieldId, TextFilterCondition.TextContains, ''),
      fixture.baseFields,
      fixture.baseRowMetas,
      { getRollupCellText: getRollupText },
    );

    expect(allWithEmpty.map((row) => row.id)).toEqual([baseRow0, baseRow1]);
  });
});

