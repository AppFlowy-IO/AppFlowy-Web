/**
 * Revealing the active view tab (WP05 §1.10, W16). Same function as desktop
 * `tabRevealScrollOffset` (`dashboard_owned_views.dart`), bound to
 * `dashboard-parity/tab-reveal.json`.
 */
export const TAB_REVEAL_EDGE_PADDING = 16;

export interface TabRevealInput {
  /** The strip's current scroll offset. */
  scrollOffset: number;
  /** The strip's visible width. */
  viewportExtent: number;
  /** The largest scroll offset (content width − viewport width). */
  maxScrollExtent: number;
  /** The tab's start, measured from the start of the scrollable content. */
  itemStart: number;
  itemExtent: number;
  edgePadding?: number;
}

/**
 * The scroll offset that shows the tab with `edgePadding` around it: a tab
 * wider than the viewport (or cut off at the start) aligns its start, a tab
 * cut off at the end aligns its end, and a visible tab keeps the offset.
 */
export function tabRevealScrollOffset({
  scrollOffset,
  viewportExtent,
  maxScrollExtent,
  itemStart,
  itemExtent,
  edgePadding = TAB_REVEAL_EDGE_PADDING,
}: TabRevealInput): number {
  let target = scrollOffset;

  if (itemExtent + 2 * edgePadding >= viewportExtent || itemStart - edgePadding < scrollOffset) {
    target = itemStart - edgePadding;
  } else if (itemStart + itemExtent + edgePadding > scrollOffset + viewportExtent) {
    target = itemStart + itemExtent + edgePadding - viewportExtent;
  }

  return Math.min(Math.max(target, 0), Math.max(maxScrollExtent, 0));
}

/**
 * Scroll `scroller` (the tab strip's own scroll container) so `tab` is fully
 * visible. Only the strip moves, in one jump: unlike `scrollIntoView`, no
 * ancestor scrolls, so a document hosting the database stays where it is.
 * Returns whether the offset changed.
 */
export function revealTabInScroller(scroller: HTMLElement, tab: HTMLElement): boolean {
  const scrollerRect = scroller.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  const viewportExtent = scroller.clientWidth;
  const target = tabRevealScrollOffset({
    scrollOffset: scroller.scrollLeft,
    viewportExtent,
    maxScrollExtent: scroller.scrollWidth - viewportExtent,
    itemStart: tabRect.left - scrollerRect.left + scroller.scrollLeft,
    itemExtent: tabRect.width,
  });

  if (target === scroller.scrollLeft) return false;
  scroller.scrollLeft = target;
  return true;
}
