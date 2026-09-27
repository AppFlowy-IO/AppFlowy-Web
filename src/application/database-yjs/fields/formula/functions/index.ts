import { FormulaFunctionCategory, FormulaFunctionSpec } from '../registry';

import { dateFunctions } from './date';
import { listFunctions } from './list';
import { logicFunctions } from './logic';
import { numberFunctions } from './number';
import { textFunctions } from './text';

export const FORMULA_FUNCTIONS: readonly FormulaFunctionSpec[] = [
  ...logicFunctions,
  ...textFunctions,
  ...numberFunctions,
  ...dateFunctions,
  ...listFunctions,
];

const byName = new Map(FORMULA_FUNCTIONS.map((spec) => [spec.name, spec]));

export function getFormulaFunction(name: string): FormulaFunctionSpec | undefined {
  return byName.get(name);
}

export const FORMULA_FUNCTION_CATEGORIES: readonly FormulaFunctionCategory[] = [
  'logic',
  'text',
  'number',
  'date',
  'list',
  'variable',
  'page',
];
