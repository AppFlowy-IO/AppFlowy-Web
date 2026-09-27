import { FORMULA_BUILTINS, FORMULA_FUNCTIONS, Token, tokenize } from '@/application/database-yjs/fields/formula';

/**
 * Pasted formulas often come from somewhere that is not our editor: a chat or
 * a doc that curled the quotes, or a spreadsheet-style formula that names its
 * properties bare (`Impact * Confidence`). This rewrites both into
 * `prop("Name")` calls so they paste as property tokens.
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

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `prop(“Name”)` / `prop(‘Name’)` → `prop("Name")`. Curly quotes elsewhere are left alone. */
function straightenPropQuotes(text: string): string {
  return text.replace(/\bprop\(\s*[“”‘’]([^“”‘’\n]*)[“”‘’]\s*\)/g, (_, name: string) => `prop(${quote(name)})`);
}

/** End of the string literal, curly-quoted text or block comment starting at `index`, or -1 when none starts there. */
function skipLiteral(text: string, index: number): number {
  const ch = text[index];

  if (ch === '"' || ch === "'") {
    let end = index + 1;

    while (end < text.length && text[end] !== ch && text[end] !== '\n') {
      end += text[end] === '\\' ? 2 : 1;
    }

    return Math.min(end + 1, text.length);
  }

  // Curly quotes that were not a prop() argument still read as quoted text.
  if (ch === '“' || ch === '‘') {
    const closeMark = ch === '“' ? '”' : '’';
    let end = index + 1;

    while (end < text.length && text[end] !== closeMark && text[end] !== '\n') end += 1;
    return Math.min(end + 1, text.length);
  }

  if (ch === '/' && text[index + 1] === '*') {
    const close = text.indexOf('*/', index + 2);

    return close === -1 ? text.length : close + 2;
  }

  return -1;
}

/**
 * Variable names bound by `let(name, value, body)` and
 * `lets(name1, value1, ..., body)`; those are variables, not properties.
 */
function boundVariables(text: string): Set<string> {
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

/** Bare property names → `prop("Name")`; longest name wins, strings and comments untouched. */
function wrapBareNames(text: string, names: string[]): string {
  const counts = new Map<string, number>();
  const variables = boundVariables(text);

  names.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
  // A name shared by several properties could mean any of them; leave it for the user to pick.
  const candidates = [...counts.keys()]
    .filter(
      (name) =>
        counts.get(name) === 1 && name.trim() === name && name !== '' && !RESERVED.has(name) && !variables.has(name)
    )
    .sort((a, b) => b.length - a.length);

  if (candidates.length === 0) return text;
  let out = '';
  let index = 0;

  while (index < text.length) {
    const literalEnd = skipLiteral(text, index);

    if (literalEnd !== -1) {
      out += text.slice(index, literalEnd);
      index = literalEnd;
      continue;
    }

    const previous = text[index - 1];
    const atBoundary = !isWordChar(previous) && previous !== '.';
    const name = atBoundary
      ? candidates.find((candidate) => text.startsWith(candidate, index) && !isWordChar(text[index + candidate.length]))
      : undefined;

    // A name followed by "(" is a call, not a property.
    if (name && !/^\s*\(/.test(text.slice(index + name.length))) {
      out += `prop(${quote(name)})`;
      index += name.length;
      continue;
    }

    out += text[index];
    index += 1;
  }

  return out;
}

export function normalizePastedFormula(text: string, propertyNames: string[]): string {
  return wrapBareNames(straightenPropQuotes(text), propertyNames);
}
