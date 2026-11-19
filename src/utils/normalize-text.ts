/**
 * The one text normalization both dashboard clients use for label sorting,
 * option search and the global filter picker:
 * lowercase (root locale) → NFKD → strip combining marks (`\p{M}`) → trim.
 *
 * Desktop mirrors it in `dashboard_text_normalize.dart`; both are pinned by
 * `dashboard-parity/text-normalize.json`. It never uses locale collation, so
 * `ß` stays `ß` and `İ` folds to `i`.
 */
export function normalizeDashboardText(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').trim();
}

/** Orders two strings by UTF-16 code unit, as `<` does: the same in every locale. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The order of dashboard labels on both clients (`compareChartLabels`, pinned
 * by `dashboard-parity/group-keys.json#labelCompare`), also used for the MCP
 * connected-app names: the texts folded with `normalizeDashboardText`, then as
 * written, both by UTF-16 code unit. Never locale collation.
 */
export function compareDashboardText(a: string, b: string): number {
  return compareCodeUnits(normalizeDashboardText(a), normalizeDashboardText(b)) || compareCodeUnits(a, b);
}

/**
 * Unicode White_Space, the set Rust's `char::is_whitespace` and `str::trim` use. JavaScript's `\s`
 * and `trim()` differ: they include U+FEFF and leave out U+0085.
 */
const WHITE_SPACE_CLASS = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const WHITE_SPACE_RUNS = new RegExp(`[${WHITE_SPACE_CLASS}]+`, 'g');
const WHITE_SPACE_ONLY = new RegExp(`^[${WHITE_SPACE_CLASS}]*$`);
const NON_ASCII = /[\u0080-\uffff]/;
const MARKS = /\p{M}+/gu;
const CAPITAL_SIGMA = /\u03a3/g;
const SURROGATE = /[\ud800-\udfff]/;

/** Matching reads at most this many code points of a query, title, name or address. */
export const MENTION_MATCH_MAX_CODE_POINTS = 512;

/** Whether `text` holds only Unicode White_Space, or nothing: a blank name in the mention contract. */
export function isMentionBlankText(text: string): boolean {
  return WHITE_SPACE_ONLY.test(text);
}

/** Every run of Unicode White_Space as one space, with none at either end. */
function collapseWhiteSpace(text: string): string {
  const collapsed = text.replace(WHITE_SPACE_RUNS, ' ');
  const start = collapsed.charCodeAt(0) === 0x20 ? 1 : 0;
  const end = collapsed.length > start && collapsed.charCodeAt(collapsed.length - 1) === 0x20 ? -1 : undefined;

  return start === 0 && end === undefined ? collapsed : collapsed.slice(start, end);
}

/**
 * The @-mention matcher's normalizer, `mention_match::normalize` of the typeahead contract
 * (AppFlowy-Cloud-Premium `doc/context/workspace/mention_typeahead_contract.md`), which Search and
 * Cloud rank with: NFKD, every Mark (Mn, Mc, Me) dropped, each code point lowercased on its own,
 * then Unicode White_Space runs collapsed to one space and trimmed. Pinned with the server by
 * `mention-parity/normalize.json`.
 *
 * Unlike {@link normalizeDashboardText} it lowercases after decomposing and per code point, so
 * `ΟΔΟΣ` gives `οδοσ` (whole-string `toLowerCase` applies Final_Sigma), and it collapses
 * White_Space: U+0085 separates words, U+FEFF does not. It folds no quotes, `æ`, `œ` or `ß`.
 */
export function normalizeMentionText(text: string): string {
  if (!NON_ASCII.test(text)) return collapseWhiteSpace(text.toLowerCase());

  const folded = text.normalize('NFKD').replace(MARKS, '');

  // Final_Sigma is the only context-dependent rule of `toLowerCase`, and a capital sigma lowercased
  // alone is `σ`, so this lowercases every code point on its own.
  return collapseWhiteSpace(folded.replace(CAPITAL_SIGMA, '\u03c3').toLowerCase());
}

/** The first `max` code points of `text`; a surrogate pair is one code point, as in `Array.from`. */
export function boundMentionText(text: string, max = MENTION_MATCH_MAX_CODE_POINTS): string {
  // A string never holds more code points than UTF-16 units.
  if (text.length <= max) return text;

  let count = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (count === max) return text.slice(0, index);

    if (isLeadSurrogatePair(text, index)) index += 1;
    count += 1;
  }

  return text;
}

/**
 * The code points of `text`, counted as `Array.from(text).length` without the array. Every unit
 * before the first surrogate is a code point of its own, and the engine finds that surrogate far
 * faster than a loop (at once in a string with no character above U+00FF), so a long title
 * without one costs next to nothing.
 */
export function countCodePoints(text: string): number {
  const first = text.search(SURROGATE);

  if (first === -1) return text.length;

  let count = first;

  for (let index = first; index < text.length; index += 1) {
    if (isLeadSurrogatePair(text, index)) index += 1;
    count += 1;
  }

  return count;
}

function isLeadSurrogatePair(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);

  if (unit < 0xd800 || unit > 0xdbff || index + 1 >= text.length) return false;

  const next = text.charCodeAt(index + 1);

  return next >= 0xdc00 && next <= 0xdfff;
}

/**
 * Orders two strings by code point, which is Rust's `String` order (UTF-8 bytes) and differs from
 * {@link compareCodeUnits} only where a character above U+FFFF meets one in U+E000 to U+FFFF.
 */
export function compareCodePoints(a: string, b: string): number {
  const length = Math.min(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    let left = a.charCodeAt(index);
    let right = b.charCodeAt(index);

    if (left !== right) {
      // UTF-16 puts surrogates (U+10000 and above) before U+E000 to U+FFFF: move them after.
      if (left >= 0xd800 && right >= 0xd800) {
        left += left >= 0xe000 ? -0x800 : 0x2000;
        right += right >= 0xe000 ? -0x800 : 0x2000;
      }

      return left - right;
    }
  }

  return a.length - b.length;
}

/**
 * `text` rewritten so that its UTF-16 order ({@link compareCodeUnits}, the engine's own `<`) is the
 * code point order of {@link compareCodePoints}: surrogates move above U+E000 to U+FFFF. Text below
 * U+D800, such as every navigation key built from ids, comes back as it is. For sorting many
 * strings, each converted once.
 */
export function codePointOrderKey(text: string): string {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) >= 0xd800) {
      return Array.from({ length: text.length }, (_, at) => {
        const unit = text.charCodeAt(at);

        return String.fromCharCode(unit < 0xd800 ? unit : unit >= 0xe000 ? unit - 0x800 : unit + 0x2000);
      }).join('');
    }
  }

  return text;
}
