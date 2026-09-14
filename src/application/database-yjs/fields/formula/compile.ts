import { FieldType } from '@/application/database-yjs/database.type';

import { FormulaNode } from './ast';
import { formulaTypeOfFieldType } from './cell-values';
import { inferFormulaType } from './checker';
import { FormulaError, SourcePosition } from './errors';
import { FORMULA_MAX_DEPTH } from './formula.type';
import { parseFormulaTypeOption } from './parse';
import { parseFormula } from './parser';
import { FormulaFieldSchema, formulaSchemaSignature, resolveFormulaField } from './schema';
import { FormulaType } from './values';

export interface CompiledFormula {
  /** Parsed expression, or null when the source is blank or failed to parse. */
  ast: FormulaNode | null;
  /** Inferred result type; `any` when the formula is invalid. */
  resultType: FormulaType;
  error?: FormulaError;
}

const cache = new Map<string, CompiledFormula>();
const CACHE_LIMIT = 500;

function remember(key: string, value: CompiledFormula): CompiledFormula {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;

    if (oldest !== undefined) cache.delete(oldest);
  }

  cache.set(key, value);
  return value;
}

/**
 * Parses and type-checks an expression against the database schema.
 * `visiting` carries the formula fields being compiled so a formula that
 * references itself (directly or through other formulas) is reported instead
 * of recursing forever; the chain is also capped at FORMULA_MAX_DEPTH.
 */
export function compileFormula(
  expression: string,
  schema: FormulaFieldSchema[],
  fieldId?: string,
  visiting: ReadonlySet<string> = new Set()
): CompiledFormula {
  const source = expression.trim();

  if (source === '') return { ast: null, resultType: 'empty' };

  const key = `${formulaSchemaSignature(schema)}\n${fieldId ?? ''}\n${source}`;
  const cached = cache.get(key);

  if (cached) return cached;

  const chain = new Set(visiting);

  if (fieldId) chain.add(fieldId);

  let ast: FormulaNode;

  try {
    ast = parseFormula(source);
  } catch (error) {
    return remember(key, { ast: null, resultType: 'any', error: error as FormulaError });
  }

  const getPropType = (ref: string, position: SourcePosition): FormulaType => {
    const entry = resolveFormulaField(schema, ref);

    if (!entry) throw new FormulaError(`Unknown property "${ref}"`, position);
    if (entry.type !== FieldType.Formula) return formulaTypeOfFieldType(entry.type);
    if (chain.has(entry.id)) {
      throw new FormulaError(`Property "${entry.name}" would reference itself`, position);
    }

    if (chain.size >= FORMULA_MAX_DEPTH) {
      throw new FormulaError(`Formulas can only reference each other ${FORMULA_MAX_DEPTH} levels deep`, position);
    }

    const nested = compileFormula(parseFormulaTypeOption(entry.field).formula, schema, entry.id, chain);

    if (nested.error) throw new FormulaError(`Property "${entry.name}" has an invalid formula`, position);
    return nested.resultType;
  };

  try {
    return remember(key, { ast, resultType: inferFormulaType(ast, { getPropType }) });
  } catch (error) {
    return remember(key, { ast, resultType: 'any', error: error as FormulaError });
  }
}

/** Test hook. */
export function clearFormulaCompileCache() {
  cache.clear();
}
