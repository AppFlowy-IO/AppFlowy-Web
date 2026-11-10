/**
 * The `mentionTypeaheadV2` switch of the editor's @ picker (MEN-WEB-08), read once when a picker
 * opens. Off by default, so the picker behaves as before until the switch's rollout:
 *
 * - On, a keystroke whose answer is not cached keeps the list and narrows it at once to the items
 *   that still match, from the answer on screen, the cached answer of the longest typed prefix and
 *   the cached bare `@` answer (`mentionProvisional.ts`). The skeleton shows only while that list is
 *   empty; otherwise a thin progress bar does. A typed answer is re-tiered by the typeahead
 *   contract's client ranking when it arrives.
 * - With v2 on, the local lane (MEN-WEB-09) is on too: the pages, databases and people this tab
 *   holds join the list in the keystroke's own render and stay after the server answers, merged by
 *   the typeahead contract's rules (`mentionLocalLane.ts`, `mentionLocalMerge.ts`), the bare `@`
 *   lists this tab's recent opens and picks first, and requests carry the opt-ins the server
 *   advertises (`mentionClientFeatures.ts`). `localStorage.__mention_local_lane = 'false'` keeps
 *   MEN-WEB-08's lists without the local lane, to compare them.
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
/** Whether v2 pickers merge the local lane (MEN-WEB-09), unless the browser overrides it. */
export const MENTION_LOCAL_LANE_DEFAULT = true;
/** `localStorage` key that turns the picker's v2 on (`true`) or off (`false`). */
export const MENTION_TYPEAHEAD_V2_OVERRIDE_KEY = '__mention_typeahead_v2';
/** `localStorage` key that turns the default highlight of v2 pickers on (`true`) or off (`false`). */
export const MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY = '__mention_default_highlight';
/** `localStorage` key that turns the local lane of v2 pickers off (`false`) or on (`true`). */
export const MENTION_LOCAL_LANE_OVERRIDE_KEY = '__mention_local_lane';

/** How a picker that opens now behaves while the user types. */
export interface MentionTypeaheadSettings {
  /** Keep and narrow the list on each keystroke, and re-tier typed answers. */
  v2: boolean;
  /** Highlight the first option by default; only with {@link v2}. */
  defaultHighlight: boolean;
  /**
   * Merge the local lane into every list, and patch the bare `@` with this tab's activity; only
   * with {@link v2}.
   */
  localLane: boolean;
}

/** Every switch off: the picker as it was before MEN-WEB-08. */
export const MENTION_TYPEAHEAD_LEGACY: MentionTypeaheadSettings = {
  v2: false,
  defaultHighlight: false,
  localLane: false,
};

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
 * The settings of a picker that opens now: {@link MENTION_TYPEAHEAD_V2_DEFAULT},
 * {@link MENTION_DEFAULT_HIGHLIGHT_DEFAULT} and {@link MENTION_LOCAL_LANE_DEFAULT} unless the
 * browser overrides them. The default highlight and the local lane apply only to v2 pickers.
 */
export function readMentionTypeaheadSettings(): MentionTypeaheadSettings {
  const v2 = readSwitch(MENTION_TYPEAHEAD_V2_OVERRIDE_KEY, MENTION_TYPEAHEAD_V2_DEFAULT);

  return {
    v2,
    defaultHighlight: v2 && readSwitch(MENTION_DEFAULT_HIGHLIGHT_OVERRIDE_KEY, MENTION_DEFAULT_HIGHLIGHT_DEFAULT),
    localLane: v2 && readSwitch(MENTION_LOCAL_LANE_OVERRIDE_KEY, MENTION_LOCAL_LANE_DEFAULT),
  };
}
