import { DEFAULT_ROW_HEIGHT } from '@/application/database-yjs';

/** Height of one timeline row; matches the grid's default row height. */
export const TIMELINE_ROW_HEIGHT = DEFAULT_ROW_HEIGHT;
/** Single header row of column (or segment) labels, like the calendar's day header. */
export const TIMELINE_HEADER_HEIGHT = 36;
/** Docked property table width when `show_table` is on. */
export const TIMELINE_SIDEBAR_WIDTH = 280;
/** Width reserved for the expand toggle when the table is hidden. */
export const TIMELINE_COLLAPSED_SIDEBAR_WIDTH = 32;
/** Vertical inset of a bar inside its row: 36px rows hold the calendar's 22px event chips. */
export const TIMELINE_BAR_INSET = 7;
/** Extra blank rows below the last row so the canvas can be scrolled past it. */
export const TIMELINE_BOTTOM_PADDING = 3 * TIMELINE_ROW_HEIGHT;
/** Columns kept rendered beyond each edge of the viewport. */
export const TIMELINE_COLUMN_OVERSCAN = 6;
/** Fraction of the visible canvas Today lands at when jumping to it. */
export const TIMELINE_TODAY_ANCHOR = 0.25;
