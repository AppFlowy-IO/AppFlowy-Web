import { useCallback } from 'react';

import { FieldType, useFilterSelector, useConditionsReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down.svg';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { useConditionsContext } from '../conditions/context';

import { FilterMenu } from './filter-menu';
import { useFilterChipLabel } from './overview/useFilterChipLabel';

export type FilterChipVariant = 'default' | 'pill';

/**
 * A filter chip and its editor. `pill` is the drill-down's chip (WP13 §3.4):
 * 24px tall, fully rounded, the active pill colours and a 12px chevron.
 */
function Filter({
  filterId,
  variant = 'default',
  parityId,
}: {
  filterId: string;
  variant?: FilterChipVariant;
  /** `data-parity-id` of the chip (the visual parity probe measures it). */
  parityId?: string;
}) {
  const filter = useFilterSelector(filterId);
  const readOnly = useConditionsReadOnly();
  const conditionsContext = useConditionsContext();
  const openFilterId = conditionsContext?.openFilterId;
  const setOpenFilterId = conditionsContext?.setOpenFilterId;
  const { description, hasContent, field } = useFilterChipLabel(filter);

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

  const pill = variant === 'pill';

  return (
    <div className={cn('relative', pill ? 'h-6' : 'h-7')}>
      <Popover modal='backdrop' open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {pill ? (
            <button
              aria-readonly={readOnly ? 'true' : 'false'}
              data-parity-id={parityId}
              data-testid={'database-filter-condition'}
              data-variant='pill'
              className={cn(
                'flex h-6 max-w-[300px] items-center gap-1 rounded-full px-2 text-sm outline-none',
                'bg-dash-pill-bg-active text-dash-pill-fg-active hover:brightness-95',
                'focus-visible:ring-1 focus-visible:ring-border-theme-thick'
              )}
            >
              <FieldCustomIcon fieldId={filter.fieldId} className={'h-3.5 w-3.5 shrink-0'} />
              <span className={'max-w-[200px] truncate whitespace-nowrap'}>{buttonText}</span>
              <ArrowDown className={'h-3 w-3 shrink-0'} data-testid='filter-chip-chevron' />
            </button>
          ) : (
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
          )}
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
