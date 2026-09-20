import { FieldType } from '@/application/database-yjs/database.type';

import { collectPropRefs, formulaUsesClock } from '../ast';
import * as checker from '../checker';
import { clearFormulaCompileCache, compileFormula } from '../compile';
import { FormulaError } from '../errors';
import { FORMULA_MAX_DEPTH } from '../formula.type';
import * as parser from '../parser';
import { collectExpressionExternalReferences, NO_EXTERNAL_REFERENCES } from '../references';
import { readFormulaSchema } from '../schema';

import { createFields, FieldSpec } from './fixture';

const formula = (id: string, expression: string): FieldSpec => ({
  id,
  name: id,
  type: FieldType.Formula,
  typeOption: { expression },
});

beforeEach(clearFormulaCompileCache);

describe('formula compilation reuse', () => {
  it('parses and checks each field once across all paths in a dense dependency graph', () => {
    const expressions = Array.from({ length: FORMULA_MAX_DEPTH }, (_, index) =>
      index === 0 ? '1' : Array.from({ length: index }, (__, dependency) => `prop("f${dependency}")`).join(' + ')
    );
    const schema = readFormulaSchema(createFields(expressions.map((source, index) => formula(`f${index}`, source))));
    const parse = jest.spyOn(parser, 'parseFormula');
    const infer = jest.spyOn(checker, 'inferFormulaType');

    try {
      const result = compileFormula(expressions[14], schema, 'f14');

      expect(result.error).toBeUndefined();
      expect(result.resultType).toBe('number');
      expect(parse).toHaveBeenCalledTimes(FORMULA_MAX_DEPTH);
      expect(infer).toHaveBeenCalledTimes(FORMULA_MAX_DEPTH);
      expect(compileFormula(expressions[14], schema, 'f14')).toBe(result);
      expressions.forEach((source, index) => {
        expect(compileFormula(source, schema, `f${index}`).error).toBeUndefined();
      });
      expect(compileFormula(expressions[3], schema, 'f3', new Set(['draft'])).error).toBeUndefined();
      expect(parse).toHaveBeenCalledTimes(FORMULA_MAX_DEPTH);
      expect(infer).toHaveBeenCalledTimes(FORMULA_MAX_DEPTH);
    } finally {
      parse.mockRestore();
      infer.mockRestore();
    }
  });

  it('rejects transitive draft cycles without poisoning reusable saved formulas', () => {
    const schema = readFormulaSchema(
      createFields([formula('a', '1'), formula('b', 'prop("a")'), formula('c', 'prop("b")')])
    );
    const saved = compileFormula('prop("b")', schema, 'c');

    expect(saved.error).toBeUndefined();
    expect(compileFormula('prop("c")', schema, 'a').error?.message).toMatch(/reference itself/);
    expect(compileFormula('prop("b")', schema, 'c')).toBe(saved);
    expect(compileFormula('prop("b")', schema, 'c', new Set(['a'])).error?.message).toMatch(/reference itself/);
    expect(compileFormula('prop("b")', schema, 'c')).toBe(saved);
  });

  it('retains shared work within a pass that exceeds the cross-call cache capacity', () => {
    const leaves = Array.from({ length: 501 }, (_, index) => formula(`leaf${index}`, '1'));
    const source = `sum([prop("shared"), ${leaves.map(({ id }) => `prop("${id}")`).join(', ')}, prop("shared")])`;
    const schema = readFormulaSchema(createFields([formula('shared', '1'), ...leaves, formula('root', source)]));
    const parse = jest.spyOn(parser, 'parseFormula');

    try {
      expect(compileFormula(source, schema, 'root').error).toBeUndefined();
      expect(parse).toHaveBeenCalledTimes(leaves.length + 2);
    } finally {
      parse.mockRestore();
    }
  });

  it('checks the full cached dependency depth and does not retain contextual errors', () => {
    const expressions = Array.from({ length: FORMULA_MAX_DEPTH + 2 }, (_, index) =>
      index === FORMULA_MAX_DEPTH + 1 ? '1' : `prop("f${index + 1}")`
    );
    const schema = readFormulaSchema(createFields(expressions.map((source, index) => formula(`f${index}`, source))));
    const tail = compileFormula(expressions[2], schema, 'f2');

    expect(tail.error).toBeUndefined();
    expect(compileFormula(expressions[0], schema, 'f0').error?.message).toMatch(/levels deep/);
    expect(compileFormula(expressions[2], schema, 'f2')).toBe(tail);
    expect(compileFormula(expressions[2], schema, 'f2', new Set(['draft'])).error?.message).toMatch(/levels deep/);
    clearFormulaCompileCache();
    expect(compileFormula(expressions[0], schema, 'f0').error?.message).toMatch(/levels deep/);
    expect(compileFormula(expressions[2], schema, 'f2').error).toBeUndefined();
  });
});

describe('references in invalid deep expressions', () => {
  it('returns a formula error without throwing while collecting a 10,000-term expression', () => {
    const source = Array.from({ length: 10_000 }, () => '1').join(' + ');
    const compiled = compileFormula(source, []);

    expect(compiled.error).toBeInstanceOf(FormulaError);
    expect(compiled.error?.displayMessage).toMatch(/too complex/);
    expect(collectExpressionExternalReferences(source, [])).toBe(NO_EXTERNAL_REFERENCES);
  });

  it('walks a failed AST iteratively while retaining property order and clock dependencies', () => {
    const source = ['prop("owners")', ...Array.from({ length: 10_000 }, () => '1'), 'now()', 'prop("creator")'].join(' + ');
    const schema = readFormulaSchema(
      createFields([
        { id: 'owners', name: 'Owners', type: FieldType.Person },
        { id: 'creator', name: 'Creator', type: FieldType.CreatedBy },
      ])
    );
    const compiled = compileFormula(source, schema);

    expect(compiled.error).toBeInstanceOf(FormulaError);
    expect(compiled.ast).not.toBeNull();
    expect(collectPropRefs(compiled.ast!)).toEqual(['owners', 'creator']);
    expect(formulaUsesClock(compiled.ast!)).toBe(true);
    expect(collectExpressionExternalReferences(source, schema)).toMatchObject({ clock: true, people: true });
  });
});
