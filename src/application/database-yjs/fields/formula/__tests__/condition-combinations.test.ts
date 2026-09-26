/**
 * Independently specified condition contracts, mirrored by the desktop suite.
 * The JSON is authored input/expected data, never output from the evaluator.
 * Pairwise coverage is deliberate: every pair exercises both branch outcomes,
 * absent cells, false checkboxes and numeric zero through the real row adapter.
 */
import dayjs from 'dayjs';

import { CalculationType, FieldType, RollupDisplayMode } from '@/application/database-yjs/database.type';

import { ReadFieldValueContext } from '../cell-values';
import { evaluateFormulaCell } from '../evaluate';
import { readFormulaSchema } from '../schema';

import contracts from './condition-combinations.json';
import {
  CellSpec,
  checklistData,
  createFields,
  createRow,
  FieldSpec,
  mediaItem,
  RowMeta,
  selectOptions,
} from './fixture';

type Contract = (typeof contracts)[number];
type State = 'positive' | 'negative' | 'empty' | 'zero';

const ALPHA_ID = '00000000-0000-4000-8000-00000000000a';
const BETA_ID = '00000000-0000-4000-8000-00000000000b';
const NAMES: Record<string, string> = { [ALPHA_ID]: 'Alpha', [BETA_ID]: 'Beta', '101': 'Alpha', '202': 'Beta' };
const states = (contract: Contract): State[] =>
  contract.supports_zero ? ['positive', 'negative', 'empty', 'zero'] : ['positive', 'negative', 'empty'];
const reference = (contract: Contract) => `prop("${contract.id}")`;
const predicate = (contract: Contract) => contract.predicate.replaceAll('$', reference(contract));

function fieldsFor(contract: Contract): FieldSpec[] {
  const id = contract.field_type === FieldType.Formula ? `source-${contract.id}` : contract.id;
  const field: FieldSpec = { id, name: id, type: contract.source_type };

  if (field.type === FieldType.SingleSelect || field.type === FieldType.MultiSelect) {
    field.typeOption = {
      content: selectOptions([
        ['choice-a', 'Alpha'],
        ['choice-b', 'Beta'],
      ]),
    };
  }

  if (field.type === FieldType.Rollup) {
    field.typeOption = {
      relation_field_id: 'rollup-relation',
      target_field_id: 'target',
      calculation_type: CalculationType.Sum,
      show_as: contract.kind === 'number' ? RollupDisplayMode.Calculated : RollupDisplayMode.OriginalList,
    };
  }

  return contract.field_type === FieldType.Formula
    ? [
        field,
        { id: contract.id, name: contract.id, type: FieldType.Formula, typeOption: { expression: `prop("${id}")` } },
      ]
    : [field];
}

function fixture(selected: Array<[Contract, State]>) {
  const cells: Record<string, CellSpec> = {};
  const meta: RowMeta = {};
  const rollups = new Map<string, NonNullable<ReturnType<NonNullable<ReadFieldValueContext['getRollupValue']>>>>();

  selected.forEach(([contract, state]) => {
    if (state === 'empty') return;
    const value = state === 'zero' ? '0' : contract[state];
    const id = contract.field_type === FieldType.Formula ? `source-${contract.id}` : contract.id;
    const type = contract.source_type;
    const alpha = state === 'positive';
    const namedId = alpha ? ALPHA_ID : BETA_ID;

    switch (type) {
      case FieldType.CreatedTime:
        meta.createdAt = String(dayjs(value).unix());
        return;
      case FieldType.LastEditedTime:
        meta.lastModified = String(dayjs(value).unix());
        return;
      case FieldType.CreatedBy:
        meta.createdBy = alpha ? 101 : 202;
        return;
      case FieldType.LastEditedBy:
        meta.lastEditedBy = alpha ? 101 : 202;
        return;
      case FieldType.Rollup:
        rollups.set(id, contract.kind === 'number' ? { value, rawNumeric: Number(value) } : { value, list: [value] });
        return;
      case FieldType.DateTime:
        // Selecting a day may retain a hidden time in the stored timestamp.
        cells[id] = { type, data: String(dayjs(value).unix()), extra: { include_time: false } };
        return;
      case FieldType.SingleSelect:
      case FieldType.MultiSelect:
        cells[id] = { type, data: alpha ? 'choice-a' : 'choice-b' };
        return;
      case FieldType.Checklist:
        cells[id] = { type, data: checklistData(Number(value), 1) };
        return;
      case FieldType.Relation:
        cells[id] = { type, data: { yArray: [namedId] } };
        return;
      case FieldType.Media:
        cells[id] = { type, data: { yArray: [mediaItem(namedId, value)] } };
        return;
      case FieldType.Person:
        cells[id] = { type, data: JSON.stringify([namedId]) };
        return;
      default:
        cells[id] = { type, data: value };
    }
  });
  const context: ReadFieldValueContext = {
    getUserName: (id) => NAMES[id],
    getPersonName: (id) => NAMES[id],
    getRelatedRowTitle: (_field, id) => NAMES[id],
    getRollupValue: (id) => rollups.get(id),
  };

  return { row: createRow('combinations', cells, meta).row, context };
}

function database(selected: Contract[], formulas: Record<string, string>) {
  const fields = createFields([
    { id: 'rollup-relation', name: 'rollup-relation', type: FieldType.Relation },
    ...selected.flatMap(fieldsFor),
    ...Object.entries(formulas).map(([id, expression]) => ({
      id,
      name: id,
      type: FieldType.Formula,
      typeOption: { expression },
    })),
  ]);
  const schema = readFormulaSchema(fields);

  return (id: string, selectedStates: Array<[Contract, State]>) => {
    const { row, context } = fixture(selectedStates);
    const result = evaluateFormulaCell({
      ...context,
      schema,
      field: fields.get(id),
      fieldId: id,
      row,
      rowId: 'combinations',
    });

    expect(result.error).toBeUndefined();
    return result;
  };
}

it('covers every field type and keeps independently authored case IDs unique', () => {
  const all = Object.values(FieldType).filter((value): value is FieldType => typeof value === 'number');

  expect(new Set(contracts.map((contract) => contract.field_type))).toEqual(new Set(all));
  expect(new Set(contracts.map((contract) => contract.id)).size).toBe(contracts.length);
});

describe.each(contracts)('$id state and typed branch contract', (contract) => {
  it.each(states(contract))('%s distinguishes its predicate and empty semantics', (state) => {
    const p = predicate(contract);
    const run = database([contract], {
      probe: `join([if(${p}, "T", "F"), if(empty(${reference(contract)}), "E", "V")], "|")`,
    });
    const isEmpty = state === 'empty' || state === 'zero' || (state === 'negative' && contract.negative_empty);

    expect(run('probe', [[contract, state]]).text).toBe(`${state === 'positive' ? 'T' : 'F'}|${isEmpty ? 'E' : 'V'}`);
  });

  it.each(['positive', 'negative'] as const)(
    '%s survives compatible typed if/ifs branches and two formula references',
    (state) => {
      const p = predicate(contract);
      const ref = reference(contract);
      const run = database([contract], {
        stage: `if(${p}, ${ref}, empty())`,
        chain: `ifs(not(${p}), ${ref}, true, prop("stage"))`,
        probe: contract.normalize.replaceAll('$', 'prop("chain")'),
      });

      expect(run('probe', [[contract, state]]).text).toBe(
        state === 'positive' ? contract.expected_positive : contract.expected_negative
      );
    }
  );
});

it.each(contracts.filter((contract) => contract.supports_zero))(
  '$id preserves numeric zero separately from an absent value',
  (contract) => {
    const run = database([contract], { probe: reference(contract) });

    expect(run('probe', [[contract, 'zero']]).rawNumeric).toBe(0);
    expect(run('probe', [[contract, 'empty']]).rawNumeric).toBeUndefined();
  }
);

it.each(contracts.filter((contract) => contract.kind === 'boolean'))(
  '$id reads both an unchecked and an absent checkbox as false',
  (contract) => {
    const run = database([contract], { probe: reference(contract) });

    expect(run('probe', [[contract, 'negative']]).rawBoolean).toBe(false);
    expect(run('probe', [[contract, 'empty']]).rawBoolean).toBe(false);
  }
);

const pairs = contracts.flatMap((left, index) =>
  contracts.slice(index + 1).map((right) => ({
    id: `${left.id} × ${right.id}`,
    left,
    right,
  }))
);

describe.each(pairs)('$id condition truth table', ({ left, right }) => {
  const combinations = states(left).flatMap((a) => states(right).map((b) => [a, b] as const));
  const p = predicate(left);
  const q = predicate(right);
  const run = database([left, right], {
    probe: `join([if((${p}) and (${q}), "T", "F"), if((${p}) or (${q}), "T", "F"), if(not(${p}), "T", "F"), ifs(${p}, "left", ${q}, "right", "neither"), if(${p}, if(${q}, "both", "left"), if(${q}, "right", "neither"))], "|")`,
  });

  it.each(combinations)('%s × %s', (a, b) => {
    // This four-entry oracle is the Boolean truth table, not engine output.
    const expected = {
      TT: 'T|T|F|left|both',
      TF: 'F|T|F|left|left',
      FT: 'F|T|T|right|right',
      FF: 'F|F|T|neither|neither',
    };
    const key = `${a === 'positive' ? 'T' : 'F'}${b === 'positive' ? 'T' : 'F'}`;

    expect(
      run('probe', [
        [left, a],
        [right, b],
      ]).text
    ).toBe(expected[key]);
  });
});
