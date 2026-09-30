import { DASHBOARD_ROW_HEIGHT_SNAP } from '@/application/database-yjs/dashboard-geometry';
import { DatabaseViewLayout } from '@/application/types';

// Constants marked "Superseded" have a token in `dashboard-geometry.ts`
// (`dashboard-parity/tokens.json`); the named package switches their consumers
// to it and deletes them. New dashboard chrome uses the tokens directly.

/** Inline padding of a standalone dashboard page (matches the other database layouts). */
export const DASHBOARD_DEFAULT_INLINE_PADDING = 96;
/**
 * Smallest right padding in Edit mode: the per-row "add widget" button sits
 * just outside the row's right edge and must not be clipped.
 * Superseded by `DASHBOARD_GEOMETRY.row.controlOffset` (30, an overlay) (WP02 / WP04).
 */
export const DASHBOARD_EDIT_ROW_ACTION_GUTTER = 36;
/**
 * Below this grid width a row's widgets no longer fit side by side even on a
 * wide screen (a dashboard in a side panel or a narrow document column), so
 * they stack. The viewport rule is `DASHBOARD_STACK_BREAKPOINT`.
 * Superseded by the wrap rule on `DASHBOARD_MIN_WIDGET_WIDTH` (WP02).
 */
export const DASHBOARD_STACK_CONTAINER_BREAKPOINT = 480;
/**
 * Horizontal gap between widgets of a row (CSS px); matches `gap-4`.
 * Superseded by `DASHBOARD_COLUMN_GAP_PX` (`grid.columnGap`, 12) (WP02).
 */
export const DASHBOARD_COLUMN_GAP = 16;
/** Vertical gap between rows in View mode (CSS px). Superseded by `DASHBOARD_GEOMETRY.grid.rowGap` (WP02). */
export const DASHBOARD_ROW_GAP = 16;
/**
 * Vertical gap between rows in Edit mode: room for the height handle and the drop zone.
 * Superseded by `DASHBOARD_GEOMETRY.grid.rowGap` (16 in both modes) (WP02).
 */
export const DASHBOARD_EDIT_ROW_GAP = 24;
/** Drop zone above the first row (Edit mode only). Superseded by `DASHBOARD_GEOMETRY.grid.topBand` (WP02). */
export const DASHBOARD_EDGE_DROP_ZONE_HEIGHT = 16;

/**
 * Quiet title row rendered above the card in View mode.
 * Superseded by `DASHBOARD_WIDGET_HEADER_HEIGHT` (`widget.headerHeight`, 40) (WP03).
 */
export const WIDGET_TITLE_HEIGHT = 32;
/**
 * Tinted header bar rendered inside the card in Edit mode.
 * Superseded by `DASHBOARD_WIDGET_HEADER_HEIGHT` (`widget.headerHeight`, 40) (WP03).
 */
export const WIDGET_EDIT_HEADER_HEIGHT = 36;
/**
 * Top + bottom border of the widget body (View mode) or card (Edit mode).
 * Superseded by `DASHBOARD_GEOMETRY.widget.cardInset` (46, header plus bottom padding; the ring takes no space) (WP03).
 */
export const WIDGET_BODY_BORDER = 2;
/** Inline padding handed to the nested database (tab bar, conditions, grid). */
export const WIDGET_INLINE_PADDING = 12;
/**
 * Start padding of an editable grid widget: its rows show their hover
 * controls in the start gutter, which `WIDGET_INLINE_PADDING` cannot hold
 * (the card clips them). Fits the compact controls, one 24 px button plus
 * its border (`COMPACT_HOVER_CONTROLS_WIDTH`), with a small gap.
 */
export const WIDGET_GRID_ROW_GUTTER = 32;
/** Height of the nested filter / sort chip row when it is expanded. */
export const WIDGET_CONDITIONS_BAR_HEIGHT = 40;
/** Smallest viewport a widget hands to its database, so tiny rows still render. */
export const WIDGET_MIN_VIEWPORT_HEIGHT = 80;

/** Keyboard step of the row height handle (CSS px): the row height snap. */
export const DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP = DASHBOARD_ROW_HEIGHT_SNAP;
/** How long the "limit reached" message stays visible. */
export const DASHBOARD_LIMIT_MESSAGE_DURATION = 4000;
/**
 * A referenced view that is missing from its database doc is reported as
 * "not found" only after this grace period, so a view created a moment ago
 * (whose update may still be in flight) does not flash an error.
 */
export const WIDGET_MISSING_GRACE_MS = 3000;

/** Drag-and-drop discriminators (scoped further by the dashboard's instance id). */
export const DASHBOARD_WIDGET_DRAG_TYPE = 'dashboard-widget';
export const DASHBOARD_WIDGET_DROP_TYPE = 'dashboard-widget-target';
export const DASHBOARD_ROW_GAP_DROP_TYPE = 'dashboard-row-gap';

/** Layouts offered by the "New view" tab of the widget picker (no Dashboard, no Form). */
export const WIDGET_PICKER_LAYOUTS: DatabaseViewLayout[] = [
  DatabaseViewLayout.Grid,
  DatabaseViewLayout.Board,
  DatabaseViewLayout.Calendar,
  DatabaseViewLayout.Chart,
  DatabaseViewLayout.List,
  DatabaseViewLayout.Gallery,
  DatabaseViewLayout.Feed,
  DatabaseViewLayout.Timeline,
];
