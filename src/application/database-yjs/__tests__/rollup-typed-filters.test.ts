import * as Y from 'yjs';

import { CalculationType, FieldType, FilterType, RollupDisplayMode } from '../database.type';
import { DateFilterCondition, NumberFilterCondition, NumberFormat, TextFilterCondition } from '../fields';
import { createRelationField } from '../fields/relation/utils';
import { createRollupField } from '../fields/rollup/utils';
import { RollupFilterMode } from '../fields/rollup/rollup.type';
import { filterBy, flattenFilterTree, getEffectiveFiltersSnapshot, parseFilter, rollupFilterCheck } from '../filter';
import { invalidateRollupCell, readRollupCell, readRollupCellSync } from '../rollup/cache';
import {
  defaultRollupPredicate,
  migrateRollupFilters,
  migrateRollupsForRelation,
  newRollupFilterMetadata,
  parseRollupFilterMetadata,
  rollupConfigurationMatches,
  rollupResultType,
} from '../rollup/filter';
import { getRowKey } from '../row_meta';
import {
  YDatabase,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseFilter,
  YDatabaseFilters,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey as K,
  YjsEditorKey as E,
} from '@/application/types';

import { createCell, createRowDoc } from './test-helpers';

let sequence = 0;
function fixture(
  type: FieldType,
  values: unknown[],
  showAs = RollupDisplayMode.OriginalList,
  calculation = CalculationType.Count
) {
  const suffix = String(++sequence);
  const baseDoc = new Y.Doc() as YDoc;
  const database = new Y.Map() as YDatabase;

  baseDoc.getMap(E.data_section).set(E.database, database);
  const fields = new Y.Map() as YDatabaseFields;

  database.set(K.fields, fields);
  const fieldId = `rollup-${suffix}`;
  const relationId = `relation-${suffix}`;

  fields.set(fieldId, createRollupField(fieldId));
  fields.set(relationId, createRelationField(relationId));
  const field = fields.get(fieldId)!;
  const option = field.get(K.type_option).get(String(FieldType.Rollup))!;

  option.set(K.relation_field_id, relationId);
  option.set(K.target_field_id, 'target');
  option.set(K.show_as, showAs);
  option.set(K.calculation_type, calculation);
  fields.get(relationId)!.get(K.type_option).get(String(FieldType.Relation))!.set(K.database_id, `related-${suffix}`);
  const relatedDoc = new Y.Doc() as YDoc;
  const relatedDatabase = new Y.Map() as YDatabase;

  relatedDoc.getMap(E.data_section).set(E.database, relatedDatabase);
  const targetFields = new Y.Map() as YDatabaseFields;

  relatedDatabase.set(K.fields, targetFields);
  const targetField = new Y.Map() as YDatabaseField;

  targetFields.set('target', targetField);
  targetField.set(K.id, 'target');
  targetField.set(K.type, type);
  const typeOptions = new Y.Map();
  const targetOption = new Y.Map();

  targetField.set(K.type_option, typeOptions);
  typeOptions.set(String(type), targetOption);
  targetOption.set(
    K.content,
    JSON.stringify({
      options: [
        { id: 'red', name: 'Red', color: 0 },
        { id: 'blue', name: 'Blue', color: 1 },
      ],
    })
  );
  const relatedRows = values.map((value, i) =>
    createRowDoc(
      `related-row-${suffix}-${i}`,
      `related-${suffix}`,
      value === undefined ? {} : { target: createCell(type, value) }
    )
  );
  if (type === FieldType.Media)
    relatedRows.forEach((doc, i) => {
      const array = new Y.Array();
      const cell = (doc.getMap(E.data_section).get(E.database_row) as YDatabaseRow).get(K.cells).get('target');

      if (cell) {
        cell.set(K.data, array);
        array.push(values[i] as string[]);
      }
    });
  const relatedIds = relatedRows.map((doc) =>
    (doc.getMap(E.data_section).get(E.database_row) as YDatabaseRow).get(K.id)
  );
  const rowDoc = createRowDoc(`row-${suffix}`, 'base', { [relationId]: createCell(FieldType.Relation, relatedIds) });
  const row = rowDoc.getMap(E.data_section).get(E.database_row) as YDatabaseRow;
  const context = {
    baseDoc,
    database,
    rollupField: field,
    row,
    rowId: row.get(K.id),
    fieldId,
    loadView: jest.fn(async () => relatedDoc),
    getViewIdFromDatabaseId: jest.fn(async () => `view-${suffix}`),
    createRow: jest.fn(
      async (key: string) => relatedRows.find((_, i) => getRowKey(relatedDoc.guid, relatedIds[i]) === key)!
    ),
  };
  const makeFilter = (condition: number, content: string, mode = RollupFilterMode.Any) => {
    const doc = new Y.Doc();
    const node = doc.getMap('filter') as YDatabaseFilter;

    node.set(K.id, `filter-${sequence}-${mode}`);
    node.set(K.field_id, fieldId);
    node.set(K.type, FieldType.Rollup);
    node.set(K.filter_type, FilterType.Data);
    node.set(K.rollup_target_type, rollupResultType({ show_as: showAs, calculation_type: calculation }, type));
    const meta = newRollupFilterMetadata(field, type);

    if (showAs !== RollupDisplayMode.Calculated) meta.rollup_filter_mode = mode;
    node.set(K.rollup_meta, meta);
    node.set(K.condition, condition);
    node.set(K.content, content);
    return node;
  };

  return { ...context, field, option, targetField, targetOption, relatedRows, rowDoc, fields, makeFilter };
}

async function visibility(f: ReturnType<typeof fixture>, condition: number, content: string) {
  const value = await readRollupCell(f);

  // Also exercise cache reads: losing ephemeral values here used to silently fall back to joined text.
  expect(readRollupCellSync(f).filterCells).toEqual(value.filterCells);
  return [RollupFilterMode.Any, RollupFilterMode.None, RollupFilterMode.Every].map((mode) =>
    rollupFilterCheck(value, f.makeFilter(condition, content, mode), f.field)
  );
}

describe('desktop rollup list contract (#1343–#1353)', () => {
  test.each([
    [
      ['Alpha', 'Beta'],
      [true, false, false],
    ],
    [
      ['Alpha', 'Alpha'],
      [true, false, true],
    ],
    [
      ['Alpha', undefined],
      [true, false, false],
    ],
    [['Beta'], [false, true, false]],
    [[], [false, true, false]],
  ])('text is checks related cells %j', async (values, expected) => {
    expect(await visibility(fixture(FieldType.RichText, values), TextFilterCondition.TextIs, 'Alpha')).toEqual(expected);
  });

  test('contains cannot cross cell boundaries; unique display does not change Every', async () => {
    expect(
      await visibility(fixture(FieldType.RichText, ['Alpha', 'Beta']), TextFilterCondition.TextContains, 'Alpha, Beta')
    ).toEqual([false, true, false]);
    expect(
      await visibility(
        fixture(FieldType.RichText, ['Alpha', 'Alpha', undefined], RollupDisplayMode.UniqueList),
        TextFilterCondition.TextIs,
        'Alpha'
      )
    ).toEqual([true, false, false]);
  });

  test('empty relation and linked empty cell are distinct', async () => {
    expect(await visibility(fixture(FieldType.URL, []), TextFilterCondition.TextIsEmpty, '')).toEqual([
      false,
      true,
      false,
    ]);
    expect(await visibility(fixture(FieldType.URL, [undefined]), TextFilterCondition.TextIsEmpty, '')).toEqual([
      true,
      false,
      true,
    ]);
  });

  test.each([
    [FieldType.Number, ['-10.25', '20.5'], NumberFilterCondition.GreaterThan, '0'],
    [FieldType.SingleSelect, ['red', 'blue'], 0, 'red'],
    [FieldType.MultiSelect, ['red,blue', 'blue'], 2, 'red'],
    [FieldType.Checkbox, ['Yes', 'No'], 0, ''],
    [
      FieldType.Checklist,
      [JSON.stringify({ options: [{ id: 'a', name: 'A' }], selected_option_ids: ['a'] }), undefined],
      0,
      '',
    ],
    [FieldType.Relation, [['red'], ['blue']], 2, '["red"]'],
    [FieldType.Person, ['["red","blue"]', '["blue"]'], 0, '["red"]'],
    [
      FieldType.Media,
      [[JSON.stringify({ id: 'f', name: 'x', url: 'https://example.com', file_type: 0, upload_type: 1 })], []],
      1,
      '',
    ],
  ])('native type %s evaluates individual cells', async (type, values, condition, content) => {
    expect(await visibility(fixture(type as FieldType, values), condition as number, content as string)).toEqual([
      true,
      false,
      false,
    ]);
  });

  test('number lists scale stored percentages once', async () => {
    const f = fixture(FieldType.Number, ['0.25', '0.75']);

    f.targetOption.set('format', 36); // NumberFormat.Percent
    expect(await visibility(f, NumberFilterCondition.GreaterThan, '50')).toEqual([true, false, false]);
  });

  test.each([FieldType.CreatedBy, FieldType.LastEditedBy])(
    'attribution %s uses exact row UIDs rather than cell data',
    async (type) => {
      const f = fixture(type, ['["wrong"]', '["wrong"]']);
      const uidKey = type === FieldType.CreatedBy ? K.created_by : K.last_edited_by;

      (f.relatedRows[0].getMap(E.data_section).get(E.database_row) as YDatabaseRow).set(uidKey, '9007199254740993');
      (f.relatedRows[1].getMap(E.data_section).get(E.database_row) as YDatabaseRow).set(uidKey, '9007199254740992');
      expect(await visibility(f, 0, '["9007199254740993"]')).toEqual([true, false, false]);
    }
  );

  test.each([FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime])(
    'date source %s uses timestamps',
    async (type) => {
      const start = 1726099200;
      const f = fixture(type, [String(start), String(start + 86400)]);

      if (type !== FieldType.DateTime)
        f.relatedRows.forEach((doc, i) =>
          (doc.getMap(E.data_section).get(E.database_row) as YDatabaseRow).set(
            type === FieldType.CreatedTime ? K.created_at : K.last_modified,
            String(start + i * 86400)
          )
        );
      expect(await visibility(f, DateFilterCondition.DateStartsOn, JSON.stringify({ timestamp: start }))).toEqual([
        true,
        false,
        false,
      ]);
    }
  );

  test('date list end predicates distinguish missing endpoints and ignore partial Between drafts', async () => {
    const start = 1726099200;
    const f = fixture(FieldType.DateTime, [String(start), String(start)]);
    const cell = (f.relatedRows[0].getMap(E.data_section).get(E.database_row) as YDatabaseRow)
      .get(K.cells)
      .get('target')!;

    cell.set(K.is_range, true);
    cell.set(K.end_timestamp, String(start + 86400));
    expect(await visibility(f, DateFilterCondition.DateEndIsEmpty, '')).toEqual([true, false, false]);
    expect(await visibility(f, DateFilterCondition.DateEndsOn, JSON.stringify({ timestamp: start + 86400 }))).toEqual([
      true,
      false,
      false,
    ]);
    expect(await visibility(f, DateFilterCondition.DateEndsBetween, JSON.stringify({ start }))).toEqual([
      true,
      true,
      true,
    ]);
  });

  test('calculated dates retain raw endpoints when identical duration text shifts', async () => {
    const start = 1726099200;
    const f = fixture(
      FieldType.DateTime,
      [String(start), String(start + 86400)],
      RollupDisplayMode.Calculated,
      CalculationType.DateRange
    );
    const filter = f.makeFilter(DateFilterCondition.DateEndsOn, JSON.stringify({ timestamp: start + 86400 }));
    const before = await readRollupCell(f);

    expect(rollupFilterCheck(before, filter, f.field)).toBe(true);
    f.relatedRows.forEach((doc, i) =>
      (doc.getMap(E.data_section).get(E.database_row) as YDatabaseRow)
        .get(K.cells)
        .get('target')!
        .set(K.data, String(start + (i + 5) * 86400))
    );
    invalidateRollupCell(`${f.rowId}:${f.fieldId}`);
    const after = await readRollupCell(f);

    expect(after.value).toBe(before.value);
    expect(rollupFilterCheck(after, filter, f.field)).toBe(false);
    expect(readRollupCellSync(f).rawDate).toEqual(after.rawDate);
  });

  test.each([FieldType.DateTime, FieldType.Person, FieldType.Checkbox])(
    'calculated Count uses numbers regardless of source %s',
    async (type) => {
      const f = fixture(type, [], RollupDisplayMode.Calculated, CalculationType.Count);
      const result = await readRollupCell(f);

      expect(rollupFilterCheck(result, f.makeFilter(NumberFilterCondition.Equal, '0'), f.field)).toBe(true);
      expect(rollupFilterCheck(result, f.makeFilter(NumberFilterCondition.NumberIsEmpty, ''), f.field)).toBe(false);
    }
  );

  test('legacy select name and joined text predicates retain their interpretation', async () => {
    const f = fixture(FieldType.RichText, ['Alpha', 'Beta']);
    const filter = f.makeFilter(TextFilterCondition.TextIs, 'Alpha');

    filter.delete(K.rollup_meta);
    expect(rollupFilterCheck(await readRollupCell(f), filter, f.field)).toBe(false);
    filter.set(K.content, 'Alpha, Beta');
    expect(rollupFilterCheck(await readRollupCell(f), filter, f.field)).toBe(true);
  });

  test('unresolved targets and empty predicates remain inactive', async () => {
    const f = fixture(FieldType.RichText, []);

    expect(rollupFilterCheck(undefined, f.makeFilter(0, 'Alpha'), f.field)).toBe(true);
    expect(await visibility(f, TextFilterCondition.TextContains, '')).toEqual([true, true, true]);
  });

  test('source metadata containing server BigInts participates in schema comparisons', async () => {
    const f = fixture(FieldType.RichText, ['Alpha', 'Beta']);

    f.targetField.set('desktop_metadata', { created_at: 1789184000n });
    expect(await visibility(f, TextFilterCondition.TextIs, 'Alpha')).toEqual([true, false, false]);
  });

  test('number lists preserve decimal precision, including percent scaling', async () => {
    const f = fixture(FieldType.Number, ['9007199254740993', '9007199254740992']);

    expect(await visibility(f, NumberFilterCondition.Equal, '9007199254740993')).toEqual([true, false, false]);
    const percent = fixture(FieldType.Number, ['0.000000000000000000000000001']);

    percent.targetOption.set('format', 36);
    expect(await visibility(percent, NumberFilterCondition.Equal, '0.0000000000000000000000001')).toEqual([
      true,
      false,
      true,
    ]);
  });

  test('calculated numbers use raw values and retain legacy scalar fallback and emptiness', () => {
    const f = fixture(FieldType.Number, [], RollupDisplayMode.Calculated);
    const equals = f.makeFilter(NumberFilterCondition.Equal, '5');

    expect(rollupFilterCheck({ value: '$5', rawNumeric: 5 }, equals, f.field)).toBe(true);
    expect(rollupFilterCheck({ value: '5' }, equals, f.field)).toBe(true);
    expect(rollupFilterCheck({ value: '$5' }, equals, f.field)).toBe(false);
    expect(rollupFilterCheck({ value: '$5' }, f.makeFilter(NumberFilterCondition.NumberIsEmpty, ''), f.field)).toBe(
      false
    );
  });

  test('date lists with an absent mode and unresolved calculations stay inactive', async () => {
    const f = fixture(FieldType.DateTime, []);
    const node = f.makeFilter(DateFilterCondition.DateStartIsNotEmpty, '');
    const meta = node.toJSON().rollup_meta;

    delete meta.rollup_filter_mode;
    node.set(K.rollup_meta, meta);
    expect(rollupFilterCheck(await readRollupCell(f), node, f.field)).toBe(true);
  });
});

describe('final desktop numeric compatibility (#1360)', () => {
  function legacyFilter(f: ReturnType<typeof fixture>, condition: NumberFilterCondition, content: string) {
    const node = f.makeFilter(condition, content);

    node.delete(K.rollup_meta);
    return node;
  }

  test.each([
    [NumberFormat.USD, ['10'], NumberFilterCondition.GreaterThan, '5', true],
    [NumberFormat.USD, ['5', '12'], NumberFilterCondition.Equal, '12', true],
    [NumberFormat.USD, ['5', '12'], NumberFilterCondition.GreaterThan, '100', false],
    [NumberFormat.USD, ['-10.25'], NumberFilterCondition.LessThan, '0', true],
    [NumberFormat.USD, ['-10.25'], NumberFilterCondition.GreaterThan, '0', false],
    [NumberFormat.USD, ['1234.56'], NumberFilterCondition.Equal, '1234.56', true],
    [NumberFormat.EUR, ['1234.56', '7.89'], NumberFilterCondition.Equal, '7.89', true],
    [NumberFormat.Percent, ['0.25', '0.75'], NumberFilterCondition.GreaterThan, '50', true],
    [NumberFormat.Percent, ['0.25'], NumberFilterCondition.GreaterThan, '50', false],
    [NumberFormat.USD, ['9007199254740993'], NumberFilterCondition.Equal, '9007199254740993', true],
    [NumberFormat.USD, ['9007199254740993'], NumberFilterCondition.Equal, '9007199254740992', false],
    [NumberFormat.USD, ['5', '12'], NumberFilterCondition.NotEqual, '5', true],
  ])('legacy format %s values %j condition %s %s', async (format, values, condition, content, expected) => {
    const f = fixture(FieldType.Number, values);

    f.targetOption.set('format', format);
    const node = legacyFilter(f, condition, content);
    const value = await readRollupCell(f);

    expect(rollupFilterCheck(value, node, f.field)).toBe(expected);
    expect(node.has(K.rollup_meta)).toBe(false);
    // Desktop payloads with just the source type are also legacy, not explicit Any.
    node.set(K.rollup_meta, { target_field_type: FieldType.Number });
    expect(rollupFilterCheck(value, node, f.field)).toBe(expected);
    expect(node.toJSON().rollup_meta).toEqual({ target_field_type: FieldType.Number });
  });

  test('formatted fallback preserves scalar precedence, aggregate emptiness and unresolved-source behavior', async () => {
    const f = fixture(FieldType.Number, ['10', undefined]);

    f.targetOption.set('format', NumberFormat.USD);
    const value = await readRollupCell(f);
    const node = legacyFilter(f, NumberFilterCondition.GreaterThan, '5');

    expect(value.value).toBe('$10');
    expect(rollupFilterCheck(value, node, f.field)).toBe(true);
    expect(rollupFilterCheck({ ...value, rawNumeric: 1 }, node, f.field)).toBe(false);
    expect(rollupFilterCheck({ ...value, value: '1' }, node, f.field)).toBe(false);
    expect(rollupFilterCheck({ ...value, value: '' }, node, f.field)).toBe(false);
    expect(rollupFilterCheck({ value: '$10.00' }, node, f.field)).toBe(false);
    expect(rollupFilterCheck({ ...value, value: '€1.234,56, €7,89' }, node, f.field)).toBe(true);
    for (const [condition, expected] of [
      [NumberFilterCondition.NumberIsEmpty, false],
      [NumberFilterCondition.NumberIsNotEmpty, true],
    ] as const) {
      expect(rollupFilterCheck(value, legacyFilter(f, condition, ''), f.field)).toBe(expected);
    }
    node.set(K.rollup_meta, { target_field_type: FieldType.RichText });
    expect(rollupFilterCheck(value, node, f.field)).toBe(false);
    node.set(K.rollup_meta, { rollup_show_as: RollupDisplayMode.Calculated });
    expect(rollupFilterCheck(value, node, f.field)).toBe(false);
    node.delete(K.rollup_meta);
    f.option.set(K.show_as, RollupDisplayMode.Calculated);
    expect(rollupFilterCheck(value, node, f.field)).toBe(false);
  });

  test.each([
    [NumberFilterCondition.Equal, true],
    [NumberFilterCondition.NotEqual, true],
    [NumberFilterCondition.GreaterThan, true],
    [NumberFilterCondition.LessThan, false],
    [NumberFilterCondition.GreaterThanOrEqualTo, true],
    [NumberFilterCondition.LessThanOrEqualTo, true],
    [NumberFilterCondition.NumberIsEmpty, true],
    [NumberFilterCondition.NumberIsNotEmpty, true],
  ])('native condition %s keeps Any/None/Every and empty-list semantics', async (condition, anyMatches) => {
    const f = fixture(FieldType.Number, ['5', '12', undefined], RollupDisplayMode.UniqueList);

    f.targetOption.set('format', NumberFormat.USD);
    expect(await visibility(f, condition, '5')).toEqual([anyMatches, !anyMatches, false]);
    expect(await visibility(fixture(FieldType.Number, []), condition, '5')).toEqual([false, true, false]);
  });

  test('formatted uniqueness does not collapse native predicate source cells', async () => {
    const values = ['1.001', '1.004'];
    const list = fixture(FieldType.Number, values, RollupDisplayMode.UniqueList);

    list.targetOption.set('format', NumberFormat.USD);
    expect((await readRollupCell(list)).list).toEqual(['$1']);
    expect(await visibility(list, NumberFilterCondition.Equal, '1.004')).toEqual([true, false, false]);
    const aggregate = fixture(FieldType.Number, values, RollupDisplayMode.Calculated, CalculationType.CountUnique);

    aggregate.targetOption.set('format', NumberFormat.USD);
    const result = await readRollupCell(aggregate);

    // Desktop counts distinct formatted strings, while native predicates retain
    // both unrounded source cells even when their list labels are identical.
    expect(result.rawNumeric).toBe(1);
    expect(rollupFilterCheck(result, aggregate.makeFilter(NumberFilterCondition.Equal, '1'), aggregate.field)).toBe(
      true
    );
  });

  test('persisted NumberMode calculation filters the mode rather than a matching source item', async () => {
    const f = fixture(FieldType.Number, ['2', '2', '10'], RollupDisplayMode.Calculated, CalculationType.NumberMode);
    const value = await readRollupCell(f);
    const node = f.makeFilter(NumberFilterCondition.Equal, '2');

    expect(value.rawNumeric).toBe(2);
    expect(rollupFilterCheck(value, node, f.field)).toBe(true);
    node.set(K.content, '10');
    expect(rollupFilterCheck(value, node, f.field)).toBe(false);
    expect(node.toJSON().rollup_meta).toMatchObject({
      rollup_show_as: RollupDisplayMode.Calculated,
      rollup_calculation_type: CalculationType.NumberMode,
    });
    expect(node.toJSON().rollup_meta.rollup_filter_mode).toBeUndefined();
  });
});

describe('desktop persistence and configuration migration (#1343, #1355, #1357)', () => {
  test('optional enum zero survives plain objects, bigint, Y.Map and parsing', () => {
    expect(parseRollupFilterMetadata(undefined)).toBeUndefined();
    expect(parseRollupFilterMetadata({})).toEqual({});
    expect(
      parseRollupFilterMetadata({
        target_field_type: 0n,
        rollup_filter_mode: '0',
        rollup_show_as: 0,
        rollup_calculation_type: 0,
      })
    ).toEqual({ target_field_type: 0, rollup_filter_mode: 0, rollup_show_as: 0, rollup_calculation_type: 0 });
    const meta = new Y.Doc().getMap('meta');

    meta.set('rollup_filter_mode', 0);
    const f = fixture(FieldType.RichText, []);
    const node = f.makeFilter(0, 'Alpha');

    node.set(K.rollup_meta, { target_field_type: 0, rollup_filter_mode: 0, rollup_show_as: 1 });
    expect(parseFilter(FieldType.Rollup, node).rollupMetadata?.rollup_filter_mode).toBe(0);
    expect(parseRollupFilterMetadata(meta)).toEqual({ rollup_filter_mode: 0 });
  });

  test('independent nested AND/OR rules keep native metadata and affect visibility signatures', async () => {
    const f = fixture(FieldType.RichText, ['Alpha', 'Beta']);
    const first = f.makeFilter(0, 'Alpha');
    const second = f.makeFilter(0, 'Beta');
    const filters = new Y.Doc().getArray('filters') as YDatabaseFilters;

    filters.push([
      {
        id: 'group',
        filter_type: FilterType.And,
        children: [first.toJSON(), { id: 'nested', filter_type: FilterType.Or, children: [second.toJSON()] }],
      } as unknown as YDatabaseFilter,
    ]);
    const drafts = flattenFilterTree(filters, f.fields);

    expect(drafts.map((d) => [d.content, d.rollupMetadata?.rollup_filter_mode])).toEqual([
      ['Alpha', 0],
      ['Beta', 0],
    ]);
    const options = { getRollupCellValue: () => value };
    const value = await readRollupCell(f);
    const rows = [{ id: f.rowId, height: 36 }];

    expect(filterBy(rows, filters, f.fields, { [f.rowId]: f.rowDoc }, options)).toHaveLength(1);
    const oldSignature = getEffectiveFiltersSnapshot(filters, f.fields);
    const tree = filters.toJSON();

    tree[0].children[1].children[0].rollup_meta.rollup_filter_mode = RollupFilterMode.Every;
    filters.delete(0);
    filters.push(tree);
    expect(getEffectiveFiltersSnapshot(filters, f.fields)).not.toEqual(oldSignature);
    expect(filterBy(rows, filters, f.fields, { [f.rowId]: f.rowDoc }, options)).toHaveLength(0);
  });

  test('migration preserves IDs, nested groups, multiple views and compatible list predicates', () => {
    const f = fixture(FieldType.SingleSelect, ['red']);
    const rule = f.makeFilter(0, 'red', RollupFilterMode.Every);
    const views = new Y.Map();

    f.database.set(K.views, views);
    for (const id of ['one', 'two']) {
      const view = new Y.Map();
      const filters = new Y.Array();

      views.set(id, view);
      view.set(K.filters, filters);
      filters.push([{ id: 'group', filter_type: 1, children: [rule.toJSON()] }]);
    }

    f.option.set(K.show_as, RollupDisplayMode.UniqueList);
    migrateRollupFilters(f.database, f.fieldId, FieldType.SingleSelect);
    const stored = () => views.toJSON().one.filters[0].children[0];

    expect(stored()).toMatchObject({
      id: rule.get(K.id),
      content: 'red',
      rollup_meta: { rollup_filter_mode: 2, rollup_show_as: 2 },
    });
    f.option.set(K.show_as, RollupDisplayMode.Calculated);
    migrateRollupFilters(f.database, f.fieldId, FieldType.SingleSelect);
    expect(stored()).toMatchObject({
      id: rule.get(K.id),
      content: '',
      condition: 0,
      rollup_target_ty: FieldType.Number,
    });
    expect(stored().rollup_meta.rollup_filter_mode).toBeUndefined();
    expect(views.toJSON().one.filters).toEqual(views.toJSON().two.filters);
  });

  test('source replacement resets same-type predicates and rejects obsolete drafts', () => {
    const before = {
      relation_field_id: 'relation',
      target_field_id: 'old',
      target_field_type: 0,
      rollup_show_as: 1,
      rollup_filter_mode: 2,
    };
    const after = { ...before, target_field_id: 'new' };

    expect(rollupConfigurationMatches(before, after)).toBe(false);
    expect(rollupConfigurationMatches(before, { ...before, rollup_filter_mode: 0 })).toBe(true);
    expect(rollupConfigurationMatches(undefined, before)).toBe(true);
    expect(defaultRollupPredicate(FieldType.SingleSelect)).toEqual({ condition: 0, content: '' });
  });
});

describe('rollup edit lifecycle and migration regressions', () => {
  function attach(f: ReturnType<typeof fixture>, rule: YDatabaseFilter) {
    const views = new Y.Map();
    const view = new Y.Map();
    const filters = new Y.Array() as YDatabaseFilters;

    f.database.set(K.views, views);
    views.set('view', view);
    view.set(K.filters, filters);
    filters.push([rule.toJSON() as YDatabaseFilter]);
    return filters;
  }

  test('compatible legacy text lists retain their joined predicate and absent mode', () => {
    const f = fixture(FieldType.RichText, []);
    const rule = f.makeFilter(0, 'Alpha, Beta');

    rule.delete(K.rollup_meta);
    const filters = attach(f, rule);
    const previous = {
      relation_field_id: f.field.get(K.type_option).get('16')!.get(K.relation_field_id) as string,
      target_field_id: 'target',
      calculation_type: 5,
      show_as: 1,
    };

    f.option.set(K.show_as, 2);
    migrateRollupFilters(f.database, f.fieldId, FieldType.RichText, previous);
    expect(filters.toJSON()[0]).toMatchObject({ content: 'Alpha, Beta', condition: 0 });
    expect(filters.toJSON()[0].rollup_meta.rollup_filter_mode).toBeUndefined();
  });

  test.each(['target_field_id', 'relation_field_id'])(
    'changing %s resets a same-type predicate without losing its ID',
    (key) => {
      const f = fixture(FieldType.RichText, []);
      const rule = f.makeFilter(0, 'Alpha', RollupFilterMode.Every);
      const filters = attach(f, rule);

      f.option.set(key, 'replacement');
      migrateRollupFilters(f.database, f.fieldId, FieldType.RichText);
      expect(filters.toJSON()[0]).toMatchObject({
        id: rule.get(K.id),
        content: '',
        condition: 2,
        rollup_meta: { [key]: 'replacement', rollup_filter_mode: 0 },
      });
    }
  );

  test('numeric calculations preserve predicates while date calculations reset them', () => {
    const f = fixture(FieldType.DateTime, [], RollupDisplayMode.Calculated, CalculationType.Count);
    const filters = attach(f, f.makeFilter(NumberFilterCondition.GreaterThan, '5'));

    f.option.set(K.calculation_type, CalculationType.CountEmpty);
    migrateRollupFilters(f.database, f.fieldId, FieldType.DateTime);
    expect(filters.toJSON()[0]).toMatchObject({
      condition: 2,
      content: '5',
      rollup_meta: { rollup_calculation_type: CalculationType.CountEmpty },
    });
    f.option.set(K.calculation_type, CalculationType.DateLatest);
    migrateRollupFilters(f.database, f.fieldId, FieldType.DateTime);
    expect(filters.toJSON()[0]).toMatchObject({ condition: 0, content: '', rollup_target_ty: FieldType.DateTime });
  });

  test('switching the relation database resets filters even with the same field IDs', () => {
    const f = fixture(FieldType.RichText, []);
    const rule = f.makeFilter(TextFilterCondition.TextIs, 'Alpha', RollupFilterMode.Every);
    const filters = attach(f, rule);
    const relationId = f.option.get(K.relation_field_id);

    f.fields.get(relationId)!.get(K.type_option).get(String(FieldType.Relation)).set(K.database_id, 'replacement-db');
    migrateRollupsForRelation(f.database, relationId);
    expect(filters.toJSON()[0]).toMatchObject({
      id: rule.get(K.id),
      content: '',
      condition: TextFilterCondition.TextContains,
      rollup_meta: {
        relation_field_id: relationId,
        target_field_id: 'target',
        rollup_filter_mode: RollupFilterMode.Any,
      },
    });
  });

  test('DateRange End becomes a blank Start predicate when switched to Latest', () => {
    const f = fixture(FieldType.DateTime, [], RollupDisplayMode.Calculated, CalculationType.DateRange);
    const filters = attach(f, f.makeFilter(DateFilterCondition.DateEndsOn, '{"timestamp":1726099200}'));

    f.option.set(K.calculation_type, CalculationType.DateLatest);
    migrateRollupFilters(f.database, f.fieldId, FieldType.DateTime);
    expect(filters.toJSON()[0]).toMatchObject({ condition: DateFilterCondition.DateStartsOn, content: '' });
  });

  test('unresolved targets preserve known predicates and metadata until schema resolution', () => {
    const f = fixture(FieldType.SingleSelect, []);
    const filters = attach(f, f.makeFilter(0, 'red', RollupFilterMode.Every));
    const before = filters.toJSON();

    migrateRollupFilters(f.database, f.fieldId);
    expect(filters.toJSON()).toEqual(before);
  });

  test('migration compares server bigint enums semantically and becomes a no-op', () => {
    const f = fixture(FieldType.RichText, []);
    const rule = f.makeFilter(0, 'Alpha', RollupFilterMode.Every);
    const metadata = rule.toJSON().rollup_meta;

    rule.set(K.rollup_meta, { ...metadata, target_field_type: 0n, rollup_show_as: 1n, rollup_filter_mode: 2n });
    const filters = attach(f, rule);
    const stored = filters.toJSON()[0];

    stored.rollup_target_ty = 0n;
    filters.delete(0);
    filters.push([stored]);
    const observer = jest.fn();

    filters.observeDeep(observer);
    migrateRollupFilters(f.database, f.fieldId, FieldType.RichText);
    expect(observer).not.toHaveBeenCalled();
    f.option.set(K.show_as, RollupDisplayMode.UniqueList);
    migrateRollupFilters(f.database, f.fieldId, FieldType.RichText);
    expect(filters.toJSON()[0]).toMatchObject({
      content: 'Alpha',
      rollup_meta: { rollup_show_as: 2, rollup_filter_mode: 2 },
    });
    observer.mockClear();
    migrateRollupFilters(f.database, f.fieldId, FieldType.RichText);
    expect(observer).not.toHaveBeenCalled();
  });

  test('a select rename updates display while the stored option ID still matches', async () => {
    const f = fixture(FieldType.SingleSelect, ['red']);
    const node = f.makeFilter(0, 'red');

    expect(rollupFilterCheck(await readRollupCell(f), node, f.field)).toBe(true);
    f.targetOption.set(K.content, JSON.stringify({ options: [{ id: 'red', name: 'Renamed', color: 0 }] }));
    invalidateRollupCell(`${f.rowId}:${f.fieldId}`);
    const value = await readRollupCell(f);

    expect(value.value).toBe('Renamed');
    expect(rollupFilterCheck(value, node, f.field)).toBe(true);
    expect(node.get(K.content)).toBe('red');
  });

  test('typed predicates without a compatible list mode never interpret IDs as text', async () => {
    const f = fixture(FieldType.Checkbox, ['No']);
    const node = f.makeFilter(0, '');
    const metadata = node.toJSON().rollup_meta;

    delete metadata.rollup_filter_mode;
    node.set(K.rollup_meta, metadata);
    expect(rollupFilterCheck(await readRollupCell(f), node, f.field)).toBe(true);
  });
});
