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
export { resolveExtraFiltersForDatabase, toExtraFilter } from './dashboard-global-filters';
export type { DashboardExtraFilter, DashboardGlobalFilter } from './dashboard-global-filters';

/** Layout-settings key for `DatabaseViewLayout.Dashboard` (`DatabaseLayout::Dashboard = 9`). */
export const DASHBOARD_LAYOUT_KEY = '9';

/** Below this viewport width every widget spans the full row (widgets stack). */
export const DASHBOARD_STACK_BREAKPOINT = 768;

/**
 * Storage keys inside `layout_settings['9']`. Values are plain JSON (arrays /
 * objects) so Yrs reads them as nested `Any` values, matching how the timeline
 * stores its dependency links.
 */
export const DashboardLayoutKeys = {
  rows: 'rows',
  globalFilters: 'global_filters',
  showWidgetTitles: 'show_widget_titles',
} as const;

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
}

export type DashboardLayoutUpdate = Partial<DashboardLayoutSetting>;

/** Where a new widget lands. */
export type DashboardWidgetPlacement =
  | { type: 'new_row'; rowIndex?: number }
  | { type: 'existing_row'; rowId: string; index?: number };
