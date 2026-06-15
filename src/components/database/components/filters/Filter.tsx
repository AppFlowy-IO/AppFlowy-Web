import { useCallback } from 'react';

import { useFilterSelector, useReadOnly } from '@/application/database-yjs';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down.svg';
import { FieldDisplay } from '@/components/database/components/field';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useConditionsContext } from '../conditions/context';

import { FilterMenu } from './filter-menu';
import { FilterContentOverview } from './overview';

function Filter({ filterId }: { filterId: string }) {
  const filter = useFilterSelector(filterId);
  const readOnly = useReadOnly();
  const openFilterId = useConditionsContext()?.openFilterId;
  const setOpenFilterId = useConditionsContext()?.setOpenFilterId;

  const open = openFilterId === filterId;

  const setOpen = useCallback(
    (open: boolean) => {
      setOpenFilterId?.(open ? filterId : undefined);
    },
    [filterId, setOpenFilterId]
  );

  if (!filter) return null;

  return (
    <div className={'relative h-7'}>
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            onMouseDown={(e) => {
              if (readOnly) {
                e.stopPropagation();
                e.preventDefault();
                return;
              }
            }}
            size={'sm'}
            aria-readonly={readOnly ? 'true' : 'false'}
            variant={'outline'}
            data-testid={'database-filter-condition'}
            className={'flex-1 justify-start gap-0 overflow-hidden rounded-full'}
          >
            <FieldDisplay fieldId={filter.fieldId} className={'max-w-[120px] truncate'} />

            <div className={'max-w-[120px] truncate whitespace-nowrap text-xs font-medium'}>
              <FilterContentOverview filter={filter} />
            </div>
            <ArrowDown className={'h-5 w-5'} />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align='start'
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={'p-2'}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <FilterMenu filter={filter} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default Filter;
