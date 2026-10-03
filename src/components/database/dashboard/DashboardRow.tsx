import { CSSProperties, Fragment, memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resizeDashboardWidget, setDashboardRowHeight } from '@/application/database-yjs/dashboard-layout';
import { DASHBOARD_MAX_WIDGETS_PER_ROW, DashboardRow as DashboardRowData } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/arrow_down.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  DASHBOARD_COLUMN_GAP,
  DASHBOARD_MOTION_FAST_CLASS,
  DASHBOARD_ROW_CONTROL_OFFSET,
  DASHBOARD_ROW_CONTROL_SIZE,
  DASHBOARD_ROW_GAP,
  DASHBOARD_WIDGET_BOX_INSET,
} from './constants';
import { LimitedAction } from './DashboardLimitMessage';
import { DashboardRowGap } from './DashboardRowGap';
import {
  DashboardLimitReason,
  useDashboardDraggingWidgetId,
  useDashboardHost,
  useDashboardUi,
} from './DashboardUiContext';
import { DashboardWidget } from './DashboardWidget';
import { dashboardLineSizes, dashboardWidgetSlots, getWidthHandleCenter } from './grid-layout';
import { ROW_HEIGHT_CSS_VARIABLE, useRowHeightResize } from './hooks/useRowHeightResize';
import { applyWidthPreview, getWidthHandleBounds, useWidthResize } from './hooks/useWidthResize';
import { RowHeightHandle, WidthResizeHandle } from './RowResizeHandles';
import { getWidgetCardCenter } from './utils';
import { preloadWidgetPicker } from './WidgetPicker';

// Notion's row controls: round, tinted buttons centred in the page gutter on
// both sides of a row, shown while the row is hovered (or one of them has
// focus). The anchors take no width; their centre sits 30px outside the column.
const CONTROL_ANCHOR_CLASS = cn(
  'absolute inset-y-0 flex items-center justify-center opacity-0 transition-opacity',
  DASHBOARD_MOTION_FAST_CLASS,
  'focus-within:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none'
);
const CONTROL_ANCHOR_OFFSET = -(DASHBOARD_ROW_CONTROL_OFFSET + DASHBOARD_ROW_CONTROL_SIZE / 2);
const EDGE_BUTTON_CLASS = 'rounded-full bg-dash-row-control-bg text-dash-accent';

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
  /** The dashboard holds its maximum number of widgets. */
  dashboardFull: boolean;
}

/**
 * One dashboard row, then the band below it. The row track bleeds 6px past
 * the content column on both sides, so the card edges line up with it; its
 * widget boxes flex on one line, or wrap (4 → 2×2, 3 → 2 + 1, 2 → 1) when a
 * box would be narrower than 240px, every line keeping the row height.
 *
 * Edit mode adds width handles between the widgets of an unwrapped row, the
 * height handle in the band below, and the row controls in the page gutter.
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
  dashboardFull,
}: DashboardRowProps) {
  const { t } = useTranslation();
  const { openPicker, updateRows } = useDashboardUi();
  const { workspaceId, variant } = useDashboardHost();
  const draggingWidgetId = useDashboardDraggingWidgetId();
  const editing = isEditing && canEdit;
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
  const isResizing = widthResize.preview !== null || heightResize.dragging;
  // Seeds the row height variable for the first paint only: `useRowHeightResize`
  // writes it from then on, so a render during a drag (a collaborator's edit)
  // cannot put the persisted height back, nor skip writing a committed one.
  const [initialRowHeight] = useState(row.height);
  const preloadPicker = useCallback(() => preloadWidgetPicker(workspaceId, variant), [variant, workspaceId]);

  const boundaries = wrapped
    ? []
    : row.widgets.slice(0, -1).map((widget, index) => ({
        key: widget.id,
        index,
        columnsBefore: widths.slice(0, index + 1).reduce((sum, width) => sum + width, 0),
        bounds: getWidthHandleBounds(widths, index, minColumns),
      }));

  // A new row needs one free widget slot on the dashboard; a widget in this row also one in the row.
  const insertLimit: DashboardLimitReason | null = dashboardFull ? 'dashboard' : null;
  const addLimit: DashboardLimitReason | null =
    insertLimit ?? (count >= DASHBOARD_MAX_WIDGETS_PER_ROW ? 'row' : null);
  const insertLabel = t('dashboard.insertRowBelow', { defaultValue: 'Insert a row below' });
  const addLabel = t('dashboard.addWidget', { defaultValue: 'Add widget' });
  const insertButton = (
    <Button
      aria-label={insertLabel}
      className={EDGE_BUTTON_CLASS}
      data-row-id={row.id}
      data-testid='dashboard-insert-row-button'
      disabled={insertLimit !== null}
      onClick={() => openPicker({ mode: 'add', placement: { type: 'new_row', rowIndex: rowIndex + 1 } })}
      onFocus={preloadPicker}
      onPointerEnter={preloadPicker}
      size='icon-sm'
      type='button'
      variant='ghost'
    >
      <ArrowDownIcon aria-hidden='true' className='h-4 w-4' />
    </Button>
  );

  const addButton = (
    <Button
      aria-label={addLabel}
      className={EDGE_BUTTON_CLASS}
      data-parity-id='dash-row-control-add'
      data-row-id={row.id}
      data-testid='dashboard-add-widget-row-button'
      disabled={addLimit !== null}
      onClick={() => openPicker({ mode: 'add', placement: { type: 'existing_row', rowId: row.id, index: count } })}
      onFocus={preloadPicker}
      onPointerEnter={preloadPicker}
      size='icon-sm'
      type='button'
      variant='ghost'
    >
      <PlusIcon aria-hidden='true' className='h-5 w-5' data-parity-id='dash-row-control-add__icon' />
    </Button>
  );

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
        data-resizing={isResizing ? 'true' : undefined}
        data-row-id={row.id}
        data-row-index={rowIndex}
        data-testid='dashboard-row'
        data-wrap-columns={wrapColumns}
      >
        <div
          className='flex flex-wrap'
          data-parity-id='dash-row'
          data-testid='dashboard-row-track'
          ref={trackRef}
          style={
            {
              // The track bleeds the box inset past the content column on both sides.
              marginLeft: -DASHBOARD_WIDGET_BOX_INSET,
              marginRight: -DASHBOARD_WIDGET_BOX_INSET,
              columnGap: DASHBOARD_COLUMN_GAP,
              rowGap: DASHBOARD_ROW_GAP,
              // The boxes read the row height from this variable, so a height
              // drag is one style write instead of a render per pixel.
              [ROW_HEIGHT_CSS_VARIABLE]: `${initialRowHeight}px`,
            } as CSSProperties
          }
        >
          {row.widgets.map((widget, index) => (
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
            />
          ))}
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
          <div
            className={CONTROL_ANCHOR_CLASS}
            data-side='start'
            data-testid='dashboard-row-control-anchor'
            style={{ left: CONTROL_ANCHOR_OFFSET, width: DASHBOARD_ROW_CONTROL_SIZE }}
          >
            <LimitedAction limit={insertLimit} side='right' tooltip={insertLabel}>
              {insertButton}
            </LimitedAction>
          </div>
        ) : null}

        {editing ? (
          <div
            className={CONTROL_ANCHOR_CLASS}
            data-side='end'
            data-testid='dashboard-row-control-anchor'
            style={{ right: CONTROL_ANCHOR_OFFSET, width: DASHBOARD_ROW_CONTROL_SIZE }}
          >
            <LimitedAction limit={addLimit} side='left' tooltip={addLabel}>
              {addButton}
            </LimitedAction>
          </div>
        ) : null}
      </div>

      <DashboardRowGap editing={editing} index={rowIndex + 1}>
        {heightHandle}
      </DashboardRowGap>
    </Fragment>
  );
});

export default DashboardRow;
