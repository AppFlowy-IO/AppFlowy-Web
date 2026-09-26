import { compileFormula, CompiledFormula } from '../compile';
import { evaluateFormula } from '../evaluator';
import { FormulaValue } from '../values';

import {
  ConcreteValue,
  dataset,
  incompatibleMetadata,
  prepareConcreteValues,
  PreparedValue,
  ValueContract,
} from './value-combination-fixture';

const BINARY = ['+', '-', '*', '/', '%', '^', '==', '!=', '<', '<=', '>', '>=', 'and', 'or', '&&', '||'];

type Expected =
  | { type: 'number'; value: number | null }
  | { type: 'boolean'; value: boolean }
  | { type: 'text'; value: string }
  | { type: 'rejected'; message: string };

// Explicit display and collation expectations, shared conceptually with the
// Rust suite. Do not generate the oracle with production formatting/comparison.
const DATE_TEXT: Record<string, string> = {
  missing: '',
  epoch: 'Jan 1, 1970 12:00 AM',
  'before-epoch': 'Dec 31, 1969 12:00 AM',
  'leap-day': 'Feb 29, 2024 11:59 PM',
  'hidden-time': 'Sep 26, 2026',
  'year-range': 'Dec 31, 2025 → Jan 2, 2026',
  'dst-first': 'Nov 3, 2024 5:30 AM',
  'dst-second': 'Nov 3, 2024 6:30 AM',
  'first-second': 'Jan 1, 1970 12:00 AM',
  'year-boundary': 'Jan 1, 2026 12:00 AM',
  'current-year': 'Sep 26, 2026 9:15 AM',
};
const TEXT_RANK: Record<string, number> = {
  'text/spaces': 1,
  'select/build': 2,
  'select/design': 3,
  'url/fragment': 4,
  'url/https': 5,
  'url/query': 6,
  'url/unicode': 7,
  'text/quoted-multiline': 8,
  'text/case-sensitive': 9,
  'text/task-name': 10,
  'text/long-text': 11,
  'url/email': 12,
  'select/comma': 13,
  'select/unicode': 14,
  'text/unicode': 15,
};

function plainText(contract: ValueContract, value: ConcreteValue): string {
  if (contract.kind === 'list') return value.expected.items!.join(', ');
  if (contract.kind !== 'date') return value.expected.normalized;
  const display = DATE_TEXT[value.id];

  if (display === undefined) throw new Error(`Missing date display oracle: ${contract.id}/${value.id}`);
  return display;
}

function rank(contract: ValueContract, value: ConcreteValue): number {
  if (value.id === 'missing' || value.id === 'blank') return 0;
  const rank = TEXT_RANK[`${contract.value_set}/${value.id}`];

  if (rank === undefined) throw new Error(`Missing text ordering oracle: ${contract.id}/${value.id}`);
  return rank;
}

function equal(left: PreparedValue, right: PreparedValue): boolean {
  const a = left.value.expected;
  const b = right.value.expected;

  switch (left.contract.kind) {
    case 'number':
      return (a.number ?? 0) === (b.number ?? 0);
    case 'date':
      return a.start_ms === b.start_ms && a.end_ms === b.end_ms;
    case 'boolean':
      return a.boolean === b.boolean;
    case 'text':
      return a.normalized === b.normalized;
    case 'list':
      return a.items!.length === b.items!.length && a.items!.every((item, index) => item === b.items![index]);
  }
}

function ordered(left: PreparedValue, right: PreparedValue): number | null {
  const a = left.value.expected;
  const b = right.value.expected;
  let x: number | null | undefined;
  let y: number | null | undefined;

  switch (left.contract.kind) {
    case 'text':
      x = rank(left.contract, left.value);
      y = rank(right.contract, right.value);
      break;
    case 'number':
      x = a.number;
      y = b.number;
      break;
    case 'date':
      x = a.start_ms;
      y = b.start_ms;
      break;
    default:
      throw new Error(`Unexpected ordered type ${left.contract.kind}`);
  }

  return x === null || x === undefined || y === null || y === undefined ? null : x < y ? -1 : x > y ? 1 : 0;
}

function expected(op: string, left: PreparedValue, right: PreparedValue): Expected {
  const leftKind = left.contract.kind;
  const rightKind = right.contract.kind;
  const numeric = leftKind === 'number' && rightKind === 'number';
  const a = left.value.expected;
  const b = right.value.expected;

  if (op === '+' && !numeric) {
    return { type: 'text', value: plainText(left.contract, left.value) + plainText(right.contract, right.value) };
  }

  if (['+', '-', '*', '/', '%', '^'].includes(op)) {
    if (!numeric) return { type: 'rejected', message: 'expects a number' };
    if (op === '+' && a.number === null && b.number === null) return { type: 'number', value: null };
    const x = a.number ?? 0;
    const y = b.number ?? 0;
    const result =
      op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : op === '%' ? x % y : x ** y;

    return { type: 'number', value: Number.isFinite(result) ? result : null };
  }

  if (op === '==' || op === '!=') {
    return leftKind === rightKind
      ? { type: 'boolean', value: equal(left, right) === (op === '==') }
      : { type: 'rejected', message: 'Cannot compare' };
  }

  if (['<', '<=', '>', '>='].includes(op)) {
    if (leftKind !== rightKind || !['number', 'date', 'text'].includes(leftKind)) {
      return { type: 'rejected', message: 'expects two numbers, two dates or two text values' };
    }

    const order = ordered(left, right);

    return {
      type: 'boolean',
      value: order !== null && (op === '<' ? order < 0 : op === '<=' ? order <= 0 : op === '>' ? order > 0 : order >= 0),
    };
  }

  if (['and', '&&', 'or', '||'].includes(op)) {
    if (leftKind !== 'boolean' || rightKind !== 'boolean') return { type: 'rejected', message: 'expects a boolean' };
    return { type: 'boolean', value: op === 'and' || op === '&&' ? a.boolean! && b.boolean! : a.boolean! || b.boolean! };
  }

  throw new Error(`Missing operator contract: ${op}`);
}

function matches(actual: FormulaValue, expected: Exclude<Expected, { type: 'rejected' }>): boolean {
  if (expected.type === 'number') {
    if (expected.value === null) return actual.type === 'empty';
    if (actual.type !== 'number') return false;
    if (Number.isInteger(expected.value)) return actual.value === expected.value;
    return actual.value !== 0 && Math.abs(actual.value - expected.value) <= Math.abs(expected.value) * 1e-12;
  }

  return actual.type === expected.type && actual.value === expected.value;
}

function verify(compiled: CompiledFormula, oracle: Expected, states: PreparedValue[], caseId: string) {
  if (oracle.type === 'rejected') {
    if (!compiled.error?.message.includes(oracle.message)) {
      throw new Error(`${caseId}: expected ${oracle.message}, got ${compiled.error?.message ?? 'accepted'}`);
    }

    return;
  }

  if (compiled.error || !compiled.ast) throw new Error(`${caseId}: ${compiled.error?.message ?? 'missing AST'}`);
  const values = new Map(states.map((state) => [state.id, state.read()]));
  const actual = evaluateFormula(compiled.ast, {
    getProp: (id) => {
      const value = values.get(id);

      if (!value) throw new Error(`Unresolved property ${id}`);
      return value;
    },
    now: () => dataset.now_ms,
    rowId: 'concrete-operators',
  });

  if (!matches(actual, oracle)) {
    throw new Error(`${caseId}: expected ${JSON.stringify(oracle)}, got ${JSON.stringify(actual)}`);
  }
}

describe('all concrete Formula operator/value combinations', () => {
  let fixture: Awaited<ReturnType<typeof prepareConcreteValues>>;

  beforeAll(async () => {
    fixture = await prepareConcreteValues();
  });
  afterAll(() => fixture?.destroy());

  test('all 16 binary operators over every realizable ordered value pair', () => {
    expect(BINARY).toHaveLength(16);
    expect(new Set(BINARY).size).toBe(16);
    let pairs = 0;
    let cases = 0;
    let excluded = 0;

    for (const left of fixture.contracts[0]) {
      for (const right of fixture.contracts[1]) {
        const schema = [...left.schema, ...right.schema];
        const expressions = BINARY.map((op) => compileFormula(`prop("${left.id}") ${op} prop("${right.id}")`, schema));

        for (const a of left.source) {
          for (const b of right.source) {
            if (incompatibleMetadata(a, b)) {
              excluded++;
              continue;
            }

            BINARY.forEach((op, i) => {
              verify(
                expressions[i],
                expected(op, a, b),
                [a, b],
                `${left.id}/${a.value.id} ${op} ${right.id}/${b.value.id}`
              );
              cases++;
            });
          }
        }

        pairs++;
      }
    }

    expect(pairs).toBe(dataset.coverage.ordered_contract_pairs);
    expect(excluded).toBe(dataset.coverage.excluded_metadata_pairs);
    expect(cases).toBe(dataset.coverage.ordered_value_pairs * BINARY.length);
    expect(cases).toBe(558480);
  }, 120_000);

  test('negation, not, and bang for every concrete value', () => {
    let cases = 0;

    for (const prepared of fixture.contracts[0]) {
      const ref = `prop("${prepared.id}")`;
      const expressions = [`-(${ref})`, `not(${ref})`, `!(${ref})`].map((expression) =>
        compileFormula(expression, prepared.schema)
      );

      for (const value of prepared.source) {
        const numeric: Expected =
          value.contract.kind === 'number'
            ? { type: 'number', value: value.value.expected.number === null ? null : -value.value.expected.number! }
            : { type: 'rejected', message: 'expects a number' };

        verify(expressions[0], numeric, [value], `negative ${prepared.id}/${value.value.id}`);
        for (const index of [1, 2]) {
          verify(
            expressions[index],
            { type: 'boolean', value: value.value.expected.empty },
            [value],
            `not ${prepared.id}/${value.value.id}`
          );
        }

        cases += 3;
      }
    }

    expect(cases).toBe(dataset.coverage.contract_values * 3);
    expect(cases).toBe(561);
  });
});
