import dayjs from 'dayjs';

import { inferFormulaType } from '../checker';
import { FormulaError } from '../errors';
import { evaluateFormula } from '../evaluator';
import { parseFormula } from '../parser';
import { bool, date, EMPTY, FormulaType, FormulaValue, list, num, text, typeToString } from '../values';

const props: Record<string, { type: FormulaType; value: FormulaValue }> = {
  Price: { type: 'number', value: num(12.5) },
  Qty: { type: 'number', value: num(4) },
  EmptyNumber: { type: 'number', value: EMPTY },
  Name: { type: 'text', value: text('Widget') },
  Done: { type: 'boolean', value: bool(true) },
  Due: { type: 'date', value: date({ start: dayjs('2024-03-10T00:00:00').valueOf(), includeTime: false }) },
  NoDate: { type: 'date', value: EMPTY },
  Tags: { type: { list: 'text' }, value: list([text('a'), text('b'), text('c')]) },
};

const NOW = dayjs('2024-03-01T10:30:00').valueOf();

function run(source: string): FormulaValue {
  const ast = parseFormula(source);

  inferFormulaType(ast, {
    getPropType: (ref, position) => {
      const entry = props[ref];

      if (!entry) throw new FormulaError(`Unknown property "${ref}"`, position);
      return entry.type;
    },
  });

  return evaluateFormula(ast, {
    getProp: (ref, position) => {
      const entry = props[ref];

      if (!entry) throw new FormulaError(`Unknown property "${ref}"`, position);
      return entry.value;
    },
    now: () => NOW,
    rowId: 'row-1',
  });
}

function typeOf(source: string): string {
  return typeToString(
    inferFormulaType(parseFormula(source), {
      getPropType: (ref) => props[ref]?.type ?? 'any',
    })
  );
}

function expectError(source: string, message: RegExp) {
  expect(() => run(source)).toThrow(message);
}

describe('bounded formula regular expressions', () => {
  it.each(['test', 'match', 'replace', 'replaceAll'])('bounds pathological patterns in %s', (fn) => {
    const input = `${'a'.repeat(1000)}!`;
    const replacement = fn.startsWith('replace') ? ', "x"' : '';
    const started = performance.now();
    const result = run(`${fn}(${JSON.stringify(input)}, "^(a+)+$"${replacement})`);

    expect(result).toEqual(fn === 'test' ? bool(false) : fn === 'match' ? list([]) : text(input));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('rejects unsupported and oversized patterns without native regex fallback', () => {
    expectError('test("aa", "(a)\\\\1")', /unsupported/);
    expectError(`test("a", ${JSON.stringify('a'.repeat(4097))})`, /too long/);
    expectError(`test("a", ${JSON.stringify('a{1000}'.repeat(11))})`, /too complex/);
    expectError(`test(repeat("aa", 10000).repeat(6), "a")`, /input is too long|work limit/);
  });

  it('preserves empty matches and JavaScript replacement groups', () => {
    expect(run('match("baaac", "a*")')).toEqual(list([text(''), text('aaa'), text(''), text('')]));
    expect(run('replaceAll("baaac", "a*", "-")')).toEqual(text('-b--c-'));
    expect(run('replaceAll("ab ab", "(?<letter>a)(b)", "$2$<letter>$$$&")')).toEqual(text('ba$ab ba$ab'));
  });

  it('bounds repeated searches that scan the remaining input', () => {
    expectError('match(repeat("a", 10000), "a.*b|a")', /too complex|work limit/);
    expectError('replaceAll(repeat("a", 10000), "a.*b|a", "x")', /too complex|work limit/);
  });
});

describe('formula language: parsing and operators', () => {
  it.each([
    'ifs(false, "prefix") + 1 + 2',
    '1 + ifs(false, "suffix") + 2',
    '["prefix"].at(2) + 1 + 2',
    'split("", ",").first() + 1 + 2',
    'prop("Tags").find(false) + 1 + 2',
    'if(true, empty(), "prefix") + 1 + 2',
    '(true ? empty() : "prefix") + 1 + 2',
    'let(prefix, ifs(false, "prefix"), prefix + 1 + 2)',
    '["prefix"].map(ifs(false, current) + 1 + 2).first()',
  ])('preserves static text addition for an empty operand: %s', (source) => {
    expect(typeOf(source)).toBe('text');
    expect(run(source)).toEqual(text('12'));
  });

  it('preserves empty values outside text addition and numeric empty addition', () => {
    expect(run('ifs(false, "prefix")')).toEqual(EMPTY);
    expect(run('ifs(false, "prefix") + ifs(false, "suffix")')).toEqual(text(''));
    expect(run('ifs(false, 10) + 1 + 2')).toEqual(num(3));
    expect(run('[10].at(2) + 1 + 2')).toEqual(num(3));
    expect(run('empty() + empty()')).toEqual(EMPTY);
  });

  it('evaluates arithmetic with the right precedence and associativity', () => {
    expect(run('1 + 2 * 3')).toEqual(num(7));
    expect(run('(1 + 2) * 3')).toEqual(num(9));
    expect(run('2 ^ 3 ^ 2')).toEqual(num(512));
    expect(run('10 % 4')).toEqual(num(2));
    expect(run('-3 + 5')).toEqual(num(2));
    expect(run('7 / 2')).toEqual(num(3.5));
  });

  it('concatenates text with + and compares values', () => {
    expect(run('"a" + "b"')).toEqual(text('ab'));
    expect(run('1 == 1')).toEqual(bool(true));
    expect(run('"a" != "b"')).toEqual(bool(true));
    expect(run('2 >= 2 and 3 > 2')).toEqual(bool(true));
    expect(run('false || true')).toEqual(bool(true));
    expect(run('not true')).toEqual(bool(false));
    expect(run('!false')).toEqual(bool(true));
  });

  it('supports the ternary operator, comments and multi-line input', () => {
    expect(run('true ? "yes" : "no"')).toEqual(text('yes'));
    expect(run('/* comment */ 1 +\n  2')).toEqual(num(3));
    expect(run('false ? 1 : true ? 2 : 3')).toEqual(num(2));
  });

  it('supports dot notation as method calls', () => {
    expect(run('"hello".length()')).toEqual(num(5));
    expect(run('"hello".upper().substring(0, 2)')).toEqual(text('HE'));
    expect(run('[3, 1, 2].sort().first()')).toEqual(num(1));
  });

  it('reads properties through prop()', () => {
    expect(run('prop("Price") * prop("Qty")')).toEqual(num(50));
    expect(run('prop("Name") + "!"')).toEqual(text('Widget!'));
    expect(run('prop("Done")')).toEqual(bool(true));
  });

  it('reports syntax errors with positions', () => {
    expect(() => parseFormula('1 +')).toThrow(/Unexpected end of formula/);
    expect(() => parseFormula('foo(1')).toThrow(/Expected "\)"/);
    expect(() => parseFormula('1 < 2 < 3')).toThrow(/cannot be chained/);
    expect(() => parseFormula('"unterminated')).toThrow(/Unterminated string/);
    expect(() => parseFormula('')).toThrow(/Formula is empty/);

    try {
      parseFormula('1 +\n  * 2');
      throw new Error('expected a parse error');
    } catch (error) {
      expect(error).toBeInstanceOf(FormulaError);
      expect((error as FormulaError).displayMessage).toBe('Unexpected "*" [2,3]');
    }
  });
});

describe('formula evaluation work limit', () => {
  it.each([
    'xs.every(xs.every(xs.every(true)))',
    'xs.some(xs.some(xs.some(false)))',
    'xs.map(xs.map(xs.map(current)))',
    'xs.filter(xs.every(xs.every(true)))',
    'xs.find(xs.some(xs.some(false)))',
    'xs.findIndex(xs.some(xs.some(false)))',
    'xs.map(index).unique()',
    'xs.map(xs).flat().flat()',
    'xs.map(xs.map(xs)).join(",")',
  ])('bounds aggregate nested list work: %s', (body) => {
    expectError(`let(xs, repeat("x", 2000).split(""), ${body})`, /exceeded the work limit/);
  });

  it('keeps short-circuiting and gives each evaluation a fresh work budget', () => {
    const source = 'let(xs, repeat("x", 1000).split(""), xs.every(xs.every(xs.every(true))))';

    expectError(source, /exceeded the work limit/);
    expect(run('let(xs, repeat("x", 1000).split(""), xs.some(xs.some(xs.some(true))))')).toEqual(bool(true));
    expect(run(`if(false, ${source}, true)`)).toEqual(bool(true));
    expect(run('repeat("x", 1000).split("").map(index).sum()')).toEqual(num(499500));
  });

  it.each([
    'repeat(repeat("x", 10000), 10000)',
    'lets(xs, repeat("x", 10000).split(""), part, repeat("x", 10000), xs.map(part).join(""))',
    'lets(xs, repeat("x", 10000).split(""), part, repeat("x", 10000), format(xs.map(part)))',
    'lets(xs, repeat("x", 10000).split(""), part, repeat("x", 10000), xs.map(part) + "")',
    'replaceAll(repeat("x", 100), "x", repeat("y", 10000))',
    'replace(repeat("x", 10000), "x+", repeat("$&", 100))',
  ])('bounds text growth before allocating the result: %s', (source) => {
    expectError(source, /exceeded the work limit/);
  });

  it('shares regex work across nested list evaluations', () => {
    expect(run('match(repeat("a", 4300), "a").length()')).toEqual(num(4300));
    expectError('let(input, repeat("a", 4300), [1, 2].every(input.match("a").length() == 4300))', /too complex/);
  });
});

describe('formula language: type checking', () => {
  it('infers result types', () => {
    expect(typeOf('1 + 2')).toBe('number');
    expect(typeOf('"a" + "b"')).toBe('text');
    expect(typeOf('1 > 2')).toBe('boolean');
    expect(typeOf('now()')).toBe('date');
    expect(typeOf('[1, 2]')).toBe('list<number>');
    expect(typeOf('split("a,b", ",")')).toBe('list<text>');
    expect(typeOf('[1, 2].map(format(current))')).toBe('list<text>');
    expect(typeOf('prop("Tags").first()')).toBe('text');
    expect(typeOf('if(true, empty(), 3)')).toBe('number');
    expect(typeOf('empty()')).toBe('empty');
    expect(typeOf('let(x, 2, x * 3)')).toBe('number');
  });

  it('rejects mismatched operand and branch types', () => {
    expectError('if(true, 1, "a")', /branches must have the same type/);
    expectError('true ? 1 : "a"', /must have the same type/);
    expectError('"1" == 1', /Cannot compare text with number/);
    expectError('1 ? 2 : 3', /must be a boolean/);
    expectError('upper(1)', /upper\(\) expects text/);
    expectError('dateAdd(now(), "1", "days")', /expects number/);
    expectError('[1, "a"]', /List items must have the same type/);
  });

  it('rejects unknown functions, variables and properties', () => {
    expectError('foo(1)', /Unknown function "foo"/);
    expectError('current', /Unknown variable or function "current"/);
    expectError('prop("Missing")', /Unknown property "Missing"/);
    expectError('if(true, 1)', /if\(\) expects 3 arguments/);
    expectError('ifs(true)', /ifs\(\) expects condition\/value pairs/);
    expectError('let(1, 2, 3)', /expects a variable name/);
  });
});

describe('formula language: functions', () => {
  it.each([
    ['length("😀")', num(1)],
    ['length("A😀B")', num(3)],
    ['length("é")', num(2)],
    ['split("😀", "").length()', num(1)],
    ['split("A😀B", "").join("")', text('A😀B')],
    ['substring("A😀B", 1, 2)', text('😀')],
    ['substring("A😀B", 2, 1)', text('😀')],
    ['substring("A😀B", -1, 2)', text('A😀')],
    ['substring("A😀B", 1.9, 99)', text('😀B')],
    ['substring("A😀B", 9)', text('')],
    ['split("你好😀", "").map(current.length()).sum()', num(3)],
  ])('uses Unicode character indices consistently: %s', (source, expected) => {
    expect(run(source as string)).toEqual(expected);
  });

  it.each([
    ['(1 / 0) + 2', num(2)],
    ['divide(1, 0) + 2', num(2)],
    ['sqrt(-1) + 2', num(2)],
    ['sum([1, 1 / 0, 2])', num(3)],
    ['mean([1, sqrt(-1), 3])', num(2)],
    ['[1, 0, 2].map(1 / current).sum()', num(1.5)],
    ['empty(exp(1000))', bool(true)],
  ])('coerces nonfinite intermediate numbers consistently: %s', (source, expected) => {
    expect(run(source as string)).toEqual(expected);
  });

  it('logic', () => {
    expect(run('if(prop("Done"), "Complete", "Incomplete")')).toEqual(text('Complete'));
    expect(run('ifs(false, "a", true, "b", "c")')).toEqual(text('b'));
    expect(run('ifs(false, "a", false, "b", "c")')).toEqual(text('c'));
    expect(run('empty(0)')).toEqual(bool(true));
    expect(run('empty("")')).toEqual(bool(true));
    expect(run('empty([])')).toEqual(bool(true));
    expect(run('empty(prop("EmptyNumber"))')).toEqual(bool(true));
    expect(run('empty(prop("Price"))')).toEqual(bool(false));
    expect(run('equal(1, 1) and unequal(1, 2)')).toEqual(bool(true));
    expect(run('and(true, true, false)')).toEqual(bool(false));
    expect(run('or(false, true)')).toEqual(bool(true));
  });

  it('variables', () => {
    expect(run('let(tax, prop("Price") * 0.1, prop("Price") + tax)')).toEqual(num(13.75));
    expect(run('lets(a, 1, b, a + 1, a + b)')).toEqual(num(3));
    expect(run('let(x, 2, let(x, 3, x))')).toEqual(num(3));
  });

  it('text', () => {
    expect(run('length("hello")')).toEqual(num(5));
    expect(run('substring("Notion", 0, 3)')).toEqual(text('Not'));
    expect(run('substring("Notion", 3)')).toEqual(text('ion'));
    expect(run('contains("Notion", "ot")')).toEqual(bool(true));
    expect(run('test("Notion", "\\\\d")')).toEqual(bool(false));
    expect(run('match("a1b22", "\\\\d+")')).toEqual(list([text('1'), text('22')]));
    expect(run('replace("a-b-c", "-", "+")')).toEqual(text('a+b-c'));
    expect(run('replaceAll("a-b-c", "-", "")')).toEqual(text('abc'));
    expect(run('lower("HI") + upper("hi")')).toEqual(text('hiHI'));
    expect(run('repeat("*", 3)')).toEqual(text('***'));
    expect(run('trim("  x ")')).toEqual(text('x'));
    expect(run('split("a,b", ",")')).toEqual(list([text('a'), text('b')]));
    expect(run('join(["a", "b"], ", ")')).toEqual(text('a, b'));
    expect(run('format(42) + format(true)')).toEqual(text('42true'));
    expect(run('format(1 / 3)')).toEqual(text('0.333333333333333'));
    expect(run('toNumber("1,234.5")')).toEqual(num(1234.5));
    expect(run('toNumber(true)')).toEqual(num(1));
    expect(run('toNumber("abc")')).toEqual(EMPTY);
    expectError('test("a", "(")', /Invalid regular expression/);
  });

  it('number', () => {
    expect(run('add(1, 2) + subtract(5, 2) + multiply(2, 3) + divide(8, 2) + mod(7, 3) + pow(2, 3)')).toEqual(num(25));
    expect(run('abs(-3) + ceil(1.2) + floor(1.8) + sign(-9)')).toEqual(num(5));
    expect(run('round(3.14159, 2)')).toEqual(num(3.14));
    expect(run('round(1.005, 2)')).toEqual(num(1.01));
    expect(run('round(2.5)')).toEqual(num(3));
    expect(run('round(-2.5)')).toEqual(num(-2));
    expect(run('round(-7.25, 1)')).toEqual(num(-7.2));
    expect(run('sqrt(16) + cbrt(27) + log10(1000) + log2(8)')).toEqual(num(13));
    expect(run('exp(0) + ln(e())')).toEqual(num(2));
    expect(run('min(3, 1, 2) + max([3, 1, 2])')).toEqual(num(4));
    expect(run('sum([1, 2, 3]) + sum(1, 2)')).toEqual(num(9));
    expect(run('mean(1, 2, 3)')).toEqual(num(2));
    expect(run('median([1, 2, 10])')).toEqual(num(2));
    expect(run('median([1, 2, 3, 4])')).toEqual(num(2.5));
    expect(run('min([])')).toEqual(EMPTY);
    expect(run('sum([])')).toEqual(num(0));
    expect(run('round(pi(), 2)')).toEqual(num(3.14));
    expect(run('formatNumber(1234.5, "commas")')).toEqual(text('1,234.5'));
    expect(run('formatNumber(0.25, "percent")')).toEqual(text('25%'));
    expect(run('formatNumber(1500, "usd", 2)')).toEqual(text('$1,500.00'));
    expect(run('formatNumber(1200000, "humanize")')).toEqual(text('1.2M'));
    expectError('formatNumber(1, "bogus")', /Unknown number format/);
  });

  it('treats empty numbers as zero in arithmetic', () => {
    expect(run('prop("EmptyNumber") + 1')).toEqual(num(1));
    expect(run('prop("EmptyNumber") * 5')).toEqual(num(0));
    expect(run('prop("EmptyNumber") == 0')).toEqual(bool(true));
  });

  it('date', () => {
    expect(run('year(prop("Due"))')).toEqual(num(2024));
    expect(run('month(prop("Due"))')).toEqual(num(3));
    expect(run('date(prop("Due"))')).toEqual(num(10));
    expect(run('day(parseDate("2024-01-01"))')).toEqual(num(1)); // Monday
    expect(run('day(parseDate("2024-01-07"))')).toEqual(num(7)); // Sunday
    expect(run('week(parseDate("2024-01-01"))')).toEqual(num(1));
    expect(run('hour(now())')).toEqual(num(10));
    expect(run('minute(now())')).toEqual(num(30));
    expect(run('dateBetween(prop("Due"), today(), "days")')).toEqual(num(9));
    expect(run('dateBetween(today(), prop("Due"), "days")')).toEqual(num(-9));
    expect(run('dateBetween(now(), today(), "hours")')).toEqual(num(10));
    expect(run('formatDate(dateAdd(prop("Due"), 2, "weeks"), "YYYY-MM-DD")')).toEqual(text('2024-03-24'));
    expect(run('formatDate(dateSubtract(prop("Due"), 1, "months"), "YYYY-MM-DD")')).toEqual(text('2024-02-10'));
    expect(run('formatDate(dateAdd(prop("Due"), 1, "quarters"), "YYYY-MM-DD")')).toEqual(text('2024-06-10'));
    expect(run('formatDate(prop("Due"), "MMM D, YYYY")')).toEqual(text('Mar 10, 2024'));
    expect(run('formatDate(prop("Due"), "[Week] W")')).toEqual(text('Week 10'));
    expect(run('formatDate(prop("Due"), "Do")')).toEqual(text('10th'));
    expect(run('timestamp(fromTimestamp(1000))')).toEqual(num(1000));
    expect(run('prop("Due") > now()')).toEqual(bool(true));
    expect(
      run('dateStart(dateRange(parseDate("2024-01-01"), parseDate("2024-01-05"))) == parseDate("2024-01-01")')
    ).toEqual(bool(true));
    expect(run('formatDate(dateEnd(dateRange(parseDate("2024-01-01"), parseDate("2024-01-05"))), "D")')).toEqual(
      text('5')
    );
    expect(run('format(parseDate("2024-03-01"))')).toEqual(text('Mar 1, 2024'));
    expect(run('format(parseDate("2024-03-01T14:05:00"))')).toEqual(text('Mar 1, 2024 2:05 PM'));
    expectError('dateAdd(now(), 1, "fortnights")', /Unknown date unit/);
  });

  it('propagates empty dates instead of failing', () => {
    expect(run('dateAdd(prop("NoDate"), 1, "days")')).toEqual(EMPTY);
    expect(run('dateBetween(prop("NoDate"), now(), "days")')).toEqual(EMPTY);
    expect(run('year(prop("NoDate"))')).toEqual(EMPTY);
    expect(run('if(empty(prop("NoDate")), empty(), dateAdd(prop("NoDate"), 1, "days"))')).toEqual(EMPTY);
    expect(run('prop("NoDate") > now()')).toEqual(bool(false));
  });

  it('list', () => {
    expect(run('[1, 2, 3].at(1)')).toEqual(num(2));
    expect(run('[1, 2, 3].at(-1)')).toEqual(num(3));
    expect(run('[1, 2, 3].at(9)')).toEqual(EMPTY);
    expect(run('first([1, 2, 3]) + last([1, 2, 3])')).toEqual(num(4));
    expect(run('[1, 2, 3].slice(1)')).toEqual(list([num(2), num(3)]));
    expect(run('concat([1], [2, 3])')).toEqual(list([num(1), num(2), num(3)]));
    expect(run('sort([3, 1, 2])')).toEqual(list([num(1), num(2), num(3)]));
    expect(run('sort(["b", "a"])')).toEqual(list([text('a'), text('b')]));
    expect(run('reverse([1, 2])')).toEqual(list([num(2), num(1)]));
    expect(run('unique([1, 1, 2])')).toEqual(list([num(1), num(2)]));
    expect(run('prop("Tags").includes("b")')).toEqual(bool(true));
    expect(run('flat([[1, 2], [3]])')).toEqual(list([num(1), num(2), num(3)]));
    expect(run('[1, 2, 3].map(current * 2)')).toEqual(list([num(2), num(4), num(6)]));
    expect(run('[1, 2, 3].map(index)')).toEqual(list([num(0), num(1), num(2)]));
    expect(run('[1, 2, 3].filter(current > 1)')).toEqual(list([num(2), num(3)]));
    expect(run('[1, 2, 3].find(current > 1)')).toEqual(num(2));
    expect(run('[1, 2, 3].find(current > 5)')).toEqual(EMPTY);
    expect(run('[1, 2, 3].findIndex(current > 1)')).toEqual(num(1));
    expect(run('[1, 2, 3].some(current > 2)')).toEqual(bool(true));
    expect(run('[1, 2, 3].every(current > 2)')).toEqual(bool(false));
    expect(run('prop("Tags").map(current.upper()).join("-")')).toEqual(text('A-B-C'));
    expect(run('prop("Tags").length()')).toEqual(num(3));
    expect(run('[1, 2, 3].map(current * 2).sum()')).toEqual(num(12));
    expect(run('id()')).toEqual(text('row-1'));
    expectError('[1, 2].filter(current + 1)', /expects a condition that returns a boolean/);
  });
});
