import { memo, MutableRefObject, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useRowMetaSelector } from '@/application/database-yjs';
import { ReactComponent as ExpandIcon } from '@/assets/icons/expand.svg';
import { DropRowIndicator } from '@/components/database/components/drag-and-drop/DropRowIndicator';
import { type Edge, useRowDnd } from '@/components/database/components/drag-and-drop/useRowDnd';
import { CardField } from '@/components/database/components/field/CardField';
import { GalleryRowIcon } from '@/components/database/gallery/GalleryRowIcon';
import { RowActionsMenu } from '@/components/database/list/ListRowActions';
import { useListHasSorts } from '@/components/database/list/ListSortState';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { TimelineRowModel } from './hooks/useTimelineRows';
import { TimelineTableViewport, timelinePropertyColumnWidth, useTimelineTableColumnWidths } from './TimelineTable';

import type { TimelineRowActions } from './TimelineRow';

export const TIMELINE_ROW_DRAG_TYPE = 'database-timeline-row';

interface TimelineSidebarRowProps {
  row: TimelineRowModel;
  editable: boolean;
  selected?: boolean;
  /** The gutter's insert / duplicate actions, owned by the view. */
  rowActions: TimelineRowActions;
  /** Properties shown as columns after the title. */
  tableFieldIds: string[];
  /** When grouped: inserted rows inherit this group's value. */
  groupFieldId?: string;
  groupId?: string;
  /** The whole timeline row, so a drop anywhere along it counts. */
  dropTargetRef: MutableRefObject<HTMLDivElement | null>;
  onOpen?: (rowId: string) => void;
  onSelect?: (rowId: string | null) => void;
  onDropRow?: (sourceRowId: string, targetRowId: string, edge: Edge) => void;
}

/**
 * One row of the docked table: Notion's hover `+` / `⋮⋮` gutter (insert,
 * duplicate, delete, drag to reorder — the List view's actions), the page
 * icon and title, and the open button.
 */
export const TimelineSidebarRow = memo(
  ({
    row,
    editable,
    selected,
    rowActions,
    tableFieldIds,
    groupFieldId,
    groupId,
    dropTargetRef,
    onOpen,
    onSelect,
    onDropRow,
  }: TimelineSidebarRowProps) => {
    const { t } = useTranslation();
    const columnWidths = useTimelineTableColumnWidths();
    const meta = useRowMetaSelector(row.rowId);
    const icon = meta?.icon ?? '';
    const cellRef = useRef<HTMLDivElement | null>(null);
    const dragHandleRef = useRef<HTMLDivElement | null>(null);
    const hasSorts = useListHasSorts();
    // Bound per row so the shared menu needs no row-level dispatch hooks.
    const addAbove = useCallback(
      () => rowActions.addAbove(row.rowId, groupFieldId, groupId),
      [groupFieldId, groupId, row.rowId, rowActions]
    );
    const addBelow = useCallback(
      () => rowActions.addBelow(row.rowId, groupFieldId, groupId),
      [groupFieldId, groupId, row.rowId, rowActions]
    );
    const duplicate = useCallback(() => rowActions.duplicate(row.rowId), [row.rowId, rowActions]);
    const dnd = useRowDnd({
      dragHandleRef,
      dropTargetRef,
      dragType: TIMELINE_ROW_DRAG_TYPE,
      enabled: editable && Boolean(onDropRow),
      hasSorts,
      onDropRow,
      rowId: row.rowId,
      rowRef: cellRef,
    });

    return (
      <TimelineTableViewport>
        <div
          ref={cellRef}
          className={cn(
            // `group/list-row` reveals the shared row actions on hover, as in the List view.
            'group/list-row relative flex h-full items-center overflow-hidden border-b border-border-primary bg-background-primary text-sm text-text-primary',
            // The selection tint is translucent: paint it over the opaque
            // background rather than instead of it, or the bar and arrows
            // scrolled under the docked table show through.
            selected && 'before:pointer-events-none before:absolute before:inset-0 before:bg-fill-theme-select',
            dnd.dragging && 'opacity-40'
          )}
          data-testid={`timeline-sidebar-cell-${row.rowId}`}
        >
          {editable ? (
            <RowActionsMenu
              dragHandleRef={(element) => {
                dragHandleRef.current = element;
              }}
              reorderable={Boolean(onDropRow)}
              rowId={row.rowId}
              addAbove={addAbove}
              addBelow={addBelow}
              duplicate={duplicate}
            />
          ) : (
            <div className='w-2 shrink-0' />
          )}
          <button
            type='button'
            className='flex min-w-0 flex-1 basis-0 items-center gap-2 truncate rounded-200 px-1 py-0.5 text-left hover:bg-fill-content-hover'
            onClick={() => {
              if (dnd.ignoreClickRef.current) return;
              onSelect?.(row.rowId);
            }}
            onDoubleClick={() => onOpen?.(row.rowId)}
            data-testid={`timeline-sidebar-row-${row.rowId}`}
          >
            {icon ? <GalleryRowIcon icon={icon} /> : null}
            <span className='truncate'>{row.title || t('grid.row.titlePlaceholder', { defaultValue: 'Untitled' })}</span>
          </button>
          {tableFieldIds.map((fieldId) => (
            <div
              key={fieldId}
              className='flex h-full shrink-0 items-center overflow-hidden border-l border-border-primary px-2'
              style={{ width: timelinePropertyColumnWidth(columnWidths, fieldId) }}
              data-testid={`timeline-table-cell-${row.rowId}-${fieldId}`}
            >
              <CardField rowId={row.rowId} fieldId={fieldId} />
            </div>
          ))}
          {/* Trailing control slot, the same width as the header's table toggle, so
            the property columns line up with their headers. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                className='mx-0.5 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/list-row:opacity-100'
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
          {dnd.closestEdge ? <DropRowIndicator edge={dnd.closestEdge} /> : null}
          {dnd.clearSortsDialog}
        </div>
      </TimelineTableViewport>
    );
  }
);

TimelineSidebarRow.displayName = 'TimelineSidebarRow';
