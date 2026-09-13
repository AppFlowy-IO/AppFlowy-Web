import { memo, MutableRefObject, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Row, useRowMetaSelector } from '@/application/database-yjs';
import { ReactComponent as ExpandIcon } from '@/assets/icons/expand.svg';
import { DropRowIndicator } from '@/components/database/components/drag-and-drop/DropRowIndicator';
import { type Edge, useRowDnd } from '@/components/database/components/drag-and-drop/useRowDnd';
import { CardField } from '@/components/database/components/field/CardField';
import { GalleryRowIcon } from '@/components/database/gallery/GalleryRowIcon';
import { ListRowActions } from '@/components/database/list/ListRowActions';
import { useListHasSorts } from '@/components/database/list/ListSortState';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { TIMELINE_TABLE_COLUMN_WIDTH } from './constants';
import { TimelineRowModel } from './hooks/useTimelineRows';

export const TIMELINE_ROW_DRAG_TYPE = 'database-timeline-row';

interface TimelineSidebarRowProps {
  row: TimelineRowModel;
  width: number;
  editable: boolean;
  selected?: boolean;
  /** View-ordered rows, needed by "insert above". */
  rowOrders: Row[];
  /** Properties shown as columns after the title. */
  tableFieldIds: string[];
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
    width,
    editable,
    selected,
    rowOrders,
    tableFieldIds,
    dropTargetRef,
    onOpen,
    onSelect,
    onDropRow,
  }: TimelineSidebarRowProps) => {
    const { t } = useTranslation();
    const meta = useRowMetaSelector(row.rowId);
    const icon = meta?.icon ?? '';
    const cellRef = useRef<HTMLDivElement | null>(null);
    const dragHandleRef = useRef<HTMLDivElement | null>(null);
    const hasSorts = useListHasSorts();
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
      <div
        ref={cellRef}
        className={cn(
          // `group/list-row` reveals the shared row actions on hover, as in the List view.
          'group/list-row sticky left-0 z-10 flex h-full shrink-0 items-center overflow-hidden border-b border-r border-border-primary bg-background-primary text-sm text-text-primary',
          selected && 'bg-fill-theme-select',
          dnd.dragging && 'opacity-40'
        )}
        style={{ width }}
        data-testid={`timeline-sidebar-cell-${row.rowId}`}
      >
        {editable ? (
          <ListRowActions
            dragHandleRef={(element) => {
              dragHandleRef.current = element;
            }}
            reorderable={Boolean(onDropRow)}
            rowId={row.rowId}
            rowOrders={rowOrders}
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon-sm'
              className='mr-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/list-row:opacity-100'
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
        {tableFieldIds.map((fieldId) => (
          <div
            key={fieldId}
            className='flex h-full shrink-0 items-center overflow-hidden border-l border-border-primary px-2'
            style={{ width: TIMELINE_TABLE_COLUMN_WIDTH }}
            data-testid={`timeline-table-cell-${row.rowId}-${fieldId}`}
          >
            <CardField rowId={row.rowId} fieldId={fieldId} />
          </div>
        ))}
        {dnd.closestEdge ? <DropRowIndicator edge={dnd.closestEdge} /> : null}
        {dnd.clearSortsDialog}
      </div>
    );
  }
);

TimelineSidebarRow.displayName = 'TimelineSidebarRow';
