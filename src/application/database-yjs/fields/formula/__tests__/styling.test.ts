import { inferFormulaType } from '../checker';
import { asText } from '../coerce';
import { evaluateFormula } from '../evaluator';
import { formatFormulaValue } from '../format';
import { parseFormula } from '../parser';
import { FormulaValue, num, text, typeOfValue } from '../values';

function run(source: string, properties: Record<string, FormulaValue> = {}): FormulaValue {
  const ast = parseFormula(source);

  inferFormulaType(ast, { getPropType: (ref) => (properties[ref] ? typeOfValue(properties[ref]) : 'empty') });
  return evaluateFormula(ast, { getProp: (ref) => properties[ref] ?? text('') });
}

describe('formula text styling', () => {
  it.each([
    'b',
    'i',
    'u',
    's',
    'c',
    'gray',
    'brown',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'pink',
    'red',
    'gray_background',
    'brown_background',
    'orange_background',
    'yellow_background',
    'green_background',
    'blue_background',
    'purple_background',
    'pink_background',
    'red_background',
  ])('applies only %s and removes it with selective or complete unstyle', (style) => {
    const styled = `style("91", "${style}", "${style}")`;

    expect(run(styled)).toEqual({
      type: 'text',
      value: '91',
      runs: [{ text: '91', styles: [style] }],
    });
    expect(run(`${styled}.unstyle("${style}")`)).toEqual(text('91'));
    expect(run(`${styled}.unstyle()`)).toEqual(text('91'));
  });

  // Values and names from the reporter's notion_formula_conversion_test_data.csv.
  it.each([
    ['No completed work', 0, 10, '0', false],
    ['Low conversion', 2, 8, '20', false],
    ['Half completed', 5, 5, '50', false],
    ['High conversion', 9, 1, '90', false],
    ['Just above threshold', 91, 9, '91', true],
    ['Very high conversion', 19, 1, '95', true],
    ['Fully completed', 10, 0, '100', true],
    ['Rounding below threshold', 904, 96, '90', false],
    ['Rounding above threshold', 905, 95, '91', true],
    ['Small numbers', 1, 2, '33', false],
    ['Uneven ratio', 7, 3, '70', false],
    ['Zero denominator', 0, 0, '0', false],
  ])('preserves conditional styling for %s', (_name, done, inProgress, expected, red) => {
    const value = run(
      'let(Conversion, round((prop("Done") / (prop("In progress") + prop("Done"))) * 100), ' +
        'if(Conversion > 90, style(format(Conversion), "red"), format(Conversion)))',
      { Done: num(Number(done)), 'In progress': num(Number(inProgress)) }
    );

    expect(value).toEqual({
      type: 'text',
      value: expected,
      ...(red ? { runs: [{ text: expected, styles: ['red'] }] } : {}),
    });
  });

  it('composes nested styles with the last foreground and background colors', () => {
    expect(run('style(style("Done", "red", "b", "yellow_background"), "i", "blue", "green_background", "b")')).toEqual({
      type: 'text',
      value: 'Done',
      runs: [{ text: 'Done', styles: ['b', 'i', 'blue', 'green_background'] }],
    });
  });

  it('preserves distinct styles through concatenation, format and list joins', () => {
    expect(run('format(["A".style("red"), "B".style("b")].join(" / ".style("i"))) + "!"')).toEqual({
      type: 'text',
      value: 'A / B!',
      runs: [
        { text: 'A', styles: ['red'] },
        { text: ' / ', styles: ['i'] },
        { text: 'B', styles: ['b'] },
        { text: '!', styles: [] },
      ],
    });
  });

  it('preserves styles inside nested lists formatted to text', () => {
    expect(run('format([["A".style("red")], ["B", "C".style("i")]])')).toEqual({
      type: 'text',
      value: 'A, B, C',
      runs: [
        { text: 'A', styles: ['red'] },
        { text: ', B, ', styles: [] },
        { text: 'C', styles: ['i'] },
      ],
    });
  });

  it('merges adjacent runs with the same styles and omits empty runs', () => {
    expect(run('"A".style("red") + "".style("i") + "B".style("red")')).toEqual({
      type: 'text',
      value: 'AB',
      runs: [{ text: 'AB', styles: ['red'] }],
    });
  });

  it('removes selected styles and restores plain text when all styles are removed', () => {
    expect(run('"Done".style("b", "red", "blue_background").unstyle("red", "b")')).toEqual({
      type: 'text',
      value: 'Done',
      runs: [{ text: 'Done', styles: ['blue_background'] }],
    });
    expect(run('("A".style("red") + "B".style("b")).unstyle()')).toEqual(text('AB'));
    expect(run('"A".style("red").unstyle("red")')).toEqual(text('A'));
    expect(run('"A".style("red").unstyle("blue")')).toEqual(run('"A".style("red")'));
  });

  it('ignores unknown style names without interpreting HTML or CSS', () => {
    expect(run('"<b>A</b>".style("color: red", "<script>")')).toEqual(text('<b>A</b>'));
  });

  it.each(['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'])(
    'supports the %s foreground and background colors',
    (color) => {
      expect(run(`style("A", "${color}", "${color}_background")`)).toEqual({
        type: 'text',
        value: 'A',
        runs: [{ text: 'A', styles: [color, `${color}_background`] }],
      });
    }
  );

  it('supports every text decoration together', () => {
    expect(run('"A".style("c", "s", "u", "i", "b")')).toEqual({
      type: 'text',
      value: 'A',
      runs: [{ text: 'A', styles: ['b', 'i', 'u', 's', 'c'] }],
    });
  });

  it('selectively clears decorations and background without losing the remaining styles', () => {
    expect(
      run('"91".style("c", "s", "u", "i", "b", "red", "blue_background").unstyle("i", "u", "blue_background")')
    ).toEqual({
      type: 'text',
      value: '91',
      runs: [{ text: '91', styles: ['b', 's', 'c', 'red'] }],
    });
  });

  it('retains repeated styled runs and bounds their growth', () => {
    expect(run('("A".style("red") + "B").repeat(2)')).toEqual({
      type: 'text',
      value: 'ABAB',
      runs: [
        { text: 'A', styles: ['red'] },
        { text: 'B', styles: [] },
        { text: 'A', styles: ['red'] },
        { text: 'B', styles: [] },
      ],
    });
    expect(() => run('("A".style("red") + "B".style("blue")).repeat(10000).repeat(10)')).toThrow(/work limit/);
  });

  it('preserves the existing work allowance for plain concatenation and joins', () => {
    const source = 'x'.repeat(40_000);
    const listItem = 'x'.repeat(24_000);

    expect(run('prop("Name") + ""', { Name: text(source) })).toEqual(text(source));
    expect(run(`["${listItem}"].join("")`)).toEqual(text(listItem));
  });

  it('keeps comparisons, conversion, searches and exports based on plain text', () => {
    expect(run('"42".style("red") == "42"')).toEqual({ type: 'boolean', value: true });
    expect(run('toNumber("42".style("red"))')).toEqual(num(42));
    expect(run('contains("Done".style("b"), "one")')).toEqual({ type: 'boolean', value: true });
    expect(run('["B".style("red"), "A".style("blue")].sort().first()')).toEqual(run('"A".style("blue")'));
    const value = run('"42".style("red")');

    expect(asText(value)).toBe('42');
    expect(formatFormulaValue(value)).toBe('42');
  });
});
