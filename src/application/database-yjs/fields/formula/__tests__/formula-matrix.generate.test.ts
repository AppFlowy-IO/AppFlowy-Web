/**
 * Generates the formula matrix BDD features for web (playwright-bdd) and
 * desktop (bdd_widget_test) from the function catalogue.
 *
 * Every function gets its documented examples, a per-parameter matrix
 * (matching property, literal, empty property, wrong type), and the
 * operators, lazy functions, empty semantics and nested combinations get
 * hand-written cases. Expected cell texts come from the web engine on a
 * fixed fixture and are asserted strictly on both platforms.
 *
 * Run: FORMULA_MATRIX_OUT=1 npx jest --no-coverage --testPathPattern=formula-matrix.generate
 * Desktop features go to $FORMULA_MATRIX_DESKTOP_DIR when set.
 */
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

import dayjs from 'dayjs';

import { FieldType } from '@/application/database-yjs/database.type';
import { FORMULA_BUILTINS } from '@/application/database-yjs/fields/formula/builtins';
import { clearFormulaCompileCache, compileFormula } from '@/application/database-yjs/fields/formula/compile';
import { evaluateFormulaCell } from '@/application/database-yjs/fields/formula/evaluate';
import { formatFormulaValue } from '@/application/database-yjs/fields/formula/format';
import { FORMULA_FUNCTIONS } from '@/application/database-yjs/fields/formula/functions';
import { FormulaParam } from '@/application/database-yjs/fields/formula/registry';
import { readFormulaSchema } from '@/application/database-yjs/fields/formula/schema';
import { FormulaType, FormulaValue, typeToString } from '@/application/database-yjs/fields/formula/values';
import { createFields, createRow, FieldSpec, selectOptions } from './fixture';
import { YDatabaseRow } from '@/application/types';

// ---------------------------------------------------------------------------
// Fixture: the same grid on web (table step) and desktop (backend helper).
// ---------------------------------------------------------------------------

const ROW_NAMES = ['Ada Lovelace', 'notion', 'Row3'];
const EMPTY = '<empty>';

interface FixtureProperty {
  name: string;
  webType: 'Text' | 'Number' | 'Checkbox' | 'Date' | 'Select' | 'MultiSelect';
  fieldType: FieldType;
  values: [string, string, string];
}

const FIXTURE: FixtureProperty[] = [
  { name: 'Name', webType: 'Text', fieldType: FieldType.RichText, values: ['Ada Lovelace', 'notion', 'Row3'] },
  { name: 'Note', webType: 'Text', fieldType: FieldType.RichText, values: ['Hello, World!', 'x', EMPTY] },
  { name: 'Num', webType: 'Number', fieldType: FieldType.Number, values: ['8', '3.75', EMPTY] },
  { name: 'Neg', webType: 'Number', fieldType: FieldType.Number, values: ['-2.5', '1.5', EMPTY] },
  { name: 'Zero', webType: 'Number', fieldType: FieldType.Number, values: ['0', '7', EMPTY] },
  { name: 'Flag', webType: 'Checkbox', fieldType: FieldType.Checkbox, values: ['Yes', 'No', 'No'] },
  { name: 'When', webType: 'Date', fieldType: FieldType.DateTime, values: ['2024-03-05', '2024-12-31', EMPTY] },
  { name: 'Tag', webType: 'Select', fieldType: FieldType.SingleSelect, values: ['alpha', 'beta', EMPTY] },
  { name: 'Tags', webType: 'MultiSelect', fieldType: FieldType.MultiSelect, values: ['a, b, c', 'b', EMPTY] },
];

/** A fixed clock for now()/today() so derived cases stay deterministic. */
const NOW = dayjs('2024-03-01T12:00:00').valueOf();

function optionIds(property: FixtureProperty): Array<[string, string]> {
  const names = new Set<string>();

  property.values
    .filter((value) => value !== EMPTY)
    .forEach((value) => value.split(',').forEach((name) => names.add(name.trim())));
  return [...names].map((name) => [`${property.name}-${name}`, name]);
}

function buildFixture(formulas: Array<{ name: string; expression: string }>) {
  const specs: FieldSpec[] = FIXTURE.map((property) => {
    const spec: FieldSpec = { id: property.name, name: property.name, type: property.fieldType };

    if (property.webType === 'Select' || property.webType === 'MultiSelect') {
      spec.typeOption = { content: selectOptions(optionIds(property)) };
    }

    return spec;
  });

  formulas.forEach((formula) =>
    specs.push({
      id: `formula-${formula.name}`,
      name: formula.name,
      type: FieldType.Formula,
      typeOption: { expression: formula.expression },
    })
  );
  const fields = createFields(specs);
  const rows: YDatabaseRow[] = ROW_NAMES.map((_, index) => {
    const cells: Parameters<typeof createRow>[1] = {};

    FIXTURE.forEach((property) => {
      const value = property.values[index];

      if (value === EMPTY) return;
      switch (property.webType) {
        case 'Date':
          cells[property.name] = {
            type: FieldType.DateTime,
            data: String(dayjs(`${value}T00:00:00`).unix()),
            extra: { include_time: false },
          };
          break;
        case 'Select':
        case 'MultiSelect': {
          const ids = optionIds(property);

          cells[property.name] = {
            type: property.fieldType,
            data: value
              .split(',')
              .map((name) => ids.find(([, optionName]) => optionName === name.trim())?.[0])
              .filter(Boolean)
              .join(','),
          };
          break;
        }
        default:
          cells[property.name] = { type: property.fieldType, data: value };
      }
    });

    return createRow(`row-${index + 1}`, cells).row;
  });

  return { fields, schema: readFormulaSchema(fields), rows };
}

const READ_CONTEXT = {
  getUserName: () => undefined,
  getPersonName: () => undefined,
  getRelatedRowTitle: () => undefined,
  getRollupValue: () => undefined,
};

interface Evaluated {
  values?: [string, string, string];
  /** The same results as the desktop app shows them (its default date format). */
  desktopValues?: [string, string, string];
  error?: string;
  resultType: string;
}

/**
 * Desktop renders dates with the viewer's settings, whose defaults are the
 * "friendly" date (`MMM dd, y`) and 24-hour time; web defaults to
 * `MM/DD/YYYY` with 12-hour time. Everything else is the engine's text on
 * both platforms.
 */
function formatDesktop(value: FormulaValue): string {
  switch (value.type) {
    case 'date': {
      const pattern = value.value.includeTime ? 'MMM DD, YYYY HH:mm' : 'MMM DD, YYYY';
      const start = dayjs(value.value.start).format(pattern);

      return value.value.end === undefined ? start : `${start} → ${dayjs(value.value.end).format(pattern)}`;
    }
    case 'list':
      return value.items.map(formatDesktop).join(', ');
    default:
      return formatFormulaValue(value);
  }
}

function evaluate(expression: string, extraFormulas: Array<{ name: string; expression: string }> = []): Evaluated {
  clearFormulaCompileCache();
  const { fields, schema, rows } = buildFixture([...extraFormulas, { name: 'probe', expression }]);
  const compiled = compileFormula(expression, schema, 'formula-probe');

  if (compiled.error) return { error: compiled.error.displayMessage, resultType: 'any' };
  const results = rows.map((row, index) =>
    evaluateFormulaCell({
      ...READ_CONTEXT,
      schema,
      field: fields.get('formula-probe'),
      fieldId: 'formula-probe',
      row,
      rowId: `row-${index + 1}`,
      now: () => NOW,
    })
  );
  const values = results.map((result) => result.text) as [string, string, string];
  const desktopValues = results.map((result) => (result.error ? '' : formatDesktop(result.value))) as [
    string,
    string,
    string
  ];

  return { values, desktopValues, resultType: typeToString(compiled.resultType) };
}

// ---------------------------------------------------------------------------
// Case generation
// ---------------------------------------------------------------------------

interface MatrixCase {
  group: string;
  fn: string;
  expression: string;
  /** Rows whose value is asserted; `now()`-dependent cases assert none. */
  values?: [string, string, string];
  desktopValues?: [string, string, string];
  error?: string;
  resultType: string;
  origin: 'docs' | 'matrix' | 'manual';
  docsResult?: string;
}

type Candidate = { text: string; empty?: boolean };

/** Argument candidates by parameter type: matching properties, literals and the empty property. */
const CANDIDATES: Record<string, Candidate[]> = {
  number: [
    { text: 'prop("Num")' },
    { text: 'prop("Neg")' },
    { text: 'prop("Zero")', empty: true },
    { text: '2' },
    { text: '0' },
    { text: '-1.5' },
  ],
  text: [
    { text: 'prop("Name")' },
    { text: 'prop("Note")', empty: true },
    { text: '"abc"' },
    { text: '""' },
    { text: 'prop("Tag")', empty: true },
  ],
  boolean: [{ text: 'prop("Flag")' }, { text: 'true' }, { text: 'false' }],
  date: [
    { text: 'prop("When")', empty: true },
    { text: 'parseDate("2024-02-29")' },
    { text: 'fromTimestamp(1700000000000)' },
  ],
  list: [{ text: 'prop("Tags")', empty: true }, { text: '[1, 2, 3]' }, { text: '["b", "a", "c", "a"]' }, { text: '[]' }],
};

/** One value of a type that no other type accepts, for the mismatch cases. */
const MISMATCH: Record<string, string> = {
  number: '"abc"',
  text: '2',
  boolean: '"abc"',
  date: '"abc"',
  list: '"abc"',
};

/** Arguments that do not error for the matrix (e.g. a unit name). */
const SPECIAL_ARGS: Record<string, Record<string, string[]>> = {
  dateAdd: { unit: ['"days"', '"months"', '"years"', '"hours"', '"minutes"', '"weeks"', '"quarters"'] },
  dateSubtract: { unit: ['"days"', '"months"', '"years"', '"hours"', '"weeks"'] },
  dateBetween: { unit: ['"days"', '"hours"', '"minutes"', '"weeks"', '"months"', '"years"', '"quarters"'] },
  formatDate: { format: ['"YYYY-MM-DD"', '"MMM D, YYYY"', '"dddd"', '"HH:mm"', '"[Q]Q YYYY"', '"YYYY-MM-DD HH:mm:ss"'] },
  formatNumber: { format: ['"commas"', '"percent"', '"USD"', '"EUR"'] },
  test: { regex: ['"^[A-Z]"', '"\\\\d+"', '"o.i"'] },
  match: { regex: ['"[a-z]+"', '"\\\\d"', '"o"'] },
  replace: { regex: ['"o"', '"[aeiou]"', '"^."'], replacement: ['"0"', '"-"'] },
  replaceAll: { regex: ['"o"', '"[aeiou]"', '"l+"'], replacement: ['"0"', '"-"'] },
  split: { separator: ['","', '" "', '""', '"o"'] },
  join: { separator: ['", "', '"-"', '""'] },
  repeat: { count: ['3', '0', 'prop("Zero")'] },
  round: { decimals: ['1', '0', '-1'] },
  substring: { startIndex: ['0', '2', '10'], endIndex: ['3', '100'] },
  slice: { startIndex: ['1', '0'], endIndex: ['2', '10'] },
  at: { index: ['0', '2', '-1', '10'] },
  parseDate: {
    text: ['"2024-03-05"', '"2024-03-05T10:30:00"', '"March 5, 2024"', '"not a date"', 'prop("Note")', 'prop("Name")'],
  },
  fromTimestamp: { number: ['0', '1709294400000', 'prop("Num")', 'prop("Zero")'] },
  timestamp: {},
};

/** Results that differ per run or per row identity are not asserted. */
const DYNAMIC = /\b(now|today|id)\s*\(/;

/** Property names the docs examples use, mapped onto the fixture. */
const DOCS_PROPS: Record<string, string> = {
  Checked: 'Flag',
  Done: 'Flag',
  Reviewed: 'Flag',
  Date: 'When',
  Start: 'When',
  End: 'When',
  Due: 'When',
  Sprint: 'When',
  Subtotal: 'Num',
  Price: 'Num',
  Title: 'Name',
};

function onFixture(expression: string): string {
  return expression.replace(/prop\("([^"]+)"\)/g, (match, name: string) =>
    DOCS_PROPS[name] ? `prop("${DOCS_PROPS[name]}")` : match
  );
}

function typeNames(type: FormulaType | FormulaType[]): string[] {
  const types = Array.isArray(type) ? type : [type];

  return types.map((entry) => (typeof entry === 'string' ? entry : 'list'));
}

function candidatesFor(fn: string, param: FormulaParam): string[] {
  const special = SPECIAL_ARGS[fn]?.[param.name];

  if (special) return special;
  const names = typeNames(param.type);
  const out: string[] = [];

  names.forEach((name) => {
    const list =
      name === 'any'
        ? [
            ...CANDIDATES.number.slice(0, 1),
            ...CANDIDATES.text.slice(0, 2),
            ...CANDIDATES.boolean.slice(0, 1),
            ...CANDIDATES.list.slice(0, 2),
          ]
        : CANDIDATES[name] ?? [];

    list.forEach((candidate) => out.push(candidate.text));
  });

  return [...new Set(out)];
}

function mismatchFor(param: FormulaParam): string | undefined {
  const names = typeNames(param.type);

  if (names.includes('any')) return undefined;
  const wrong = Object.entries(MISMATCH).find(([type]) => !names.includes(type));

  return wrong?.[1];
}

function generateFunctionMatrix(): {
  expressions: Array<{ fn: string; expression: string }>;
  mismatches: Array<{ fn: string; expression: string }>;
} {
  const expressions: Array<{ fn: string; expression: string }> = [];
  const mismatches: Array<{ fn: string; expression: string }> = [];

  FORMULA_FUNCTIONS.forEach((spec) => {
    if (spec.lazy || !spec.params || spec.name === 'id') return;
    const params = spec.params;
    const required = params.filter((param) => !param.optional);
    const variadic = params.length === 1 && /^(values|lists)$/.test(params[0].name);
    const base = params.map((param) => candidatesFor(spec.name, param)[0]);
    const call = (args: string[]) => `${spec.name}(${args.join(', ')})`;
    const add = (args: string[]) => expressions.push({ fn: spec.name, expression: call(args) });

    if (params.length === 0) {
      add([]);
      return;
    }

    if (variadic) {
      const list = candidatesFor(spec.name, params[0]);

      list.forEach((candidate) => add([candidate]));
      add([list[0], list[1] ?? list[0]]);
      add(['prop("Num")', 'prop("Neg")', 'prop("Zero")']);
      add(['prop("Num")', 'prop("Zero")']);
      mismatches.push({ fn: spec.name, expression: call(['"abc"']) });
      return;
    }

    // Required-only call with each candidate of each parameter.
    params.forEach((param, index) => {
      candidatesFor(spec.name, param).forEach((candidate) => {
        const args = required.map((_, i) => (i === index ? candidate : base[i]));

        if (index < required.length) add(args);
      });
    });
    // Optional parameters: every candidate with the base for the rest.
    params.forEach((param, index) => {
      if (!param.optional) return;
      candidatesFor(spec.name, param).forEach((candidate) => {
        const args = params.slice(0, index + 1).map((_, i) => (i === index ? candidate : base[i]));

        add(args);
      });
    });
    // Wrong type for the first parameter that has a fixed type.
    const target = params.findIndex((param) => mismatchFor(param) !== undefined);

    if (target !== -1) {
      const args = required.map((_, i) => (i === target ? (mismatchFor(params[target]) as string) : base[i]));

      if (target < required.length) mismatches.push({ fn: spec.name, expression: call(args) });
    }
  });

  return { expressions, mismatches };
}

/** Lazy functions, variables, dot notation, operators, empty semantics and nesting. */
const MANUAL: Record<string, string[]> = {
  logic: [
    'if(prop("Flag"), "yes", "no")',
    'if(prop("Num") > 5, prop("Num") * 2, prop("Num") / 2)',
    'if(empty(prop("Note")), "none", prop("Note"))',
    'if(prop("Flag"), 1, "one")',
    'if(prop("Zero"), "truthy", "falsy")',
    'if(prop("Note"), "truthy", "falsy")',
    'if(prop("Tags"), "truthy", "falsy")',
    'if(prop("When"), "has date", "no date")',
    'ifs(prop("Num") > 5, "big", prop("Num") > 2, "mid", "small")',
    'ifs(prop("Flag"), "flag", prop("Zero") > 0, "zero", "none")',
    'ifs(false, "a", false, "b")',
    'and(prop("Flag"), prop("Num") > 5)',
    'and(true, prop("Zero"))',
    'or(prop("Flag"), prop("Zero") > 5)',
    'or(false, prop("Note"))',
    'not(prop("Flag"))',
    'not(empty(prop("Num")))',
    'empty(prop("Num"))',
    'empty(prop("Zero"))',
    'empty(prop("Note"))',
    'empty(prop("Flag"))',
    'empty(prop("When"))',
    'empty(prop("Tags"))',
    'empty(prop("Tag"))',
    'empty("")',
    'empty(0)',
    'empty([])',
    'empty(false)',
    'empty()',
    'equal(prop("Num"), 8)',
    'equal(prop("Name"), "notion")',
    'equal(prop("Flag"), true)',
    'equal(prop("Tags"), ["a", "b", "c"])',
    'equal(prop("Num"), prop("Zero"))',
    'unequal(prop("Num"), 8)',
    'unequal(prop("Note"), "")',
    'let(x, prop("Num") * 2, x + 1)',
    'let(name, upper(prop("Name")), name + "!")',
    'lets(a, prop("Num"), b, prop("Neg"), a * b)',
    'lets(a, 1, b, a + 1, c, b + 1, c)',
    'let(x, 2, let(x, 3, x))',
    'prop("Flag") ? "on" : "off"',
    'prop("Num") > 5 ? (prop("Num") > 7 ? "large" : "medium") : "small"',
    'empty(prop("Num")) ? "n/a" : format(prop("Num"))',
  ],
  operators: [
    'prop("Num") + prop("Neg")',
    'prop("Num") + prop("Zero")',
    'prop("Zero") + 1',
    'prop("Num") - prop("Neg")',
    'prop("Num") * prop("Neg")',
    'prop("Num") / prop("Zero")',
    'prop("Zero") / prop("Num")',
    'prop("Num") / 4',
    '7 / 2',
    '1 / 3',
    '2 / 3',
    '10 / 4 * 2',
    '-prop("Neg")',
    '-prop("Zero")',
    'prop("Num") % 3',
    'prop("Neg") % 2',
    '-7 % 3',
    '7 % -3',
    '2 ^ 10',
    '2 ^ 0.5',
    'prop("Num") ^ 2',
    '2 ^ 3 ^ 2',
    '(2 ^ 3) ^ 2',
    '1 + 2 * 3',
    '(1 + 2) * 3',
    '8 / 2 / 2',
    '10 - 2 - 3',
    '1 + 2 == 3',
    '"a" + "b"',
    'prop("Name") + " " + prop("Note")',
    'prop("Name") + prop("Note")',
    '"" + ""',
    'prop("Num") == 8',
    'prop("Num") != 8',
    'prop("Num") > prop("Neg")',
    'prop("Num") >= 8',
    'prop("Num") < 8',
    'prop("Num") <= prop("Zero")',
    'prop("Name") == "Ada Lovelace"',
    'prop("Name") != "notion"',
    '"b" > "a"',
    '"B" > "a"',
    '"abc" < "abd"',
    'prop("Flag") == true',
    'prop("Flag") != false',
    'true == false',
    'prop("When") == parseDate("2024-03-05")',
    'prop("When") > parseDate("2024-06-01")',
    'prop("When") < parseDate("2024-06-01")',
    'prop("Tags") == ["a", "b", "c"]',
    'prop("Tags") != []',
    'prop("Flag") and prop("Num") > 5',
    'prop("Flag") or prop("Num") > 5',
    'not prop("Flag")',
    'not empty(prop("Note"))',
    'true and false or true',
    'true or false and false',
    'not true and false',
    'prop("Num") > 5 ? "big" : "small"',
    'prop("Num") > 5 and prop("Neg") < 0 ? "yes" : "no"',
    '(prop("Num") + prop("Neg")) * 2 ^ 2 - 1',
  ],
  empty: [
    'prop("Num") + 1',
    'prop("Num") * 2',
    'prop("Zero") * 2',
    'format(prop("Num"))',
    'format(prop("Zero"))',
    'format(prop("Note"))',
    'format(prop("Flag"))',
    'format(prop("When"))',
    'format(prop("Tags"))',
    'format(prop("Tag"))',
    'format(empty())',
    'upper(prop("Note"))',
    'length(prop("Note"))',
    'length(prop("Tags"))',
    'prop("Note") + "!"',
    'prop("Name") + prop("Note")',
    'prop("Tags").join(", ")',
    'prop("Tags").first()',
    'prop("Tags").last()',
    'prop("Tags").length()',
    'prop("Tag") + "?"',
    'prop("Tag") == "alpha"',
    'if(empty(prop("Zero")), "empty", "has value")',
    'empty(prop("Zero")) ? 0 : prop("Zero") * 10',
    'round(prop("Neg"))',
    'abs(prop("Neg"))',
    'sum(prop("Num"), prop("Neg"), prop("Zero"))',
    'max(prop("Num"), prop("Neg"), prop("Zero"))',
    'min(prop("Num"), prop("Neg"), prop("Zero"))',
    'mean(prop("Num"), prop("Zero"))',
    'dateAdd(prop("When"), 1, "days")',
    'formatDate(prop("When"), "YYYY-MM-DD")',
    'year(prop("When"))',
    'dateBetween(prop("When"), parseDate("2024-01-01"), "days")',
    'timestamp(prop("When"))',
    'toNumber(prop("Note"))',
    'toNumber(prop("Name"))',
    'toNumber(prop("Flag"))',
    'toNumber(prop("Tag"))',
    'toNumber("")',
    'toNumber("12.5abc")',
    'toNumber("abc")',
    'toNumber(true)',
    'toNumber(prop("When"))',
    'prop("Flag") + 0',
    'prop("Num") + prop("Flag")',
  ],
  list: [
    'prop("Tags").map(current + "!")',
    'prop("Tags").map(format(index) + ":" + current)',
    '[1, 2, 3].map(current * 2)',
    '[1, 2, 3].map(current * prop("Num"))',
    'prop("Tags").filter(current != "b")',
    '[1, 2, 3, 4].filter(current % 2 == 0)',
    '[1, 2, 3].filter(current > 10)',
    'prop("Tags").find(current == "b")',
    'prop("Tags").find(current == "z")',
    '[5, 6, 7].findIndex(current == 7)',
    '[5, 6, 7].findIndex(current == 0)',
    'prop("Tags").some(current == "c")',
    'prop("Tags").some(current == "z")',
    '[].some(true)',
    'prop("Tags").every(length(current) == 1)',
    '[1, 2, 3].every(current > 0)',
    '[].every(false)',
    'prop("Tags").map(upper(current)).join("-")',
    'prop("Tags").filter(current != "a").map(current + current)',
    'prop("Tags").sort().reverse()',
    '[3, 1, 2].sort()',
    '["b", "a", "c"].sort()',
    '[3, 1, 2].sort().first()',
    '[3, 1, 2].sort().last()',
    '[1, 2, 2, 3, 1].unique()',
    '[[1, 2], [3]].flat()',
    '[1, 2].concat([3], [4, 5])',
    'prop("Tags").concat(["z"])',
    'prop("Tags").includes("b")',
    'prop("Tags").includes("z")',
    '[1, 2, 3].includes(prop("Num"))',
    'prop("Tags").at(1)',
    'prop("Tags").at(5)',
    'prop("Tags").slice(1)',
    'prop("Tags").slice(0, 2)',
    'prop("Tags").reverse().join("")',
    'split(prop("Name"), " ")',
    'split(prop("Name"), " ").length()',
    'split(prop("Name"), " ").first()',
    'split(prop("Name"), " ").map(substring(current, 0, 1)).join("")',
    'split("a,b,,c", ",")',
    'split("abc", "")',
    '[1, 2, 3].join(", ")',
    '[1, "a", true].join("|")',
    'join(prop("Tags"), " + ")',
    'length([1, 2, 3])',
    'length([])',
    'sum([1, 2, 3])',
    'sum(prop("Tags").map(length(current)))',
    'mean([1, 2, 3, 4])',
    'median([3, 1, 2])',
    'median([4, 1, 2, 3])',
    'max([1, 9, 3])',
    'min([1, 9, 3])',
    'max([])',
    'sum([])',
    '[1, 2] == [1, 2]',
    '[1, 2] == [2, 1]',
    'prop("Tags") + ["d"]',
    '["x"] + ["y"]',
    '[1, 2, 3] + [4]',
  ],
  combos: [
    'upper(substring(prop("Name"), 0, 3))',
    'lower(replaceAll(prop("Name"), " ", "_"))',
    'length(trim("  " + prop("Name") + "  "))',
    'round(sum(prop("Num"), prop("Neg")) * 2)',
    'round(prop("Num") / 3, 2)',
    'format(round(prop("Num") / 3, 2)) + "%"',
    'formatNumber(prop("Num") * 1000, "commas")',
    'formatNumber(prop("Num") / 100, "percent")',
    'formatNumber(prop("Neg"), "USD")',
    'if(contains(lower(prop("Name")), "ada"), format(prop("Num") + 1), "no")',
    'ifs(empty(prop("Num")), "none", prop("Num") > 5, "high", "low")',
    'join(map(prop("Tags"), upper(current)), "-")',
    'prop("Tags").map(current + format(prop("Num"))).join(",")',
    'let(total, prop("Num") + prop("Neg"), total > 5 ? "over" : "under")',
    'lets(n, prop("Num"), half, n / 2, format(half) + "/" + format(n))',
    'dateBetween(dateAdd(prop("When"), 1, "days"), prop("When"), "hours")',
    'formatDate(dateAdd(parseDate("2024-01-31"), 1, "months"), "YYYY-MM-DD")',
    'formatDate(dateSubtract(prop("When"), 1, "weeks"), "YYYY-MM-DD")',
    'formatDate(dateStart(dateRange(prop("When"), dateAdd(prop("When"), 3, "days"))), "YYYY-MM-DD")',
    'formatDate(dateEnd(dateRange(prop("When"), dateAdd(prop("When"), 3, "days"))), "YYYY-MM-DD")',
    'dateBetween(dateEnd(dateRange(prop("When"), dateAdd(prop("When"), 3, "days"))), dateStart(dateRange(prop("When"), dateAdd(prop("When"), 3, "days"))), "days")',
    'year(prop("When")) * 100 + month(prop("When"))',
    'format(year(prop("When"))) + "-" + format(month(prop("When"))) + "-" + format(date(prop("When")))',
    'day(prop("When"))',
    'week(prop("When"))',
    'hour(dateAdd(prop("When"), 90, "minutes"))',
    'minute(dateAdd(prop("When"), 90, "minutes"))',
    'fromTimestamp(timestamp(prop("When")) + 86400000) == dateAdd(prop("When"), 1, "days")',
    'formatDate(fromTimestamp(timestamp(prop("When"))), "YYYY-MM-DD")',
    'formatDate(parseDate("2024-02-29"), "MMMM D, YYYY")',
    'formatDate(dateAdd(parseDate("2024-02-29"), 1, "years"), "YYYY-MM-DD")',
    'dateBetween(parseDate("2024-12-25"), parseDate("2024-01-01"), "weeks")',
    'dateBetween(parseDate("2024-01-01"), parseDate("2024-12-25"), "months")',
    'dateBetween(today(), today(), "days")',
    'formatDate(today(), "YYYY") == formatDate(now(), "YYYY")',
    'year(now()) >= 2024',
    'dateBetween(now(), today(), "days")',
    'dateBetween(dateAdd(today(), 10, "days"), today(), "days")',
    'today() == today()',
    'length(split(prop("Note"), " "))',
    'replace(prop("Note"), "World", "AppFlowy")',
    'replaceAll(prop("Note"), "l", "L")',
    'test(prop("Name"), "^[A-Z]")',
    'match(prop("Note"), "[a-z]+").join("|")',
    'match(prop("Note"), "[a-z]+").length()',
    'repeat("ab", prop("Num") / 4)',
    'substring(prop("Name"), length(prop("Name")) - 4)',
    'toNumber(format(prop("Num"))) + 1',
    'format(prop("Num")) + format(prop("Flag"))',
    'format(prop("Tags")) + "|" + format(prop("When"))',
    'format(1 / 3)',
    'format(2 / 3 * 3)',
    'format(0.1 + 0.2)',
    'format(1e21)',
    'format(123456789012345680)',
    'format(-0)',
    'format(sqrt(-1))',
    'format(1 / 0)',
    'sqrt(prop("Num") * 2)',
    'cbrt(27)',
    'exp(0)',
    'ln(e())',
    'log10(1000)',
    'log2(8)',
    'sign(prop("Neg"))',
    'sign(prop("Zero"))',
    'abs(prop("Neg")) + abs(prop("Num"))',
    'ceil(prop("Neg"))',
    'floor(prop("Neg"))',
    'round(2.5)',
    'round(-2.5)',
    'round(3.14159, 3)',
    'round(1234.5678, -2)',
    'mod(prop("Num"), 3)',
    'mod(-7, 3)',
    'pow(2, prop("Num"))',
    'divide(prop("Num"), prop("Zero"))',
    'multiply(add(1, 2), subtract(5, 3))',
    'pi() * 2',
    'round(pi(), 4)',
    'round(e(), 4)',
    'max(prop("Num"), prop("Neg"), 3)',
    'min([prop("Num"), prop("Neg")])',
    'sum([1, 2, 3], 4)',
    'prop("Flag") ? prop("Num") : prop("Neg")',
    'if(prop("Flag"), prop("Tags"), [])',
    'if(prop("Flag"), prop("When"), dateAdd(prop("When"), 1, "days"))',
    'formatDate(if(prop("Flag"), prop("When"), dateAdd(prop("When"), 1, "days")), "YYYY-MM-DD")',
    'let(n, length(prop("Tags")), n > 2 ? "many" : n > 0 ? "few" : "none")',
    'prop("Tags").filter(current != "a").length() > 0 and prop("Flag")',
    '/* comment */ prop("Num") + 1 // trailing',
    'prop("Num").add(1).multiply(2)',
    'prop("Name").upper().length()',
    'prop("Num").format().length()',
    'prop("When").formatDate("YYYY")',
    'prop("Num") == 8 and prop("Name") == "Ada Lovelace" and prop("Flag")',
  ],
};

/** Formulas that read other formulas, in creation order (each may use the earlier ones). */
const CHAINS: Array<{ name: string; expression: string }> = [
  { name: 'chain_total', expression: 'prop("Num") + prop("Neg")' },
  { name: 'chain_double', expression: 'prop("chain_total") * 2' },
  { name: 'chain_label', expression: 'prop("Name") + ": " + format(prop("chain_double"))' },
  { name: 'chain_flag', expression: 'prop("chain_double") > 10' },
  { name: 'chain_pick', expression: 'if(prop("chain_flag"), upper(prop("chain_label")), lower(prop("chain_label")))' },
  { name: 'chain_date', expression: 'dateAdd(prop("When"), prop("Num"), "days")' },
  { name: 'chain_date_text', expression: 'formatDate(prop("chain_date"), "YYYY-MM-DD")' },
  { name: 'chain_days', expression: 'dateBetween(prop("chain_date"), prop("When"), "days")' },
  { name: 'chain_list', expression: 'prop("Tags").map(current + format(prop("chain_total")))' },
  { name: 'chain_list_len', expression: 'length(prop("chain_list")) + prop("chain_days")' },
  { name: 'chain_empty', expression: 'empty(prop("chain_total")) ? "no total" : format(prop("chain_total"))' },
  {
    name: 'chain_deep',
    expression:
      'prop("chain_pick") + "/" + prop("chain_date_text") + "/" + prop("chain_list").join("+") + "/" + format(prop("chain_list_len"))',
  },
];

function chainCases(): MatrixCase[] {
  return CHAINS.map((chain, index) => {
    const result = evaluate(chain.expression, CHAINS.slice(0, index));

    return {
      group: 'chains',
      fn: chain.name,
      expression: chain.expression,
      values: result.values,
      desktopValues: result.desktopValues,
      error: result.error,
      resultType: result.resultType,
      origin: 'manual',
    };
  });
}

/** Docs examples become cases; results that depend on the clock assert nothing. */
function docsCases(): MatrixCase[] {
  const out: MatrixCase[] = [];
  const push = (fn: string, docsExpression: string, docsResult: string) => {
    const expression = onFixture(docsExpression);
    const result = evaluate(expression);

    out.push({
      group: categoryOf(fn),
      fn,
      expression,
      values: DYNAMIC.test(expression) ? undefined : result.values,
      desktopValues: DYNAMIC.test(expression) ? undefined : result.desktopValues,
      error: result.error,
      resultType: result.resultType,
      origin: 'docs',
      docsResult,
    });
  };

  FORMULA_FUNCTIONS.forEach((spec) =>
    spec.examples.forEach((example) => push(spec.name, example.expression, example.result))
  );
  FORMULA_BUILTINS.forEach((spec) =>
    spec.examples.forEach((example) => push(spec.name, example.expression, example.result))
  );
  return out;
}

function categoryOf(fn: string): string {
  const spec = FORMULA_FUNCTIONS.find((entry) => entry.name === fn);

  if (spec) return spec.category === 'variable' || spec.category === 'page' ? 'logic' : spec.category;
  return 'operators';
}

function matrixCases(): MatrixCase[] {
  const { expressions, mismatches } = generateFunctionMatrix();
  const out: MatrixCase[] = [];

  expressions.forEach(({ fn, expression }) => {
    const result = evaluate(expression);

    out.push({
      group: categoryOf(fn),
      fn,
      expression,
      values: DYNAMIC.test(expression) ? undefined : result.values,
      desktopValues: DYNAMIC.test(expression) ? undefined : result.desktopValues,
      error: result.error,
      resultType: result.resultType,
      origin: 'matrix',
    });
  });
  mismatches.forEach(({ fn, expression }) => {
    const result = evaluate(expression);

    out.push({
      group: 'errors',
      fn,
      expression,
      error: result.error ?? `NO ERROR (${result.values?.join(' | ')})`,
      resultType: result.resultType,
      origin: 'matrix',
    });
  });
  return out;
}

function manualCases(): MatrixCase[] {
  const out: MatrixCase[] = [];

  Object.entries(MANUAL).forEach(([group, expressions]) => {
    expressions.forEach((expression) => {
      const result = evaluate(expression);
      const fn = /^([a-zA-Z]+)\(/.exec(expression)?.[1] ?? 'operator';

      out.push({
        group,
        fn,
        expression,
        values: DYNAMIC.test(expression) ? undefined : result.values,
        desktopValues: DYNAMIC.test(expression) ? undefined : result.desktopValues,
        error: result.error,
        resultType: result.resultType,
        origin: 'manual',
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '\\n');
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => escapeCell(row[column]).length)));

  return rows
    .map((row) => `      | ${row.map((cell, column) => escapeCell(cell).padEnd(widths[column])).join(' | ')} |`)
    .join('\n');
}

function fixtureTable(): string {
  return table([
    ['property', 'type', 'row 1', 'row 2', 'row 3'],
    ...FIXTURE.map((property) => [property.name, property.webType, ...property.values]),
  ]);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];

  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function propertyName(item: MatrixCase, index: number): string {
  if (item.group === 'chains') return item.fn;
  return `${item.fn.replace(/[^a-zA-Z0-9]/g, '')}_${index + 1}`;
}

function webFeature(group: string, cases: MatrixCase[], errors: MatrixCase[]): string {
  const title = group[0].toUpperCase() + group.slice(1);
  const lines: string[] = [
    `@formula @formula-matrix @formula-matrix-${group}`,
    `Feature: Formula matrix: ${title}`,
    '  Generated by src/application/database-yjs/fields/formula/__tests__/',
    '  formula-matrix.generate.test.ts from the',
    '  function catalogue: every documented example, every parameter with a',
    '  matching property, a literal, an empty property and a wrong type, plus',
    '  operators, empty semantics and nested combinations. Cell texts are',
    '  asserted exactly on the fixed fixture. Date and time texts assume the',
    '  UTC timezone the generator ran in.',
    '',
  ];
  let scenario = 0;

  chunk(cases, 30).forEach((items) => {
    scenario += 1;
    const names = items.map((item, index) => propertyName(item, index + (scenario - 1) * 30));

    lines.push(`  Scenario: ${title} cases ${scenario}`);
    lines.push('    Given a Grid for formula testing with these properties');
    lines.push(fixtureTable());
    lines.push('    When I add these formula properties');
    lines.push(table([['name', 'expression'], ...items.map((item, index) => [names[index], item.expression])]));
    ROW_NAMES.forEach((_, row) => {
      lines.push(`    Then the formula properties show these values for row ${row + 1}`);
      lines.push(table([['name', 'value'], ...items.map((item, index) => [names[index], item.values?.[row] ?? ''])]));
    });
    lines.push('');
  });

  if (errors.length > 0) {
    lines.push(`  Scenario: ${title} type errors`);
    lines.push('    Given a Grid for formula testing with these properties');
    lines.push(fixtureTable());
    lines.push('    When I start a new formula property');
    lines.push('    Then these formulas show these errors');
    lines.push(table([['expression', 'error'], ...errors.map((item) => [item.expression, item.error ?? ''])]));
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** bdd_widget_test copies the text into a Dart string literal, so escape for Dart. */
function desktopParam(text: string): string {
  return `{'${text.replace(/\\/g, '\\\\').replace(/\$/g, '\\$')}'}`;
}

function desktopFeature(group: string, cases: MatrixCase[], errors: MatrixCase[]): string {
  const title = group[0].toUpperCase() + group.slice(1);
  const lines: string[] = [
    `Feature: Formula matrix ${group}`,
    '',
    '  # Generated from the web catalogue (AppFlowy-Web src/application/',
    '  # database-yjs/fields/formula/__tests__/formula-matrix.generate.test.ts):',
    '  # every documented example, every',
    '  # parameter with a matching property, a literal, an empty property and',
    '  # a wrong type, plus operators, empty semantics and nested combinations.',
    '  # Cell texts are asserted exactly on the fixed matrix fixture; dates use',
    '  # the desktop defaults (friendly date, 24-hour time) in the UTC timezone.',
    '',
  ];
  let scenario = 0;

  chunk(cases, 30).forEach((items) => {
    scenario += 1;
    const grid = `Matrix ${title} ${scenario}`;
    const names = items.map((item, index) => propertyName(item, index + (scenario - 1) * 30));

    lines.push(`  Scenario: ${title} cases ${scenario}`);
    lines.push('    Given the app is initialized');
    lines.push('    When the user signs in anonymously');
    lines.push('    Then the user sees the home page with get started page');
    lines.push(`    When the user backend creates a formula matrix grid named ${desktopParam(grid)}`);
    items.forEach((item, index) => {
      lines.push(
        `    And the user backend adds a formula field named ${desktopParam(
          names[index]
        )} with the expression ${desktopParam(item.expression)}`
      );
    });
    lines.push(`    And the user opens the grid page named ${desktopParam(grid)}`);
    items.forEach((item, index) => {
      if (!item.values) return;
      ROW_NAMES.forEach((rowName, row) => {
        const value = item.desktopValues?.[row] ?? item.values?.[row] ?? '';
        const cell = `the grid formula cell in row ${desktopParam(rowName)} for field ${desktopParam(names[index])}`;

        if (item.resultType === 'boolean' && (value === 'Yes' || value === 'No')) {
          lines.push(`    Then ${cell} shows a ${desktopParam(value === 'Yes' ? 'checked' : 'unchecked')} checkbox`);
        } else if (value === '') {
          lines.push(`    Then ${cell} is empty`);
        } else {
          lines.push(`    Then ${cell} shows exactly ${desktopParam(value)}`);
        }
      });
    });
    lines.push('');
  });

  if (errors.length > 0) {
    lines.push(`  Scenario: ${title} type errors`);
    lines.push('    Given the app is initialized');
    lines.push('    When the user signs in anonymously');
    lines.push('    Then the user sees the home page with get started page');
    lines.push(
      `    When the user backend creates a formula matrix grid named ${desktopParam(`Matrix ${title} errors`)}`
    );
    lines.push(`    And the user opens the grid page named ${desktopParam(`Matrix ${title} errors`)}`);
    lines.push(
      `    When the user creates a grid field named ${desktopParam('Probe')} of type ${desktopParam('formula')}`
    );
    lines.push('    Then the formula editor is open');
    errors.forEach((item) => {
      lines.push(`    When the user replaces the formula with ${desktopParam(item.expression)}`);
      lines.push(`    Then the formula editor shows the error ${desktopParam(item.error ?? '')}`);
    });
    lines.push('    When the user cancels the formula editor');
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

const desktopSafe = (item: MatrixCase) =>
  !item.expression.includes("'") &&
  !(item.values ?? []).some((value) => value.includes("'")) &&
  !(item.error ?? '').includes("'");

test('generate the formula matrix features', () => {
  if (!process.env.FORMULA_MATRIX_OUT) return;
  const all = [...docsCases(), ...matrixCases(), ...manualCases(), ...chainCases()];
  const seen = new Set<string>();
  // Chains keep their own copies: later links read them by name.
  const cases = all.filter((item) => {
    if (item.group === 'chains') return true;
    if (seen.has(item.expression)) return false;
    seen.add(item.expression);
    return true;
  });
  // Clock-dependent cases have no fixed value and mismatches that compiled
  // (accepted coercions) are reported, not asserted.
  const valueCases = cases.filter((item) => !item.error && item.values);
  const errorCases = cases.filter((item) => item.error && !item.error.startsWith('NO ERROR'));
  const accepted = cases.filter((item) => item.error?.startsWith('NO ERROR'));
  const groups = [...new Set(valueCases.map((item) => item.group))];
  const webDir = path.resolve(__dirname, '../../../../../../playwright/bdd/features/database/matrix');
  const desktopDir = process.env.FORMULA_MATRIX_DESKTOP_DIR;

  mkdirSync(webDir, { recursive: true });
  if (desktopDir) mkdirSync(desktopDir, { recursive: true });
  groups.forEach((group) => {
    const items = valueCases.filter((item) => item.group === group);
    const errors = errorCases.filter((item) => item.group === group || (group === 'logic' && item.group === 'errors'));

    writeFileSync(path.join(webDir, `formula-matrix-${group}.feature`), webFeature(group, items, errors));
    if (desktopDir) {
      writeFileSync(
        path.join(desktopDir, `formula_matrix_${group}.feature`),
        desktopFeature(group, items.filter(desktopSafe), errors.filter(desktopSafe))
      );
    }
  });
  const discrepancies = cases.filter((item) => {
    if (item.origin !== 'docs' || !item.docsResult || !item.values) return false;
    const docs = item.docsResult.replace(/^"(.*)"$/, '$1');
    const normalized =
      docs === 'true' ? 'Yes' : docs === 'false' ? 'No' : docs.replace(/^\[(.*)\]$/, '$1').replace(/"/g, '');

    return normalized !== item.values[0];
  });

  writeFileSync(
    process.env.FORMULA_MATRIX_OUT === '1' ? path.join(webDir, 'formula-matrix.json') : process.env.FORMULA_MATRIX_OUT,
    JSON.stringify(
      {
        fixture: FIXTURE,
        counts: {
          total: cases.length,
          values: valueCases.length,
          errors: errorCases.length,
          byGroup: Object.fromEntries(groups.map((g) => [g, valueCases.filter((i) => i.group === g).length])),
        },
        discrepancies: discrepancies.map((item) => ({
          expression: item.expression,
          docs: item.docsResult,
          engine: item.values?.[0],
        })),
        acceptedMismatches: accepted.map((item) => ({ expression: item.expression, values: item.error })),
        cases,
      },
      null,
      2
    )
  );
});
