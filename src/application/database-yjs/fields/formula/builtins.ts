import { FormulaFunctionExample } from './registry';
import { FormulaType } from './values';

/** Operators and constants shown under "Built-ins" in the editor catalogue. */
export interface FormulaBuiltinSpec {
  /** Display name, e.g. `+` or `true`. */
  name: string;
  /** Text inserted into the editor when picked. */
  insert: string;
  signature: string;
  description: string;
  resultType: FormulaType;
  examples: FormulaFunctionExample[];
}

export const FORMULA_BUILTINS: readonly FormulaBuiltinSpec[] = [
  {
    name: '+',
    insert: ' + ',
    signature: 'number + number, text + text',
    description: 'Adds two numbers, or joins two text values.',
    resultType: 'number',
    examples: [
      { expression: '3 + 2', result: '5' },
      { expression: '"Hello" + " " + "world"', result: '"Hello world"' },
    ],
  },
  {
    name: '-',
    insert: ' - ',
    signature: 'number - number',
    description: 'Subtracts the second number from the first.',
    resultType: 'number',
    examples: [{ expression: '5 - 2', result: '3' }],
  },
  {
    name: '*',
    insert: ' * ',
    signature: 'number * number',
    description: 'Multiplies two numbers.',
    resultType: 'number',
    examples: [{ expression: '3 * 4', result: '12' }],
  },
  {
    name: '/',
    insert: ' / ',
    signature: 'number / number',
    description: 'Divides the first number by the second.',
    resultType: 'number',
    examples: [{ expression: '8 / 2', result: '4' }],
  },
  {
    name: '%',
    insert: ' % ',
    signature: 'number % number',
    description: 'Returns the remainder of a division.',
    resultType: 'number',
    examples: [{ expression: '7 % 3', result: '1' }],
  },
  {
    name: '^',
    insert: ' ^ ',
    signature: 'number ^ number',
    description: 'Raises the first number to the power of the second.',
    resultType: 'number',
    examples: [{ expression: '2 ^ 10', result: '1024' }],
  },
  {
    name: '==',
    insert: ' == ',
    signature: 'value == value',
    description: 'Returns true when both values are equal.',
    resultType: 'boolean',
    examples: [{ expression: '"a" == "a"', result: 'true' }],
  },
  {
    name: '!=',
    insert: ' != ',
    signature: 'value != value',
    description: 'Returns true when the values are different.',
    resultType: 'boolean',
    examples: [{ expression: '1 != 2', result: 'true' }],
  },
  {
    name: '>',
    insert: ' > ',
    signature: 'value > value',
    description: 'Returns true when the first value is greater. Works with numbers, dates and text.',
    resultType: 'boolean',
    examples: [{ expression: '3 > 2', result: 'true' }],
  },
  {
    name: '>=',
    insert: ' >= ',
    signature: 'value >= value',
    description: 'Returns true when the first value is greater than or equal to the second.',
    resultType: 'boolean',
    examples: [{ expression: '2 >= 2', result: 'true' }],
  },
  {
    name: '<',
    insert: ' < ',
    signature: 'value < value',
    description: 'Returns true when the first value is smaller.',
    resultType: 'boolean',
    examples: [{ expression: 'prop("Due") < now()', result: 'true when Due is in the past' }],
  },
  {
    name: '<=',
    insert: ' <= ',
    signature: 'value <= value',
    description: 'Returns true when the first value is smaller than or equal to the second.',
    resultType: 'boolean',
    examples: [{ expression: '1 <= 2', result: 'true' }],
  },
  {
    name: 'and',
    insert: ' and ',
    signature: 'boolean and boolean',
    description: 'Returns true when both sides are true. Also written as &&.',
    resultType: 'boolean',
    examples: [{ expression: 'true and false', result: 'false' }],
  },
  {
    name: 'or',
    insert: ' or ',
    signature: 'boolean or boolean',
    description: 'Returns true when either side is true. Also written as ||.',
    resultType: 'boolean',
    examples: [{ expression: 'true or false', result: 'true' }],
  },
  {
    name: 'not',
    insert: 'not ',
    signature: 'not boolean',
    description: 'Returns the opposite boolean. Also written as !.',
    resultType: 'boolean',
    examples: [{ expression: 'not true', result: 'false' }],
  },
  {
    name: '? :',
    insert: ' ? ',
    signature: 'condition ? valueIfTrue : valueIfFalse',
    description: 'Shorthand for if(condition, valueIfTrue, valueIfFalse).',
    resultType: 'any',
    examples: [{ expression: 'prop("Done") ? "Complete" : "Open"', result: '"Complete" when Done is checked' }],
  },
  {
    name: 'true',
    insert: 'true',
    signature: 'true',
    description: 'The boolean value true.',
    resultType: 'boolean',
    examples: [{ expression: 'true', result: 'true' }],
  },
  {
    name: 'false',
    insert: 'false',
    signature: 'false',
    description: 'The boolean value false.',
    resultType: 'boolean',
    examples: [{ expression: 'false', result: 'false' }],
  },
  {
    name: 'current',
    insert: 'current',
    signature: 'current',
    description: 'The item being processed inside map(), filter(), find(), findIndex(), some() and every().',
    resultType: 'any',
    examples: [{ expression: '[1, 2, 3].map(current * 2)', result: '[2, 4, 6]' }],
  },
  {
    name: 'index',
    insert: 'index',
    signature: 'index',
    description: 'The position of the item being processed inside map() and the other list functions.',
    resultType: 'number',
    examples: [{ expression: '["a", "b"].map(index)', result: '[0, 1]' }],
  },
];
