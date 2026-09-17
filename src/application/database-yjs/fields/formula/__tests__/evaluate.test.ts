import dayjs from 'dayjs';
import * as Y from 'yjs';

import { FieldType, FilterType, SortCondition } from '@/application/database-yjs/database.type';
import { NumberFormat } from '@/application/database-yjs/fields/number/number.type';
import { filterBy, resolveRollupFilterTargetFieldType } from '@/application/database-yjs/filter';
import { formulaPredicateFieldType } from '@/application/database-yjs/formula/filter';
import { Row } from '@/application/database-yjs/selector';
import { sortBy } from '@/application/database-yjs/sort';
import {
  RowId,
  YDatabaseCell,
  YDatabaseCells,
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

import * as cellValues from '../cell-values';
import { clearFormulaCompileCache, compileFormula } from '../compile';
import { evaluateFormulaCell } from '../evaluate';
import * as evaluator from '../evaluator';
import { FORMULA_MAX_DEPTH } from '../formula.type';
import { readFormulaSchema, readFormulaSchemaForVersion, toDisplayExpression, toStorageExpression } from '../schema';

/**
 * Builds a database `fields` map inside one Y.Doc, so every field has the map
 * as its parent exactly like a real database document.
 */
function createFields(
  specs: Array<{ id: string; name: string; type: FieldType; typeOption?: Record<string, unknown> }>
): YDatabaseFields {
  const doc = new Y.Doc();
  const fields = doc.getMap('fields') as YDatabaseFields;

  doc.transact(() => {
    specs.forEach((spec) => {
      const field = new Y.Map() as YDatabaseField;

      fields.set(spec.id, field);
      field.set(YjsDatabaseKey.id, spec.id);
      field.set(YjsDatabaseKey.name, spec.name);
      field.set(YjsDatabaseKey.type, spec.type);

      if (spec.typeOption) {
        const typeOptionMap = new Y.Map();
        const option = new Y.Map();

        field.set(YjsDatabaseKey.type_option, typeOptionMap);
        typeOptionMap.set(String(spec.type), option);
        Object.entries(spec.typeOption).forEach(([key, value]) => option.set(key, value));
      }
    });
  });

  return fields;
}

type CellSpec = {
  type: FieldType;
  data?: unknown;
  endTimestamp?: string;
  includeTime?: boolean;
  isRange?: boolean;
};

function createRow(
  rowId: string,
  cells: Record<string, CellSpec>,
  meta: { createdAt?: string; lastModified?: string; createdBy?: number } = {}
): { doc: YDoc; row: YDatabaseRow } {
  const doc = new Y.Doc() as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const row = new Y.Map() as YDatabaseRow;
  const cellMap = new Y.Map() as YDatabaseCells;

  sharedRoot.set(YjsEditorKey.database_row, row);
  row.set(YjsDatabaseKey.id, rowId);
  row.set(YjsDatabaseKey.cells, cellMap);
  row.set(YjsDatabaseKey.created_at, meta.createdAt ?? '1700000000');
  row.set(YjsDatabaseKey.last_modified, meta.lastModified ?? '1700000000');
  if (meta.createdBy !== undefined) row.set(YjsDatabaseKey.created_by, meta.createdBy);

  Object.entries(cells).forEach(([fieldId, spec]) => {
    const cell = new Y.Map() as YDatabaseCell;

    cellMap.set(fieldId, cell);
    cell.set(YjsDatabaseKey.field_type, spec.type);
    if (spec.data !== undefined) cell.set(YjsDatabaseKey.data, spec.data);
    if (spec.endTimestamp !== undefined) cell.set(YjsDatabaseKey.end_timestamp, spec.endTimestamp);
    if (spec.includeTime !== undefined) cell.set(YjsDatabaseKey.include_time, spec.includeTime);
    if (spec.isRange !== undefined) cell.set(YjsDatabaseKey.is_range, spec.isRange);
  });

  return { doc, row };
}

const NOW = dayjs('2024-03-01T10:00:00').valueOf();
const DUE = dayjs('2024-03-11T00:00:00');

const selectOptions = {
  options: [
    { id: 'opt-high', name: 'High', color: 'Purple' },
    { id: 'opt-low', name: 'Low', color: 'Blue' },
    { id: 'opt-a', name: 'Alpha', color: 'Blue' },
    { id: 'opt-b', name: 'Beta', color: 'Blue' },
  ],
  disable_color: false,
};

function buildFixture(formulas: Record<string, string>, options: { numberFormat?: NumberFormat } = {}) {
  const fields = createFields([
    { id: 'f-title', name: 'Name', type: FieldType.RichText },
    { id: 'f-price', name: 'Price', type: FieldType.Number, typeOption: { format: NumberFormat.Num } },
    { id: 'f-qty', name: 'Qty', type: FieldType.Number },
    { id: 'f-done', name: 'Done', type: FieldType.Checkbox },
    { id: 'f-due', name: 'Due', type: FieldType.DateTime },
    { id: 'f-priority', name: 'Priority', type: FieldType.SingleSelect, typeOption: { content: JSON.stringify(selectOptions) } },
    { id: 'f-tags', name: 'Tags', type: FieldType.MultiSelect, typeOption: { content: JSON.stringify(selectOptions) } },
    { id: 'f-created', name: 'Created', type: FieldType.CreatedTime },
    {
      id: 'f-people',
      name: 'Owner',
      type: FieldType.Person,
      typeOption: { content: JSON.stringify({ persons: [{ id: 'u1', name: 'Ada' }, { id: 'u2', name: 'Grace' }] }) },
    },
    { id: 'f-check', name: 'Steps', type: FieldType.Checklist },
    { id: 'f-url', name: 'Link', type: FieldType.URL },
    ...Object.entries(formulas).map(([id, formula]) => ({
      id,
      name: id.replace('f-', ''),
      type: FieldType.Formula,
      typeOption: { expression: formula, format: options.numberFormat ?? NumberFormat.Num },
    })),
  ]);

  const schema = readFormulaSchema(fields);
  const { row } = createRow(
    'row-1',
    {
      'f-title': { type: FieldType.RichText, data: 'Widget' },
      'f-price': { type: FieldType.Number, data: '12.5' },
      'f-qty': { type: FieldType.Number, data: '4' },
      'f-done': { type: FieldType.Checkbox, data: 'Yes' },
      'f-due': { type: FieldType.DateTime, data: String(DUE.unix()), includeTime: false },
      'f-priority': { type: FieldType.SingleSelect, data: 'opt-high' },
      'f-tags': { type: FieldType.MultiSelect, data: 'opt-a,opt-b' },
      'f-people': { type: FieldType.Person, data: JSON.stringify(['u1', 'u2']) },
      'f-check': {
        type: FieldType.Checklist,
        data: JSON.stringify({ options: [{ id: 'c1', name: 'a' }, { id: 'c2', name: 'b' }], selected_option_ids: ['c1'] }),
      },
      'f-url': { type: FieldType.URL, data: 'https://appflowy.io' },
    },
    { createdAt: String(dayjs('2024-02-01T09:00:00').unix()), createdBy: 42 }
  );

  const evaluate = (fieldId: string) => {
    const field = fields.get(fieldId);

    return evaluateFormulaCell({ schema, field, fieldId, row, rowId: 'row-1', now: () => NOW });
  };

  return { fields, schema, row, evaluate };
}

beforeEach(() => {
  clearFormulaCompileCache();
});

describe('formula evaluation over database rows', () => {
  it('evaluates shared dependencies once and discards their values between row evaluations', () => {
    const formulas = Object.fromEntries(
      Array.from({ length: 13 }, (_, index) => [
        `cached-${index}`,
        index === 0 ? 'prop("f-price")' : `prop("cached-${index - 1}") + prop("cached-${index - 1}")`,
      ])
    );
    const { fields, schema, row, evaluate } = buildFixture(formulas);
    const priceCell = row.get(YjsDatabaseKey.cells).get('f-price');
    const read = jest.spyOn(cellValues, 'readFieldFormulaValue');
    const evaluateAst = jest.spyOn(evaluator, 'evaluateFormula');

    try {
      priceCell.set(YjsDatabaseKey.data, '1');
      expect(evaluate('cached-12').rawNumeric).toBe(4096);
      expect(read).toHaveBeenCalledTimes(1);
      expect(evaluateAst).toHaveBeenCalledTimes(13);
      read.mockClear();
      priceCell.set(YjsDatabaseKey.data, '2');
      expect(evaluate('cached-12').rawNumeric).toBe(8192);
      expect(read).toHaveBeenCalledTimes(1);
      const second = createRow('row-2', { 'f-price': { type: FieldType.Number, data: '3' } });

      expect(evaluateFormulaCell({
        schema, field: fields.get('cached-12'), fieldId: 'cached-12', row: second.row, rowId: 'row-2',
      }).rawNumeric).toBe(12288);
    } finally {
      read.mockRestore();
      evaluateAst.mockRestore();
    }
  });

  it('reads every supported property type from the row', () => {
    const { evaluate } = buildFixture({
      'f-total': 'prop("f-price") * prop("f-qty")',
      'f-label': 'prop("f-title") + " (" + prop("f-priority") + ")"',
      'f-flag': 'prop("f-done") and prop("f-price") > 10',
      'f-days': 'dateBetween(prop("f-due"), today(), "days")',
      'f-tags-count': 'prop("f-tags").length()',
      'f-tags-text': 'prop("f-tags").join(", ")',
      'f-owners': 'prop("f-people").join(" & ")',
      'f-progress': 'prop("f-check")',
      'f-created-year': 'year(prop("f-created"))',
      'f-url-ok': 'contains(prop("f-url"), "appflowy")',
    });

    expect(evaluate('f-total')).toMatchObject({ resultType: 'number', text: '50', rawNumeric: 50 });
    expect(evaluate('f-label')).toMatchObject({ resultType: 'text', text: 'Widget (High)' });
    expect(evaluate('f-flag')).toMatchObject({ resultType: 'boolean', rawBoolean: true, text: 'Yes' });
    expect(evaluate('f-days')).toMatchObject({ resultType: 'number', rawNumeric: 10 });
    expect(evaluate('f-tags-count')).toMatchObject({ rawNumeric: 2 });
    expect(evaluate('f-tags-text')).toMatchObject({ text: 'Alpha, Beta' });
    expect(evaluate('f-owners')).toMatchObject({ text: 'Ada & Grace' });
    expect(evaluate('f-progress')).toMatchObject({ rawNumeric: 50 });
    expect(evaluate('f-created-year')).toMatchObject({ rawNumeric: 2024 });
    expect(evaluate('f-url-ok')).toMatchObject({ rawBoolean: true });
  });

  it('resolves property references by name as well as by id', () => {
    const { evaluate } = buildFixture({ 'f-total': 'prop("Price") * prop("Qty")' });

    const total = evaluate('f-total');

    expect(total.rawNumeric).toBe(50);
    expect(total.error).toBeUndefined();
  });

  it('formats number results with the field number format and dates as date cells', () => {
    const { evaluate } = buildFixture(
      { 'f-total': 'prop("f-price") * prop("f-qty")', 'f-next': 'dateAdd(prop("f-due"), 1, "weeks")' },
      { numberFormat: NumberFormat.USD }
    );

    expect(evaluate('f-total').text).toBe('$50');
    const next = evaluate('f-next');

    expect(next.resultType).toBe('date');
    expect(next.rawDate).toEqual({ start: DUE.add(1, 'week').unix(), end: undefined, includeTime: false });
    expect(next.text).toBe(DUE.add(1, 'week').format('MM/DD/YYYY'));
  });

  it('evaluates formulas that reference other formulas', () => {
    const { evaluate } = buildFixture({
      'f-subtotal': 'prop("f-price") * prop("f-qty")',
      'f-tax': 'round(prop("f-subtotal") * 0.1, 2)',
      'f-total': 'prop("f-subtotal") + prop("f-tax")',
    });

    expect(evaluate('f-total')).toMatchObject({ rawNumeric: 55, text: '55' });
  });

  it('reports self references, cycles and errors in referenced formulas', () => {
    const { evaluate, fields, schema } = buildFixture({
      'f-a': 'prop("f-b") + 1',
      'f-b': 'prop("f-a") + 1',
      'f-self': 'prop("f-self")',
      'f-broken': 'upper(1)',
      'f-uses-broken': 'prop("f-broken") + "!"',
    });

    expect(evaluate('f-self').error).toMatch(/would reference itself/);
    expect(evaluate('f-a').error).toMatch(/would reference itself/);
    expect(evaluate('f-broken').error).toMatch(/upper\(\) expects text/);
    expect(evaluate('f-uses-broken').error).toMatch(/has an invalid formula/);
    expect(compileFormula('prop("f-a")', schema, 'f-c').error?.message).toMatch(/would reference itself/);
    expect(fields.get('f-a')).toBeDefined();
  });

  it('returns an empty result for a blank formula and a positioned error for a syntax error', () => {
    const { evaluate } = buildFixture({ 'f-blank': '   ', 'f-bad': 'prop("f-price") +' });

    const blank = evaluate('f-blank');

    expect(blank).toMatchObject({ resultType: 'empty', text: '' });
    expect(blank.error).toBeUndefined();
    expect(evaluate('f-bad').error).toBe('Unexpected end of formula [1,18]');
  });

  it('reports unknown properties', () => {
    const { evaluate } = buildFixture({ 'f-missing': 'prop("Nope") + 1' });

    expect(evaluate('f-missing').error).toMatch(/Unknown property "Nope"/);
  });

  it('treats missing cells as empty values', () => {
    const fields = createFields([
      { id: 'f-n', name: 'N', type: FieldType.Number },
      { id: 'f-t', name: 'T', type: FieldType.RichText },
      { id: 'f-d', name: 'D', type: FieldType.DateTime },
      { id: 'f-m', name: 'M', type: FieldType.MultiSelect },
      {
        id: 'f-x',
        name: 'X',
        type: FieldType.Formula,
        typeOption: {
          expression:
            'format(prop("f-n") + 1) + "|" + prop("f-t") + "|" + format(empty(prop("f-d"))) + "|" + format(prop("f-m").length())',
        },
      },
    ]);
    const { row } = createRow('row-empty', {});

    expect(
      evaluateFormulaCell({ schema: readFormulaSchema(fields), field: fields.get('f-x'), fieldId: 'f-x', row, rowId: 'row-empty' })
    ).toMatchObject({ text: '1||true|0' });
  });

  it.each(['prop("Title") + 2 + 3', 'let(title, prop("Title"), title + 2 + 3)', 'prop("Copy") + 2 + 3'])(
    'concatenates untouched and stored blank text consistently: %s',
    (expression) => {
      const fields = createFields([
        { id: 'title', name: 'Title', type: FieldType.RichText },
        { id: 'copy', name: 'Copy', type: FieldType.Formula, typeOption: { expression: 'prop("Title")' } },
        { id: 'result', name: 'Result', type: FieldType.Formula, typeOption: { expression } },
      ]);
      const schema = readFormulaSchema(fields);

      for (const cells of [{}, { title: { type: FieldType.RichText, data: '' } }]) {
        const { row } = createRow('blank', cells);

        expect(evaluateFormulaCell({ schema, field: fields.get('result'), fieldId: 'result', row, rowId: 'blank' }))
          .toMatchObject({ resultType: 'text', text: '23' });
      }
    }
  );
});

describe('formula expression storage', () => {
  it('converts property names to ids for storage and back for display', () => {
    const { schema } = buildFixture({});
    const display = 'prop("Price") * prop("Qty") + length(prop("Name")) /* "Price" stays */';
    const storage = toStorageExpression(display, schema);

    expect(storage).toBe('prop("f-price") * prop("f-qty") + length(prop("f-title")) /* "Price" stays */');
    expect(toDisplayExpression(storage, schema)).toBe(display);
  });

  it('keeps unknown references and unparseable drafts untouched', () => {
    const { schema } = buildFixture({});

    expect(toStorageExpression('prop("Unknown") + 1', schema)).toBe('prop("Unknown") + 1');
    expect(toStorageExpression('prop("Price") + "unterminated', schema)).toBe('prop("Price") + "unterminated');
  });

  it('escapes quotes in property names', () => {
    const fields = createFields([{ id: 'f-q', name: 'Say "hi"', type: FieldType.RichText }]);
    const schema = readFormulaSchema(fields);
    const storage = toStorageExpression('prop("Say \\"hi\\"")', schema);

    expect(storage).toBe('prop("f-q")');
    expect(toDisplayExpression(storage, schema)).toBe('prop("Say \\"hi\\"")');
  });

  it('resolves ids before names and the first of duplicate names', () => {
    const fields = createFields([
      { id: 'a', name: 'b', type: FieldType.Number },
      { id: 'b', name: 'Other', type: FieldType.Number },
      { id: 'dup-1', name: 'Dup', type: FieldType.Number },
      { id: 'dup-2', name: 'Dup', type: FieldType.Number },
    ]);
    const schema = readFormulaSchema(fields);

    expect(toStorageExpression('prop("b") + prop("Dup")', schema)).toBe('prop("b") + prop("dup-1")');
    const stored = 'prop("a") + prop("b") + prop("dup-1") + prop("dup-2")';

    expect(toStorageExpression(toDisplayExpression(stored, schema), schema)).toBe(stored);
  });
});

describe('formula schema caches', () => {
  it('invalidates inferred types when a dependency changes within the same second', () => {
    const fields = createFields([
      { id: 'a', name: 'A', type: FieldType.Formula, typeOption: { expression: '1' } },
      { id: 'b', name: 'B', type: FieldType.Formula, typeOption: { expression: 'prop("a")' } },
    ]);

    fields.get('a').set(YjsDatabaseKey.last_modified, '1700000000');
    expect(compileFormula('prop("a")', readFormulaSchema(fields), 'b').resultType).toBe('number');
    fields.get('a').get(YjsDatabaseKey.type_option)?.get(String(FieldType.Formula))?.set(YjsDatabaseKey.expression, '"text"');
    expect(compileFormula('prop("a")', readFormulaSchema(fields), 'b').resultType).toBe('text');
  });

  it('rejects a cyclic editor draft after its dependency was cached', () => {
    const fields = createFields([
      { id: 'a', name: 'A', type: FieldType.Formula, typeOption: { expression: '1' } },
      { id: 'b', name: 'B', type: FieldType.Formula, typeOption: { expression: 'prop("a") + 1' } },
    ]);
    const schema = readFormulaSchema(fields);

    expect(compileFormula('prop("a") + 1', schema, 'b').error).toBeUndefined();
    expect(compileFormula('prop("b")', schema, 'a').error?.message).toMatch(/reference itself/);
    expect(compileFormula('prop("a") + 1', schema, 'b').error).toBeUndefined();
  });

  it('shares one schema per fields version', () => {
    const fields = createFields([{ id: 'f-price', name: 'Price', type: FieldType.Number }]);
    const first = readFormulaSchemaForVersion(fields, 1);

    expect(readFormulaSchemaForVersion(fields, 1)).toBe(first);
    fields.get('f-price')?.set(YjsDatabaseKey.name, 'Cost');
    const next = readFormulaSchemaForVersion(fields, 2);

    expect(next).not.toBe(first);
    expect(next[0].name).toBe('Cost');
  });

  it('does not cache a depth error reached through a longer chain', () => {
    clearFormulaCompileCache();
    const chainLength = FORMULA_MAX_DEPTH + 2;
    const fields = createFields(
      Array.from({ length: chainLength }, (_, index) => ({
        id: `f-${index}`,
        name: `F${index}`,
        type: FieldType.Formula,
        typeOption: { expression: index === chainLength - 1 ? '1' : `prop("f-${index + 1}") + 1` },
      }))
    );
    const schema = readFormulaSchema(fields);
    const deepest = `f-${FORMULA_MAX_DEPTH - 1}`;

    expect(compileFormula('prop("f-1") + 1', schema, 'f-0').error?.message).toMatch(/levels deep|invalid formula/);
    // On its own the formula near the end of the chain is within the limit.
    expect(compileFormula(`prop("f-${FORMULA_MAX_DEPTH}") + 1`, schema, deepest).error).toBeUndefined();
  });
});

function createFilter(fieldId: string, condition: number, content = ''): YDatabaseFilters {
  const doc = new Y.Doc();
  const filter = doc.getMap('filter') as YDatabaseFilter;

  filter.set(YjsDatabaseKey.id, 'filter-1');
  filter.set(YjsDatabaseKey.field_id, fieldId);
  filter.set(YjsDatabaseKey.filter_type, FilterType.Data);
  filter.set(YjsDatabaseKey.condition, condition);
  filter.set(YjsDatabaseKey.content, content);

  return { toArray: () => [filter], length: 1 } as unknown as YDatabaseFilters;
}

function createSorts(fieldId: string, condition: SortCondition): YDatabaseSorts {
  const doc = new Y.Doc();
  const sort = doc.getMap('sort') as YDatabaseSort;

  sort.set(YjsDatabaseKey.id, 'sort-1');
  sort.set(YjsDatabaseKey.field_id, fieldId);
  sort.set(YjsDatabaseKey.condition, condition);

  return { toArray: () => [sort] } as YDatabaseSorts;
}

describe('formula filters and sorts', () => {
  const fields = createFields([
    { id: 'f-price', name: 'Price', type: FieldType.Number },
    { id: 'f-done', name: 'Done', type: FieldType.Checkbox },
    { id: 'f-due', name: 'Due', type: FieldType.DateTime },
    { id: 'f-double', name: 'Double', type: FieldType.Formula, typeOption: { expression: 'prop("f-price") * 2' } },
    { id: 'f-label', name: 'Label', type: FieldType.Formula, typeOption: { expression: 'if(prop("f-done"), "done", "open")' } },
    { id: 'f-flag', name: 'Flag', type: FieldType.Formula, typeOption: { expression: 'prop("f-price") > 5' } },
    { id: 'f-next', name: 'Next', type: FieldType.Formula, typeOption: { expression: 'dateAdd(prop("f-due"), 1, "days")' } },
  ]);
  const rows: Row[] = ['row-a', 'row-b', 'row-c'].map((id) => ({ id, height: 0 }));
  const rowMetas: Record<RowId, YDoc> = {
    'row-a': createRow('row-a', {
      'f-price': { type: FieldType.Number, data: '3' },
      'f-done': { type: FieldType.Checkbox, data: 'Yes' },
      'f-due': { type: FieldType.DateTime, data: String(dayjs('2024-03-03').unix()) },
    }).doc,
    'row-b': createRow('row-b', {
      'f-price': { type: FieldType.Number, data: '10' },
      'f-done': { type: FieldType.Checkbox, data: 'No' },
      'f-due': { type: FieldType.DateTime, data: String(dayjs('2024-03-01').unix()) },
    }).doc,
    'row-c': createRow('row-c', {
      'f-price': { type: FieldType.Number, data: '7' },
      'f-due': { type: FieldType.DateTime, data: String(dayjs('2024-03-02').unix()) },
    }).doc,
  };

  it('derives the filter vocabulary from the result type', () => {
    expect(formulaPredicateFieldType(fields.get('f-double'), fields)).toBe(FieldType.Number);
    expect(formulaPredicateFieldType(fields.get('f-label'), fields)).toBe(FieldType.RichText);
    expect(formulaPredicateFieldType(fields.get('f-flag'), fields)).toBe(FieldType.Checkbox);
    expect(formulaPredicateFieldType(fields.get('f-next'), fields)).toBe(FieldType.DateTime);
    // Persisted on the filter (rollup_target_ty) so the server can rebuild the variant.
    expect(resolveRollupFilterTargetFieldType(FieldType.Formula, fields.get('f-double'))).toBe(FieldType.Number);
    expect(resolveRollupFilterTargetFieldType(FieldType.Formula, fields.get('f-next'))).toBe(FieldType.DateTime);
  });

  it('filters number, text, boolean and date results', () => {
    // NumberFilterCondition.GreaterThan = 2
    expect(filterBy(rows, createFilter('f-double', 2, '10'), fields, rowMetas).map((row) => row.id)).toEqual([
      'row-b',
      'row-c',
    ]);
    // TextFilterCondition.TextContains = 2
    expect(filterBy(rows, createFilter('f-label', 2, 'done'), fields, rowMetas).map((row) => row.id)).toEqual(['row-a']);
    // CheckboxFilterCondition.IsChecked = 0
    expect(filterBy(rows, createFilter('f-flag', 0), fields, rowMetas).map((row) => row.id)).toEqual(['row-b', 'row-c']);
    // DateFilterCondition.DateStartsOn = 0 with a timestamp payload
    const on = JSON.stringify({ timestamp: dayjs('2024-03-04').unix() });

    expect(filterBy(rows, createFilter('f-next', 0, on), fields, rowMetas).map((row) => row.id)).toEqual(['row-a']);
  });

  it('sorts by the evaluated result with the ordering of its type', () => {
    expect(sortBy(rows, createSorts('f-double', SortCondition.Ascending), fields, rowMetas).map((row) => row.id)).toEqual([
      'row-a',
      'row-c',
      'row-b',
    ]);
    expect(sortBy(rows, createSorts('f-double', SortCondition.Descending), fields, rowMetas).map((row) => row.id)).toEqual([
      'row-b',
      'row-c',
      'row-a',
    ]);
    expect(sortBy(rows, createSorts('f-label', SortCondition.Ascending), fields, rowMetas).map((row) => row.id)).toEqual([
      'row-a',
      'row-b',
      'row-c',
    ]);
    expect(sortBy(rows, createSorts('f-next', SortCondition.Ascending), fields, rowMetas).map((row) => row.id)).toEqual([
      'row-b',
      'row-c',
      'row-a',
    ]);
  });
});
