import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CalendarEvent, usePrimaryFieldId } from '@/application/database-yjs';
import { ReactComponent as DropdownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { Button } from '@/components/ui/button';
import { DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { NoDateRow } from './NoDateRow';

interface NoDateButtonProps {
  emptyEvents: CalendarEvent[];
  isWeekView: boolean;
  onDragStart?: (rowId: string) => void;
  draggingRowId?: string | null;
  onDragEnd?: () => void;
}

export const NoDateButton = memo(
  ({ onDragEnd, emptyEvents, isWeekView, onDragStart, draggingRowId }: NoDateButtonProps) => {
    const [open, setOpen] = useState(false);
    const { t } = useTranslation();
    const primaryFieldId = usePrimaryFieldId();

    if (emptyEvents.length === 0 || !primaryFieldId) {
      return null;
    }

    return (
      <Popover open={open}>
        <PopoverTrigger asChild>
          <Button
            onClick={() => {
              setOpen((prev) => !prev);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            size='sm'
            variant='ghost'
            className='no-date-button gap-1 overflow-hidden whitespace-nowrap'
          >
            {`${t('calendar.settings.noDateTitle')} (${emptyEvents.length})`}
            <DropdownIcon className='h-5 w-5 text-icon-secondary' />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
          onMouseUp={() => {
            onDragEnd?.();
          }}
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement;

            if (target.closest('.MuiDialog-root')) return;
            setOpen(false);
          }}
          className='appflowy-scroller max-h-[360px] w-[260px] overflow-y-auto border border-border-primary bg-surface-layer-04 p-2'
        >
          <div
            style={{
              opacity: draggingRowId ? 0.6 : 1,
              transition: 'opacity 0.2s ease-in-out',
            }}
          >
            <DropdownMenuLabel className='px-3'>{t('calendar.settings.noDatePopoverTitle')}</DropdownMenuLabel>
            <div className='flex flex-col'>
              {emptyEvents.map((event) => {
                const rowId = event.id;

                return (
                  <NoDateRow
                    primaryFieldId={primaryFieldId}
                    rowId={rowId}
                    key={event.id}
                    isWeekView={isWeekView}
                    onDragStart={onDragStart}
                    isDragging={draggingRowId === rowId}
                  />
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }
);

export default NoDateButton;
