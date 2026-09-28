import { FORMULA_BUILTINS, FORMULA_FUNCTIONS, Token, tokenize } from '@/application/database-yjs/fields/formula';

/**
 * Pasted formulas often come from somewhere that is not our editor: a chat or
 * a doc that curled the quotes, or a spreadsheet-style formula that names its
 * properties bare (`Impact * Confidence`). This rewrites both into
 * `prop("Name")` calls so they paste as property tokens. Strings, comments and
 * explicit syntax are left as written.
 */

// Words the language already owns; a property with one of these names stays
// ambiguous bare, so it is only reachable through prop("...").
const RESERVED = new Set<string>([
  'prop',
  'true',
  'false',
  'and',
  'or',
  'not',
  ...FORMULA_FUNCTIONS.map((spec) => spec.name),
  ...FORMULA_BUILTINS.map((spec) => spec.name),
]);

const WORD_CHAR = /[\p{L}\p{N}_]/u;
// A bare name needs a letter or an underscore; `2024`, `%` or `&&` read as a
// number or an operator.
const NAME_CHAR = /[\p{L}_]/u;
// A whole number as the lexer reads one: `1e3` has a letter but is a number.
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const CURLY_PROP = /prop\(\s*[“”‘’]([^“”‘’\n]*)[“”‘’]\s*\)/y;
const CALL_AHEAD = /^\s*\(/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface Literal {
  end: number;
  closed: boolean;
}

/**
 * The string literal, curly-quoted text or block comment starting at `index`:
 * where it ends and whether it is closed; null when none starts there.
 * Strings follow the lexer, which lets them span lines.
 */
function literalAt(text: string, index: number): Literal | null {
  const ch = text[index];

  if (ch === '"' || ch === "'") {
    let end = index + 1;

    while (end < text.length && text[end] !== ch) end += text[end] === '\\' ? 2 : 1;
    return end < text.length ? { end: end + 1, closed: true } : { end: text.length, closed: false };
  }

  // Curly quotes that were not a prop() argument still read as quoted text,
  // up to the end of the line.
  if (ch === '“' || ch === '‘') {
    const close = text.indexOf(ch === '“' ? '”' : '’', index + 1);
    const lineEnd = text.indexOf('\n', index + 1);

    if (close !== -1 && (lineEnd === -1 || close < lineEnd)) return { end: close + 1, closed: true };
    return { end: lineEnd === -1 ? text.length : lineEnd, closed: false };
  }

  if (ch === '/' && text[index + 1] === '*') {
    const close = text.indexOf('*/', index + 2);

    return close === -1 ? { end: text.length, closed: false } : { end: close + 2, closed: true };
  }

  return null;
}

/**
 * The opening of the string literal, curly-quoted text or block comment that
 * `offset` in `source` sits inside (`"`, `'`, `“`, `‘` or `/*`), or '' when it
 * is in code. Text pasted there is not rewritten.
 */
export function formulaLiteralOpenerAt(source: string, offset: number): string {
  let index = 0;

  while (index < offset && index < source.length) {
    const literal = literalAt(source, index);

    if (!literal) {
      index += 1;
      continue;
    }

    const opener = source.startsWith('/*', index) ? '/*' : source[index];

    // Between the "/" and "*" of an opener is still code.
    if (offset < index + opener.length) return '';
    if (literal.end > offset || (!literal.closed && literal.end === offset)) return opener;
    index = literal.end;
  }

  return '';
}

/**
 * The context a paste after `before` is read in (see {@link
 * PastedFormulaOptions.context}): the opening of the literal it lands in, with
 * a backslash that escapes the first pasted character inside a string; in
 * code, the character before it when that changes how the paste starts (a
 * word it continues, a dot before a related row's property, or a "/" that a
 * pasted "*" makes a comment).
 */
export function formulaPasteContext(before: string): string {
  const opener = formulaLiteralOpenerAt(before, before.length);

  if (opener === '"' || opener === "'") {
    const backslashes = before.length - before.replace(/\\+$/, '').length;

    return backslashes % 2 === 1 ? `${opener}\\` : opener;
  }

  if (opener !== '') return opener;
  const last = before[before.length - 1];

  return isWordChar(last) || last === '.' || last === '/' ? last : '';
}

/**
 * Variable names bound by `let(name, value, body)` and
 * `lets(name1, value1, ..., body)`; those are variables, not properties.
 */
export function formulaBoundVariables(text: string): Set<string> {
  const bound = new Set<string>();
  let tokens: Token[];

  try {
    tokens = tokenize(text, true);
  } catch {
    return bound;
  }

  tokens.forEach((token, index) => {
    const open = tokens[index + 1];

    if (token.kind !== 'ident' || (token.value !== 'let' && token.value !== 'lets')) return;
    if (open?.kind !== 'punct' || open.value !== '(') return;
    // Split the call's arguments at its own top-level commas.
    const args: Token[][] = [[]];
    let depth = 0;

    for (const next of tokens.slice(index + 2)) {
      if (next.kind === 'punct' && (next.value === '(' || next.value === '[')) depth += 1;
      if (next.kind === 'punct' && (next.value === ')' || next.value === ']')) {
        if (depth === 0) break;
        depth -= 1;
      }

      if (depth === 0 && next.kind === 'punct' && next.value === ',') args.push([]);
      else args[args.length - 1].push(next);
    }

    // Names sit at the even positions before the body (the last argument).
    args.slice(0, -1).forEach((arg, position) => {
      if (position % 2 === 0 && arg.length === 1 && arg[0].kind === 'ident') bound.add(arg[0].value);
    });
  });

  return bound;
}

interface Span {
  start: number;
  end: number;
}

/**
 * Explicit syntax a bare name must not swallow: every `prop(...)` call,
 * complete or not (`prop(`, `prop("Pri`), and every call of a name the
 * language owns (`now(`, `round(`), from the name through its "(".
 */
function explicitCallSpans(source: string): Span[] {
  let tokens: Token[];

  try {
    tokens = tokenize(source, true);
  } catch {
    return [];
  }

  const isPunct = (token: Token | undefined, value: string) => token?.kind === 'punct' && token.value === value;
  const spans: Span[] = [];

  tokens.forEach((token, index) => {
    if (token.kind !== 'ident' || !RESERVED.has(token.value) || !isPunct(tokens[index + 1], '(')) return;
    let end = tokens[index + 1].end;
    const argument = tokens[index + 2];

    if (token.value === 'prop' && argument?.kind === 'string') {
      end = isPunct(tokens[index + 3], ')') ? tokens[index + 3].end : argument.end;
    }

    spans.push({ start: token.position.offset, end });
  });

  return spans;
}

export interface PastedFormulaOptions {
  /**
   * The opening of the literal the paste lands in (see
   * {@link formulaLiteralOpenerAt}); text up to where it closes stays as it
   * is, and a paste that closes it reads what follows as code.
   */
  context?: string;
  /** More words that are not properties, e.g. variables a let() around the paste binds. */
  reservedWords?: Iterable<string>;
}

/**
 * Bare property names → `prop("Name")` and `prop(“Name”)` → `prop("Name")`.
 * The longest name wins; strings, comments and explicit calls are untouched,
 * and a name that could mean something else (a shared, reserved or letterless
 * name, or a variable) is left for the user to resolve.
 */
export function normalizePastedFormula(
  text: string,
  propertyNames: string[],
  { context = '', reservedWords = [] }: PastedFormulaOptions = {}
): string {
  const source = `${context}${text}`;
  const reserved = new Set([...RESERVED, ...reservedWords, ...formulaBoundVariables(source)]);
  const counts = new Map<string, number>();

  propertyNames.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
  // A name shared by several properties could mean any of them; leave it for the user to pick.
  const candidates = [...counts.keys()]
    .filter(
      (name) =>
        counts.get(name) === 1 &&
        name.trim() === name &&
        NAME_CHAR.test(name) &&
        !NUMBER.test(name) &&
        !reserved.has(name)
    )
    .sort((a, b) => b.length - a.length);
  const calls = candidates.length > 0 ? explicitCallSpans(source) : [];
  const overlapsCall = (start: number, end: number) => calls.some((call) => start < call.end && call.start < end);
  let out = '';
  let index = 0;

  while (index < source.length) {
    const literal = literalAt(source, index);

    if (literal) {
      out += source.slice(index, literal.end);
      index = literal.end;
      continue;
    }

    const previous = source[index - 1];

    if (isWordChar(previous)) {
      out += source[index];
      index += 1;
      continue;
    }

    // Straight quotes for prop(“Name”), also a related row's `.prop(“Name”)`.
    CURLY_PROP.lastIndex = index;
    const curly = source.startsWith('prop(', index) ? CURLY_PROP.exec(source) : null;

    if (curly) {
      out += `prop(${quote(curly[1])})`;
      index += curly[0].length;
      continue;
    }

    // After a dot a name is a method or a related row's property.
    const name =
      previous === '.'
        ? undefined
        : candidates.find(
            (candidate) =>
              source.startsWith(candidate, index) &&
              !isWordChar(source[index + candidate.length]) &&
              !overlapsCall(index, index + candidate.length)
          );

    // A name followed by "(" is a call, not a property.
    if (name && !CALL_AHEAD.test(source.slice(index + name.length))) {
      out += `prop(${quote(name)})`;
      index += name.length;
      continue;
    }

    out += source[index];
    index += 1;
  }

  // The context was copied as the start of its literal.
  return out.slice(context.length);
}
