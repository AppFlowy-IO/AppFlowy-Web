import * as Y from 'yjs';
import { CalculationType as C, FieldType as F, RollupDisplayMode as D } from '../database.type';
import { createRelationField } from '../fields/relation/utils';
import { createRollupField } from '../fields/rollup/utils';
import { readRollupCondition, writeRollupCondition } from '../fields/rollup/condition';
import { evaluateRollupCell, readRollupCell } from '../rollup/cache';
import { observeRollupCell } from '../rollup/observe';
import { getRowKey } from '../row_meta';
import {
  YDatabase,
  YDatabaseFields,
  YDatabaseField,
  YDatabaseRow,
  YDatabaseCells,
  YDatabaseCell,
  YDoc,
  YjsDatabaseKey as K,
  YjsEditorKey as E,
} from '@/application/types';

let sequence = 0;
function field(id: string, type: F, expression = '') {
  const result = new Y.Map() as YDatabaseField;
  result.set(K.id, id);
  result.set(K.name, id);
  result.set(K.type, type);
  const options = new Y.Map();
  const option = new Y.Map();
  options.set(String(type), option);
  option.set('expression', expression);
  option.set('format', 0);
  option.set(
    'content',
    JSON.stringify({
      options: [
        { id: 'done', name: 'Done', color: 0 },
        { id: 'progress', name: 'In progress', color: 1 },
      ],
    })
  );
  result.set(K.type_option, options);
  return result;
}
function database(id: string) {
  const doc = new Y.Doc({ guid: id }) as YDoc;
  const db = new Y.Map() as YDatabase;
  const fields = new Y.Map() as YDatabaseFields;
  doc.getMap(E.data_section).set(E.database, db);
  db.set(K.id, id);
  db.set(K.fields, fields);
  return { doc, db, fields };
}
function row(id: string, databaseId: string, values: Record<string, [F, unknown]>) {
  const doc = new Y.Doc() as YDoc;
  const result = new Y.Map() as YDatabaseRow;
  const cells = new Y.Map() as YDatabaseCells;
  doc.getMap(E.data_section).set(E.database_row, result);
  result.set(K.id, id);
  result.set(K.database_id, databaseId);
  result.set(K.cells, cells);
  for (const [key, [type, value]] of Object.entries(values)) {
    const cell = new Y.Map() as YDatabaseCell;
    cells.set(key, cell);
    cell.set(K.field_type, type);
    cell.set(K.data, value);
  }
  return { doc, row: result };
}
function fixture(type: F, expression: string, inputs: unknown[], calculation: C, showAs = D.Calculated) {
  const suffix = ++sequence;
  const base = database(`base-${suffix}`);
  const target = database(`target-${suffix}`);
  target.fields.set('source', field('source', type));
  target.fields.set('formula', field('formula', F.Formula, expression));
  base.fields.set('relation', createRelationField('relation', { database_id: target.doc.guid }));
  const rollupId = `rollup-${suffix}`;
  const rollup = createRollupField(rollupId);
  base.fields.set(rollupId, rollup);
  const option = rollup.get(K.type_option).get(String(F.Rollup));
  option.set(K.relation_field_id, 'relation');
  option.set(K.target_field_id, 'formula');
  option.set(K.calculation_type, calculation);
  option.set(K.show_as, showAs);
  const targetRows = inputs.map((value, i) =>
    row(`target-row-${suffix}-${i}`, target.doc.guid, value === undefined ? {} : { source: [type, value] })
  );
  const owner = row(`owner-${suffix}`, base.doc.guid, {
    relation: [F.Relation, targetRows.map(({ row }) => row.get(K.id))],
  });
  const docs = new Map([
    [base.doc.guid, base.doc],
    [target.doc.guid, target.doc],
  ]);
  const rows = new Map([
    ...targetRows.map(({ doc, row }) => [getRowKey(target.doc.guid, row.get(K.id)), doc] as const),
    [getRowKey(base.doc.guid, owner.row.get(K.id)), owner.doc],
  ]);
  const context = {
    baseDoc: base.doc,
    database: base.db,
    rollupField: rollup,
    row: owner.row,
    rowId: owner.row.get(K.id),
    fieldId: rollupId,
    getViewIdFromDatabaseId: async (id: string) => id,
    loadView: async (id: string) => docs.get(id) ?? null,
    createRow: async (id: string) => rows.get(id)!,
  };
  return { base, target, targetRows, owner, option, context, docs, rows };
}

// Expected answers are product examples, never produced by another formula implementation.
describe('typed formula targets combined with rollup calculations', () => {
  it.each([
    ['number sum', F.Number, 'prop("source") * 2', ['2', '5'], C.Sum, '14', 14],
    ['number average', F.Number, 'prop("source") * 2', ['2', '5'], C.Average, '7', 7],
    [
      'boolean checked',
      F.SingleSelect,
      'prop("source") == "Done"',
      ['done', 'progress', undefined],
      C.CountChecked,
      '1',
      1,
    ],
    [
      'boolean percent',
      F.MultiSelect,
      'includes(prop("source"), "Done")',
      ['done,progress', 'progress', undefined, 'done'],
      C.PercentChecked,
      '50.0%',
      50,
    ],
    ['boolean unchecked', F.Checkbox, 'prop("source")', ['Yes', 'No', 'No'], C.CountUnchecked, '2', 2],
    ['text unique', F.RichText, 'upper(prop("source"))', ['a', 'A', 'b'], C.CountUnique, '2', 2],
    ['errors are empty', F.RichText, '1 / 0', ['x', 'y'], C.CountEmpty, '2', 2],
    ['empty formulas', F.RichText, '', ['x', 'y'], C.CountNonEmpty, '0', 0],
  ] as const)('%s', async (_name, type, expression, inputs, calculation, value, rawNumeric) => {
    const f = fixture(type, expression, [...inputs], calculation);
    expect(await evaluateRollupCell(f.context)).toMatchObject({ value, rawNumeric });
  });

  it('preserves raw formula numbers independently of percent display formatting', async () => {
    const f = fixture(F.Number, 'prop("source")', ['0.25', '0.5'], C.Sum);
    f.target.fields.get('formula')!.get(K.type_option).get(String(F.Formula)).set('format', 1);
    expect((await evaluateRollupCell(f.context)).rawNumeric).toBe(0.75);
  });

  it('preserves formula date ranges and visible times in original lists', async () => {
    const f = fixture(
      F.RichText,
      'dateRange(parseDate("2026-09-24T18:00:00Z"), parseDate("2026-09-26T09:00:00Z"))',
      ['x'],
      C.Count,
      D.OriginalList
    );
    const result = await evaluateRollupCell(f.context);
    expect(result.targetFieldType).toBe(F.DateTime);
    expect(result.filterCells?.[0].date).toMatchObject({
      data: String(Date.parse('2026-09-24T18:00:00Z') / 1000),
      includeTime: true,
      isRange: true,
    });
  });

  it('calculates earliest formula date from timestamps', async () => {
    const f = fixture(F.RichText, 'parseDate(prop("source"))', ['2026-09-26', '2026-09-24'], C.DateEarliest);
    expect((await evaluateRollupCell(f.context)).rawDate?.data).toBe(String(Date.parse('2026-09-24') / 1000));
  });

  it.each([
    [C.DateEarliest, '2026-09-24T18:45:00', '09/24/2026 6:45 PM'],
    [C.DateLatest, '2026-09-26T09:15:00', '09/26/2026 9:15 AM'],
  ] as const)(
    'reduces Formula ranges to one visible-time endpoint for calculation %s',
    async (calculation, timestamp, display) => {
      const f = fixture(
        F.RichText,
        'dateRange(parseDate(prop("source")), dateAdd(parseDate(prop("source")), 5, "days"))',
        ['2026-09-24T18:45:00', '2026-09-26T09:15:00'],
        calculation
      );
      const result = await evaluateRollupCell(f.context);
      expect(result.value).toBe(display);
      expect(result.rawDate).toMatchObject({ data: String(Date.parse(timestamp) / 1000), includeTime: true });
      expect(result.rawDate?.isRange).not.toBe(true);
      expect(result.rawDate?.endTimestamp).toBeUndefined();
    }
  );

  it('retains a range only for Date range aggregation of Formula ranges', async () => {
    const f = fixture(
      F.RichText,
      'dateRange(parseDate(prop("source")), dateAdd(parseDate(prop("source")), 5, "days"))',
      ['2026-09-24T18:45:00', '2026-09-26T09:15:00'],
      C.DateRange
    );
    expect((await evaluateRollupCell(f.context)).rawDate).toMatchObject({
      data: String(Date.parse('2026-09-24T18:45:00') / 1000),
      endTimestamp: String(Date.parse('2026-09-26T09:15:00') / 1000),
      isRange: true,
    });
  });

  it('shows list formulas without requiring stored formula cells', async () => {
    const f = fixture(F.MultiSelect, 'prop("source")', ['done,progress', 'progress'], C.Count, D.OriginalList);
    expect((await evaluateRollupCell(f.context)).list).toEqual(['Done, In progress', 'In progress']);
  });

  it('evaluates formula chains on related rows', async () => {
    const f = fixture(F.Number, 'prop("other") + 1', ['3', '8'], C.Sum);
    f.target.fields.set('other', field('other', F.Formula, 'prop("source") * 2'));
    expect((await evaluateRollupCell(f.context)).rawNumeric).toBe(24);
  });
});

describe('selected option count and percentage', () => {
  it.each([F.SingleSelect, F.MultiSelect])('counts rows matching ANY option once for field type %s', async (type) => {
    const f = fixture(type, '', ['done,progress', 'done', 'progress', undefined], C.CountValue);
    f.option.set(K.target_field_id, 'source');
    f.option.set(K.condition_value, '["done","progress"]');
    expect((await evaluateRollupCell(f.context)).rawNumeric).toBe(3);
    f.option.set(K.calculation_type, C.PercentValue);
    expect(await evaluateRollupCell(f.context)).toMatchObject({ value: '75.0%', rawNumeric: 75 });
    f.option.set(K.condition_value, 'done');
    expect((await evaluateRollupCell(f.context)).rawNumeric).toBe(50);
    f.option.set(K.condition_value, 'deleted-option');
    expect((await evaluateRollupCell(f.context)).rawNumeric).toBe(0);
  });

  it('keeps empty relation percentages blank and empty condition unconfigured', async () => {
    const f = fixture(F.MultiSelect, '', [], C.PercentValue);
    f.option.set(K.target_field_id, 'source');
    f.option.set(K.condition_value, 'done');
    expect((await evaluateRollupCell(f.context)).value).toBe('');
    const g = fixture(F.MultiSelect, '', ['done'], C.PercentValue);
    g.option.set(K.target_field_id, 'source');
    expect((await evaluateRollupCell(g.context)).value).toBe('');
  });

  it.each([
    ['', []],
    ['done', ['done']],
    ['["done","progress","done"]', ['done', 'progress']],
    ['["done",1]', ['["done",1]']],
    ['[malformed', ['[malformed']],
  ])('decodes the shared condition wire format %s', (raw, expected) => {
    expect(readRollupCondition(raw as string)).toEqual(expected);
    expect(readRollupCondition(writeRollupCondition(expected as string[]))).toEqual(expected);
  });
});

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Expected computed dependency update');
}

describe('computed dependency lifecycle', () => {
  function nested() {
    const f = fixture(F.Number, 'prop("nested") * 2', ['1', '2'], C.Sum);
    const child = database(`child-${sequence}`);
    child.fields.set('amount', field('amount', F.Number));
    const childRow = row(`child-row-${sequence}`, child.doc.guid, { amount: [F.Number, '3'] });
    f.docs.set(child.doc.guid, child.doc);
    f.rows.set(getRowKey(child.doc.guid, childRow.row.get(K.id)), childRow.doc);
    f.target.fields.set('nestedRelation', createRelationField('nestedRelation', { database_id: child.doc.guid }));
    const nestedRollup = createRollupField('nested');
    f.target.fields.set('nested', nestedRollup);
    const option = nestedRollup.get(K.type_option).get(String(F.Rollup));
    option.set(K.relation_field_id, 'nestedRelation');
    option.set(K.target_field_id, 'amount');
    option.set(K.calculation_type, C.Sum);
    for (const targetRow of f.targetRows) {
      const cell = new Y.Map() as YDatabaseCell;
      targetRow.row.get(K.cells).set('nestedRelation', cell);
      cell.set(K.field_type, F.Relation);
      cell.set(K.data, [childRow.row.get(K.id)]);
    }
    return { ...f, child, childRow, nestedOption: option };
  }

  it('resolves nested rollup inputs and refreshes when an external source changes', async () => {
    const f = nested();
    expect((await readRollupCell(f.context)).rawNumeric).toBe(12);
    const changed = jest.fn();
    const stop = observeRollupCell(f.context, changed);
    try {
      await until(() => changed.mock.calls.length > 0);
      changed.mockClear();
      f.childRow.row.get(K.cells).get('amount')!.set(K.data, '5');
      await until(() => changed.mock.calls.length > 0);
      expect((await readRollupCell(f.context)).rawNumeric).toBe(20);
      f.target.fields.get('formula')!.get(K.type_option).get(String(F.Formula)).set('expression', 'prop("nested") > 4');
      f.option.set(K.calculation_type, C.PercentChecked);
      changed.mockClear();
      await until(() => changed.mock.calls.length > 0);
      expect((await readRollupCell(f.context)).rawNumeric).toBe(100);
    } finally {
      stop();
    }
    const calls = changed.mock.calls.length;
    f.childRow.row.get(K.cells).get('amount')!.set(K.data, '9');
    expect(changed).toHaveBeenCalledTimes(calls);
  });

  it('refreshes clock-dependent Formula targets without a source edit', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    const f = fixture(F.Number, 'timestamp(now())', ['1'], C.Sum);
    const changed = jest.fn();
    const stop = observeRollupCell(f.context, changed);
    try {
      await jest.advanceTimersByTimeAsync(0);
      expect(changed).toHaveBeenCalled();
      const before = (await readRollupCell(f.context)).rawNumeric!;
      changed.mockClear();
      await jest.advanceTimersByTimeAsync(1000);
      expect(changed).toHaveBeenCalled();
      expect((await readRollupCell(f.context)).rawNumeric).toBe(before + 1000);
    } finally {
      stop();
      jest.useRealTimers();
    }
  });

  it('stops discovering dependencies when its observer is disposed during a row load', async () => {
    const f = nested();
    let resolveRow: (doc: YDoc) => void = () => undefined;
    const createRow = jest.fn(
      () =>
        new Promise<YDoc>((resolve) => {
          resolveRow = resolve;
        })
    );
    const changed = jest.fn();
    const stop = observeRollupCell({ ...f.context, createRow }, changed);
    await until(() => createRow.mock.calls.length === 1);
    stop();
    resolveRow(f.targetRows[0].doc);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(createRow).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'missing', 'unresolved'] as const)(
    'recovers from a %s metadata load without a source edit',
    async (failure) => {
      jest.useFakeTimers();
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const f = fixture(F.Number, 'prop("source") * 2', ['3'], C.Sum);
      let first = true;
      const loadView = jest.fn(async (id: string) => {
        if (first) {
          first = false;
          if (failure === 'rejected') throw new Error('Transient source error');
          return null;
        }
        return f.context.loadView(id);
      });
      const changed = jest.fn();
      const stop = observeRollupCell(
        {
          ...f.context,
          loadView,
          getViewIdFromDatabaseId: async (id) => {
            if (first && failure === 'unresolved') {
              first = false;
              return null;
            }
            return id;
          },
        },
        changed
      );
      try {
        await jest.advanceTimersByTimeAsync(0);
        expect(changed).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(250);
        expect(loadView).toHaveBeenCalledTimes(failure === 'unresolved' ? 1 : 2);
        expect(changed).toHaveBeenCalledTimes(2);
        expect((await readRollupCell(f.context)).rawNumeric).toBe(6);
        f.targetRows[0].row.get(K.cells).get('source')!.set(K.data, '4');
        await jest.advanceTimersByTimeAsync(0);
        expect(changed).toHaveBeenCalledTimes(3);
        expect((await readRollupCell(f.context)).rawNumeric).toBe(8);
      } finally {
        stop();
        error.mockRestore();
        jest.useRealTimers();
      }
    }
  );

  it('rejects missing Formula relation-title sources during permanent materialization', async () => {
    const f = fixture(F.Number, 'join(prop("names"), ", ")', ['1'], C.Count);
    f.target.fields.set('names', createRelationField('names', { database_id: 'missing-database' }));
    const cell = new Y.Map() as YDatabaseCell;
    f.targetRows[0].row.get(K.cells).set('names', cell);
    cell.set(K.field_type, F.Relation);
    cell.set(K.data, ['missing-row']);
    await expect(evaluateRollupCell({ ...f.context, requireLoadedSources: true })).rejects.toThrow(
      'could not be loaded for formula conversion'
    );
  });

  it.each(['title property', 'row payload'] as const)(
    'rejects an unhydrated relation %s during materialization',
    async (missing) => {
      const f = fixture(F.Number, 'join(prop("names"), ", ")', ['1'], C.Count);
      const titles = database(`title-db-${sequence}`);
      const views = new Y.Map();
      const view = new Y.Map();
      const orders = new Y.Array();
      orders.push([{ id: 'title-row' }]);
      view.set(K.row_orders, orders);
      views.set('title-view', view);
      titles.db.set(K.views, views);
      f.docs.set(titles.doc.guid, titles.doc);
      f.rows.set(getRowKey(titles.doc.guid, 'title-row'), new Y.Doc() as YDoc);
      if (missing === 'row payload') {
        const title = field('title', F.RichText);
        title.set(K.is_primary, true);
        titles.fields.set('title', title);
      }
      f.target.fields.set('names', createRelationField('names', { database_id: titles.doc.guid }));
      const cell = new Y.Map() as YDatabaseCell;
      f.targetRows[0].row.get(K.cells).set('names', cell);
      cell.set(K.field_type, F.Relation);
      cell.set(K.data, ['title-row']);
      await expect(evaluateRollupCell({ ...f.context, requireLoadedSources: true })).rejects.toThrow(
        'could not be loaded for formula conversion'
      );
    }
  );

  it.each([64, 65])('handles the shared %s-hop Rollup/Formula boundary', async (depth) => {
    const f = fixture(F.Number, '1', ['1'], C.Sum);
    let currentDatabase = f.target;
    let currentRow = f.targetRows[0];
    for (let hop = 1; hop < depth; hop++) {
      const child = database(`depth-${sequence}-${hop}`);
      child.fields.set('formula', field('formula', F.Formula, '1'));
      const childRow = row(`depth-row-${sequence}-${hop}`, child.doc.guid, {});
      f.docs.set(child.doc.guid, child.doc);
      f.rows.set(getRowKey(child.doc.guid, childRow.row.get(K.id)), childRow.doc);
      currentDatabase.fields
        .get('formula')!
        .get(K.type_option)
        .get(String(F.Formula))
        .set('expression', 'prop("nested")');
      currentDatabase.fields.set('next', createRelationField('next', { database_id: child.doc.guid }));
      const nested = createRollupField('nested');
      currentDatabase.fields.set('nested', nested);
      const option = nested.get(K.type_option).get(String(F.Rollup));
      option.set(K.relation_field_id, 'next');
      option.set(K.target_field_id, 'formula');
      option.set(K.calculation_type, C.Sum);
      const cell = new Y.Map() as YDatabaseCell;
      currentRow.row.get(K.cells).set('next', cell);
      cell.set(K.field_type, F.Relation);
      cell.set(K.data, [childRow.row.get(K.id)]);
      currentDatabase = child;
      currentRow = childRow;
    }
    const value = await evaluateRollupCell(f.context);
    if (depth === 64) expect(value.rawNumeric).toBe(1);
    else expect(value).toMatchObject({ value: '', error: 'Formula and rollup dependencies are too deep' });
  });

  it('terminates cross-database Formula/Rollup cycles before using in-flight promises', async () => {
    const f = nested();
    f.nestedOption.set(K.target_field_id, 'loop');
    f.child.fields.set('loop', field('loop', F.Formula, 'prop("back")'));
    f.child.fields.set('backRelation', createRelationField('backRelation', { database_id: f.base.doc.guid }));
    const back = createRollupField('back');
    f.child.fields.set('back', back);
    const option = back.get(K.type_option).get(String(F.Rollup));
    option.set(K.relation_field_id, 'backRelation');
    option.set(K.target_field_id, 'ownerFormula');
    option.set(K.calculation_type, C.Sum);
    f.base.fields.set('ownerFormula', field('ownerFormula', F.Formula, `prop("${f.context.fieldId}")`));
    const cell = new Y.Map() as YDatabaseCell;
    f.childRow.row.get(K.cells).set('backRelation', cell);
    cell.set(K.field_type, F.Relation);
    cell.set(K.data, [f.owner.row.get(K.id)]);
    const results = await Promise.all(Array.from({ length: 6 }, () => readRollupCell(f.context)));
    expect(results.every((result) => result.value === '' && result.error?.includes('Circular'))).toBe(true);
    await expect(evaluateRollupCell({ ...f.context, requireLoadedSources: true })).rejects.toThrow('Circular');
  });
});
