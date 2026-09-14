import { asList, asNumber, asText } from '../coerce';
import { FormulaError, SourcePosition } from '../errors';
import { FormulaFunctionSpec, FormulaParam } from '../registry';
import { EMPTY, FormulaValue, listOf, num, text } from '../values';

const NUMBER_OR_LIST: FormulaParam = { name: 'values', type: ['number', listOf('number')], rest: true };

/** Flattens `min(1, [2, 3])` style arguments into the finite numbers they hold. */
function collectNumbers(args: FormulaValue[], position: SourcePosition): number[] {
  const numbers: number[] = [];

  args.forEach((arg) => {
    asList(arg).forEach((item) => {
      if (item.type === 'empty') return;
      numbers.push(asNumber(item, position));
    });
  });

  return numbers;
}

function unary(
  name: string,
  description: string,
  examples: FormulaFunctionSpec['examples'],
  compute: (value: number) => number
): FormulaFunctionSpec {
  return {
    name,
    category: 'number',
    signature: `${name}(number)`,
    description,
    examples,
    params: [{ name: 'number', type: 'number' }],
    returnType: 'number',
    impl: ([value], _ctx, _nodes, position) => (value.type === 'empty' ? EMPTY : num(compute(asNumber(value, position)))),
  };
}

function binary(
  name: string,
  description: string,
  examples: FormulaFunctionSpec['examples'],
  compute: (a: number, b: number) => number
): FormulaFunctionSpec {
  return {
    name,
    category: 'number',
    signature: `${name}(number1, number2)`,
    description,
    examples,
    params: [
      { name: 'number1', type: 'number' },
      { name: 'number2', type: 'number' },
    ],
    returnType: 'number',
    impl: ([a, b], _ctx, _nodes, position) => num(compute(asNumber(a, position), asNumber(b, position))),
  };
}

/**
 * Notion rounds like JavaScript's Math.round: halves go toward +infinity, so
 * round(2.5) = 3 and round(-2.5) = -2.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** Math.max(0, Math.min(15, Math.trunc(decimals)));
  // Offset the float representation error so 1.005 rounds to 1.01, not 1.
  const scaled = Number((value * factor).toPrecision(15));

  return Math.round(scaled) / factor;
}

const CURRENCY_CODES: Record<string, string> = {
  usd: 'USD',
  eur: 'EUR',
  gbp: 'GBP',
  jpy: 'JPY',
  cad: 'CAD',
  aud: 'AUD',
  cny: 'CNY',
  inr: 'INR',
  krw: 'KRW',
  chf: 'CHF',
  brl: 'BRL',
  mxn: 'MXN',
  rub: 'RUB',
  hkd: 'HKD',
  sgd: 'SGD',
  nzd: 'NZD',
  sek: 'SEK',
  nok: 'NOK',
  dkk: 'DKK',
  pln: 'PLN',
  try: 'TRY',
  twd: 'TWD',
  thb: 'THB',
  idr: 'IDR',
  php: 'PHP',
  ils: 'ILS',
  aed: 'AED',
  sar: 'SAR',
  zar: 'ZAR',
};

export function formatNumberWithStyle(value: number, style: string, decimals?: number): string {
  const key = style.trim().toLowerCase();
  const fractionDigits =
    decimals === undefined ? undefined : Math.max(0, Math.min(20, Math.trunc(decimals)));
  const digits =
    fractionDigits === undefined ? {} : { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits };

  switch (key) {
    case 'commas':
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 10, ...digits }).format(value);
    case 'percent':
      return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 10, ...digits }).format(value);
    case 'humanize':
      return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: fractionDigits ?? 1,
        ...digits,
      }).format(value);
    default: {
      const currency = CURRENCY_CODES[key] ?? (key.length === 3 ? key.toUpperCase() : null);

      if (!currency) throw new FormulaError(`Unknown number format "${style}"`);
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency, ...digits }).format(value);
      } catch {
        throw new FormulaError(`Unknown number format "${style}"`);
      }
    }
  }
}

export const numberFunctions: FormulaFunctionSpec[] = [
  binary('add', 'Adds two numbers. Same as the + operator.', [{ expression: 'add(1, 2)', result: '3' }], (a, b) => a + b),
  binary(
    'subtract',
    'Subtracts the second number from the first. Same as the - operator.',
    [{ expression: 'subtract(5, 2)', result: '3' }],
    (a, b) => a - b
  ),
  binary(
    'multiply',
    'Multiplies two numbers. Same as the * operator.',
    [{ expression: 'multiply(3, 4)', result: '12' }],
    (a, b) => a * b
  ),
  binary(
    'divide',
    'Divides the first number by the second. Same as the / operator.',
    [{ expression: 'divide(8, 2)', result: '4' }],
    (a, b) => a / b
  ),
  binary(
    'mod',
    'Returns the remainder of dividing the first number by the second. Same as the % operator.',
    [{ expression: 'mod(7, 3)', result: '1' }],
    (a, b) => a % b
  ),
  binary(
    'pow',
    'Raises the first number to the power of the second. Same as the ^ operator.',
    [{ expression: 'pow(2, 10)', result: '1024' }],
    (a, b) => a ** b
  ),
  unary('abs', 'Returns the absolute value of the number.', [{ expression: 'abs(-3)', result: '3' }], Math.abs),
  {
    name: 'round',
    category: 'number',
    signature: 'round(number, decimals?)',
    description: 'Rounds to the nearest integer, or to the given number of decimal places.',
    examples: [
      { expression: 'round(3.6)', result: '4' },
      { expression: 'round(3.14159, 2)', result: '3.14' },
    ],
    params: [
      { name: 'number', type: 'number' },
      { name: 'decimals', type: 'number', optional: true },
    ],
    returnType: 'number',
    impl: ([value, decimals], _ctx, _nodes, position) =>
      value.type === 'empty'
        ? EMPTY
        : num(roundTo(asNumber(value, position), decimals === undefined ? 0 : asNumber(decimals, position))),
  },
  unary('ceil', 'Rounds up to the smallest integer that is greater than or equal to the number.', [{ expression: 'ceil(3.2)', result: '4' }], Math.ceil),
  unary('floor', 'Rounds down to the largest integer that is less than or equal to the number.', [{ expression: 'floor(3.8)', result: '3' }], Math.floor),
  unary('sqrt', 'Returns the positive square root of the number.', [{ expression: 'sqrt(16)', result: '4' }], Math.sqrt),
  unary('cbrt', 'Returns the cube root of the number.', [{ expression: 'cbrt(27)', result: '3' }], Math.cbrt),
  unary('exp', "Returns e raised to the power of the number.", [{ expression: 'exp(0)', result: '1' }], Math.exp),
  unary('ln', 'Returns the natural logarithm of the number.', [{ expression: 'ln(e())', result: '1' }], Math.log),
  unary('log10', 'Returns the base 10 logarithm of the number.', [{ expression: 'log10(1000)', result: '3' }], Math.log10),
  unary('log2', 'Returns the base 2 logarithm of the number.', [{ expression: 'log2(8)', result: '3' }], Math.log2),
  unary(
    'sign',
    'Returns 1 for positive numbers, -1 for negative numbers, and 0 for zero.',
    [{ expression: 'sign(-5)', result: '-1' }],
    Math.sign
  ),
  {
    name: 'min',
    category: 'number',
    signature: 'min(number1, number2, ...) or min(list)',
    description: 'Returns the smallest of the numbers. Accepts several numbers or a list of numbers.',
    examples: [
      { expression: 'min(3, 1, 2)', result: '1' },
      { expression: 'min([3, 1, 2])', result: '1' },
    ],
    params: [NUMBER_OR_LIST],
    returnType: 'number',
    impl: (args, _ctx, _nodes, position) => {
      const numbers = collectNumbers(args, position);

      return numbers.length === 0 ? EMPTY : num(Math.min(...numbers));
    },
  },
  {
    name: 'max',
    category: 'number',
    signature: 'max(number1, number2, ...) or max(list)',
    description: 'Returns the largest of the numbers. Accepts several numbers or a list of numbers.',
    examples: [{ expression: 'max(3, 1, 2)', result: '3' }],
    params: [NUMBER_OR_LIST],
    returnType: 'number',
    impl: (args, _ctx, _nodes, position) => {
      const numbers = collectNumbers(args, position);

      return numbers.length === 0 ? EMPTY : num(Math.max(...numbers));
    },
  },
  {
    name: 'sum',
    category: 'number',
    signature: 'sum(number1, number2, ...) or sum(list)',
    description: 'Returns the total of the numbers. Accepts several numbers or a list of numbers.',
    examples: [{ expression: 'sum([1, 2, 3])', result: '6' }],
    params: [NUMBER_OR_LIST],
    returnType: 'number',
    impl: (args, _ctx, _nodes, position) => num(collectNumbers(args, position).reduce((total, value) => total + value, 0)),
  },
  {
    name: 'mean',
    category: 'number',
    signature: 'mean(number1, number2, ...) or mean(list)',
    description: 'Returns the arithmetic average of the numbers.',
    examples: [{ expression: 'mean(1, 2, 3)', result: '2' }],
    params: [NUMBER_OR_LIST],
    returnType: 'number',
    impl: (args, _ctx, _nodes, position) => {
      const numbers = collectNumbers(args, position);

      return numbers.length === 0 ? EMPTY : num(numbers.reduce((total, value) => total + value, 0) / numbers.length);
    },
  },
  {
    name: 'median',
    category: 'number',
    signature: 'median(number1, number2, ...) or median(list)',
    description: 'Returns the middle value of the numbers.',
    examples: [{ expression: 'median(1, 2, 10)', result: '2' }],
    params: [NUMBER_OR_LIST],
    returnType: 'number',
    impl: (args, _ctx, _nodes, position) => {
      const numbers = collectNumbers(args, position).sort((a, b) => a - b);

      if (numbers.length === 0) return EMPTY;
      const middle = Math.floor(numbers.length / 2);

      return num(numbers.length % 2 === 0 ? (numbers[middle - 1] + numbers[middle]) / 2 : numbers[middle]);
    },
  },
  {
    name: 'pi',
    category: 'number',
    signature: 'pi()',
    description: 'Returns the ratio of a circle’s circumference to its diameter.',
    examples: [{ expression: 'pi()', result: '3.14159...' }],
    params: [],
    returnType: 'number',
    impl: () => num(Math.PI),
  },
  {
    name: 'e',
    category: 'number',
    signature: 'e()',
    description: 'Returns the base of the natural logarithm.',
    examples: [{ expression: 'e()', result: '2.71828...' }],
    params: [],
    returnType: 'number',
    impl: () => num(Math.E),
  },
  {
    name: 'formatNumber',
    category: 'number',
    signature: 'formatNumber(number, format, decimals?)',
    description:
      'Formats a number as text. Formats: "commas", "percent", "humanize", or a currency code such as "usd", "eur", "gbp".',
    examples: [
      { expression: 'formatNumber(1234.5, "commas")', result: '"1,234.5"' },
      { expression: 'formatNumber(0.25, "percent")', result: '"25%"' },
      { expression: 'formatNumber(1500, "usd", 2)', result: '"$1,500.00"' },
    ],
    params: [
      { name: 'number', type: 'number' },
      { name: 'format', type: 'text' },
      { name: 'decimals', type: 'number', optional: true },
    ],
    returnType: 'text',
    impl: ([value, style, decimals], _ctx, _nodes, position) => {
      if (value.type === 'empty') return text('');
      try {
        return text(
          formatNumberWithStyle(
            asNumber(value, position),
            asText(style),
            decimals === undefined ? undefined : asNumber(decimals, position)
          )
        );
      } catch (error) {
        throw new FormulaError(error instanceof Error ? error.message : 'Invalid number format', position);
      }
    },
  },
];
