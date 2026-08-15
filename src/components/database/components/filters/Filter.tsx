import { useCallback } from 'react';

import { FieldType, useFieldSelector, useFilterSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down.svg';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { useConditionsContext } from '../conditions/context';

import { FilterMenu } from './filter-menu';
import { useFilterChipLabel } from './overview/useFilterChipLabel';

function Filter({ filterId }: { filterId: string }) {
  const filter = useFilterSelector(filterId);
  const readOnly = useReadOnly();
  const openFilterId = useConditionsContext()?.openFilterId;
  const setOpenFilterId = useConditionsContext()?.setOpenFilterId;
  const { field } = useFieldSelector(filter?.fieldId ?? '');
  const { description, hasContent } = useFilterChipLabel(filter);

  const open = openFilterId === filterId;

  const setOpen = useCallback(
    (open: boolean) => {
      if (open && readOnly) return;
      setOpenFilterId?.(open ? filterId : undefined);
    },
    [filterId, readOnly, setOpenFilterId]
  );

  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  // Desktop constrains date and relation editors to 400px, all others to 320px.
  const wideMenu = [FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime, FieldType.Relation].includes(
    fieldType
  );

  if (!filter || !field) return null;

  const fieldName = field.get(YjsDatabaseKey.name) ?? '';
  const buttonText = hasContent ? `${fieldName}: ${description}` : fieldName;

  return (
    <div className={'relative h-7'}>
      <Popover modal open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            aria-readonly={readOnly ? 'true' : 'false'}
            data-testid={'database-filter-condition'}
            className={cn(
              'flex h-7 max-w-[300px] items-center rounded-full border px-2 py-1 outline-none',
              hasContent
                ? 'border-border-theme-thick bg-fill-theme-select'
                : 'border-border-primary bg-transparent hover:bg-fill-content-hover'
            )}
          >
            <FieldCustomIcon
              fieldId={filter.fieldId}
              className={cn('h-4 w-4 shrink-0', hasContent ? 'text-other-colors-text-event' : 'text-icon-primary')}
            />
            <span
              className={cn(
                'ml-1 max-w-[200px] truncate whitespace-nowrap text-sm font-medium',
                hasContent ? 'text-other-colors-text-event' : 'text-text-primary'
              )}
            >
              {buttonText}
            </span>
            <ArrowDown
              className={cn('ml-1 h-5 w-5 shrink-0', hasContent ? 'text-icon-info-thick' : 'text-icon-secondary')}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align='start'
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn('p-2', wideMenu ? 'w-[400px]' : 'w-[320px]')}
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
