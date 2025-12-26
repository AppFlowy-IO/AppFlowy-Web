import { Draggable } from '@fullcalendar/interaction';
import { useEffect, useRef } from 'react';

import { useCellSelector, useDatabaseContext } from '@/application/database-yjs';
import { useReadOnly } from '@/application/database-yjs/context';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { Cell } from '@/components/database/components/cell';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Log } from '@/utils/log';


interface NoDateRowProps {
  rowId: string;
  primaryFieldId: string;
  isWeekView: boolean;
  onDragStart?: (rowId: string) => void;
  isDragging?: boolean;
}

export function NoDateRow({ rowId, primaryFieldId, isWeekView, onDragStart, isDragging = false }: NoDateRowProps) {
  const toRow = useDatabaseContext()?.navigateToRow;
  const readOnly = useReadOnly();
  const cell = useCellSelector({
    rowId,
    fieldId: primaryFieldId || '',
  });

  const dragRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = dragRef.current;

    if (!element || readOnly) return;

    Log.debug('🎯 Creating optimized Draggable for rowId:', rowId);

    // Create individual Draggable for this row with performance optimizations
    const draggable = new Draggable(element, {
      eventData: {
        title: cell?.data?.toString() || '',
        duration: isWeekView ? '01:00' : undefined,
        extendedProps: {
          rowId: rowId,
        },
      },
    });

    Log.debug('✅ Optimized Draggable created for rowId:', rowId);

    return () => {
      Log.debug('🎯 Destroying optimized Draggable for rowId:', rowId);
      draggable.destroy();
    };
  }, [rowId, cell?.data, isWeekView, readOnly]);

  return (
    <div
      ref={dragRef}
      data-row-id={rowId}
      className={cn(
        'hover:scale-1 group flex h-[36px] w-full items-center gap-2 px-2 py-1 hover:bg-transparent hover:shadow-none',
        'fc-event fc-nodate-event cursor-grab' // Required for FullCalendar dragging
      )}
      onMouseDown={() => {
        Log.debug('🎯 Mouse down on rowId:', rowId);
        onDragStart?.(rowId);
      }}
      style={{
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.2s ease-in-out',
      }}
    >
      {!readOnly && (
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <div className={cn('flex cursor-pointer items-center justify-center')}>
              <DragIcon className='h-5 w-5 text-icon-secondary' />
            </div>
          </TooltipTrigger>
          <TooltipContent side='left' align='center'>
            Drag to the calendar
          </TooltipContent>
        </Tooltip>
      )}

      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <div
            onMouseDownCapture={(e) => {
              e.stopPropagation();
              e.preventDefault();
              toRow?.(rowId);
            }}
            className='flex h-[28px] flex-1 cursor-pointer items-center truncate rounded-300 bg-surface-container-layer-01 px-2 text-sm hover:bg-surface-container-layer-02'
          >
            <Cell
              wrap={false}
              style={{
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
              readOnly
              cell={cell}
              placeholder='Empty'
              rowId={rowId}
              fieldId={primaryFieldId}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side='left' align='center'>{`Click to open ${
          cell?.data?.toString() || 'event'
        }`}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export default NoDateRow;
