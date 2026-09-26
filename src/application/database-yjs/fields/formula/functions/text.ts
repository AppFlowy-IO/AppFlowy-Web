import { RE2JS } from 're2js';

import { asList, asNumber, asText, asTextWithBudget } from '../coerce';
import { FormulaError, SourcePosition } from '../errors';
import { EvalContext, FormulaFunctionSpec, FormulaParam } from '../registry';
import { bool, EMPTY, FormulaValue, list, listOf, num, text } from '../values';

// style() and unstyle(): the text, then any number of Notion style names.
const STYLE_PARAMS: FormulaParam[] = [
  { name: 'text', type: 'text' },
  { name: 'styles', type: 'text', rest: true },
];

const regexCache = new Map<string, RE2JS | string>();

/** RE2 never backtracks. Also bound compilation, input and per-cell work. */
function regexMatcher(value: FormulaValue, pattern: FormulaValue, position: SourcePosition, ctx: EvalContext) {
  const source = asText(pattern);
  const input = asText(value);

  if (source.length > 4096) throw new FormulaError('The regular expression is too long', position);
  if (input.length > 100_000) throw new FormulaError('The regular expression input is too long', position);
  let regex = regexCache.get(source);

  if (!regex) {
    try {
      regex = RE2JS.compile(RE2JS.translateRegExp(source), RE2JS.LOOKBEHINDS);
      if (regex.programSize() > 10_000) regex = 'The regular expression is too complex';
    } catch {
      regex = `Invalid regular expression "${source}" (invalid or unsupported syntax)`;
    }

    // Cache failures too: a bad saved pattern must not be recompiled per row.
    if (regexCache.size >= 32) regexCache.clear();
    regexCache.set(source, regex);
  }

  if (typeof regex === 'string') throw new FormulaError(regex, position);
  const programSize = regex.programSize();

  if (programSize * Math.max(1, input.length) > 2_000_000) {
    throw new FormulaError('The regular expression is too complex', position);
  }

  const matcher = regex.matcher(input);
  let start = 0;

  return {
    matcher,
    find: () => {
      // Each unanchored search can scan the remaining input, even with RE2.
      // Charge every search so global matching cannot become quadratic.
      const work = programSize * Math.max(1, input.length - start);

      ctx.consumeRegexWork(work, position);
      const found = matcher.find();

      if (found) start = matcher.end() + (matcher.start() === matcher.end() ? 1 : 0);
      return found;
    },
  };
}

function replaceRegex(
  value: FormulaValue,
  pattern: FormulaValue,
  replacement: FormulaValue,
  all: boolean,
  position: SourcePosition,
  ctx: EvalContext
): FormulaValue {
  // The engine repeats the searches when applying replacements.
  const regex = regexMatcher(value, pattern, position, ctx);
  const replacementText = asText(replacement);
  const inputLength = asText(value).length;
  let replacementBound = replacementText.length;

  // Each capture/prefix/suffix token can expand to at most the full input.
  // Counting even invalid tokens is a conservative bound without duplicating
  // the engine's replacement semantics.
  for (let index = 0; index + 1 < replacementText.length; index += 1) {
    if (replacementText[index] === '$' && /[&`'1-9<]/.test(replacementText[index + 1])) {
      replacementBound += inputLength;
    }
  }

  ctx.consumeWork(inputLength, position);
  while (regex.find()) {
    ctx.consumeWork(replacementBound, position);
    if (!all) break;
  }

  return text(all ? regex.matcher.replaceAll(replacementText) : regex.matcher.replaceFirst(replacementText));
}

export const textFunctions: FormulaFunctionSpec[] = [
  {
    name: 'length',
    category: 'text',
    signature: 'length(text or list)',
    description: 'Returns the number of Unicode characters in text, or the number of items in a list.',
    examples: [
      { expression: 'length("hello")', result: '5' },
      { expression: '[1, 2, 3].length()', result: '3' },
    ],
    params: [{ name: 'value', type: ['text', listOf('any')] }],
    returnType: 'number',
    impl: ([value]) => num(value.type === 'list' ? value.items.length : Array.from(asText(value)).length),
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
    impl: ([value, start, end], _ctx, _nodes, position) => {
      // Use the same character indices as length() and split("") on desktop.
      const characters = Array.from(asText(value));
      const clamp = (index: number) => Math.max(0, Math.min(characters.length, Math.trunc(index)));
      const from = clamp(asNumber(start, position));
      const to = end === undefined ? characters.length : clamp(asNumber(end, position));

      return text(characters.slice(Math.min(from, to), Math.max(from, to)).join(''));
    },
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
    impl: ([value, pattern], ctx, _nodes, position) => bool(regexMatcher(value, pattern, position, ctx).find()),
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
    impl: ([value, pattern], ctx, _nodes, position) => {
      const regex = regexMatcher(value, pattern, position, ctx);
      const matches: FormulaValue[] = [];

      while (regex.find()) matches.push(text(regex.matcher.group() ?? ''));
      return list(matches);
    },
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
    impl: ([value, pattern, replacement], ctx, _nodes, position) =>
      replaceRegex(value, pattern, replacement, false, position, ctx),
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
    impl: ([value, pattern, replacement], ctx, _nodes, position) =>
      replaceRegex(value, pattern, replacement, true, position, ctx),
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
    impl: ([value, count], ctx, _nodes, position) => {
      const source = asText(value);
      const repetitions = Math.max(0, Math.min(10_000, Math.trunc(asNumber(count, position))));

      ctx.consumeWork(source.length * repetitions, position);
      return text(source.repeat(repetitions));
    },
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
  // Formula cells show plain text, so styles are accepted for Notion
  // compatibility and dropped: the text comes back unchanged.
  {
    name: 'style',
    category: 'text',
    signature: 'style(text, style1, style2, ...)',
    description:
      'Accepts Notion text styles ("b", "i", "u", "s", "c", colors and "_background" colors) so pasted formulas work. Formula results show as plain text, so the styles are not applied.',
    examples: [{ expression: 'style("Done", "b", "green")', result: '"Done"' }],
    params: STYLE_PARAMS,
    returnType: 'text',
    impl: ([value]) => text(asText(value)),
  },
  {
    name: 'unstyle',
    category: 'text',
    signature: 'unstyle(text, style1, style2, ...)',
    description:
      'Accepts Notion text styles to remove so pasted formulas work. Formula results show as plain text, so the text is returned unchanged.',
    examples: [{ expression: 'unstyle("Done", "b")', result: '"Done"' }],
    params: STYLE_PARAMS,
    returnType: 'text',
    impl: ([value]) => text(asText(value)),
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
    impl: ([value, separator], ctx, _nodes, position) => {
      const source = asText(value);

      if (source === '') return list([]);
      const delimiter = asText(separator);
      // Charge output slots before the native split/map allocates them. The
      // input traversal alone does not account for a list of many empty pieces.
      let count = 0;

      if (delimiter === '') {
        for (let index = 0; index < source.length; count += 1) {
          index += source.codePointAt(index)! > 0xffff ? 2 : 1;
        }
      } else {
        count = 1;
        let index = source.indexOf(delimiter);

        while (index !== -1) {
          count += 1;
          index = source.indexOf(delimiter, index + delimiter.length);
        }
      }

      ctx.consumeWork(count, position);

      return list((delimiter === '' ? Array.from(source) : source.split(delimiter)).map((item) => text(item)));
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
    impl: ([value, separator], ctx, _nodes, position) => {
      const parts = asList(value).map((item) => asTextWithBudget(item, (amount) => ctx.consumeWork(amount, position)));
      const delimiter = asText(separator);

      ctx.consumeWork(Math.max(0, parts.length - 1) * delimiter.length, position);
      return text(parts.join(delimiter));
    },
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
    impl: ([value], ctx, _nodes, position) =>
      text(asTextWithBudget(value, (amount) => ctx.consumeWork(amount, position))),
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
