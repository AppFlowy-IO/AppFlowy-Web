// Value constructors (`text`, `num`, `date`, ...) are deliberately not
// re-exported here: this module is part of the `fields` barrel and those
// names would collide with other field helpers. Import them from './values'.
export type { FormulaNode, BinaryOperator, UnaryOperator } from './ast';
export { collectPropRefs } from './ast';
export { FORMULA_BUILTINS } from './builtins';
export type { FormulaBuiltinSpec } from './builtins';
export { formulaTypeOfField, formulaTypeOfFieldType, readFieldFormulaValue } from './cell-values';
export type { ReadFieldValueContext } from './cell-values';
export { inferFormulaType } from './checker';
export { formatNumberPlain, formatDatePlain } from './coerce';
export { compileFormula, clearFormulaCompileCache } from './compile';
export type { CompiledFormula } from './compile';
export { FormulaError, isFormulaError } from './errors';
export type { SourcePosition } from './errors';
export { evaluateFormulaCell, evaluateFormulaExpression } from './evaluate';
export type { EvaluateFormulaCellOptions, EvaluateFormulaExpressionOptions } from './evaluate';
export { evaluateFormula } from './evaluator';
export { formatFormulaValue, formatFormulaNumber, formatFormulaDate } from './format';
export type { FormulaFormatOptions } from './format';
export { FORMULA_MAX_DEPTH } from './formula.type';
export type { FormulaTypeOption, FormulaCellResult, FormulaCellDisplayOptions } from './formula.type';
export { FORMULA_FUNCTIONS, FORMULA_FUNCTION_CATEGORIES, getFormulaFunction } from './functions';
export { tokenize } from './lexer';
export type { Token, TokenKind } from './lexer';
export { parseFormulaTypeOption, parseFormulaVisualizationOption } from './parse';
export { parseFormula } from './parser';
export {
  collectExpressionExternalReferences,
  collectFormulaExternalReferences,
  formulaExternalReferencesKey,
  NO_EXTERNAL_REFERENCES,
} from './references';
export type { FormulaExternalReferences } from './references';
export type { FormulaFunctionSpec, FormulaFunctionCategory, FormulaFunctionExample, FormulaParam } from './registry';
export {
  readFormulaSchema,
  readFormulaSchemaForVersion,
  formulaSchemaSignature,
  resolveFormulaField,
  toDisplayExpression,
  toStorageExpression,
} from './schema';
export type { FormulaFieldSchema } from './schema';
export { isEmptyValue, isListType, typeToString, typeOfValue, typesCompatible, unifyTypes } from './values';
export type { FormulaType, FormulaScalarType, FormulaValue, FormulaDate } from './values';
