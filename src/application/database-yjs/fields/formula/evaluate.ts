import { FieldType } from '@/application/database-yjs/database.type';
import { YDatabaseField, YDatabaseRow } from '@/application/types';

import { readFieldFormulaValue, ReadFieldValueContext } from './cell-values';
import { compileFormula } from './compile';
import { FormulaError, SourcePosition } from './errors';
import { evaluateFormula } from './evaluator';
import { formatFormulaValue, FormulaFormatOptions } from './format';
import { FORMULA_MAX_DEPTH, FormulaCellResult } from './formula.type';
import { parseFormulaTypeOption } from './parse';
import { FormulaFieldSchema, resolveFormulaField } from './schema';
import { EMPTY, FormulaValue } from './values';

export interface EvaluateFormulaCellOptions extends ReadFieldValueContext {
  schema: FormulaFieldSchema[];
  /** The formula field being evaluated (its type option holds the expression and formats). */
  field: YDatabaseField;
  fieldId: string;
  row: YDatabaseRow;
  rowId: string;
  now?: () => number;
  format?: FormulaFormatOptions;
  /** Formula fields already on the evaluation stack (cycle guard). */
  visiting?: ReadonlySet<string>;
}

function describeError(error: unknown): string {
  if (error instanceof FormulaError) return error.displayMessage;
  return error instanceof Error ? error.message : 'Formula failed';
}

function withRaw(value: FormulaValue, resultType: FormulaCellResult['resultType'], text: string): FormulaCellResult {
  const result: FormulaCellResult = { value, resultType, text };

  switch (value.type) {
    case 'number':
      result.rawNumeric = value.value;
      break;
    case 'boolean':
      result.rawBoolean = value.value;
      break;
    case 'date':
      result.rawDate = {
        start: Math.floor(value.value.start / 1000),
        end: value.value.end === undefined ? undefined : Math.floor(value.value.end / 1000),
        includeTime: value.value.includeTime,
      };
      break;
    default:
      break;
  }

  return result;
}

/**
 * Evaluates one formula cell synchronously from the row's own cells.
 * Never throws: parse, type and runtime failures come back as `error`.
 */
export function evaluateFormulaCell(options: EvaluateFormulaCellOptions): FormulaCellResult {
  const typeOption = parseFormulaTypeOption(options.field);

  return evaluateFormulaExpression({
    ...options,
    expression: typeOption.formula,
    format: { numberFormat: typeOption.format, ...options.format },
  });
}

export interface EvaluateFormulaExpressionOptions extends EvaluateFormulaCellOptions {
  /** Storage-form expression to evaluate instead of the field's saved one (editor previews). */
  expression: string;
}

/** Evaluates an arbitrary expression as if it were `field`'s formula (used for live previews). */
export function evaluateFormulaExpression(options: EvaluateFormulaExpressionOptions): FormulaCellResult {
  const { schema, fieldId, row, rowId, now, expression } = options;
  const formatOptions: FormulaFormatOptions = { ...options.format };
  const compiled = compileFormula(expression, schema, fieldId, options.visiting);

  if (compiled.error) {
    return { value: EMPTY, resultType: 'any', text: '', error: compiled.error.displayMessage };
  }

  if (!compiled.ast) return { value: EMPTY, resultType: 'empty', text: '' };

  const visiting = new Set(options.visiting);

  visiting.add(fieldId);

  const getProp = (ref: string, position: SourcePosition): FormulaValue => {
    const entry = resolveFormulaField(schema, ref);

    if (!entry) throw new FormulaError(`Unknown property "${ref}"`, position);
    if (entry.type !== FieldType.Formula) return readFieldFormulaValue(entry, row, options);
    if (visiting.has(entry.id)) throw new FormulaError(`Property "${entry.name}" would reference itself`, position);
    if (visiting.size >= FORMULA_MAX_DEPTH) {
      throw new FormulaError(`Formulas can only reference each other ${FORMULA_MAX_DEPTH} levels deep`, position);
    }

    const nested = evaluateFormulaCell({
      schema,
      field: entry.field,
      fieldId: entry.id,
      row,
      rowId,
      now,
      getUserName: options.getUserName,
      getPersonName: options.getPersonName,
      getRelatedRowTitle: options.getRelatedRowTitle,
      getRollupValue: options.getRollupValue,
      visiting,
    });

    if (nested.error) throw new FormulaError(`Property "${entry.name}" has an error: ${nested.error}`, position);
    return nested.value;
  };

  try {
    const value = evaluateFormula(compiled.ast, { getProp, now, rowId });

    return withRaw(value, compiled.resultType, formatFormulaValue(value, formatOptions));
  } catch (error) {
    return { value: EMPTY, resultType: compiled.resultType, text: '', error: describeError(error) };
  }
}
