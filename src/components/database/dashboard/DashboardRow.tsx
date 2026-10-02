import { CSSProperties, Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resizeDashboardWidget, setDashboardRowHeight } from '@/application/database-yjs/dashboard-layout';
import {
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DashboardRow as DashboardRowData,
} from '@/application/database-yjs/dashboard.type';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/arrow_down.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import {
  DASHBOARD_COLUMN_GAP,
  DASHBOARD_ROW_CONTROL_OFFSET,
  DASHBOARD_ROW_CONTROL_SIZE,
  DASHBOARD_ROW_GAP,
} from './constants';
import { DashboardRowGap } from './DashboardRowGap';
import { useDashboardDraggingWidgetId, useDashboardHost, useDashboardUi } from './DashboardUiContext';
import { DashboardWidget } from './DashboardWidget';
import { dashboardLineSizes, dashboardWidgetSlots, getWidthHandleCenter } from './grid-layout';
import { ROW_HEIGHT_CSS_VARIABLE, useRowHeightResize } from './hooks/useRowHeightResize';
import { applyWidthPreview, useWidthResize } from './hooks/useWidthResize';
import { RowHeightHandle, WidthResizeHandle } from './RowResizeHandles';
import { preloadWidgetPicker } from './WidgetPicker';

/** How long the boxes animate their width after a discrete change (200ms plus slack). */
const REFLOW_MS = 250;

// Notion's row controls: round, tinted buttons centred in the page gutter on
// both sides of a row, shown while the row is hovered (or one of them has
// focus). The anchors take no width; their centre sits 30px outside the column.
const CONTROL_ANCHOR_CLASS =
  'absolute inset-y-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-in-out focus-within:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none';
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
  const { openPicker, showLimitMessage, updateRows } = useDashboardUi();
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
  const rowFull = count >= DASHBOARD_MAX_WIDGETS_PER_ROW;
  const isDraggingWidget = draggingWidgetId !== null;
  const isResizing = widthResize.preview !== null || heightResize.dragging;
  // Seeds the row height variable for the first paint only: `useRowHeightResize`
  // writes it from then on, so a render during a drag (a collaborator's edit)
  // cannot put the persisted height back, nor skip writing a committed one.
  const [initialRowHeight] = useState(row.height);
  const preloadPicker = useCallback(() => preloadWidgetPicker(workspaceId, variant), [variant, workspaceId]);

  // Widths animate after a discrete change only (a committed width, a new wrap,
  // a widget added, moved or removed), never during a drag or a window resize.
  const [reflow, setReflow] = useState(false);
  const layoutKey = `${wrapColumns}|${row.widgets.map((widget) => `${widget.id}:${widget.width}`).join(',')}`;
  const previousLayoutKeyRef = useRef(layoutKey);

  useLayoutEffect(() => {
    if (previousLayoutKeyRef.current === layoutKey) return;
    previousLayoutKeyRef.current = layoutKey;
    if (widthResize.preview === null) setReflow(true);
  }, [layoutKey, widthResize.preview]);

  useEffect(() => {
    if (!reflow) return;
    const timeout = window.setTimeout(() => setReflow(false), REFLOW_MS);

    return () => window.clearTimeout(timeout);
  }, [reflow]);

  const boundaries = wrapped
    ? []
    : row.widgets.slice(0, -1).map((widget, index) => ({
        key: widget.id,
        index,
        columnsBefore: widths.slice(0, index + 1).reduce((sum, width) => sum + width, 0),
      }));

  const addDisabledReason = dashboardFull
    ? t('dashboard.widgetLimit', {
        count: DASHBOARD_MAX_WIDGETS,
        defaultValue: 'Dashboards support up to {{count}} widgets.',
      })
    : rowFull
    ? t('dashboard.rowLimit', {
        count: DASHBOARD_MAX_WIDGETS_PER_ROW,
        defaultValue: 'A row holds up to {{count}} widgets.',
      })
    : null;

  const insertLabel = t('dashboard.insertRowBelow', { defaultValue: 'Insert a row below' });
  // A new row needs one free widget slot; the row itself may be full.
  const insertButton = (
    <Button
      aria-label={insertLabel}
      className={EDGE_BUTTON_CLASS}
      data-row-id={row.id}
      data-testid='dashboard-insert-row-button'
      disabled={dashboardFull}
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
      aria-label={t('dashboard.addWidget', { defaultValue: 'Add widget' })}
      className={EDGE_BUTTON_CLASS}
      data-parity-id='dash-row-control-add'
      data-row-id={row.id}
      data-testid='dashboard-add-widget-row-button'
      disabled={Boolean(addDisabledReason)}
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

  return (
    <Fragment>
      <div
        className='group/row relative w-full'
        data-lines={lines.join(',')}
        data-reflow={reflow ? 'true' : undefined}
        data-resizing={isResizing ? 'true' : undefined}
        data-row-id={row.id}
        data-row-index={rowIndex}
        data-testid='dashboard-row'
        data-wrap-columns={wrapColumns}
      >
        <div
          className='-mx-1.5 flex flex-wrap'
          data-parity-id='dash-row'
          data-testid='dashboard-row-track'
          ref={trackRef}
          style={
            {
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
                index={boundary.index}
                inert={isDraggingWidget}
                key={boundary.key}
                minColumns={minColumns}
                onKeyDown={widthResize.handleKeyDown}
                onPointerDown={widthResize.startResize}
                rowId={row.id}
                widths={widths}
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
            {dashboardFull ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className='inline-flex' onClick={() => showLimitMessage('dashboard')}>
                    {insertButton}
                  </span>
                </TooltipTrigger>
                <TooltipContent side='right'>
                  {t('dashboard.widgetLimit', {
                    count: DASHBOARD_MAX_WIDGETS,
                    defaultValue: 'Dashboards support up to {{count}} widgets.',
                  })}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>{insertButton}</TooltipTrigger>
                <TooltipContent side='right'>{insertLabel}</TooltipContent>
              </Tooltip>
            )}
          </div>
        ) : null}

        {editing ? (
          <div
            className={CONTROL_ANCHOR_CLASS}
            data-side='end'
            data-testid='dashboard-row-control-anchor'
            style={{ right: CONTROL_ANCHOR_OFFSET, width: DASHBOARD_ROW_CONTROL_SIZE }}
          >
            {addDisabledReason ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className='inline-flex' onClick={() => showLimitMessage(dashboardFull ? 'dashboard' : 'row')}>
                    {addButton}
                  </span>
                </TooltipTrigger>
                <TooltipContent side='left'>{addDisabledReason}</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>{addButton}</TooltipTrigger>
                <TooltipContent side='left'>{t('dashboard.addWidget', { defaultValue: 'Add widget' })}</TooltipContent>
              </Tooltip>
            )}
          </div>
        ) : null}
      </div>

      <DashboardRowGap editing={editing} index={rowIndex + 1}>
        {editing ? (
          <RowHeightHandle
            dragging={heightResize.dragging}
            height={row.height}
            inert={isDraggingWidget}
            onKeyDown={heightResize.handleKeyDown}
            onPointerDown={heightResize.startResize}
            preview={heightResize.preview}
            rowId={row.id}
          />
        ) : null}
      </DashboardRowGap>
    </Fragment>
  );
});

export default DashboardRow;
