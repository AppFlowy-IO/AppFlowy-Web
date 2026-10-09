/**
 * PostCSS plugin: unwrap `#id :is(X)` when X holds a sibling combinator.
 *
 * Tailwind 3.4 with `important: '#body'` (tailwind.config.cjs) wraps every
 * utility selector in `:is()`, so `space-y-1` becomes
 * `#body :is(.space-y-1 > :not([hidden]) ~ :not([hidden]))`. Blink cannot
 * scope the sibling invalidation of a combinator nested in `:is()`: a child
 * inserted into <body> (Radix focus guards, portals, tooltips) or a row
 * mounted in a grid then restyles the whole page (19,456 of 19,458 elements
 * on a synthetic page, 1 for the same selector without the wrapper).
 *
 * The plugin rewrites `#id :is(X)` to `#id X`, and `#id :is(A, B)` to
 * `#id A, #id B`, when:
 * - the compound before `:is(` is a single id selector;
 * - no entry of X has a descendant combinator (with one, `#id X` would no
 *   longer match when the left part of X sits on an ancestor of #id);
 * - at least one entry of X has a `~` or `+` combinator;
 * - every entry of a list has the same specificity (`:is()` takes the highest
 *   specificity of its entries, a selector list keeps each entry's own);
 * - nothing but an optional pseudo-element follows the `:is()`.
 * Every other selector is left untouched.
 *
 * Specificity is unchanged. Matching is unchanged for entries made of
 * sibling combinators only. With a child combinator, the rewritten selector
 * no longer matches when the compound left of `>` matches the #id element
 * itself (the utility class on <body id="body">), which the app never does.
 */
const PLUGIN_NAME = 'unwrap-sibling-is';

const COMBINATORS = new Set(['>', '+', '~']);
const WHITESPACE = /\s/;
const HEX_DIGIT = /[0-9a-fA-F]/;
const IDENT_CHAR = /[-\w\u00a0-\uffff]/;
/** Pseudo-elements CSS 2 still allows with one colon: they count as elements. */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
/** Pseudo-classes whose specificity is that of their most specific argument. */
const MAX_OF_ARGUMENT = new Set(['is', 'not', 'has', 'matches']);

/** Index of the last character of the escape that starts at `index` (a backslash). */
function escapeEnd(text, index) {
  let cursor = index + 1;

  if (cursor >= text.length) return index;
  if (!HEX_DIGIT.test(text[cursor])) return cursor;
  const limit = Math.min(text.length, cursor + 6);

  while (cursor < limit && HEX_DIGIT.test(text[cursor])) cursor += 1;
  // One whitespace character ends a hex escape and belongs to it.
  if (cursor < text.length && WHITESPACE.test(text[cursor])) return cursor;
  return cursor - 1;
}

/**
 * Calls `visit(char, index)` for every character at the top level: outside
 * parentheses, brackets and strings. An opening `(` or `[` at the top level
 * is visited (it starts or continues a compound), its content is not; an
 * escape is visited once, as a backslash. Returns false when the text is
 * unbalanced.
 */
function scanTopLevel(text, visit) {
  let depth = 0;
  let quote = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '\\') {
      if (depth === 0 && quote === null) visit(char, index);
      index = escapeEnd(text, index);
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      if (depth === 0) visit(char, index);
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth -= 1;
      if (depth < 0) return false;
    } else if (depth === 0) {
      visit(char, index);
    }
  }

  return depth === 0 && quote === null;
}

/** Splits at top-level commas; null when the text is unbalanced. */
function splitList(text) {
  const parts = [];
  let start = 0;
  const balanced = scanTopLevel(text, (char, index) => {
    if (char !== ',') return;
    parts.push(text.slice(start, index));
    start = index + 1;
  });

  if (!balanced) return null;
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

/** Index of the parenthesis that closes the one at `open`, or -1. */
function closingParen(text, open) {
  let depth = 0;
  let quote = null;

  for (let index = open; index < text.length; index += 1) {
    const char = text[index];

    if (char === '\\') {
      index = escapeEnd(text, index);
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth -= 1;
      if (depth === 0) return char === ')' ? index : -1;
    }
  }

  return -1;
}

/** End index (exclusive) of the identifier that starts at `index`. */
function identEnd(text, index) {
  let cursor = index;

  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor = escapeEnd(text, cursor) + 1;
    } else if (IDENT_CHAR.test(text[cursor])) {
      cursor += 1;
    } else {
      break;
    }
  }

  return cursor;
}

/**
 * The top-level combinators of a complex selector: whether it has a sibling
 * (`~`, `+`) and a descendant (whitespace) combinator. Null when the selector
 * is unbalanced or starts or ends with a combinator.
 */
function combinatorsOf(selector) {
  const result = { sibling: false, descendant: false };
  let previous = 'start';
  let pendingSpace = false;
  const balanced = scanTopLevel(selector, (char) => {
    if (WHITESPACE.test(char)) {
      pendingSpace = previous === 'compound';
      return;
    }

    if (COMBINATORS.has(char)) {
      if (previous !== 'compound') previous = 'invalid';
      else previous = 'combinator';
      if (char !== '>') result.sibling = true;
      pendingSpace = false;
      return;
    }

    if (pendingSpace) result.descendant = true;
    pendingSpace = false;
    if (previous !== 'invalid') previous = 'compound';
  });

  if (!balanced || previous !== 'compound') return null;
  return result;
}

/** Adds two specificities. */
function add(left, right) {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function compare(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/**
 * Specificity [ids, classes, types] of a complex selector, or null for a
 * shape this plugin does not need to understand (namespaces, nesting,
 * `:nth-child(... of S)`).
 */
function specificityOf(selector) {
  let total = [0, 0, 0];
  let index = 0;

  while (index < selector.length) {
    const char = selector[index];

    if (WHITESPACE.test(char) || COMBINATORS.has(char) || char === '*') {
      index += 1;
    } else if (char === '#') {
      total = add(total, [1, 0, 0]);
      index = identEnd(selector, index + 1);
    } else if (char === '.') {
      total = add(total, [0, 1, 0]);
      index = identEnd(selector, index + 1);
    } else if (char === '[') {
      let close = index + 1;
      let quote = null;

      // The matching bracket, honouring strings and escapes.
      for (; close < selector.length; close += 1) {
        const inner = selector[close];

        if (inner === '\\') {
          close = escapeEnd(selector, close);
        } else if (quote) {
          if (inner === quote) quote = null;
        } else if (inner === '"' || inner === "'") {
          quote = inner;
        } else if (inner === ']') {
          break;
        }
      }

      if (close >= selector.length) return null;
      total = add(total, [0, 1, 0]);
      index = close + 1;
    } else if (char === ':') {
      const element = selector[index + 1] === ':';
      const nameStart = index + (element ? 2 : 1);
      const nameEnd = identEnd(selector, nameStart);
      const name = selector.slice(nameStart, nameEnd).toLowerCase();
      let next = nameEnd;
      let argument = null;

      if (!name) return null;
      if (selector[nameEnd] === '(') {
        const close = closingParen(selector, nameEnd);

        if (close < 0) return null;
        argument = selector.slice(nameEnd + 1, close);
        next = close + 1;
      }

      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        total = add(total, [0, 0, 1]);
      } else if (name === 'where') {
        // Zero specificity.
      } else if (MAX_OF_ARGUMENT.has(name)) {
        const entries = argument === null ? null : splitList(argument);

        if (!entries) return null;
        let highest = [0, 0, 0];

        for (const entry of entries) {
          const value = specificityOf(entry);

          if (!value) return null;
          if (compare(value, highest) > 0) highest = value;
        }

        total = add(total, highest);
      } else if ((name === 'nth-child' || name === 'nth-last-child') && /\sof\s/i.test(argument ?? '')) {
        return null;
      } else {
        total = add(total, [0, 1, 0]);
      }

      index = next;
    } else if (IDENT_CHAR.test(char) || char === '\\') {
      total = add(total, [0, 0, 1]);
      index = identEnd(selector, index);
    } else {
      // `|` (namespaces), `&` (nesting) and anything else.
      return null;
    }
  }

  return total;
}

/**
 * The rewritten selectors for one complex selector, or null to keep it.
 * `#body :is(.a > b ~ c)` becomes [`#body .a > b ~ c`].
 */
function unwrapSelector(selector) {
  const text = selector.trim();

  if (text[0] !== '#') return null;
  const idEnd = identEnd(text, 1);

  if (idEnd === 1 || idEnd >= text.length || !WHITESPACE.test(text[idEnd])) return null;
  let cursor = idEnd;

  while (cursor < text.length && WHITESPACE.test(text[cursor])) cursor += 1;
  if (text.slice(cursor, cursor + 4).toLowerCase() !== ':is(') return null;
  const open = cursor + 3;
  const close = closingParen(text, open);

  if (close < 0) return null;
  const suffix = text.slice(close + 1);

  // Tailwind moves pseudo-elements out of the `:is()`; nothing else may follow.
  if (suffix && !/^::[-a-zA-Z]+$/.test(suffix)) return null;
  const entries = splitList(text.slice(open + 1, close));

  if (!entries || entries.some((entry) => !entry)) return null;
  const shapes = entries.map(combinatorsOf);

  if (shapes.some((shape) => !shape || shape.descendant)) return null;
  if (!shapes.some((shape) => shape.sibling)) return null;
  if (entries.length > 1) {
    const values = entries.map(specificityOf);

    if (values.some((value) => !value || compare(value, values[0]) !== 0)) return null;
  }

  const id = text.slice(0, idEnd);

  return entries.map((entry) => `${id} ${entry}${suffix}`);
}

/** Rewrites one rule's selector list; returns whether it changed. */
function unwrapRule(rule) {
  const selectors = splitList(rule.selector);

  if (!selectors) return false;
  let changed = false;
  const next = [];

  for (const selector of selectors) {
    const unwrapped = unwrapSelector(selector);

    if (unwrapped) {
      changed = true;
      next.push(...unwrapped);
    } else {
      next.push(selector);
    }
  }

  if (changed) rule.selectors = next;
  return changed;
}

/** @type {import('postcss').PluginCreator<void>} */
const unwrapSiblingIs = () => ({
  postcssPlugin: PLUGIN_NAME,
  OnceExit(root) {
    root.walkRules((rule) => {
      const parent = rule.parent;

      // Keyframe selectors (`0%`, `from`) are not element selectors.
      if (parent && parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
      unwrapRule(rule);
    });
  },
});

unwrapSiblingIs.postcss = true;

module.exports = unwrapSiblingIs;
module.exports.unwrapSelector = unwrapSelector;
module.exports.specificityOf = specificityOf;
module.exports.splitList = splitList;
