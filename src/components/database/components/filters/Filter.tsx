import { useFilterSelector, useReadOnly } from '@/application/database-yjs';
import { FilterContentOverview } from './overview';
import React, { useState } from 'react';
import { FieldDisplay } from '@/components/database/components/field';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down.svg';
import { FilterMenu } from './filter-menu';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

function Filter ({ filterId }: { filterId: string }) {
  const filter = useFilterSelector(filterId);
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);

  if (!filter) return null;

  return (
    <div className={'relative h-7'}>
      <Button
        onClick={(e) => {
          e.stopPropagation();
          if (readOnly) return;
          setOpen(prev => {
            return !prev;
          });
        }}
        size={'sm'}
        aria-readonly={readOnly ? 'true' : 'false'}
        variant={'outline'}
        data-testid={'database-filter-condition'}
        className={'justify-start gap-0 flex-1 rounded-full overflow-hidden'}
      >
        <FieldDisplay
          fieldId={filter.fieldId}
          className={'truncate max-w-[120px]'}
        />

        <div className={'whitespace-nowrap text-xs truncate max-w-[120px] font-medium'}>
          <FilterContentOverview filter={filter} />
        </div>
        <ArrowDown className={'w-5 h-5'} />
      </Button>
      {open && (
        <Popover
          modal
          open={open}
          onOpenChange={setOpen}
        >
          <PopoverTrigger asChild>
            <div className={'absolute top-0 left-0 w-full h-full z-[-1]'} />
          </PopoverTrigger>
          <PopoverContent
            onCloseAutoFocus={e => e.preventDefault()}
            className={'p-2'}
            onClick={e => {
              e.stopPropagation();
            }}
          >
            <FilterMenu filter={filter} />
          </PopoverContent>
        </Popover>)}
    </div>
  );
}

export default Filter;
