import { canAddDashboardWidget, findDashboardWidget } from '@/application/database-yjs/dashboard-layout';
import {
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DashboardRow,
  DashboardWidgetPlacement,
} from '@/application/database-yjs/dashboard.type';

export type WidgetMoveDirection = 'left' | 'right' | 'up' | 'down';

export type WidgetMoveTargets = Record<WidgetMoveDirection, DashboardWidgetPlacement | null>;

export const NO_WIDGET_MOVES: WidgetMoveTargets = { left: null, right: null, up: null, down: null };

/**
 * Where each "Move …" menu entry sends a widget (`null` = the entry is
 * disabled). Placements are meant for `moveDashboardWidget`.
 *
 * - Left / right swap the widget with its neighbour in the row.
 * - Up / down split a widget that shares its row into its own row directly
 *   above / below. A widget alone in its row joins the neighbouring row when
 *   that row has room (at the end when moving up, at the start when moving
 *   down, so the two moves undo each other); a full neighbouring row is
 *   swapped with the widget's row instead.
 */
export function getWidgetMoveTargets(rows: DashboardRow[], widgetId: string): WidgetMoveTargets {
  const location = findDashboardWidget(rows, widgetId);

  if (!location) return NO_WIDGET_MOVES;
  const { row, rowIndex, index } = location;
  const sharesRow = row.widgets.length > 1;
  const previousRow = rows[rowIndex - 1];
  const nextRow = rows[rowIndex + 1];

  const left: DashboardWidgetPlacement | null =
    index > 0 ? { type: 'existing_row', rowId: row.id, index: index - 1 } : null;
  const right: DashboardWidgetPlacement | null =
    index < row.widgets.length - 1 ? { type: 'existing_row', rowId: row.id, index: index + 1 } : null;

  let up: DashboardWidgetPlacement | null = null;

  if (sharesRow) {
    up = { type: 'new_row', rowIndex };
  } else if (previousRow) {
    up =
      previousRow.widgets.length < DASHBOARD_MAX_WIDGETS_PER_ROW
        ? { type: 'existing_row', rowId: previousRow.id, index: previousRow.widgets.length }
        : { type: 'new_row', rowIndex: rowIndex - 1 };
  }

  let down: DashboardWidgetPlacement | null = null;

  if (sharesRow) {
    down = { type: 'new_row', rowIndex: rowIndex + 1 };
  } else if (nextRow) {
    down =
      nextRow.widgets.length < DASHBOARD_MAX_WIDGETS_PER_ROW
        ? { type: 'existing_row', rowId: nextRow.id, index: 0 }
        : // Expressed against the list before this row disappears.
          { type: 'new_row', rowIndex: rowIndex + 2 };
  }

  return { left, right, up, down };
}

/** Duplicating needs a free widget slot anywhere on the dashboard. */
export function canDuplicateWidget(rows: DashboardRow[], widgetId: string) {
  if (!findDashboardWidget(rows, widgetId)) return false;
  return rows.reduce((sum, row) => sum + row.widgets.length, 0) < DASHBOARD_MAX_WIDGETS;
}

/**
 * Where an add lands. When the target row filled up while the picker was open
 * the widget starts a new row right below it (at the end when the row is
 * gone); `null` when the dashboard itself is full.
 */
export function resolveAddPlacement(
  rows: DashboardRow[],
  placement: DashboardWidgetPlacement
): DashboardWidgetPlacement | null {
  if (canAddDashboardWidget(rows, placement)) return placement;
  if (placement.type !== 'existing_row' || !canAddDashboardWidget(rows)) return null;
  const rowIndex = rows.findIndex((row) => row.id === placement.rowId);

  return { type: 'new_row', rowIndex: rowIndex === -1 ? rows.length : rowIndex + 1 };
}
