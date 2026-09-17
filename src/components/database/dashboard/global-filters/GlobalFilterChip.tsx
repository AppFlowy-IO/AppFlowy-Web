import { useCallback, useState } from 'react';

import { DashboardGlobalFilter } from '@/application/database-yjs/dashboard.type';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down.svg';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { GlobalFilterSource } from './global-filter.utils';
import { GlobalFilterMenu } from './GlobalFilterMenu';
import { useGlobalFilterLabel } from './useGlobalFilterLabel';

/** One dashboard filter in the bar; opens its editor. Styled like a view filter chip. */
export function GlobalFilterChip({ filter, sources }: { filter: DashboardGlobalFilter; sources: GlobalFilterSource[] }) {
  const [open, setOpen] = useState(false);
  const { text, active, sourceCount, sourceLabel } = useGlobalFilterLabel(filter, sources);
  const close = useCallback(() => setOpen(false), []);

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          data-testid='dashboard-global-filter-chip'
          data-filter-id={filter.id}
          data-active={active}
          title={text}
          className={cn(
            'flex h-7 max-w-[320px] items-center rounded-full border px-2 py-1 outline-none',
            active
              ? 'border-border-theme-thick bg-fill-theme-select'
              : 'border-border-primary bg-transparent hover:bg-fill-content-hover'
          )}
        >
          <FieldTypeIcon
            type={filter.fieldType}
            className={cn('h-4 w-4 shrink-0', active ? 'text-other-colors-text-event' : 'text-icon-primary')}
          />
          <span
            data-testid='dashboard-global-filter-chip-label'
            className={cn(
              'ml-1 min-w-0 truncate whitespace-nowrap text-sm font-medium',
              active ? 'text-other-colors-text-event' : 'text-text-primary'
            )}
          >
            {text}
          </span>
          <span
            data-testid='dashboard-global-filter-chip-count'
            aria-label={sourceLabel}
            title={sourceLabel}
            className={cn(
              'ml-1 flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-none',
              active ? 'bg-fill-theme-thick text-text-on-fill' : 'bg-fill-content-hover text-text-secondary'
            )}
          >
            {sourceCount}
          </span>
          <ArrowDown
            className={cn('ml-0.5 h-4 w-4 shrink-0', active ? 'text-icon-info-thick' : 'text-icon-secondary')}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[360px]'
        onCloseAutoFocus={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
      >
        <GlobalFilterMenu filterId={filter.id} onClose={close} />
      </PopoverContent>
    </Popover>
  );
}

export default GlobalFilterChip;
