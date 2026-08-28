import { BaseRange, Editor, Path, Text } from 'slate';

/** Escape regex metacharacters so the user's query is matched literally. */
const REGEX_META = /[.*+?^${}()|[\]\\]/g;
const escapeRegex = (s: string) => s.replace(REGEX_META, '\\$&');

/**
 * Find all occurrences of `query` within the editor's text leaves.
 *
 * Matching is performed per text node (leaf). A phrase that is split across
 * mark boundaries (e.g. a word that is partially bold) lives in multiple
 * Slate text nodes and therefore is not matched as a single hit — this mirrors
 * the common "find text on page" behaviour while keeping decoration lookups
 * O(1) per node.
 *
 * Returned ranges are in document order. Each range is fully contained within
 * a single text node, so `anchor.path` equals `focus.path`.
 *
 * Uses a regex with the `iu` flag for case-insensitive search rather than
 * lowercasing both sides: `String.prototype.toLowerCase()` can change a
 * string's length (e.g. Turkish `İ` → `i̇`), which would produce Slate
 * offsets that overrun the original text node. RegExp `exec` reports indices
 * and match lengths in the *original* string, so the resulting Slate ranges
 * are always within bounds.
 */
export function findMatches(editor: Editor, query: string, caseSensitive: boolean): BaseRange[] {
  const ranges: BaseRange[] = [];

  if (!query) return ranges;

  const pattern = new RegExp(escapeRegex(query), caseSensitive ? 'gu' : 'giu');

  for (const [node, path] of Editor.nodes(editor, {
    at: [],
    match: (n) => Text.isText(n),
  })) {
    const textNode = node as Text;

    // Atomic inline leaves (mentions, formulas) render dynamic content, so their
    // raw `.text` is a placeholder rather than the visible string — skip them.
    if (textNode.mention || textNode.formula) continue;

    const raw = textNode.text || '';

    if (!raw) continue;

    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(raw)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      ranges.push({
        anchor: { path, offset: start },
        focus: { path, offset: end },
      });

      // Guard against zero-width matches creating an infinite loop. (Shouldn't
      // happen for a literal escaped query, but defensive.)
      if (pattern.lastIndex === start) pattern.lastIndex = start + 1;
    }
  }

  return ranges;
}

/** Stable string key for a Slate path, used to index decorations by text node. */
export const pathToKey = (path: Path): string => path.join('.');
