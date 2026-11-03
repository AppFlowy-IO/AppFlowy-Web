import { canAddDashboardWidget, findDashboardWidget } from '@/application/database-yjs/dashboard-layout';
import { DashboardRow, DashboardWidgetPlacement } from '@/application/database-yjs/dashboard.type';

export type WidgetMoveDirection = 'left' | 'right' | 'rowAbove' | 'rowBelow';

export type WidgetMoveTargets = Record<WidgetMoveDirection, DashboardWidgetPlacement | null>;

export const NO_WIDGET_MOVES: WidgetMoveTargets = { left: null, right: null, rowAbove: null, rowBelow: null };

/**
 * Where each move of the widget menu sends a widget (`null` = the move has
 * no target). Placements are meant for `moveDashboardWidget`.
 *
 * - Left / right swap the widget with its neighbour in the row.
 * - "Create new row above / below" ("Move to row") take a widget that shares
 *   its row into a row of its own directly above / below; a widget alone in
 *   its row already has one.
 */
export function getWidgetMoveTargets(rows: DashboardRow[], widgetId: string): WidgetMoveTargets {
  const location = findDashboardWidget(rows, widgetId);

  if (!location) return NO_WIDGET_MOVES;
  const { row, rowIndex, index } = location;
  const sharesRow = row.widgets.length > 1;

  return {
    left: index > 0 ? { type: 'existing_row', rowId: row.id, index: index - 1 } : null,
    right: index < row.widgets.length - 1 ? { type: 'existing_row', rowId: row.id, index: index + 1 } : null,
    rowAbove: sharesRow ? { type: 'new_row', rowIndex } : null,
    rowBelow: sharesRow ? { type: 'new_row', rowIndex: rowIndex + 1 } : null,
  };
}

/** Duplicating needs a free widget slot anywhere on the dashboard. */
export function canDuplicateWidget(rows: DashboardRow[], widgetId: string) {
  return findDashboardWidget(rows, widgetId) !== null && canAddDashboardWidget(rows);
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

export type WidgetMenuEntryId =
  | 'view-data-source'
  | 'edit-view'
  | 'move-left'
  | 'move-right'
  | 'move-to-row'
  | 'create-row-above'
  | 'create-row-below'
  | 'duplicate'
  | 'delete';

/** A separator goes between two groups. */
export type WidgetMenuGroup = 'navigate' | 'settings' | 'move' | 'manage';

export interface WidgetMenuEntry {
  id: WidgetMenuEntryId;
  group: WidgetMenuGroup;
  disabled: boolean;
  /** Why a disabled entry is shown anyway (it stays hoverable and explains itself). */
  disabledReason?: 'dashboard_full';
  /** The submenu ("Move to row"). */
  children?: WidgetMenuEntry[];
}

/**
 * The widget menu (Notion spec §7.1), the same on desktop
 * (`buildDashboardWidgetMenuEntries`) and checked against
 * `dashboard-parity/wrap-and-split.json` `menu`.
 *
 * - View mode (every role, writers included): "View data source" only.
 * - Edit mode: "Edit view"; "Move left" / "Move right" where the widget has a
 *   neighbour on that side; "Move to row" with "Create new row above / below"
 *   (disabled for a widget alone in its row); "Duplicate" (disabled on a full
 *   dashboard, with the reason); "Delete".
 */
export function buildWidgetMenuEntries({
  editing,
  canDuplicate,
  moveTargets,
}: {
  editing: boolean;
  canDuplicate: boolean;
  moveTargets: WidgetMoveTargets;
}): WidgetMenuEntry[] {
  if (!editing) return [{ id: 'view-data-source', group: 'navigate', disabled: false }];
  const entries: WidgetMenuEntry[] = [{ id: 'edit-view', group: 'settings', disabled: false }];

  if (moveTargets.left) entries.push({ id: 'move-left', group: 'move', disabled: false });
  if (moveTargets.right) entries.push({ id: 'move-right', group: 'move', disabled: false });
  entries.push(
    {
      id: 'move-to-row',
      group: 'move',
      disabled: false,
      children: [
        { id: 'create-row-above', group: 'move', disabled: moveTargets.rowAbove === null },
        { id: 'create-row-below', group: 'move', disabled: moveTargets.rowBelow === null },
      ],
    },
    canDuplicate
      ? { id: 'duplicate', group: 'manage', disabled: false }
      : { id: 'duplicate', group: 'manage', disabled: true, disabledReason: 'dashboard_full' },
    { id: 'delete', group: 'manage', disabled: false }
  );

  return entries;
}
