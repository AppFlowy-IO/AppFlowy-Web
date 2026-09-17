import {
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MIN_ROW_HEIGHT,
  DashboardRow,
  DashboardWidget,
} from '@/application/database-yjs/dashboard.type';
import { DatabaseViewLayout, ViewLayout } from '@/application/types';

import {
  DASHBOARD_COLUMN_GAP,
  DASHBOARD_EDIT_ROW_ACTION_GUTTER,
  WIDGET_BODY_BORDER,
  WIDGET_EDIT_HEADER_HEIGHT,
  WIDGET_MIN_VIEWPORT_HEIGHT,
  WIDGET_TITLE_HEIGHT,
} from './constants';

const DATABASE_TO_VIEW_LAYOUT: Record<DatabaseViewLayout, ViewLayout> = {
  [DatabaseViewLayout.Grid]: ViewLayout.Grid,
  [DatabaseViewLayout.Board]: ViewLayout.Board,
  [DatabaseViewLayout.Calendar]: ViewLayout.Calendar,
  [DatabaseViewLayout.Chart]: ViewLayout.Chart,
  [DatabaseViewLayout.List]: ViewLayout.List,
  [DatabaseViewLayout.Gallery]: ViewLayout.Gallery,
  [DatabaseViewLayout.Feed]: ViewLayout.Feed,
  [DatabaseViewLayout.Form]: ViewLayout.Form,
  [DatabaseViewLayout.Timeline]: ViewLayout.Timeline,
  [DatabaseViewLayout.Dashboard]: ViewLayout.Dashboard,
};

/** Folder layout (icons, catalog) of a database-side layout value. */
export function databaseLayoutToViewLayout(layout: DatabaseViewLayout | null | undefined): ViewLayout {
  if (layout === null || layout === undefined) return ViewLayout.Grid;
  return DATABASE_TO_VIEW_LAYOUT[layout] ?? ViewLayout.Grid;
}

/** Database-side layout of a folder layout value; `null` for non-database layouts. */
export function viewLayoutToDatabaseLayout(layout: ViewLayout | null | undefined): DatabaseViewLayout | null {
  const entry = Object.entries(DATABASE_TO_VIEW_LAYOUT).find(([, value]) => value === layout);

  return entry ? (Number(entry[0]) as DatabaseViewLayout) : null;
}

/** Translation key + English fallback of a layout's menu name. */
export function getLayoutLabel(layout: ViewLayout): { key: string; defaultValue: string } {
  switch (layout) {
    case ViewLayout.Board:
      return { key: 'board.menuName', defaultValue: 'Board' };
    case ViewLayout.Calendar:
      return { key: 'calendar.menuName', defaultValue: 'Calendar' };
    case ViewLayout.Chart:
      return { key: 'chart.menuName', defaultValue: 'Chart' };
    case ViewLayout.List:
      return { key: 'list.menuName', defaultValue: 'List' };
    case ViewLayout.Gallery:
      return { key: 'gallery.menuName', defaultValue: 'Gallery' };
    case ViewLayout.Feed:
      return { key: 'feed.menuName', defaultValue: 'Feed' };
    case ViewLayout.Form:
      return { key: 'form.builderName', defaultValue: 'Form builder' };
    case ViewLayout.Timeline:
      return { key: 'timeline.menuName', defaultValue: 'Timeline' };
    case ViewLayout.Dashboard:
      return { key: 'dashboard.menuName', defaultValue: 'Dashboard' };
    default:
      return { key: 'grid.menuName', defaultValue: 'Grid' };
  }
}

export interface WidgetChromeInput {
  isEditing: boolean;
  showWidgetTitles: boolean;
}

/**
 * Vertical space the widget header takes inside the widget's slot. In View
 * mode without titles the actions float over the card and take none.
 */
export function getWidgetHeaderHeight({ isEditing, showWidgetTitles }: WidgetChromeInput) {
  if (isEditing) return WIDGET_EDIT_HEADER_HEIGHT;
  return showWidgetTitles ? WIDGET_TITLE_HEIGHT : 0;
}

/** Height handed to the nested database as its embedded viewport. */
export function getWidgetViewportHeight(rowHeight: number, chrome: WidgetChromeInput) {
  return Math.max(WIDGET_MIN_VIEWPORT_HEIGHT, rowHeight - getWidgetHeaderHeight(chrome) - WIDGET_BODY_BORDER);
}

/**
 * CSS `left` of the boundary after `columns` grid columns, centred in the gap:
 * one column plus one gap is `(100% + gap) / 12`, and the boundary sits half a
 * gap before the next column starts.
 */
export function getColumnBoundaryOffset(columns: number, gap = DASHBOARD_COLUMN_GAP) {
  return `calc((100% + ${gap}px) * ${columns} / ${DASHBOARD_GRID_COLUMNS} - ${gap / 2}px)`;
}

/** Whole grid columns covered by a horizontal pointer delta over a row `rowWidth` px wide. */
export function pixelsToColumns(deltaPx: number, rowWidth: number, gap = DASHBOARD_COLUMN_GAP) {
  if (!Number.isFinite(deltaPx) || rowWidth <= 0) return 0;
  const columnWidth = (rowWidth + gap) / DASHBOARD_GRID_COLUMNS;
  const columns = Math.round(deltaPx / columnWidth);

  // Avoid returning -0 so callers can compare with `===`.
  return columns === 0 ? 0 : columns;
}

/**
 * Clamp a width delta for the boundary after `index` so both neighbours keep
 * at least one column (mirrors `resizeDashboardWidget`).
 */
export function clampWidthDelta(widgets: DashboardWidget[], index: number, delta: number) {
  const left = widgets[index];
  const right = widgets[index + 1];

  if (!left || !right) return 0;
  const clamped = Math.max(1 - left.width, Math.min(right.width - 1, delta));

  return clamped === 0 ? 0 : clamped;
}

export function clampRowHeight(height: number) {
  if (!Number.isFinite(height)) return DASHBOARD_MIN_ROW_HEIGHT;
  return Math.min(DASHBOARD_MAX_ROW_HEIGHT, Math.max(DASHBOARD_MIN_ROW_HEIGHT, Math.round(height)));
}

/** An empty dashboard opens in Edit mode for users who can build it. */
export function shouldOpenInEditMode({ canEdit, rows }: { canEdit: boolean; rows: DashboardRow[] }) {
  return canEdit && rows.length === 0;
}

/**
 * Inline padding of the dashboard content. Edit mode keeps enough room on the
 * right for the per-row "add widget" button that sits outside each row.
 */
export function getDashboardInlinePadding({
  paddingStart,
  paddingEnd,
  editing,
}: {
  paddingStart: number;
  paddingEnd: number;
  editing: boolean;
}) {
  return {
    paddingLeft: paddingStart,
    paddingRight: editing ? Math.max(paddingEnd, DASHBOARD_EDIT_ROW_ACTION_GUTTER) : paddingEnd,
  };
}
