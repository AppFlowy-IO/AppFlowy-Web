import { FieldType } from '@/application/database-yjs/database.type';

import { collectDependentFormulaFields } from '../dependencies';
import { readFormulaSchema } from '../schema';

import { createFields, FieldSpec } from './fixture';

const formula = (id: string, expression: string): FieldSpec => ({
  id,
  name: id,
  type: FieldType.Formula,
  typeOption: { expression },
});

describe('formula property deletion dependencies', () => {
  it('finds direct and indirect dependents once, including invalid types and cycles', () => {
    const schema = readFormulaSchema(
      createFields([
        { id: 'price', name: 'Price', type: FieldType.Number },
        formula('total', 'prop("price") * 2'),
        formula('summary', 'format(prop("total")) + format(prop("price"))'),
        formula('invalid-type', 'upper(prop("price"))'),
        formula('cycle-a', 'prop("cycle-b") + prop("price")'),
        formula('cycle-b', 'prop("cycle-a")'),
        formula('unrelated', '"prop(\\"price\\")" /* prop("price") */'),
        formula('blank', ''),
      ])
    );

    expect(collectDependentFormulaFields(schema, 'price').map(({ id }) => id)).toEqual([
      'total',
      'summary',
      'invalid-type',
      'cycle-a',
      'cycle-b',
    ]);
    expect(collectDependentFormulaFields(schema, 'total').map(({ id }) => id)).toEqual(['summary']);
    expect(collectDependentFormulaFields(schema, 'cycle-a').map(({ id }) => id)).toEqual(['cycle-b']);
    expect(collectDependentFormulaFields(schema, 'unrelated')).toEqual([]);
  });

  it('resolves duplicate names exactly as formulas do without confusing their field IDs', () => {
    const schema = readFormulaSchema(
      createFields([
        { id: 'first', name: 'Price', type: FieldType.Number },
        { id: 'second', name: 'Price', type: FieldType.Number },
        formula('by-name', 'prop("Price")'),
        formula('by-id', 'prop("second")'),
      ])
    );

    expect(collectDependentFormulaFields(schema, 'first').map(({ id }) => id)).toEqual(['by-name']);
    expect(collectDependentFormulaFields(schema, 'second').map(({ id }) => id)).toEqual(['by-id']);
  });

  it('includes formulas that reach a relation through a rollup', () => {
    const schema = readFormulaSchema(
      createFields([
        { id: 'relation', name: 'Related', type: FieldType.Relation },
        {
          id: 'rollup',
          name: 'Rollup',
          type: FieldType.Rollup,
          typeOption: { relation_field_id: 'relation', target_field_id: 'amount' },
        },
        formula('total', 'prop("rollup")'),
        formula('summary', 'format(prop("total"))'),
      ])
    );

    expect(collectDependentFormulaFields(schema, 'relation').map(({ id }) => id)).toEqual(['total', 'summary']);
  });
});
