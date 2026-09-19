import { FieldType, FilterType } from './database.type';

/** Layout-settings key for `DatabaseViewLayout.Dashboard` (`DatabaseLayout::Dashboard = 9`). */
export const DASHBOARD_LAYOUT_KEY = '9';

/** Notion parity: a dashboard holds at most 12 widgets, 4 per row. */
export const DASHBOARD_MAX_WIDGETS = 12;
export const DASHBOARD_MAX_WIDGETS_PER_ROW = 4;
/** Widget widths are shares of a 12-column grid; a row's widths always sum to this. */
export const DASHBOARD_GRID_COLUMNS = 12;
export const DASHBOARD_MIN_ROW_HEIGHT = 240;
export const DASHBOARD_MAX_ROW_HEIGHT = 1200;
export const DASHBOARD_DEFAULT_ROW_HEIGHT = 360;
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

/**
 * A dashboard-level filter applied to every widget whose source database has a
 * mapping in `targets`. `condition` / `content` use the same encoding as a view
 * filter of `fieldType`, so the existing filter menus can edit it and
 * `filterBy` can evaluate it unchanged.
 */
export interface DashboardGlobalFilter {
  id: string;
  /** Display name shown on the chip (defaults to the first mapped property's name). */
  name: string;
  fieldType: FieldType;
  condition: number;
  content: string;
  /** database id → field id of that database the filter applies to. */
  targets: Record<string, string>;
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

/**
 * A global filter resolved for one widget: a plain filter node in the persisted
 * view-filter shape (`filter_type`, `field_id`, `ty`, `condition`, `content`).
 * `filterBy` wraps plain objects, so the node needs no Yjs container.
 */
export interface DashboardExtraFilter {
  id: string;
  filter_type: FilterType.Data;
  field_id: string;
  ty: FieldType;
  condition: number;
  content: string;
}

export function toExtraFilter(filter: DashboardGlobalFilter, fieldId: string): DashboardExtraFilter {
  return {
    id: filter.id,
    filter_type: FilterType.Data,
    field_id: fieldId,
    ty: filter.fieldType,
    condition: filter.condition,
    content: filter.content,
  };
}

/**
 * The global filters that apply to a widget of `databaseId`, resolved to its
 * field ids. Each node keeps the filter's type in `ty`; `combineFilters` skips
 * a node whose field has since changed type, reading the type live.
 */
export function resolveExtraFiltersForDatabase(
  globalFilters: DashboardGlobalFilter[],
  databaseId: string
): DashboardExtraFilter[] {
  const resolved: DashboardExtraFilter[] = [];

  globalFilters.forEach((filter) => {
    const fieldId = filter.targets[databaseId];

    if (fieldId) resolved.push(toExtraFilter(filter, fieldId));
  });

  return resolved;
}
