/**
 * PostCSS plugin: scope `X:hover *::-webkit-scrollbar-thumb` to scroll
 * containers.
 *
 * A universal subject under :hover makes Blink invalidate the whole subtree
 * of every element whose hover state some rule tests (Tailwind `group`
 * rows, widgets, cards), not only of `X`: one such rule anywhere in the
 * loaded CSS makes every hover change restyle the hovered subtree. The app's
 * own scrollers (src/styles/mixin.scss `hover-thumb`) no longer emit it; the
 * `@appflowyinc/editor` stylesheet still does, for `.appflowy-scrollbar`.
 *
 * `X:hover *::-webkit-scrollbar-<part>` (or `X:hover ::-webkit-scrollbar-<part>`)
 * becomes the two selectors of the `hover-thumb` mixin:
 * - `X:hover :where(<NESTED_SCROLLERS>)::-webkit-scrollbar-<part>`: the listed
 *   scroll containers inside a hovered X keep X's colour, as before;
 * - `X *:hover::-webkit-scrollbar-<part>`: Blink reads a :hover in the
 *   compound of a scrollbar pseudo-element as the hover of that scrollbar
 *   part, so a hovered thumb of any scroll container inside X keeps X's colour.
 * Both match a subset of the elements the original matched, with the same
 * specificity. Every other selector is left untouched.
 */
const { splitList } = require('./unwrap-sibling-is.cjs');

const PLUGIN_NAME = 'scope-scrollbar-hover';

/** Keep in sync with `$nested-scrollers` in src/styles/mixin.scss. */
const NESTED_SCROLLERS = [
  '.overflow-auto',
  '.overflow-scroll',
  '.overflow-x-auto',
  '.overflow-x-scroll',
  '.overflow-y-auto',
  '.overflow-y-scroll',
  '.appflowy-scroller',
  '.appflowy-scrollbar',
  '.appflowy-custom-scroller',
  '.simple-table-scroll-container',
];

/** `<prefix>:hover *::-webkit-scrollbar-<part>`: the prefix ends with a compound. */
const UNIVERSAL_THUMB = /^(.*[^\s>+~(]):hover\s+\*?(::-webkit-scrollbar(?:-[a-z]+(?:-[a-z]+)*)?)$/i;

/** The replacement selectors for one complex selector, or null to keep it. */
function scopeSelector(selector) {
  const match = UNIVERSAL_THUMB.exec(selector.trim());

  if (!match) return null;
  const [, prefix, pseudoElement] = match;

  // An escaped character right before `:hover` belongs to the prefix's last
  // identifier only when the backslash itself is not escaped; `\:hover` is
  // part of a class name, not a pseudo-class.
  const backslashes = /\\*$/.exec(prefix)[0].length;

  if (backslashes % 2 === 1) return null;
  return [`${prefix}:hover :where(${NESTED_SCROLLERS.join(', ')})${pseudoElement}`, `${prefix} *:hover${pseudoElement}`];
}

/** @type {import('postcss').PluginCreator<void>} */
const scopeScrollbarHover = () => ({
  postcssPlugin: PLUGIN_NAME,
  OnceExit(root) {
    root.walkRules((rule) => {
      if (!rule.selector.includes(':hover')) return;
      const selectors = splitList(rule.selector);

      if (!selectors) return;
      let changed = false;
      const next = [];

      for (const selector of selectors) {
        const scoped = scopeSelector(selector);

        if (scoped) {
          changed = true;
          next.push(...scoped);
        } else {
          next.push(selector);
        }
      }

      if (changed) rule.selectors = next;
    });
  },
});

scopeScrollbarHover.postcss = true;

module.exports = scopeScrollbarHover;
module.exports.NESTED_SCROLLERS = NESTED_SCROLLERS;
module.exports.scopeSelector = scopeSelector;
