import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  countDashboardWidgets,
  resizeDashboardWidget,
  setDashboardRowHeight,
} from '@/application/database-yjs/dashboard-layout';
import {
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_MAX_ROW_HEIGHT,
  DASHBOARD_MAX_WIDGETS,
  DASHBOARD_MAX_WIDGETS_PER_ROW,
  DASHBOARD_MIN_ROW_HEIGHT,
  DashboardRow as DashboardRowData,
} from '@/application/database-yjs/dashboard.type';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { DASHBOARD_COLUMN_GAP, DASHBOARD_EDIT_ROW_GAP, DASHBOARD_ROW_GAP } from './constants';
import { useDashboardContext } from './DashboardContext';
import { useDashboardDraggingWidgetId, useDashboardUi } from './DashboardUiContext';
import { DashboardWidget } from './DashboardWidget';
import { useRowHeightResize } from './hooks/useRowHeightResize';
import { applyWidthPreview, useWidthResize } from './hooks/useWidthResize';
import { getColumnBoundaryOffset } from './utils';

const HEIGHT_HANDLE_SIZE = 12;

interface DashboardRowProps {
  row: DashboardRowData;
  rowIndex: number;
  /** Narrow dashboards stack every widget on its own line. */
  stacked: boolean;
}

/**
 * One dashboard row: a 12-column CSS grid whose widgets share the row height.
 * Edit mode adds width handles between widgets, a height handle under the
 * row and an "add widget to this row" button at its right edge.
 */
export const DashboardRow = memo(function DashboardRow({ row, rowIndex, stacked }: DashboardRowProps) {
  const { t } = useTranslation();
  const { rows, isEditing, canEdit, showWidgetTitles, updateRows } = useDashboardContext();
  const { openPicker, showLimitMessage } = useDashboardUi();
  const draggingWidgetId = useDashboardDraggingWidgetId();
  const editing = isEditing && canEdit;
  const gridRef = useRef<HTMLDivElement>(null);
  const getRowElement = useCallback(() => gridRef.current, []);
  const rowId = row.id;

  const commitWidth = useCallback(
    (index: number, delta: number) => updateRows((current) => resizeDashboardWidget(current, rowId, index, delta)),
    [rowId, updateRows]
  );
  const commitHeight = useCallback(
    (height: number) => updateRows((current) => setDashboardRowHeight(current, rowId, height)),
    [rowId, updateRows]
  );

  const widthResize = useWidthResize({
    widgets: row.widgets,
    enabled: editing && !stacked,
    getRowElement,
    onCommit: commitWidth,
  });
  const heightResize = useRowHeightResize({ height: row.height, enabled: editing, onCommit: commitHeight });
  const widths = applyWidthPreview(row.widgets, widthResize.preview);
  const rowHeight = heightResize.height;
  const rowFull = row.widgets.length >= DASHBOARD_MAX_WIDGETS_PER_ROW;
  const dashboardFull = countDashboardWidgets(rows) >= DASHBOARD_MAX_WIDGETS;
  const isDraggingWidget = draggingWidgetId !== null;
  const isResizing = widthResize.preview !== null || heightResize.preview !== null;

  const boundaries = row.widgets.slice(0, -1).map((widget, index) => ({
    key: widget.id,
    index,
    columns: widths.slice(0, index + 1).reduce((sum, width) => sum + width, 0),
    width: widths[index],
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

  const addButton = (
    <Button
      aria-label={t('dashboard.addWidget', { defaultValue: 'Add widget' })}
      className='text-icon-secondary'
      data-row-id={row.id}
      data-testid='dashboard-add-widget-row-button'
      disabled={Boolean(addDisabledReason)}
      onClick={() =>
        openPicker({ mode: 'add', placement: { type: 'existing_row', rowId: row.id, index: row.widgets.length } })
      }
      size='icon-sm'
      type='button'
      variant='ghost'
    >
      <PlusIcon aria-hidden='true' className='h-5 w-5' />
    </Button>
  );

  return (
    <div
      className='group/row relative w-full'
      data-resizing={isResizing ? 'true' : undefined}
      data-row-id={row.id}
      data-row-index={rowIndex}
      data-testid='dashboard-row'
    >
      <div
        className='grid w-full'
        ref={gridRef}
        style={{
          gridTemplateColumns: `repeat(${DASHBOARD_GRID_COLUMNS}, minmax(0, 1fr))`,
          columnGap: DASHBOARD_COLUMN_GAP,
          rowGap: DASHBOARD_ROW_GAP,
          height: stacked ? undefined : rowHeight,
        }}
      >
        {row.widgets.map((widget, index) => (
          <DashboardWidget
            canEdit={canEdit}
            height={rowHeight}
            isDragging={draggingWidgetId === widget.id}
            isEditing={isEditing}
            key={widget.id}
            showWidgetTitles={showWidgetTitles}
            span={stacked ? DASHBOARD_GRID_COLUMNS : widths[index]}
            widget={widget}
          />
        ))}
      </div>

      {editing && !stacked
        ? boundaries.map((boundary) => {
            const active = widthResize.preview?.index === boundary.index;

            return (
              <div
                aria-label={t('dashboard.widget.resizeWidth', { defaultValue: 'Drag to resize' })}
                aria-orientation='vertical'
                aria-valuemax={DASHBOARD_GRID_COLUMNS - 1}
                aria-valuemin={1}
                aria-valuenow={boundary.width}
                className={cn(
                  // `touch-none`: a touch pan would cancel the pointer drag.
                  'group/handle absolute bottom-0 top-0 z-10 flex -translate-x-1/2 cursor-col-resize touch-none justify-center outline-none',
                  isDraggingWidget && 'pointer-events-none'
                )}
                data-active={active ? 'true' : undefined}
                data-index={boundary.index}
                data-row-id={row.id}
                data-testid='dashboard-width-handle'
                key={boundary.key}
                onKeyDown={(event) => widthResize.handleKeyDown(boundary.index, event)}
                onPointerDown={(event) => widthResize.startResize(boundary.index, event)}
                role='separator'
                style={{ left: getColumnBoundaryOffset(boundary.columns), width: DASHBOARD_COLUMN_GAP }}
                tabIndex={0}
              >
                <span
                  className={cn(
                    'my-3 w-1 rounded-full transition-colors',
                    active
                      ? 'bg-fill-theme-thick'
                      : 'bg-transparent group-hover/handle:!bg-fill-theme-thick group-hover/row:bg-border-primary group-focus-visible/handle:!bg-fill-theme-thick'
                  )}
                />
              </div>
            );
          })
        : null}

      {editing && !stacked ? (
        <div className='absolute left-full top-1/2 ml-1 -translate-y-1/2'>
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

      {editing ? (
        <div
          aria-label={t('dashboard.widget.resizeHeight', { defaultValue: 'Drag to change row height' })}
          aria-orientation='horizontal'
          aria-valuemax={DASHBOARD_MAX_ROW_HEIGHT}
          aria-valuemin={DASHBOARD_MIN_ROW_HEIGHT}
          aria-valuenow={rowHeight}
          className={cn(
            'group/height absolute inset-x-0 top-full z-10 flex cursor-row-resize touch-none items-center justify-center outline-none',
            isDraggingWidget && 'pointer-events-none'
          )}
          data-active={heightResize.preview !== null ? 'true' : undefined}
          data-row-id={row.id}
          data-testid='dashboard-height-handle'
          onKeyDown={heightResize.handleKeyDown}
          onPointerDown={heightResize.startResize}
          role='separator'
          style={{ height: HEIGHT_HANDLE_SIZE, marginTop: (DASHBOARD_EDIT_ROW_GAP - HEIGHT_HANDLE_SIZE) / 2 }}
          tabIndex={0}
        >
          <span
            className={cn(
              'h-1 rounded-full transition-all',
              heightResize.preview !== null
                ? 'w-full bg-fill-theme-thick'
                : 'w-10 bg-transparent group-hover/height:w-full group-hover/height:!bg-fill-theme-thick group-hover/row:bg-border-primary group-focus-visible/height:w-full group-focus-visible/height:!bg-fill-theme-thick'
            )}
          />
          {heightResize.preview !== null ? (
            <span className='absolute right-0 top-full mt-1 rounded-200 bg-surface-inverse px-1.5 py-0.5 text-xs text-text-on-fill'>
              {rowHeight}px
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export default DashboardRow;
