/**
 * The `mentionTypeaheadV2` switch of the editor's @ picker (MEN-WEB-08), read once when a picker
 * opens. Off by default, so the picker behaves as before until the switch's rollout:
 *
 * - On, a keystroke whose answer is not cached keeps the list and narrows it at once to the items
 *   that still match, from the answer on screen, the cached answer of the longest typed prefix and
 *   the cached bare `@` answer (`mentionProvisional.ts`). The skeleton shows only while that list is
 *   empty; otherwise a thin progress bar does. A typed answer is re-tiered by the typeahead
 *   contract's client ranking when it arrives.
 * - The default highlight is a separate switch, off by default even with the picker's v2 on: the
 *   first option is highlighted after each keystroke and follows the top of the list, until
 *   ArrowUp or ArrowDown moves the highlight and holds it on its item until the next keystroke.
 *   Off, nothing is highlighted until an arrow key is pressed, as before.
 *
 * A browser opts in with `localStorage.__mention_typeahead_v2 = 'true'` and
 * `localStorage.__mention_default_highlight = 'true'`. Storage that cannot be read gives the
 * defaults. Nothing here depends on React.
 */

/** Whether a picker that opens now keeps and narrows its list (MEN-WEB-08), unless the browser overrides it. */
export const MENTION_TYPEAHEAD_V2_DEFAULT = false;
/** Whether v2 pickers highlight their first option by default, unless the browser overrides it. */
export const MENTION_DEFAULT_HIGHLIGHT_DEFAULT = false;
/** `localStorage` key that turns the picker's v2 on (`true`) or off (`false`). */
export const MENTION_TYPEAHEAD_V2_OVERRIDE_KEY = '__mention_typeahead_v2';
/** `localStorage` key that turns the default highlight of v2 pickers on (`true`) or off (`false`). */
export const MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY = '__mention_default_highlight';

/** How a picker that opens now behaves while the user types. */
export interface MentionTypeaheadSettings {
  /** Keep and narrow the list on each keystroke, and re-tier typed answers. */
  v2: boolean;
  /** Highlight the first option by default; only with {@link v2}. */
  defaultHighlight: boolean;
}

/** Both switches off: the picker as it was before MEN-WEB-08. */
export const MENTION_TYPEAHEAD_LEGACY: MentionTypeaheadSettings = { v2: false, defaultHighlight: false };

// Storage can be denied, by the getter or the read itself, and then the defaults apply.
function readSwitch(key: string, fallback: boolean): boolean {
  try {
    const value = typeof window === 'undefined' ? null : window.localStorage?.getItem(key) ?? null;

    return value === 'true' ? true : value === 'false' ? false : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The settings of a picker that opens now: {@link MENTION_TYPEAHEAD_V2_DEFAULT} and
 * {@link MENTION_DEFAULT_HIGHLIGHT_DEFAULT} unless the browser overrides them. The default
 * highlight applies only to v2 pickers.
 */
export function readMentionTypeaheadSettings(): MentionTypeaheadSettings {
  const v2 = readSwitch(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, MENTION_TYPEAHEAD_V2_DEFAULT);

  return {
    v2,
    defaultHighlight: v2 && readSwitch(MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY, MENTION_DEFAULT_HIGHLIGHT_DEFAULT),
  };
}
