/**
 * The screens of the global filter menu and how they go back: pure, and
 * outside the lazily loaded menu module, so the popover that holds the
 * current screen (and draws a phone sheet's back chevron from it) does not
 * pull the menu's code in.
 */

/** Where the menu was opened: the toolbar button, the bar's `+ Filter`, or a pill. */
export type GlobalFilterMenuEntry = 'toolbar' | 'bar-add' | 'pill';

/** The screens of the menu (WP08 §1.2–1.6). */
export type GlobalFilterMenuScreen =
  | { type: 'picker' }
  | { type: 'reader-list' }
  | { type: 'multi-intro' }
  | { type: 'multi-picker' }
  | { type: 'builder'; filterId: string }
  | { type: 'add-another'; filterId: string }
  | { type: 'pill'; filterId: string };

/** The screen the menu opens on: a pill's editor, the reader's filter list, or the property picker. */
export function initialGlobalFilterScreen(
  entry: GlobalFilterMenuEntry,
  filterId: string | undefined,
  canEdit: boolean
): GlobalFilterMenuScreen {
  if (entry === 'pill' && filterId) return { type: 'pill', filterId };
  if (!canEdit) return { type: 'reader-list' };
  return { type: 'picker' };
}

/**
 * Where the back of a pushed screen goes, the same in the popover's back row
 * and the sheet's header; `null` for a screen the menu opens on.
 */
export function globalFilterScreenBackTarget(
  screen: GlobalFilterMenuScreen,
  entry: GlobalFilterMenuEntry
): GlobalFilterMenuScreen | null {
  switch (screen.type) {
    case 'multi-picker':
      return { type: 'multi-intro' };
    case 'add-another':
      return { type: 'builder', filterId: screen.filterId };
    case 'builder':
      // The builder reached from a pill's editor goes back to it; from the picker it ends with Done.
      return entry === 'pill' ? { type: 'pill', filterId: screen.filterId } : null;
    default:
      return null;
  }
}

/**
 * A phone sheet's header back: the screen's back target, and the intro back
 * to the picker it was pushed from (in a popover the intro closes instead).
 */
export function globalFilterSheetBackTarget(
  screen: GlobalFilterMenuScreen,
  entry: GlobalFilterMenuEntry,
  canEdit: boolean
): GlobalFilterMenuScreen | null {
  if (screen.type === 'multi-intro' && entry !== 'pill' && canEdit) return { type: 'picker' };
  return globalFilterScreenBackTarget(screen, entry);
}
