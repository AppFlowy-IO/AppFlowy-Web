import { memo, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addDashboardWidget,
  createDashboardWidget,
  getDashboardAddToNewRowState,
  getDashboardRowControls,
} from '@/application/database-yjs/dashboard-layout';
import { DASHBOARD_GRID_COLUMNS, DashboardRow as DashboardRowData } from '@/application/database-yjs/dashboard.type';

import { useAddWidgetFlowState } from './add-widget/add-widget-api';
import { AddWidgetFlowState } from './add-widget/add-widget-flow';
import { DASHBOARD_WIDGET_BOX_INSET } from './constants';
import { useDashboardContext, useDashboardLayout } from './DashboardContext';
import { dashboardFullAnnouncement } from './DashboardFullTooltip';
import { DashboardRow } from './DashboardRow';
import { AddToNewRowButton } from './DashboardRowControls';
import { DashboardRowGap } from './DashboardRowGap';
import { useDashboardDraggingWidgetId, useDashboardUi } from './DashboardUiContext';
import { useDashboardGridBreakpoints } from './hooks/useDashboardGridBreakpoints';
import { resolveAddPlacement } from './widget-moves';

const GRID_BLEED_STYLE = {
  marginLeft: -DASHBOARD_WIDGET_BOX_INSET,
  marginRight: -DASHBOARD_WIDGET_BOX_INSET,
  paddingLeft: DASHBOARD_WIDGET_BOX_INSET,
  paddingRight: DASHBOARD_WIDGET_BOX_INSET,
};

type PendingAdd = Extract<AddWidgetFlowState, { kind: 'creating' }>;

/** The widget the add flow is creating, while it is not persisted yet. */
export const selectPendingAdd = (state: AddWidgetFlowState): PendingAdd | null =>
  state.kind === 'creating' ? state : null;

/**
 * The rows with the add flow's pending widget previewed at its placement
 * (R-SPLIT applies); never persisted. A placement the latest rows refuse
 * previews nothing.
 */
export function withPendingWidget(rows: DashboardRowData[], pending: PendingAdd | null): DashboardRowData[] {
  if (!pending) return rows;
  const placement = resolveAddPlacement(rows, pending.placement);

  if (!placement) return rows;
  return addDashboardWidget(rows, createDashboardWidget('', '', DASHBOARD_GRID_COLUMNS, pending.widgetId), placement);
}

/**
 * The rows of a non-empty dashboard, each followed by its band (12px before
 * the first row, 16px between rows), with the same geometry in View and Edit
 * mode. In Edit mode the bands are drop zones that create a new row and host
 * the height handles, every row gets its controls (`getDashboardRowControls`)
 * and the "Add to new row" button follows the last row.
 *
 * The grid follows its measured width only through the wrap columns and the
 * resize minimum it hands every row (`useDashboardGridBreakpoints`), so a
 * window resize re-renders the grid and a row only when one of them changes.
 */
export const DashboardGrid = memo(function DashboardGrid() {
  const { t } = useTranslation();
  const { isEditing, canEdit } = useDashboardContext();
  const { rows: storedRows, showWidgetTitles, showIconsInHeading } = useDashboardLayout();
  const { announce, startAddWidget, addWidget } = useDashboardUi();
  const pending = useAddWidgetFlowState(addWidget.flow, selectPendingAdd);
  // The pending widget of an add shows at its place (with its row split) until it is persisted.
  const rows = useMemo(() => withPendingWidget(storedRows, pending), [pending, storedRows]);
  const dragging = useDashboardDraggingWidgetId() !== null;
  const gridRef = useRef<HTMLDivElement>(null);
  const breakpoints = useDashboardGridBreakpoints(gridRef);
  const editing = isEditing && canEdit;
  const addNewRow = useCallback(() => startAddWidget({ type: 'new_row' }), [startAddWidget]);
  const refuseAdd = useCallback(() => announce(dashboardFullAnnouncement(t)), [announce, t]);
  const preloadPicker = addWidget.preload;

  return (
    <div
      // The grid box bleeds like the tracks (the padding keeps its content on
      // the column), so it measures as wide as its rows. Visually neutral.
      className='flex flex-col'
      data-parity-id='dash-grid'
      data-testid='dashboard-grid'
      ref={gridRef}
      style={GRID_BLEED_STYLE}
    >
      <DashboardRowGap editing={editing} index={0} />
      {rows.map((row, rowIndex) => {
        const count = row.widgets.length;
        const controls = getDashboardRowControls(rows, row.id);
        const pendingHere = pending !== null && row.widgets.some((widget) => widget.id === pending.widgetId);

        return (
          <DashboardRow
            addToRow={controls.addToRow}
            canEdit={canEdit}
            canMoveDown={controls.moveDown}
            canMoveUp={controls.moveUp}
            isEditing={isEditing}
            key={row.id}
            // An unmeasured grid never wraps a row.
            minColumns={breakpoints?.minColumns[count] ?? 1}
            // Only the row holding the pending widget gets it, so the others stay memoized.
            pendingSpec={pendingHere ? pending.spec : null}
            pendingWidgetId={pendingHere ? pending.widgetId : null}
            row={row}
            rowIndex={rowIndex}
            showIconsInHeading={showIconsInHeading}
            showWidgetTitles={showWidgetTitles}
            wrapColumns={breakpoints?.wrapColumns[count] ?? count}
          />
        );
      })}
      {editing ? (
        <AddToNewRowButton
          hidden={dragging}
          onAdd={addNewRow}
          onPreload={preloadPicker}
          onRefuse={refuseAdd}
          state={getDashboardAddToNewRowState(rows)}
        />
      ) : null}
    </div>
  );
});

export default DashboardGrid;
