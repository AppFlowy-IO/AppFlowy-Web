import { asList, asNumber, asText } from '../coerce';
import { FormulaError, SourcePosition } from '../errors';
import { FormulaFunctionSpec } from '../registry';
import { bool, EMPTY, FormulaValue, list, listOf, num, text } from '../values';

function compileRegex(pattern: FormulaValue, flags: string, position: SourcePosition): RegExp {
  try {
    return new RegExp(asText(pattern), flags);
  } catch {
    throw new FormulaError(`Invalid regular expression "${asText(pattern)}"`, position);
  }
}

export const textFunctions: FormulaFunctionSpec[] = [
  {
    name: 'length',
    category: 'text',
    signature: 'length(text or list)',
    description: 'Returns the number of characters in a text value, or the number of items in a list.',
    examples: [
      { expression: 'length("hello")', result: '5' },
      { expression: '[1, 2, 3].length()', result: '3' },
    ],
    params: [{ name: 'value', type: ['text', listOf('any')] }],
    returnType: 'number',
    impl: ([value]) => num(value.type === 'list' ? value.items.length : asText(value).length),
  },
  {
    name: 'substring',
    category: 'text',
    signature: 'substring(text, startIndex, endIndex?)',
    description:
      'Returns the part of the text from the start index (inclusive) to the end index (optional and exclusive).',
    examples: [
      { expression: 'substring("Notion", 0, 3)', result: '"Not"' },
      { expression: 'substring("Notion", 3)', result: '"ion"' },
    ],
    params: [
      { name: 'text', type: 'text' },
      { name: 'startIndex', type: 'number' },
      { name: 'endIndex', type: 'number', optional: true },
    ],
    returnType: 'text',
    impl: ([value, start, end], _ctx, _nodes, position) =>
      text(
        asText(value).substring(
          Math.max(0, Math.trunc(asNumber(start, position))),
          end === undefined ? undefined : Math.max(0, Math.trunc(asNumber(end, position)))
        )
      ),
  },
  {
    name: 'contains',
    category: 'text',
    signature: 'contains(text, search)',
    description: 'Returns true if the search text is present in the value.',
    examples: [{ expression: 'contains("Notion", "ot")', result: 'true' }],
    params: [
      { name: 'text', type: 'text' },
      { name: 'search', type: 'text' },
    ],
    returnType: 'boolean',
    impl: ([value, search]) => bool(asText(value).includes(asText(search))),
  },
  {
    name: 'test',
    category: 'text',
    signature: 'test(text, regex)',
    description: 'Returns true if the text matches the regular expression.',
    examples: [
      { expression: 'test("Notion", "Not")', result: 'true' },
      { expression: 'test("Notion", "\\\\d")', result: 'false' },
    ],
    params: [
      { name: 'text', type: 'text' },
      { name: 'regex', type: 'text' },
    ],
    returnType: 'boolean',
    impl: ([value, pattern], _ctx, _nodes, position) => bool(compileRegex(pattern, '', position).test(asText(value))),
  },
  {
    name: 'match',
    category: 'text',
    signature: 'match(text, regex)',
    description: 'Returns every match of the regular expression as a list of text.',
    examples: [{ expression: 'match("a1b22", "\\\\d+")', result: '["1", "22"]' }],
    params: [
      { name: 'text', type: 'text' },
      { name: 'regex', type: 'text' },
    ],
    returnType: listOf('text'),
    impl: ([value, pattern], _ctx, _nodes, position) =>
      list((asText(value).match(compileRegex(pattern, 'g', position)) ?? []).map((item) => text(item))),
  },
  {
    name: 'replace',
    category: 'text',
    signature: 'replace(text, regex, replacement)',
    description: 'Replaces the first match of the regular expression with the replacement text.',
    examples: [{ expression: 'replace("a-b-c", "-", "+")', result: '"a+b-c"' }],
    params: [
      { name: 'text', type: 'text' },
      { name: 'regex', type: 'text' },
      { name: 'replacement', type: 'text' },
    ],
    returnType: 'text',
    impl: ([value, pattern, replacement], _ctx, _nodes, position) =>
      text(asText(value).replace(compileRegex(pattern, '', position), asText(replacement))),
  },
  {
    name: 'replaceAll',
    category: 'text',
    signature: 'replaceAll(text, regex, replacement)',
    description: 'Replaces every match of the regular expression with the replacement text.',
    examples: [{ expression: 'replaceAll("a-b-c", "-", "")', result: '"abc"' }],
    params: [
      { name: 'text', type: 'text' },
      { name: 'regex', type: 'text' },
      { name: 'replacement', type: 'text' },
    ],
    returnType: 'text',
    impl: ([value, pattern, replacement], _ctx, _nodes, position) =>
      text(asText(value).replace(compileRegex(pattern, 'g', position), asText(replacement))),
  },
  {
    name: 'lower',
    category: 'text',
    signature: 'lower(text)',
    description: 'Converts the text to lowercase.',
    examples: [{ expression: 'lower("HELLO")', result: '"hello"' }],
    params: [{ name: 'text', type: 'text' }],
    returnType: 'text',
    impl: ([value]) => text(asText(value).toLowerCase()),
  },
  {
    name: 'upper',
    category: 'text',
    signature: 'upper(text)',
    description: 'Converts the text to uppercase.',
    examples: [{ expression: 'upper("hello")', result: '"HELLO"' }],
    params: [{ name: 'text', type: 'text' }],
    returnType: 'text',
    impl: ([value]) => text(asText(value).toUpperCase()),
  },
  {
    name: 'repeat',
    category: 'text',
    signature: 'repeat(text, count)',
    description: 'Repeats the text the given number of times.',
    examples: [{ expression: 'repeat("*", 3)', result: '"***"' }],
    params: [
      { name: 'text', type: 'text' },
      { name: 'count', type: 'number' },
    ],
    returnType: 'text',
    impl: ([value, count], _ctx, _nodes, position) =>
      text(asText(value).repeat(Math.max(0, Math.min(10_000, Math.trunc(asNumber(count, position)))))),
  },
  {
    name: 'trim',
    category: 'text',
    signature: 'trim(text)',
    description: 'Removes whitespace from the beginning and end of the text.',
    examples: [{ expression: 'trim("  hi  ")', result: '"hi"' }],
    params: [{ name: 'text', type: 'text' }],
    returnType: 'text',
    impl: ([value]) => text(asText(value).trim()),
  },
  {
    name: 'split',
    category: 'text',
    signature: 'split(text, separator)',
    description: 'Splits the text into a list at every occurrence of the separator.',
    examples: [{ expression: 'split("a,b,c", ",")', result: '["a", "b", "c"]' }],
    params: [
      { name: 'text', type: 'text' },
      { name: 'separator', type: 'text' },
    ],
    returnType: listOf('text'),
    impl: ([value, separator]) => {
      const source = asText(value);

      if (source === '') return list([]);
      return list(source.split(asText(separator)).map((item) => text(item)));
    },
  },
  {
    name: 'join',
    category: 'text',
    signature: 'join(list, separator)',
    description: 'Joins the items of a list into one text value, placing the separator between items.',
    examples: [{ expression: 'join(["a", "b"], ", ")', result: '"a, b"' }],
    params: [
      { name: 'list', type: listOf('any') },
      { name: 'separator', type: 'text' },
    ],
    returnType: 'text',
    impl: ([value, separator]) => text(asList(value).map(asText).join(asText(separator))),
  },
  {
    name: 'format',
    category: 'text',
    signature: 'format(value)',
    description: 'Converts any value to text.',
    examples: [
      { expression: 'format(42)', result: '"42"' },
      { expression: 'format(true)', result: '"true"' },
    ],
    params: [{ name: 'value', type: 'any' }],
    returnType: 'text',
    impl: ([value]) => text(asText(value)),
  },
  {
    name: 'toNumber',
    category: 'text',
    signature: 'toNumber(value)',
    description: 'Parses a number from text. Dates become their timestamp in milliseconds; true becomes 1.',
    examples: [
      { expression: 'toNumber("42")', result: '42' },
      { expression: 'toNumber(true)', result: '1' },
    ],
    params: [{ name: 'value', type: 'any' }],
    returnType: 'number',
    impl: ([value]) => {
      switch (value.type) {
        case 'number':
          return value;
        case 'boolean':
          return num(value.value ? 1 : 0);
        case 'date':
          return num(value.value.start);
        case 'text': {
          const cleaned = value.value.replace(/,/g, '').trim();
          const parsed = Number(cleaned);

          return cleaned === '' || !Number.isFinite(parsed) ? EMPTY : num(parsed);
        }

        default:
          return EMPTY;
      }
    },
  },
];
