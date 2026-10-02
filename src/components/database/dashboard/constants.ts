import {
  DASHBOARD_COLUMN_GAP_PX,
  DASHBOARD_GEOMETRY,
  DASHBOARD_ROW_HEIGHT_SNAP,
  DASHBOARD_WIDGET_BOX_BLEED,
  DASHBOARD_WIDGET_HEADER_HEIGHT,
} from '@/application/database-yjs/dashboard-geometry';
import { DatabaseViewLayout } from '@/application/types';

// Geometry comes from `dashboard-geometry.ts` (`dashboard-parity/tokens.json`);
// these names keep the dashboard components readable.

export { DASHBOARD_MIN_WIDGET_WIDTH, DASHBOARD_ROW_HEIGHT_SNAP } from '@/application/database-yjs/dashboard-geometry';

/** Inline padding of a standalone dashboard page (matches the other database layouts). */
export const DASHBOARD_DEFAULT_INLINE_PADDING = 96;
/** Horizontal gap between widget boxes of a row (CSS px); the visible card gap is 6 + 12 + 6. */
export const DASHBOARD_COLUMN_GAP = DASHBOARD_COLUMN_GAP_PX;
/** Vertical gap between rows and between the wrapped lines of a row, the same in View and Edit mode. */
export const DASHBOARD_ROW_GAP = DASHBOARD_GEOMETRY.grid.rowGap;
/** Band above the first row: the page's top spacing, and the "new first row" drop zone in Edit mode. */
export const DASHBOARD_GRID_TOP_BAND = DASHBOARD_GEOMETRY.grid.topBand;
/** The widget box's padding (`0 6 6`); each row track bleeds this far past the content column. */
export const DASHBOARD_WIDGET_BOX_INSET = DASHBOARD_WIDGET_BOX_BLEED;
/** Fewest columns a width drag leaves a widget (with the 240px floor of `dashboardMinWidgetColumns`). */
export const DASHBOARD_MIN_WIDGET_COLUMNS = DASHBOARD_GEOMETRY.grid.minWidgetColumns;
/** Row controls are centred this far outside the content column. */
export const DASHBOARD_ROW_CONTROL_OFFSET = DASHBOARD_GEOMETRY.row.controlOffset;
export const DASHBOARD_ROW_CONTROL_SIZE = DASHBOARD_GEOMETRY.row.controlSize;
/** Smallest page inset for editors, in View and Edit mode alike, so the row controls fit. */
export const DASHBOARD_CONTROL_GUTTER = DASHBOARD_GEOMETRY.row.controlGutterMin;
/** Width handle: hit strip (the visible card gap) and pill sizes. */
export const DASHBOARD_RESIZE_GEOMETRY = DASHBOARD_GEOMETRY.resize;

/** The widget header band above the card (titles shown), the same in View and Edit mode. */
export const WIDGET_HEADER_HEIGHT = DASHBOARD_WIDGET_HEADER_HEIGHT;
/** The widget box padding around the card (`0 6 6`, or `6 6 6` with titles hidden). */
export const WIDGET_BOX_PADDING = DASHBOARD_GEOMETRY.widget.boxPaddingInline;
/**
 * Inline padding handed to the nested database (`dashboard-parity/widget-content.json`
 * `geometry.start_inset` and `end_inset`): every widget but an editable grid starts and ends 12px inside the card.
 */
export const WIDGET_INLINE_PADDING = 12;
/**
 * Start padding of an editable grid widget (`widget-content.json` `geometry.grid_start_inset_editable`):
 * its rows show their hover controls in the start gutter, which `WIDGET_INLINE_PADDING` cannot hold
 * (the card clips them). Fits the compact controls, one 24 px button plus
 * its border (`COMPACT_HOVER_CONTROLS_WIDTH`), with a small gap.
 */
export const WIDGET_GRID_ROW_GUTTER = 32;
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
