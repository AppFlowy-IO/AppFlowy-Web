import { memo, MouseEvent, PointerEvent as ReactPointerEvent, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Column } from '@/application/database-yjs';
import { ReactComponent as ArrowLeft } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as ArrowRight } from '@/assets/icons/arrow_right.svg';
import { type Edge } from '@/components/database/components/drag-and-drop/useRowDnd';
import { cn } from '@/lib/utils';

import { TIMELINE_ROW_HEIGHT } from './constants';
import { TimelineDragMode } from './hooks/useTimelineDrag';
import { TimelineRowModel } from './hooks/useTimelineRows';
import { BarRect } from './scale/geometry';
import { TimelineBar, TimelineBarDragLabel } from './TimelineBar';
import { TimelineSidebarRow } from './TimelineSidebarRow';

/** Row-creation actions shared by every table row; the view owns the dispatches. */
export interface TimelineRowActions {
  addAbove: (rowId: string, groupFieldId?: string, groupId?: string) => Promise<unknown>;
  addBelow: (rowId: string, groupFieldId?: string, groupId?: string) => Promise<unknown>;
  duplicate: (rowId: string) => Promise<unknown>;
}

interface TimelineRowProps {
  row: TimelineRowModel;
  rect: BarRect | null;
  /** The bar lies (partly) beyond the visible canvas on that side. */
  offscreenLeft: boolean;
  offscreenRight: boolean;
  rowIndex: number;
  sidebarWidth: number;
  showSidebar: boolean;
  propertyFields: Column[];
  editable: boolean;
  dateEditable: boolean;
  selected?: boolean;
  dragging?: boolean;
  following?: boolean;
  dragLabel?: TimelineBarDragLabel;
  progress?: number;
  progressPreview?: number;
  /** Any drag is in progress somewhere on the canvas. */
  anyDragging?: boolean;
  /** The scroller the hover card stays inside (right of the docked table). */
  hoverCardBoundary?: Element | null;
  /** User-preference time formatter shared by all bars. */
  formatTime: (date: Date) => string;
  /** The table gutter's insert / duplicate actions. */
  rowActions: TimelineRowActions;
  /** Properties shown as table columns after the title. */
  tableFieldIds: string[];
  /** When grouped: the group field and this row's group, so inserts land in the same group. */
  groupFieldId?: string;
  groupId?: string;
  onOpen?: (rowId: string) => void;
  onSelect?: (rowId: string | null) => void;
  onScrollTo?: (x: number) => void;
  onBarPointerDown?: (event: ReactPointerEvent<HTMLElement>, row: TimelineRowModel, mode: TimelineDragMode) => void;
  /** An undated row's canvas was clicked at canvas pixel `x`. */
  onEmptyClick?: (row: TimelineRowModel, x: number) => void;
  /** The empty canvas of a dated row was clicked (client coordinates). */
  onCanvasClick?: (clientX: number, clientY: number) => void;
  /** A table row was dropped on this one (undefined = reordering disabled). */
  onDropRow?: (sourceRowId: string, targetRowId: string, edge: Edge) => void;
  /** A dependency field is bound, so bars offer a connector handle. */
  linkable?: boolean;
  /** A connector is being dragged over this row's bar. */
  linkTarget?: boolean;
  /** The connector handle was pressed: start a link drag from this row. */
  onLinkPointerDown?: (
    event: ReactPointerEvent<HTMLElement>,
    row: TimelineRowModel,
    rect: BarRect,
    index: number
  ) => void;
}

function OffscreenPill({
  direction,
  offset,
  onClick,
}: {
  direction: 'left' | 'right';
  offset: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const Icon = direction === 'left' ? ArrowLeft : ArrowRight;

  return (
    <button
      type='button'
      aria-label={t('timeline.scrollToBar', { defaultValue: 'Scroll to item' })}
      data-testid={`timeline-offscreen-${direction}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className='pointer-events-auto sticky z-[5] my-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-200 border border-border-primary bg-background-primary text-icon-secondary hover:bg-fill-content-hover'
      style={direction === 'left' ? { left: offset, marginLeft: 6 } : { right: offset, marginRight: 6 }}
    >
      <Icon aria-hidden className='h-3.5 w-3.5' />
    </button>
  );
}

export const TimelineRow = memo(
  ({
    row,
    rowIndex,
    rect,
    offscreenLeft,
    offscreenRight,
    sidebarWidth,
    showSidebar,
    propertyFields,
    editable,
    dateEditable,
    selected,
    dragging,
    following,
    dragLabel,
    progress,
    progressPreview,
    anyDragging,
    hoverCardBoundary,
    formatTime,
    rowActions,
    tableFieldIds,
    groupFieldId,
    groupId,
    onOpen,
    onSelect,
    onScrollTo,
    onBarPointerDown,
    onEmptyClick,
    onCanvasClick,
    onDropRow,
    linkable,
    linkTarget,
    onLinkPointerDown,
  }: TimelineRowProps) => {
    const { t } = useTranslation();
    const rowRef = useRef<HTMLDivElement | null>(null);
    const showLeftPill = rect !== null && offscreenLeft;
    const showRightPill = rect !== null && offscreenRight;
    const canAssignDate = dateEditable && rect === null;
    const handleBarPointerDown = useCallback(
      (event: ReactPointerEvent<HTMLElement>, mode: TimelineDragMode) => {
        onSelect?.(row.rowId);
        onBarPointerDown?.(event, row, mode);
      },
      [onBarPointerDown, onSelect, row]
    );
    // Stable per row so a row re-render (scroll pill, drag state) doesn't
    // re-render the memoized bar.
    const handleLinkPointerDown = useCallback(
      (event: ReactPointerEvent<HTMLElement>) => {
        if (rect) onLinkPointerDown?.(event, row, rect, rowIndex);
      },
      [onLinkPointerDown, rect, row, rowIndex]
    );

    const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
      if (!canAssignDate) {
        // Clicking the empty grid clears the selection (as in frappe) unless a
        // dependency line runs under the pointer — the view decides.
        onCanvasClick?.(event.clientX, event.clientY);
        return;
      }

      const bounds = event.currentTarget.getBoundingClientRect();

      onEmptyClick?.(row, event.clientX - bounds.left);
    };

    return (
      <div
        ref={rowRef}
        className='group/row flex h-full w-full'
        data-testid={`timeline-row-${row.rowId}`}
        data-selected={selected ? 'true' : undefined}
      >
        {showSidebar ? (
          <TimelineSidebarRow
            row={row}
            editable={editable}
            selected={selected}
            rowActions={rowActions}
            tableFieldIds={tableFieldIds}
            groupFieldId={groupFieldId}
            groupId={groupId}
            dropTargetRef={rowRef}
            onOpen={onOpen}
            onSelect={onSelect}
            onDropRow={onDropRow}
          />
        ) : (
          <div
            className={cn(
              'sticky left-0 z-10 h-full shrink-0 border-b border-r border-border-primary bg-background-primary',
              selected && 'before:pointer-events-none before:absolute before:inset-0 before:bg-fill-theme-select'
            )}
            style={{ width: sidebarWidth }}
          />
        )}

        <div
          className={cn(
            'relative flex h-full flex-1 border-b border-border-primary',
            canAssignDate && 'cursor-cell hover:bg-fill-content-hover'
          )}
          style={{ height: TIMELINE_ROW_HEIGHT }}
          onClick={handleCanvasClick}
          title={
            canAssignDate
              ? t('timeline.settings.noDatePopoverTitle', { defaultValue: 'Click to assign a date' })
              : undefined
          }
          data-testid={canAssignDate ? `timeline-row-empty-${row.rowId}` : undefined}
        >
          {rect ? (
            <TimelineBar
              row={row}
              rect={rect}
              propertyFields={propertyFields}
              editable={editable}
              dateEditable={dateEditable}
              selected={selected}
              dragging={dragging}
              following={following}
              dragLabel={dragLabel}
              progress={progress}
              progressPreview={progressPreview}
              hoverDisabled={anyDragging}
              hoverCardBoundary={hoverCardBoundary}
              hoverCardInset={sidebarWidth}
              formatTime={formatTime}
              linkable={linkable}
              linkTarget={linkTarget}
              onLinkPointerDown={onLinkPointerDown ? handleLinkPointerDown : undefined}
              onOpen={onOpen}
              onPointerDown={handleBarPointerDown}
            />
          ) : null}

          {showLeftPill && rect ? (
            <div className='pointer-events-none absolute inset-0 z-[5] flex'>
              <OffscreenPill direction='left' offset={sidebarWidth + 6} onClick={() => onScrollTo?.(rect.left)} />
            </div>
          ) : null}
          {showRightPill && rect ? (
            <div className='pointer-events-none absolute inset-0 z-[5] flex justify-end'>
              <OffscreenPill direction='right' offset={6} onClick={() => onScrollTo?.(rect.left + rect.width)} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }
);

TimelineRow.displayName = 'TimelineRow';
