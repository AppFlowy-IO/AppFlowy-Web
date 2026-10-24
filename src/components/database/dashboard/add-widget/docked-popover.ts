import { DASHBOARD_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';

/** Width of the dock (the picker, the New view panel and the widget settings host). */
export const DOCK_WIDTH = DASHBOARD_GEOMETRY.popover.pickerWidth;
/** Gap between the widget box's top-right corner and the dock. */
export const DOCK_GAP = 8;
/** Room kept free at the viewport edge. */
export const DOCK_PADDING = 16;
/** The dock's vertical clamp: at least this much of it fits above the viewport bottom. */
export const DOCK_MIN_VISIBLE_HEIGHT = 320;
/** The dock's height cap; the list scrolls inside. */
export const DOCK_MAX_HEIGHT = 560;

export type DockSide = 'right' | 'left';

/**
 * Which side of a widget the dock opens on (WP06 §1.6,
 * `dashboard-parity/add-widget.json` `docked_popover_side`). The anchor is the
 * widget box's top-right corner: `right` when the dock fits between it and
 * the viewport's right edge, else `left`, where the dock's right edge sits
 * `gap` left of the anchor and overlaps the right part of the widget.
 */
export function dockedPopoverSide(
  anchorRightX: number,
  viewportRightX: number,
  width = DOCK_WIDTH,
  gap = DOCK_GAP,
  padding = DOCK_PADDING
): DockSide {
  return anchorRightX + gap + width <= viewportRightX - padding ? 'right' : 'left';
}

/**
 * The Radix popper placement of a docked panel anchored to a zero-size
 * element at the widget box's top-right corner: top-aligned on `side`, with
 * the dock's near edge `DOCK_GAP` away from the anchor.
 */
export function dockPopperProps(side: DockSide) {
  return {
    side,
    align: 'start' as const,
    sideOffset: DOCK_GAP,
    collisionPadding: DOCK_PADDING,
  };
}

/** The dock's height cap for an anchor at `anchorTop` in a viewport `viewportHeight` tall. */
export function dockMaxHeight(anchorTop: number, viewportHeight: number) {
  return Math.max(DOCK_MIN_VISIBLE_HEIGHT, Math.min(DOCK_MAX_HEIGHT, viewportHeight - anchorTop - DOCK_PADDING));
}
