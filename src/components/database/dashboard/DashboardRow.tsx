import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  moveDashboardRow,
  resizeDashboardWidget,
  setDashboardRowHeight,
} from '@/application/database-yjs/dashboard-layout';
import { DashboardAddControlState, DashboardRow as DashboardRowData } from '@/application/database-yjs/dashboard.type';

import { DefaultWidgetSpecKind } from './add-widget/add-widget-flow';
import { PendingWidgetBox } from './add-widget/PendingWidgetBox';
import {
  DASHBOARD_COLUMN_GAP,
  DASHBOARD_DROP_INDICATOR_WIDTH,
  DASHBOARD_ROW_GAP,
  DASHBOARD_WIDGET_BOX_INSET,
} from './constants';
import { dashboardFullAnnouncement } from './DashboardFullTooltip';
import { RowAddControl, RowMoveControl } from './DashboardRowControls';
import { DashboardRowGap } from './DashboardRowGap';
import { useDashboardDraggingWidgetId, useDashboardUi } from './DashboardUiContext';
import { DashboardWidget } from './DashboardWidget';
import { dashboardLineSizes, dashboardWidgetSlots, getWidthHandleCenter } from './grid-layout';
import { useRowHeightResize } from './hooks/useRowHeightResize';
import { applyWidthPreview, getWidthHandleBounds, useWidthResize } from './hooks/useWidthResize';
import { RowHeightHandle, WidthResizeHandle } from './RowResizeHandles';
import { getWidgetCardCenter } from './utils';

import type { DropIndicatorStore } from './arrange-stores';

interface DashboardRowProps {
  row: DashboardRowData;
  rowIndex: number;
  /** Widgets per line (`dashboardWrapColumns` of the measured track); fewer than the widgets means the row wraps. */
  wrapColumns: number;
  /** Resize minimum of the measured track (`dashboardMinWidgetColumns`), for the handles' accessible range. */
  minColumns: number;
  // The dashboard-wide state comes as props, not from `DashboardContext`
  // (which carries every row): committing one row leaves the others alone.
  canEdit: boolean;
  isEditing: boolean;
  showWidgetTitles: boolean;
  showIconsInHeading: boolean;
  /** The row controls (`getDashboardRowControls`), as primitives so the row stays memoized. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  addToRow: DashboardAddControlState;
  /** The add flow's pending widget, rendered as a pending slot when it is in this row. */
  pendingWidgetId: string | null;
  /** The pending widget's default spec when it is in this row, else `null`. */
  pendingSpec: DefaultWidgetSpecKind | null;
}

/**
 * The vertical drop line of a widget dragged next to a widget of this row:
 * 2px of the accent over the card's height, centred in the gap at the
 * dropped edge. Reads the dashboard's drop-line store, so only the row that
 * shows the line renders on a pointer move.
 */
function RowDropIndicator({ rowId, store }: { rowId: string; store: DropIndicatorStore }) {
  const getSnapshot = useCallback(() => {
    const geometry = store.get();

    return geometry?.rowId === rowId ? geometry : null;
  }, [rowId, store]);
  const geometry = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);

  if (!geometry) return null;
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute z-20 rounded-full bg-dash-accent'
      data-orientation='vertical'
      data-row-id={rowId}
      data-testid='dashboard-drop-indicator'
      style={{
        left: geometry.left - DASHBOARD_DROP_INDICATOR_WIDTH / 2,
        top: geometry.top,
        width: DASHBOARD_DROP_INDICATOR_WIDTH,
        height: geometry.height,
      }}
    />
  );
}

/**
 * One dashboard row, then the band below it. The row track bleeds 6px past
 * the content column on both sides, so the card edges line up with it; its
 * widget boxes flex on one line, or wrap (4 → 2×2, 3 → 2 + 1, 2 → 1) when a
 * box would be narrower than 240px, every line keeping the row height.
 *
 * Edit mode adds width handles between the widgets of an unwrapped row, the
 * height handle in the band below, the row controls in the page gutter (the
 * ↑/↓ move control on the left, "Add to row" on the right) and the drop line
 * of a widget dragged into the row.
 */
export const DashboardRow = memo(function DashboardRow({
  row,
  rowIndex,
  wrapColumns,
  minColumns,
  canEdit,
  isEditing,
  showWidgetTitles,
  showIconsInHeading,
  canMoveUp,
  canMoveDown,
  addToRow,
  pendingWidgetId,
  pendingSpec,
}: DashboardRowProps) {
  const { t } = useTranslation();
  const {
    addWidget,
    announce,
    consumeRowFocus,
    dropIndicatorStore,
    getRows,
    requestRowFocus,
    startAddWidget,
    updateRows,
  } = useDashboardUi();
  const draggingWidgetId = useDashboardDraggingWidgetId();
  const editing = isEditing && canEdit;
  const rowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const getRowElement = useCallback(() => trackRef.current, []);
  const rowId = row.id;
  const count = row.widgets.length;
  const wrapped = wrapColumns < count;

  const commitWidth = useCallback(
    (index: number, delta: number, minimum: number) =>
      updateRows((current) => resizeDashboardWidget(current, rowId, index, delta, minimum)),
    [rowId, updateRows]
  );
  const commitHeight = useCallback(
    (height: number) => updateRows((current) => setDashboardRowHeight(current, rowId, height)),
    [rowId, updateRows]
  );

  const widthResize = useWidthResize({
    widgets: row.widgets,
    // A row that wraps has no width handles; a running drag is cancelled.
    enabled: editing && !wrapped,
    getRowElement,
    onCommit: commitWidth,
  });
  const heightResize = useRowHeightResize({
    height: row.height,
    enabled: editing,
    onCommit: commitHeight,
    getRowElement,
  });
  const widths = applyWidthPreview(row.widgets, widthResize.preview);
  const slots = dashboardWidgetSlots(widths, wrapColumns);
  const lines = dashboardLineSizes(count, wrapColumns);
  const widthResizing = widthResize.preview !== null;
  const isResizing = widthResizing || heightResize.dragging;
  const preloadPicker = addWidget.preload;

  // ↑ / ↓: swap with the neighbouring row (one write, one undo step), tell
  // assistive technology, and keep the focus on the moved row's arrow.
  const moveRow = useCallback(
    (delta: -1 | 1) => {
      const current = getRows();

      if (moveDashboardRow(current, rowId, delta) === current) return;
      requestRowFocus(rowId, delta < 0 ? 'up' : 'down');
      updateRows((latest) => moveDashboardRow(latest, rowId, delta));
      announce(
        delta < 0
          ? t('dashboard.row.movedUp', { defaultValue: 'Row moved up' })
          : t('dashboard.row.movedDown', { defaultValue: 'Row moved down' })
      );
    },
    [announce, getRows, requestRowFocus, rowId, t, updateRows]
  );
  const addToThisRow = useCallback(
    () => startAddWidget({ type: 'existing_row', rowId, index: count }),
    [count, startAddWidget, rowId]
  );
  const refuseAdd = useCallback(() => announce(dashboardFullAnnouncement(t)), [announce, t]);

  // The moved row renders at its new place: focus the arrow that moved it, or
  // the remaining one when that arrow is gone (the row became first or last).
  useLayoutEffect(() => {
    // The arrows only exist in Edit mode.
    if (!editing) return;
    const control = consumeRowFocus(rowId);

    if (!control) return;
    const root = rowRef.current;
    const wanted = root?.querySelector<HTMLElement>(`[data-testid='dashboard-row-move-${control}']`);
    const other = root?.querySelector<HTMLElement>(
      `[data-testid='dashboard-row-move-${control === 'up' ? 'down' : 'up'}']`
    );

    (wanted ?? other)?.focus();
  }, [canMoveDown, canMoveUp, consumeRowFocus, editing, rowId, rowIndex]);

  const boundaries = wrapped
    ? []
    : row.widgets.slice(0, -1).map((widget, index) => ({
        key: widget.id,
        index,
        columnsBefore: widths.slice(0, index + 1).reduce((sum, width) => sum + width, 0),
        bounds: getWidthHandleBounds(widths, index, minColumns),
      }));

  // The same element while nothing of the handle changes, so the band below
  // the row (memoized) does not render with the row.
  const heightHandle = useMemo(
    () =>
      editing ? (
        <RowHeightHandle
          dragging={heightResize.dragging}
          height={row.height}
          onKeyDown={heightResize.handleKeyDown}
          onPointerDown={heightResize.startResize}
          preview={heightResize.preview}
          rowId={rowId}
        />
      ) : null,
    [
      editing,
      heightResize.dragging,
      heightResize.handleKeyDown,
      heightResize.preview,
      heightResize.startResize,
      row.height,
      rowId,
    ]
  );
  const pillTop = getWidgetCardCenter({ showWidgetTitles });

  return (
    <Fragment>
      <div
        className='group/row relative w-full'
        data-lines={lines.join(',')}
        data-parity-id='dash-row-band'
        data-resizing={isResizing ? 'true' : undefined}
        data-row-id={row.id}
        data-row-index={rowIndex}
        data-testid='dashboard-row'
        data-wrap-columns={wrapColumns}
        ref={rowRef}
      >
        <div
          className='flex flex-wrap'
          data-parity-id='dash-row'
          data-testid='dashboard-row-track'
          ref={trackRef}
          style={{
            // The track bleeds the box inset past the content column on both sides.
            marginLeft: -DASHBOARD_WIDGET_BOX_INSET,
            marginRight: -DASHBOARD_WIDGET_BOX_INSET,
            columnGap: DASHBOARD_COLUMN_GAP,
            rowGap: DASHBOARD_ROW_GAP,
          }}
        >
          {/* `useRowHeightResize` writes the row height on each box: a height drag
              is one style write per box and 20px step, never a render. */}
          {row.widgets.map((widget, index) =>
            widget.id === pendingWidgetId && pendingSpec ? (
              <PendingWidgetBox
                key={widget.id}
                lineSize={slots[index].lineSize}
                showWidgetTitles={showWidgetTitles}
                span={slots[index].span}
                spec={pendingSpec}
                widgetId={widget.id}
              />
            ) : (
              <DashboardWidget
                canEdit={canEdit}
                height={row.height}
                heightPreview={heightResize.preview}
                isDragging={draggingWidgetId === widget.id}
                isEditing={isEditing}
                key={widget.id}
                lineSize={slots[index].lineSize}
                showIconsInHeading={showIconsInHeading}
                showWidgetTitles={showWidgetTitles}
                span={slots[index].span}
                widget={widget}
                widthResizing={widthResizing}
              />
            )
          )}
        </div>

        {editing
          ? boundaries.map((boundary) => (
              <WidthResizeHandle
                active={widthResize.preview?.index === boundary.index}
                center={getWidthHandleCenter(boundary.columnsBefore, boundary.index, count)}
                columns={widths[boundary.index]}
                index={boundary.index}
                key={boundary.key}
                maxColumns={boundary.bounds.max}
                minColumns={boundary.bounds.min}
                onKeyDown={widthResize.handleKeyDown}
                onPointerDown={widthResize.startResize}
                pillTop={pillTop}
                rowId={row.id}
              />
            ))
          : null}

        {editing ? (
          <>
            <RowMoveControl moveDown={canMoveDown} moveUp={canMoveUp} onMove={moveRow} rowId={rowId} />
            <RowAddControl
              onAdd={addToThisRow}
              onPreload={preloadPicker}
              onRefuse={refuseAdd}
              rowId={rowId}
              state={addToRow}
            />
            <RowDropIndicator rowId={rowId} store={dropIndicatorStore} />
          </>
        ) : null}
      </div>

      <DashboardRowGap editing={editing} index={rowIndex + 1}>
        {heightHandle}
      </DashboardRowGap>
    </Fragment>
  );
});

export default DashboardRow;
