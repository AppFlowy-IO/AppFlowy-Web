import { FORMULA_BUILTINS, FORMULA_FUNCTIONS } from '@/application/database-yjs/fields/formula';

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

/** End of the string literal or block comment starting at `index`, or -1 when none starts there. */
function skipLiteral(text: string, index: number): number {
  const ch = text[index];

  if (ch === '"' || ch === "'") {
    let end = index + 1;

    while (end < text.length && text[end] !== ch && text[end] !== '\n') {
      end += text[end] === '\\' ? 2 : 1;
    }

    return Math.min(end + 1, text.length);
  }

  if (ch === '/' && text[index + 1] === '*') {
    const close = text.indexOf('*/', index + 2);

    return close === -1 ? text.length : close + 2;
  }

  return -1;
}

/** Bare property names → `prop("Name")`; longest name wins, strings and comments untouched. */
function wrapBareNames(text: string, names: string[]): string {
  const counts = new Map<string, number>();

  names.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
  // A name shared by several properties could mean any of them; leave it for the user to pick.
  const candidates = [...counts.keys()]
    .filter((name) => counts.get(name) === 1 && name.trim() === name && name !== '' && !RESERVED.has(name))
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
