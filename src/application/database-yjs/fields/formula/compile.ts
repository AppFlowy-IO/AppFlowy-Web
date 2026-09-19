import { FieldType } from '@/application/database-yjs/database.type';
import { parseRollupTypeOption } from '@/application/database-yjs/fields/rollup/parse';

import { FormulaNode } from './ast';
import { formulaTypeOfField } from './cell-values';
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

interface CachedCompilation {
  result: CompiledFormula;
  /** Transitive formula references, excluding this expression's own field. */
  dependencies: Set<string>;
  /** Longest downstream chain, not including this expression's own field. */
  depth: number;
  /** Cycle/depth failures depend on the caller and cannot enter the shared cache. */
  contextualError?: boolean;
}

const cache = new Map<string, CachedCompilation>();
const CACHE_LIMIT = 500;

function remember(key: string, value: CachedCompilation): CachedCompilation {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;

    if (oldest !== undefined) cache.delete(oldest);
  }

  cache.set(key, value);
  return value;
}

function compilationError(error: unknown, position?: SourcePosition): FormulaError {
  if (error instanceof FormulaError) return error;
  return new FormulaError(error instanceof RangeError ? 'Formula is too complex' : String(error), position);
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
  const signature = formulaSchemaSignature(schema);
  // Keep shared results for this whole pass even when a wide graph evicts
  // entries from the bounded cross-call cache.
  const memo = new Map<string, CachedCompilation>();
  const compile = (source: string, ownerId: string | undefined, ancestors: ReadonlySet<string>): CachedCompilation => {
    const key = JSON.stringify([signature, ownerId, source]);
    const chain = new Set(ancestors);

    if (ownerId) chain.add(ownerId);
    const cached = memo.get(key) ?? cache.get(key);

    if (cached) {
      const cycle = Array.from(cached.dependencies).find((id) => chain.has(id));
      let error: FormulaError | undefined;

      if (cycle) {
        error = new FormulaError(
          `Property "${resolveFormulaField(schema, cycle)?.name ?? cycle}" would reference itself`,
          cached.result.ast?.position
        );
      } else if (chain.size + cached.depth > FORMULA_MAX_DEPTH) {
        error = new FormulaError(
          `Formulas can only reference each other ${FORMULA_MAX_DEPTH} levels deep`,
          cached.result.ast?.position
        );
      }

      if (error) {
        return { ...cached, result: { ...cached.result, resultType: 'any', error }, contextualError: true };
      }

      memo.set(key, cached);
      return cached;
    }

    const dependencies = new Set<string>();
    let depth = 0;
    let contextualError = false;
    const finish = (result: CompiledFormula): CachedCompilation => {
      const compiled = { result, dependencies, depth, contextualError };

      if (!contextualError) {
        memo.set(key, compiled);
        remember(key, compiled);
      }

      return compiled;
    };

    if (source === '') return finish({ ast: null, resultType: 'empty' });
    let ast: FormulaNode;

    try {
      ast = parseFormula(source);
    } catch (error) {
      return finish({ ast: null, resultType: 'any', error: compilationError(error) });
    }

    const getPropType = (ref: string, position: SourcePosition): FormulaType => {
      const entry = resolveFormulaField(schema, ref);

      if (!entry) throw new FormulaError(`Unknown property "${ref}"`, position, ref);
      if (entry.type === FieldType.Rollup) {
        const relationId = parseRollupTypeOption(entry.field)?.relation_field_id;

        if (relationId && resolveFormulaField(schema, relationId)?.id !== relationId) {
          throw new FormulaError(
            `Property "${entry.name}" uses a missing relation property "${relationId}"`,
            position,
            relationId
          );
        }
      }

      if (entry.type !== FieldType.Formula) return formulaTypeOfField(entry);
      if (chain.has(entry.id)) {
        contextualError = true;
        throw new FormulaError(`Property "${entry.name}" would reference itself`, position);
      }

      if (chain.size >= FORMULA_MAX_DEPTH) {
        contextualError = true;
        throw new FormulaError(`Formulas can only reference each other ${FORMULA_MAX_DEPTH} levels deep`, position);
      }

      const nested = compile(parseFormulaTypeOption(entry.field).formula.trim(), entry.id, chain);

      dependencies.add(entry.id);
      nested.dependencies.forEach((id) => dependencies.add(id));
      depth = Math.max(depth, 1 + nested.depth);
      if (nested.result.error) {
        contextualError ||= Boolean(nested.contextualError);
        throw new FormulaError(
          `Property "${entry.name}" has an invalid formula: ${nested.result.error.message}`,
          position,
          nested.result.error.missingPropertyRef
        );
      }

      return nested.result.resultType;
    };

    try {
      return finish({ ast, resultType: inferFormulaType(ast, { getPropType }) });
    } catch (error) {
      return finish({ ast, resultType: 'any', error: compilationError(error, ast.position) });
    }
  };

  return compile(expression.trim(), fieldId, visiting).result;
}

/** Test hook. */
export function clearFormulaCompileCache() {
  cache.clear();
}
