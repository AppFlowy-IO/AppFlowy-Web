import { memo, MouseEvent, PointerEvent as ReactPointerEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Column, useRowMetaSelector } from '@/application/database-yjs';
import { ReactComponent as ArrowLeft } from '@/assets/icons/arrow_left.svg';
import { ReactComponent as ArrowRight } from '@/assets/icons/arrow_right.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/expand.svg';
import { GalleryRowIcon } from '@/components/database/gallery/GalleryRowIcon';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { TIMELINE_ROW_HEIGHT } from './constants';
import { TimelineDragMode } from './hooks/useTimelineDrag';
import { TimelineRowModel } from './hooks/useTimelineRows';
import { BarRect } from './scale/geometry';
import { TimelineBar, TimelineBarDragLabel } from './TimelineBar';

interface TimelineRowProps {
  row: TimelineRowModel;
  rect: BarRect | null;
  /** The bar lies (partly) beyond the visible canvas on that side. */
  offscreenLeft: boolean;
  offscreenRight: boolean;
  sidebarWidth: number;
  showSidebar: boolean;
  propertyFields: Column[];
  editable: boolean;
  selected?: boolean;
  dragging?: boolean;
  following?: boolean;
  dragLabel?: TimelineBarDragLabel;
  progress?: number;
  progressPreview?: number;
  /** Any drag is in progress somewhere on the canvas. */
  anyDragging?: boolean;
  /** User-preference time formatter shared by all bars. */
  formatTime: (date: Date) => string;
  onOpen?: (rowId: string) => void;
  onSelect?: (rowId: string | null) => void;
  onScrollTo?: (x: number) => void;
  onBarPointerDown?: (event: ReactPointerEvent<HTMLElement>, row: TimelineRowModel, mode: TimelineDragMode) => void;
  /** An undated row's canvas was clicked at canvas pixel `x`. */
  onEmptyClick?: (row: TimelineRowModel, x: number) => void;
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
    rect,
    offscreenLeft,
    offscreenRight,
    sidebarWidth,
    showSidebar,
    propertyFields,
    editable,
    selected,
    dragging,
    following,
    dragLabel,
    progress,
    progressPreview,
    anyDragging,
    formatTime,
    onOpen,
    onSelect,
    onScrollTo,
    onBarPointerDown,
    onEmptyClick,
  }: TimelineRowProps) => {
    const { t } = useTranslation();
    const meta = useRowMetaSelector(row.rowId);
    const icon = meta?.icon ?? '';
    const showLeftPill = rect !== null && offscreenLeft;
    const showRightPill = rect !== null && offscreenRight;
    const canAssignDate = editable && rect === null;
    const handleBarPointerDown = useCallback(
      (event: ReactPointerEvent<HTMLElement>, mode: TimelineDragMode) => {
        onSelect?.(row.rowId);
        onBarPointerDown?.(event, row, mode);
      },
      [onBarPointerDown, onSelect, row]
    );

    const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
      if (!canAssignDate) {
        // Clicking the empty grid clears the selection, as in frappe.
        onSelect?.(null);
        return;
      }

      const bounds = event.currentTarget.getBoundingClientRect();

      onEmptyClick?.(row, event.clientX - bounds.left);
    };

    return (
      <div
        className='group/row flex h-full w-full'
        data-testid={`timeline-row-${row.rowId}`}
        data-selected={selected ? 'true' : undefined}
      >
        <div
          className={cn(
            'sticky left-0 z-10 flex h-full shrink-0 items-center gap-1 overflow-hidden border-b border-r border-border-primary bg-background-primary text-sm text-text-primary',
            selected && 'bg-fill-theme-select'
          )}
          style={{ width: sidebarWidth }}
        >
          {showSidebar ? (
            <>
              <button
                type='button'
                className='ml-2 flex min-w-0 flex-1 items-center gap-2 truncate rounded-200 px-1 py-0.5 text-left hover:bg-fill-content-hover'
                onClick={() => onSelect?.(row.rowId)}
                onDoubleClick={() => onOpen?.(row.rowId)}
                data-testid={`timeline-sidebar-row-${row.rowId}`}
              >
                {icon ? <GalleryRowIcon icon={icon} /> : null}
                <span className='truncate'>
                  {row.title || t('grid.row.titlePlaceholder', { defaultValue: 'Untitled' })}
                </span>
              </button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    className='mr-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100'
                    aria-label={t('timeline.openRow', { defaultValue: 'Open' })}
                    data-testid={`timeline-open-row-${row.rowId}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen?.(row.rowId);
                    }}
                  >
                    <ExpandIcon aria-hidden className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('timeline.openRow', { defaultValue: 'Open' })}</TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>

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
              selected={selected}
              dragging={dragging}
              following={following}
              dragLabel={dragLabel}
              progress={progress}
              progressPreview={progressPreview}
              hoverDisabled={anyDragging}
              formatTime={formatTime}
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
