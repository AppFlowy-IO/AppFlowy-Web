import { FieldType } from '@/application/database-yjs/database.type';
import { YjsDatabaseKey } from '@/application/types';

import { FormulaNode } from '../ast';
import { compileFormula } from '../compile';
import { evaluateFormulaCell } from '../evaluate';
import { evaluateFormula } from '../evaluator';
import { FormulaFieldSchema } from '../schema';
import { FormulaValue } from '../values';

import {
  ConcreteValue,
  dataset,
  fieldForExpression,
  incompatibleMetadata,
  prepareConcreteValues,
  PreparedContract,
  PreparedValue,
  ValueContract,
} from './value-combination-fixture';

// These tables are independently authored Boolean outcomes in FF, FT, TF, TT
// and FFF through TTT order. They do not ask the formula engine for its oracle.
const PAIRS = [
  { and: '0', or: '0', not: '1', priority: -1, choose: 1 },
  { and: '0', or: '1', not: '1', priority: 1, choose: 1 },
  { and: '0', or: '1', not: '0', priority: 0, choose: 0 },
  { and: '1', or: '1', not: '0', priority: 0, choose: 0 },
] as const;
const TRIPLES = [
  { left: '0', right: '0', priority: -1, nested: 2, choose: 2 },
  { left: '1', right: '0', priority: 2, nested: 2, choose: 2 },
  { left: '0', right: '0', priority: 1, nested: 2, choose: 1 },
  { left: '1', right: '0', priority: 1, nested: 2, choose: 1 },
  { left: '0', right: '0', priority: 0, nested: 1, choose: 0 },
  { left: '1', right: '1', priority: 0, nested: 1, choose: 0 },
  { left: '1', right: '1', priority: 0, nested: 0, choose: 0 },
  { left: '1', right: '1', priority: 0, nested: 0, choose: 0 },
] as const;

function substitute(expression: string, reference: string): string {
  return expression.replaceAll('$', reference);
}

function compiled(expression: string, schema: FormulaFieldSchema[], id: string): FormulaNode {
  const result = compileFormula(expression, schema, id);

  if (result.error || !result.ast) throw new Error(`${id}: ${result.error?.message ?? 'missing AST'} in ${expression}`);
  return result.ast;
}

/** Match raw types as well as display text: Empty is different from numeric 0. */
function matchesValue(actual: FormulaValue, contract: ValueContract, value: ConcreteValue): boolean {
  const expected = value.expected;

  switch (contract.kind) {
    case 'text':
      return actual.type === 'text' && actual.value === expected.normalized;
    case 'number':
      return expected.number === null
        ? actual.type === 'empty'
        : actual.type === 'number' && actual.value === expected.number;
    case 'boolean':
      return actual.type === 'boolean' && actual.value === expected.boolean;
    case 'list':
      return (
        actual.type === 'list' &&
        actual.items.length === expected.items!.length &&
        actual.items.every((item, i) => item.type === 'text' && item.value === expected.items![i])
      );
    case 'date':
      return expected.start_ms === null
        ? actual.type === 'empty'
        : actual.type === 'date' &&
            actual.value.start === expected.start_ms &&
            actual.value.end === (expected.end_ms ?? undefined) &&
            actual.value.includeTime === expected.include_time;
  }
}

function matchesStrings(actual: FormulaValue, expected: readonly string[]): boolean {
  return (
    actual.type === 'list' &&
    actual.items.length === expected.length &&
    actual.items.every((item, i) => item.type === 'text' && item.value === expected[i])
  );
}

function assertRaw(actual: FormulaValue, state: PreparedValue): void {
  if (!matchesValue(actual, state.contract, state.value)) {
    throw new Error(
      `${state.id}/${state.value.id}: raw ${JSON.stringify(actual)}, expected ${JSON.stringify(state.value.expected)}`
    );
  }
}

function matrix(selected: PreparedContract[]) {
  const triple = selected.length === 3;
  const references = selected.map(({ id }) => `prop("${id}")`);
  const predicates = selected.map(({ contract }, i) => substitute(contract.predicate, references[i]));
  const normalizers = selected.map(({ contract }, i) => substitute(contract.normalize, references[i]));
  const bindings = selected.flatMap((_contract, i) => [`p${i}`, predicates[i], `n${i}`, normalizers[i]]).join(', ');
  const condition = triple ? '(p0 and p1) or p2' : 'p0 and p1';
  const outputs = triple
    ? 'n0, n1, n2, if((p0 and p1) or p2, "1", "0"), if(p0 and (p1 or p2), "1", "0"), ifs(p0, n0, p1, n1, p2, n2, "none"), if(p0, if(p1, n0, n1), n2), p0 ? n0 : (p1 ? n1 : n2)'
    : 'n0, n1, if(p0 and p1, "1", "0"), if(p0 or p1, "1", "0"), if(not(p0), "1", "0"), ifs(p0, n0, p1, n1, "none"), p0 ? n0 : n1';
  const stageExpression = `lets(${predicates
    .flatMap((predicate, i) => [`p${i}`, predicate])
    .join(', ')}, if(${condition}, ${references[0]}, empty()))`;
  const stage = fieldForExpression('stage', stageExpression);
  const downstream = fieldForExpression('downstream', 'prop("stage")');
  const schema = [...selected.flatMap(({ schema }) => schema), stage.entry, downstream.entry];
  const probe = compiled(`lets(${bindings}, [${outputs}])`, schema, 'probe');
  const stageNode = compiled(stageExpression, schema, 'stage');
  const downstreamNode = compiled('prop("stage")', schema, 'downstream');
  const typedFields: ReturnType<typeof fieldForExpression>[] = [];
  const typedNodes = new Map<string, FormulaNode>();
  const typedRoots: FormulaNode[] = [];

  if (!triple) {
    for (const predicate of [predicates[0], `not(${predicates[0]})`]) {
      for (const expression of [
        `if(${predicate}, ${references[0]}, ${references[1]})`,
        `ifs(${predicate}, ${references[0]}, ${references[1]})`,
        `(${predicate}) ? ${references[0]} : ${references[1]}`,
      ]) {
        const id = `typed-stage-${typedFields.length}`;
        const typedStage = fieldForExpression(id, expression);
        const typedDownstream = fieldForExpression(`${id}-downstream`, `prop("${id}")`);
        const typedSchema = [...schema, typedStage.entry, typedDownstream.entry];
        const result = compileFormula(`prop("${id}-downstream")`, typedSchema, `${id}-probe`);

        typedFields.push(typedStage, typedDownstream);
        if (selected[0].contract.kind !== selected[1].contract.kind) {
          if (!result.error || !/same type/i.test(result.error.message)) {
            throw new Error(
              `${selected.map(({ id }) => id).join(' × ')} must reject incompatible branches: ${
                result.error?.message ?? 'accepted'
              }`
            );
          }
        } else {
          if (result.error || !result.ast) throw new Error(`${id}: ${result.error?.message ?? 'missing AST'}`);
          typedNodes.set(id, compiled(expression, typedSchema, id));
          typedNodes.set(`${id}-downstream`, compiled(`prop("${id}")`, typedSchema, `${id}-downstream`));
          typedRoots.push(result.ast);
        }
      }
    }
  }

  let current: PreparedValue[] = [];
  let values: Array<FormulaValue | undefined> = [];
  const indexes = new Map(selected.map(({ id }, i) => [id, i]));
  const getProp = (ref: string): FormulaValue => {
    if (ref === 'stage') return evaluateFormula(stageNode, options);
    const typedNode = typedNodes.get(ref);

    if (typedNode) return evaluateFormula(typedNode, options);
    const index = indexes.get(ref);

    if (index === undefined) throw new Error(`Unexpected reference ${ref}`);
    // Each tuple reads its real Yjs cells. Sharing within the two dependent
    // formulas matches the production evaluator's synchronous value cache.
    return values[index] ?? (values[index] = current[index].read());
  };

  const options = { getProp, now: () => dataset.now_ms, rowId: 'concrete-matrix' };

  return {
    check(states: PreparedValue[]) {
      current = states;
      values = [];
      const expected = states.map(({ value }) => value.expected.normalized);
      const key = states.reduce((key, { value }) => key * 2 + Number(value.expected.truth), 0);
      let retain: boolean;

      if (triple) {
        const truth = TRIPLES[key];

        retain = truth.left === '1';
        expected.push(
          truth.left,
          truth.right,
          truth.priority < 0 ? 'none' : expected[truth.priority],
          expected[truth.nested],
          expected[truth.choose]
        );
      } else {
        const truth = PAIRS[key];

        retain = truth.and === '1';
        expected.push(
          truth.and,
          truth.or,
          truth.not,
          truth.priority < 0 ? 'none' : expected[truth.priority],
          expected[truth.choose]
        );
      }

      const result = evaluateFormula(probe, options);
      const downstreamResult = evaluateFormula(downstreamNode, options);

      for (let index = 0; index < typedRoots.length; index++) {
        const useLeft = index < 3 ? states[0].value.expected.truth : !states[0].value.expected.truth;
        const state = states[useLeft ? 0 : 1];
        const actual = evaluateFormula(typedRoots[index], options);

        if (!matchesValue(actual, state.contract, state.value)) {
          throw new Error(
            `${states.map(({ id, value }) => `${id}/${value.id}`).join(' × ')} typed branch ${index}: ${JSON.stringify(
              actual
            )} expected ${JSON.stringify(state.value.expected)}`
          );
        }
      }

      if (
        !matchesStrings(result, expected) ||
        (retain
          ? !matchesValue(downstreamResult, states[0].contract, states[0].value)
          : downstreamResult.type !== 'empty')
      ) {
        const id = states.map(({ id, value }) => `${id}/${value.id}`).join(' × ');

        throw new Error(
          `${id}: probe ${JSON.stringify(result)} expected ${JSON.stringify(expected)}; downstream ${JSON.stringify(
            downstreamResult
          )} expected ${retain ? JSON.stringify(states[0].value.expected) : 'Empty'}`
        );
      }
    },
    destroy() {
      stage.fields.doc?.destroy();
      downstream.fields.doc?.destroy();
      typedFields.forEach(({ fields }) => fields.doc?.destroy());
    },
    typedOutcomes: typedRoots.length,
    rejectedBranches: triple ? 0 : 6 - typedRoots.length,
  };
}

describe('concrete field values in every ordered formula combination', () => {
  let prepared: Awaited<ReturnType<typeof prepareConcreteValues>>;
  const counts = {
    pairs: 0,
    triples: 0,
    pairTypes: 0,
    tripleTypes: 0,
    excludedPairs: 0,
    excludedTriples: 0,
    typedOutcomes: 0,
    rejectedBranches: 0,
  };

  beforeAll(async () => {
    prepared = await prepareConcreteValues();
  }, 120_000);
  afterAll(() => prepared?.destroy());

  it('keeps explicit finite coverage guards for all 20 field types and 26 result contracts', () => {
    expect(dataset.version).toBe(1);
    expect(dataset.time_zone).toBe('UTC');
    expect(Object.values(FieldType).filter((type) => typeof type === 'number')).toEqual(dataset.coverage.field_types);
    expect(dataset.coverage).toEqual({
      field_types: Array.from({ length: 20 }, (_, i) => i),
      contracts: 26,
      contract_values: 187,
      ordered_contract_pairs: 676,
      ordered_contract_triples: 17576,
      ordered_value_pairs: 34905,
      ordered_value_triples: 6503827,
      excluded_metadata_pairs: 64,
      excluded_metadata_triples: 35376,
    });
    expect(new Set(dataset.contracts.map(({ field_type }) => field_type))).toEqual(
      new Set(dataset.coverage.field_types)
    );
    expect(dataset.contracts).toHaveLength(26);
    expect(dataset.contracts.reduce((count, contract) => count + dataset.value_sets[contract.value_set].length, 0)).toBe(
      187
    );
  });

  it.each(dataset.contracts.map((contract, index) => [contract.id, index] as const))(
    'concrete %s values survive source and serialized/reloaded YDocs',
    (_id, index) => {
      // Every position has its own field IDs, so self-pairs/triples still refer to
      // distinct fields. Verify all three layouts, including fresh Rollup graphs.
      for (const slot of prepared.contracts) {
        const contract = slot[index];
        const ref = `prop("${contract.id}")`;
        const expression = `[${substitute(contract.contract.normalize, ref)}, if(${substitute(
          contract.contract.predicate,
          ref
        )}, "T", "F"), if(empty(${ref}), "E", "V")]`;
        const probe = fieldForExpression('probe', expression);

        try {
          for (const state of [...contract.source, ...contract.restored]) {
            assertRaw(state.read(), state);
            const result = evaluateFormulaCell({
              schema: [...state.schema, probe.entry],
              field: probe.entry.field,
              fieldId: 'probe',
              row: state.row,
              rowId: state.row.get(YjsDatabaseKey.id),
              now: () => dataset.now_ms,
              ...state.context,
            });
            const expected = state.value.expected;

            if (
              result.error ||
              !matchesStrings(result.value, [
                expected.normalized,
                expected.truth ? 'T' : 'F',
                expected.empty ? 'E' : 'V',
              ])
            ) {
              throw new Error(
                `${state.id}/${state.value.id}: ${JSON.stringify(result)} expected ${JSON.stringify(expected)}`
              );
            }
          }
        } finally {
          probe.fields.doc?.destroy();
        }
      }
    }
  );

  it.each(dataset.contracts.map((contract, index) => [contract.id, index] as const))(
    'ordered pairs beginning with %s use every concrete value',
    (_id, index) => {
      const left = prepared.contracts[0][index];

      for (const right of prepared.contracts[1]) {
        const check = matrix([left, right]);

        counts.pairTypes++;
        counts.rejectedBranches += check.rejectedBranches;
        try {
          for (const a of left.source) {
            for (const b of right.source) {
              if (incompatibleMetadata(a, b)) {
                counts.excludedPairs++;
                continue;
              }

              check.check([a, b]);
              counts.pairs++;
              counts.typedOutcomes += check.typedOutcomes;
            }
          }
        } finally {
          check.destroy();
        }
      }
    },
    600_000
  );

  it.each(dataset.contracts.map((contract, index) => [contract.id, index] as const))(
    'ordered triples beginning with %s use every concrete value',
    (_id, index) => {
      const left = prepared.contracts[0][index];

      for (const middle of prepared.contracts[1]) {
        for (const right of prepared.contracts[2]) {
          const check = matrix([left, middle, right]);

          counts.tripleTypes++;
          try {
            for (const a of left.source) {
              for (const b of middle.source) {
                for (const c of right.source) {
                  if (incompatibleMetadata(a, b) || incompatibleMetadata(a, c) || incompatibleMetadata(b, c)) {
                    counts.excludedTriples++;
                    continue;
                  }

                  check.check([a, b, c]);
                  counts.triples++;
                }
              }
            }
          } finally {
            check.destroy();
          }
        }
      }
    },
    600_000
  );

  it('executes the complete Cartesian matrices with only impossible metadata assignments excluded', () => {
    expect(counts).toEqual({
      pairs: 34905,
      triples: 6503827,
      pairTypes: 676,
      tripleTypes: 17576,
      excludedPairs: 64,
      excludedTriples: 35376,
      typedOutcomes: 52350,
      rejectedBranches: 3120,
    });
    expect(counts.pairs + counts.excludedPairs).toBe(187 ** 2);
    expect(counts.triples + counts.excludedTriples).toBe(187 ** 3);
  });
});
