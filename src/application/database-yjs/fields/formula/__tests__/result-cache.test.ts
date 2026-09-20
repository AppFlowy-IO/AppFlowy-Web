import * as Y from 'yjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { NumberFormat } from '@/application/database-yjs/fields/number/number.type';
import {
  YDatabaseCell,
  YDatabaseCells,
  YDatabaseField,
  YDatabaseFields,
  YDatabaseRow,
  YjsDatabaseKey,
} from '@/application/types';

import { evaluateFormulaCell, evaluateFormulaExpression, EvaluateFormulaCellOptions } from '../evaluate';
import * as evaluator from '../evaluator';
import { FORMULA_RESULT_CACHE_LIMITS } from '../result-cache';
import { readFormulaSchema } from '../schema';

interface FieldSpec {
  id: string;
  type: FieldType;
  option?: Record<string, unknown>;
}

function addField(fields: YDatabaseFields, { id, type, option }: FieldSpec) {
  const field = new Y.Map() as YDatabaseField;

  fields.set(id, field);
  field.set(YjsDatabaseKey.id, id);
  field.set(YjsDatabaseKey.name, id);
  field.set(YjsDatabaseKey.type, type);
  const typeOptions = new Y.Map();
  const typeOption = new Y.Map();

  field.set(YjsDatabaseKey.type_option, typeOptions);
  typeOptions.set(String(type), typeOption);
  Object.entries(option ?? {}).forEach(([key, value]) => typeOption.set(key, value));
  return field;
}

function createRow(value: unknown = '3', storedType = FieldType.Number) {
  const doc = new Y.Doc();
  const row = doc.getMap('row') as YDatabaseRow;
  const cells = new Y.Map() as YDatabaseCells;
  const cell = new Y.Map() as YDatabaseCell;

  row.set(YjsDatabaseKey.cells, cells);
  row.set(YjsDatabaseKey.last_modified, '1700000000');
  cells.set('input', cell);
  cell.set(YjsDatabaseKey.field_type, storedType);
  cell.set(YjsDatabaseKey.data, value);
  return { doc, row, cells, cell };
}

function fixture(expression = 'prop("input") * 2', inputType = FieldType.Number, value: unknown = '3') {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;

  addField(fields, { id: 'input', type: inputType });
  const field = addField(fields, { id: 'result', type: FieldType.Formula, option: { expression } });
  const row = createRow(value, inputType);
  const options: EvaluateFormulaCellOptions = {
    schema: readFormulaSchema(fields),
    field,
    fieldId: 'result',
    row: row.row,
    rowId: 'row-1',
  };

  return {
    fields,
    ...row,
    databaseDoc: doc,
    options,
    evaluate: (overrides: Partial<EvaluateFormulaCellOptions> = {}) => evaluateFormulaCell({ ...options, ...overrides }),
  };
}

function option(field: YDatabaseField, type = FieldType.Formula) {
  return field.get(YjsDatabaseKey.type_option)!.get(String(type))!;
}

describe('saved formula result cache', () => {
  let evaluateAst: jest.SpyInstance;

  beforeEach(() => {
    evaluateAst = jest.spyOn(evaluator, 'evaluateFormula');
  });
  afterEach(() => jest.restoreAllMocks());

  it('shares successful saved results across calls without evaluating the AST again', () => {
    const f = fixture();

    expect(f.evaluate()).toMatchObject({ text: '6', rawNumeric: 6 });
    expect(f.evaluate()).toMatchObject({ text: '6', rawNumeric: 6 });
    f.row.set(YjsDatabaseKey.last_modified, '1800000000');
    expect(f.evaluate().rawNumeric).toBe(6);
    expect(evaluateAst).toHaveBeenCalledTimes(1);
  });

  it('does not cache caller-built schema arrays without a live source', () => {
    const f = fixture('prop("nested")');
    const nested = addField(f.fields, { id: 'nested', type: FieldType.Formula, option: { expression: '1' } });
    const schema = readFormulaSchema(f.fields).slice();

    expect(f.evaluate({ schema }).rawNumeric).toBe(1);
    option(nested).set(YjsDatabaseKey.expression, '2');
    expect(f.evaluate({ schema }).rawNumeric).toBe(2);
    expect(evaluateAst).toHaveBeenCalledTimes(4);
  });

  it('reads local and remote edits immediately without relying on modified timestamps', () => {
    const f = fixture();

    expect(f.evaluate().rawNumeric).toBe(6);
    f.cell.set(YjsDatabaseKey.data, '4');
    expect(f.evaluate().rawNumeric).toBe(8);
    const remote = new Y.Doc();

    Y.applyUpdate(remote, Y.encodeStateAsUpdate(f.doc));
    const remoteRow = remote.getMap('row') as YDatabaseRow;

    remoteRow.get(YjsDatabaseKey.cells)!.get('input')!.set(YjsDatabaseKey.data, '5');
    Y.applyUpdate(f.doc, Y.encodeStateAsUpdate(remote));
    expect(f.evaluate().rawNumeric).toBe(10);
    expect(f.row.get(YjsDatabaseKey.last_modified)).toBe('1700000000');
    expect(evaluateAst).toHaveBeenCalledTimes(3);
  });

  it('observes mutation/read/mutation/read within the same row transaction', () => {
    const f = fixture();

    f.evaluate();
    f.doc.transact(() => {
      f.cell.set(YjsDatabaseKey.data, '7');
      expect(f.evaluate().rawNumeric).toBe(14);
      f.cell.set(YjsDatabaseKey.data, '9');
      expect(f.evaluate().rawNumeric).toBe(18);
      expect(f.evaluate().rawNumeric).toBe(18);
    });
    expect(evaluateAst).toHaveBeenCalledTimes(3);
  });

  it('refreshes transitive expressions inside a database transaction using a retained schema', () => {
    const f = fixture('prop("nested") + 1');
    const nested = addField(f.fields, {
      id: 'nested',
      type: FieldType.Formula,
      option: { expression: 'prop("input") * 2' },
    });

    expect(f.evaluate().rawNumeric).toBe(7);
    f.databaseDoc.transact(() => {
      option(nested).set(YjsDatabaseKey.expression, 'prop("input") * 3');
      expect(f.evaluate().rawNumeric).toBe(10);
      option(nested).set(YjsDatabaseKey.expression, 'prop("input") * 4');
      expect(f.evaluate().rawNumeric).toBe(13);
    });
    expect(f.evaluate().rawNumeric).toBe(13);
    expect(evaluateAst).toHaveBeenCalledTimes(6);
  });

  it('uses the replacement formula field handle and refreshed property names/types', () => {
    const f = fixture();

    expect(f.evaluate().rawNumeric).toBe(6);
    addField(f.fields, { id: 'result', type: FieldType.Formula, option: { expression: 'prop("Title").upper()' } });
    const input = f.fields.get('input')!;

    input.set(YjsDatabaseKey.name, 'Title');
    input.set(YjsDatabaseKey.type, FieldType.RichText);
    expect(f.evaluate()).toMatchObject({ text: '3', resultType: 'text' });
    expect(f.evaluate()).toMatchObject({ text: '3', resultType: 'text' });
    expect(evaluateAst).toHaveBeenCalledTimes(2);
  });

  it('fingerprints decoded lazy conversions and source number options', () => {
    const f = fixture('prop("input")', FieldType.Number, '$1,234.50');

    f.cell.set(YjsDatabaseKey.field_type, FieldType.RichText);
    expect(f.evaluate().rawNumeric).toBe(1);
    option(f.fields.get('input')!, FieldType.Number).set('format', NumberFormat.USD);
    expect(f.evaluate().rawNumeric).toBe(1234.5);
    expect(f.evaluate().rawNumeric).toBe(1234.5);
    expect(evaluateAst).toHaveBeenCalledTimes(2);
  });

  it('invalidates selected option names and selected IDs without a schema reload', () => {
    const f = fixture('prop("input").join(" / ")', FieldType.MultiSelect, 'a');
    const options = [
      { id: 'a', name: 'Alpha', color: 'Blue' },
      { id: 'b', name: 'Beta', color: 'Blue' },
    ];
    const setOptions = () =>
      option(f.fields.get('input')!, FieldType.MultiSelect).set('content', JSON.stringify({ options }));

    setOptions();
    expect(f.evaluate().text).toBe('Alpha');
    options[0].name = 'Renamed';
    setOptions();
    expect(f.evaluate().text).toBe('Renamed');
    f.cell.set(YjsDatabaseKey.data, 'b,a');
    expect(f.evaluate().text).toBe('Beta / Renamed');
    expect(f.evaluate().text).toBe('Beta / Renamed');
    expect(evaluateAst).toHaveBeenCalledTimes(3);
  });

  it('includes saved and explicit result format options in cache validity', () => {
    const f = fixture();

    expect(f.evaluate().text).toBe('6');
    expect(f.evaluate({ format: { numberFormat: NumberFormat.USD } }).text).toBe('$6');
    option(f.options.field).set('format', NumberFormat.EUR);
    expect(f.evaluate().text).toBe('€6');
    expect(f.evaluate().text).toBe('€6');
    expect(evaluateAst).toHaveBeenCalledTimes(3);
    expect(f.evaluate({ format: { numberFormat: undefined } }).text).toBe('6');
    expect(evaluateAst).toHaveBeenCalledTimes(4);
  });

  it('isolates actual database documents and row IDs, and revalidates replacement row documents', () => {
    const f = fixture('id() + ":" + format(prop("input"))');
    const other = fixture('id() + ":" + format(prop("input"))');

    expect(f.evaluate().text).toBe('row-1:3');
    expect(other.evaluate().text).toBe('row-1:3');
    expect(f.evaluate({ rowId: 'row-2' }).text).toBe('row-2:3');
    const replacement = createRow('8');

    expect(f.evaluate({ row: replacement.row }).text).toBe('row-1:8');
    expect(f.evaluate({ row: replacement.row }).text).toBe('row-1:8');
    expect(evaluateAst).toHaveBeenCalledTimes(4);
  });

  it('does not expose cached result values or type objects to caller mutation', () => {
    const f = fixture('[[prop("input")]]');
    const first = f.evaluate();

    if (first.value.type !== 'list') throw new Error('expected list');
    first.value.items.length = 0;
    if (typeof first.resultType !== 'string') first.resultType.list = 'text';
    first.text = 'poisoned';
    const cached = f.evaluate();

    expect(cached).toMatchObject({ text: '3', resultType: { list: { list: 'number' } } });
    if (cached.value.type !== 'list') throw new Error('expected list');
    cached.value.items.length = 0;
    expect(f.evaluate().value).toEqual({
      type: 'list',
      items: [{ type: 'list', items: [{ type: 'number', value: 3 }] }],
    });
    expect(evaluateAst).toHaveBeenCalledTimes(1);
    f.cell.set(YjsDatabaseKey.data, '4');
    expect(f.evaluate()).toMatchObject({ text: '4', resultType: { list: { list: 'number' } } });
    expect(evaluateAst).toHaveBeenCalledTimes(2);
  });

  it('distinguishes signed zero and safely decodes nonfinite input', () => {
    const f = fixture('prop("input")', FieldType.Number, '0');

    expect(Object.is(f.evaluate().rawNumeric, 0)).toBe(true);
    f.cell.set(YjsDatabaseKey.data, '-0');
    expect(Object.is(f.evaluate().rawNumeric, -0)).toBe(true);
    expect(Object.is(f.evaluate().rawNumeric, -0)).toBe(true);
    f.cell.set(YjsDatabaseKey.data, 'Infinity');
    expect(f.evaluate().value).toEqual({ type: 'empty' });
    expect(f.evaluate().rawNumeric).toBeUndefined();
    expect(evaluateAst).toHaveBeenCalledTimes(3);
  });

  it('evicts least recently used entries by count', () => {
    const f = fixture('id()');

    for (let index = 0; index < FORMULA_RESULT_CACHE_LIMITS.entries; index += 1) f.evaluate({ rowId: String(index) });
    f.evaluate({ rowId: '0' });
    f.evaluate({ rowId: 'new' });
    f.evaluate({ rowId: '0' });
    expect(evaluateAst).toHaveBeenCalledTimes(FORMULA_RESULT_CACHE_LIMITS.entries + 1);
    f.evaluate({ rowId: '1' });
    expect(evaluateAst).toHaveBeenCalledTimes(FORMULA_RESULT_CACHE_LIMITS.entries + 2);
  });

  it('evicts by byte budget before the entry count limit', () => {
    const f = fixture('repeat("x", 1000)');

    f.evaluate({ rowId: 'first' });
    for (let index = 0; index < 300; index += 1) f.evaluate({ rowId: String(index) });
    expect(evaluateAst).toHaveBeenCalledTimes(301);
    f.evaluate({ rowId: 'first' });
    expect(evaluateAst).toHaveBeenCalledTimes(302);
  });

  it.each([
    ['repeat("x", 10000)', FieldType.Number, '3'],
    ['prop("input").length()', FieldType.RichText, 'x'.repeat(FORMULA_RESULT_CACHE_LIMITS.entryBytes)],
  ])('bypasses oversized values/results: %s', (expression, type, value) => {
    const f = fixture(expression as string, type as FieldType, value);

    expect(f.evaluate().error).toBeUndefined();
    expect(f.evaluate().error).toBeUndefined();
    expect(evaluateAst).toHaveBeenCalledTimes(2);
  });

  it('clears and permanently bypasses a destroyed database scope without row listeners', () => {
    const f = fixture();
    const databaseOnce = jest.spyOn(f.databaseDoc, 'once');
    const rowOnce = jest.spyOn(f.doc, 'once');

    f.evaluate();
    f.evaluate();
    expect(databaseOnce).toHaveBeenCalledTimes(1);
    expect(rowOnce).not.toHaveBeenCalled();
    f.databaseDoc.destroy();
    expect(f.evaluate().rawNumeric).toBe(6);
    expect(f.evaluate().rawNumeric).toBe(6);
    expect(evaluateAst).toHaveBeenCalledTimes(3);
    expect(databaseOnce).toHaveBeenCalledTimes(1);
  });

  it.each([
    FieldType.DateTime,
    FieldType.CreatedTime,
    FieldType.LastEditedTime,
    FieldType.Person,
    FieldType.CreatedBy,
    FieldType.LastEditedBy,
    FieldType.Relation,
    FieldType.Rollup,
  ])('bypasses transitive external/date dependencies of type %s', (type) => {
    const f = fixture('prop("nested")', type, '');

    addField(f.fields, { id: 'nested', type: FieldType.Formula, option: { expression: 'prop("input")' } });
    expect(f.evaluate().error).toBeUndefined();
    expect(f.evaluate().error).toBeUndefined();
    expect(evaluateAst).toHaveBeenCalledTimes(4);
  });

  it('keeps external person results fresh as resolvers load and change', () => {
    const f = fixture('prop("input").join(", ")', FieldType.Person, '["person-1"]');

    expect(f.evaluate().text).toBe('');
    expect(f.evaluate({ getPersonName: () => 'Ada' }).text).toBe('Ada');
    expect(f.evaluate({ getPersonName: () => 'Grace' }).text).toBe('Grace');
    expect(evaluateAst).toHaveBeenCalledTimes(3);
  });

  it('bypasses lazy conversions from raw dates even when the current field is text', () => {
    const f = fixture('prop("input")', FieldType.RichText, '1700000000');

    f.cell.set(YjsDatabaseKey.field_type, FieldType.CreatedTime);
    expect(f.evaluate().error).toBeUndefined();
    expect(f.evaluate().error).toBeUndefined();
    expect(evaluateAst).toHaveBeenCalledTimes(2);
  });

  it('keeps clock/date functions uncached, including transitive clock functions', () => {
    const f = fixture('prop("nested")');

    addField(f.fields, { id: 'nested', type: FieldType.Formula, option: { expression: 'timestamp(now())' } });
    expect(f.evaluate({ now: () => 1000 }).rawNumeric).toBe(1000);
    expect(f.evaluate({ now: () => 2000 }).rawNumeric).toBe(2000);
    expect(evaluateAst).toHaveBeenCalledTimes(4);
    option(f.options.field).set(YjsDatabaseKey.expression, 'timestamp(parseDate("2024-01-01"))');
    expect(f.evaluate().error).toBeUndefined();
    expect(f.evaluate().error).toBeUndefined();
    expect(evaluateAst).toHaveBeenCalledTimes(6);
  });

  it('never persists errors or incomplete rows', () => {
    const f = fixture('repeat("x", 10000).split("").map(index).sum() + repeat("x", 10000).split("").map(index).sum()');

    expect(f.evaluate().error).toMatch(/work limit/);
    expect(f.evaluate().error).toMatch(/work limit/);
    expect(evaluateAst).toHaveBeenCalledTimes(2);
    const emptyDoc = new Y.Doc();
    const row = emptyDoc.getMap('row') as YDatabaseRow;

    option(f.options.field).set(YjsDatabaseKey.expression, '1');
    expect(f.evaluate({ row }).rawNumeric).toBe(1);
    expect(f.evaluate({ row }).rawNumeric).toBe(1);
    expect(evaluateAst).toHaveBeenCalledTimes(4);
  });

  it('leaves preview and contextual calls uncached while refreshing preview schema', () => {
    const f = fixture();

    f.evaluate();
    expect(evaluateFormulaExpression({ ...f.options, expression: 'prop("input") + 1' }).rawNumeric).toBe(4);
    expect(evaluateFormulaExpression({ ...f.options, expression: 'prop("input") + 1' }).rawNumeric).toBe(4);
    f.fields.get('input')!.set(YjsDatabaseKey.name, 'Renamed');
    expect(evaluateFormulaExpression({ ...f.options, expression: 'prop("Renamed") + 2' }).rawNumeric).toBe(5);
    expect(f.evaluate({ visiting: new Set() }).rawNumeric).toBe(6);
    expect(f.evaluate({ visiting: new Set() }).rawNumeric).toBe(6);
    expect(evaluateAst).toHaveBeenCalledTimes(6);
  });

  it('preserves shared nested work budgets even after warming each dependency', () => {
    const heavy = 'repeat("x", 10000).split("").map(index).sum()';
    const f = fixture('prop("left") + prop("right")');
    const left = addField(f.fields, { id: 'left', type: FieldType.Formula, option: { expression: heavy } });
    const right = addField(f.fields, { id: 'right', type: FieldType.Formula, option: { expression: heavy } });

    expect(f.evaluate({ field: left, fieldId: 'left' }).error).toBeUndefined();
    expect(f.evaluate({ field: right, fieldId: 'right' }).error).toBeUndefined();
    expect(f.evaluate().error).toMatch(/work limit/);
    expect(f.evaluate().error).toMatch(/work limit/);
  });

  it('does not reuse a saved result for a cyclic preview or changed cyclic expression', () => {
    const f = fixture('1');

    addField(f.fields, { id: 'nested', type: FieldType.Formula, option: { expression: 'prop("result")' } });
    expect(f.evaluate().rawNumeric).toBe(1);
    expect(evaluateFormulaExpression({ ...f.options, expression: 'prop("nested")' }).error).toMatch(/reference itself/);
    option(f.options.field).set(YjsDatabaseKey.expression, 'prop("nested")');
    expect(f.evaluate().error).toMatch(/reference itself/);
  });
});
