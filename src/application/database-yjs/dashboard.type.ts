import type { DashboardGlobalFilter } from './dashboard-global-filters';

// The limits live in `dashboard-geometry.ts`, bound to `dashboard-parity/tokens.json`.
export {
  DASHBOARD_DEFAULT_ROW_HEIGHT,
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DASHBOARD_MIN_ROW_HEIGHT,
} from './dashboard-geometry';
// The global-filter model and its per-widget resolution live in `dashboard-global-filters.ts`.
export { resolveExtraFiltersForDatabase } from './dashboard-global-filters';
export type { DashboardExtraFilter, DashboardGlobalFilter } from './dashboard-global-filters';

/** Layout-settings key for `DatabaseViewLayout.Dashboard` (`DatabaseLayout::Dashboard = 9`). */
export const DASHBOARD_LAYOUT_KEY = '9';

// The storage keys inside `layout_settings['9']` are the `dashboard_*` / `show_*`
// members of `YjsDatabaseKey`. `rows` and `global_filters` hold plain JSON (arrays
// / objects) so Yrs reads them as nested `Any` values, matching how the timeline
// stores its dependency links.

/** One widget: a reference to a database view, plus its share of the row. */
export interface DashboardWidget {
  id: string;
  /** The database view the widget renders (a view tab of `databaseId`). */
  viewId: string;
  /** The database collab that owns `viewId`; may differ from the host database. */
  databaseId: string;
  /** 1..12 columns of the row's 12-column grid. */
  width: number;
}

export interface DashboardRow {
  id: string;
  /** Row height in CSS pixels shared by every widget in the row. */
  height: number;
  widgets: DashboardWidget[];
}

export interface DashboardLayoutSetting {
  rows: DashboardRow[];
  globalFilters: DashboardGlobalFilter[];
  showWidgetTitles: boolean;
  /** Widget titles show the view icon (`show_icons_in_heading`, default false as in Notion). */
  showIconsInHeading: boolean;
}

export type DashboardLayoutUpdate = Partial<DashboardLayoutSetting>;

/** Where a new widget lands. */
export type DashboardWidgetPlacement =
  | { type: 'new_row'; rowIndex?: number }
  | { type: 'existing_row'; rowId: string; index?: number };

/**
 * Where a dragged widget is dropped (WP04): next to a widget (its left or
 * right edge), or into the band in front of row `rowIndex` (0 = above the
 * first row, `rows.length` = below the last), which starts a new row.
 */
export type DashboardDropTarget =
  | { type: 'widget'; widgetId: string; edge: 'left' | 'right' }
  | { type: 'row_gap'; rowIndex: number };

/**
 * The line a drop draws: a vertical line at insert position `boundary`
 * (0..n, counted before the dragged widget leaves the row) of row `rowId`, or
 * a horizontal line in the band in front of row `rowIndex`.
 */
export type DashboardDropIndicator =
  | { type: 'column'; rowId: string; boundary: number }
  | { type: 'row_gap'; rowIndex: number };

/** `blocked`: a real move the limits refuse (a full row); `noop`: nothing would change. */
export type DashboardMoveFeedback = 'allowed' | 'blocked' | 'noop';

/** An add control: usable, shown but refused (the dashboard is full), or not shown (the row is full). */
export type DashboardAddControlState = 'enabled' | 'disabled' | 'hidden';

/** What the controls beside a row offer (Edit mode). */
export interface DashboardRowControls {
  moveUp: boolean;
  moveDown: boolean;
  addToRow: DashboardAddControlState;
}
