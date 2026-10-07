import { NumberFormat } from '@/application/database-yjs/fields/number/number.type';
import { DateFormat } from '@/application/types';

import { formatFormulaNumber, formatFormulaText, formatFormulaValue } from '../format';
import { styleText } from '../styled-text';
import { date, list, num, text } from '../values';

describe('formula number formatting', () => {
  it.each([
    [1e21, '$1,000,000,000,000,000,000,000'],
    [-1e21, '-$1,000,000,000,000,000,000,000'],
    [1.23e21, '$1,230,000,000,000,000,000,000'],
    [1e-7, '$0'],
    [-1e-7, '-$0'],
    [1.23e-7, '$0'],
    [0, '$0'],
    [1234.56, '$1,234.56'],
    [-1234.56, '-$1,234.56'],
  ])('formats the decimal amount of %s as currency', (value, expected) => {
    expect(formatFormulaNumber(value, NumberFormat.USD)).toBe(expected);
  });

  it.each([
    [1e21, '100,000,000,000,000,000,000,000%'],
    [1e-7, '0%'],
    [0.125, '12.5%'],
  ])('formats the decimal amount of %s as a percentage', (value, expected) => {
    expect(formatFormulaNumber(value, NumberFormat.Percent)).toBe(expected);
  });

  it.each([1e30, -1e30, Number.MAX_VALUE])('preserves the amount outside the desktop decimal range: %s', (value) => {
    expect(formatFormulaNumber(value, NumberFormat.USD)).toBe(String(value));
  });

  it.each([1e21, 1e-7])('preserves plain number formatting for %s', (value) => {
    expect(formatFormulaNumber(value)).toBe(String(value));
  });

  it.each([NaN, Infinity, -Infinity])('keeps nonfinite results empty: %s', (value) => {
    expect(formatFormulaNumber(value, NumberFormat.USD)).toBe('');
  });
});

describe('styled formula display formatting', () => {
  it('preserves display number/date formats and styled spans in nested lists', () => {
    const value = list([
      styleText(text('Red'), ['red']),
      list([num(1234.56), date({ start: new Date(2024, 0, 2, 12).getTime(), includeTime: false })]),
    ]);
    const options = { numberFormat: NumberFormat.USD, dateFormat: DateFormat.ISO };
    const display = formatFormulaText(value, options);

    expect(display).toEqual({
      type: 'text',
      value: 'Red, $1,234.56, 2024-01-02',
      runs: [
        { text: 'Red', styles: ['red'] },
        { text: ', $1,234.56, 2024-01-02', styles: [] },
      ],
    });
    expect(display.value).toBe(formatFormulaValue(value, options));
  });
});
