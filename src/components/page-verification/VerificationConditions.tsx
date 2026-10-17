import { endOfDay, startOfDay } from 'date-fns';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Filter, useReadOnly } from '@/application/database-yjs';
import {
  parseVerificationFilter,
  serializeVerificationFilter,
  VerificationFilterCondition,
  VerificationFilterStatus,
  VerificationPredicate,
} from '@/application/database-yjs/fields/verification';
import { ReactComponent as ClearIcon } from '@/assets/icons/close.svg';
import FieldMenuTitle from '@/components/database/components/filters/filter-menu/FieldMenuTitle';
import { useFilterValueUpdater } from '@/components/database/components/filters/filter-menu/FilterEditorContext';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { DropdownMenuItemTick, dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const statuses = [
  VerificationFilterStatus.Unverified,
  VerificationFilterStatus.Verified,
  VerificationFilterStatus.Expired,
];
const statusNames = ['Unverified', 'Verified', 'Expired'] as const;
const conditions = [
  VerificationFilterCondition.Is,
  VerificationFilterCondition.IsNot,
  VerificationFilterCondition.IsEmpty,
  VerificationFilterCondition.IsNotEmpty,
];
const conditionKeys = [
  'grid.textFilter.is',
  'grid.textFilter.isNot',
  'grid.textFilter.isEmpty',
  'grid.textFilter.isNotEmpty',
] as const;

/** One native leaf editor, shared by the simple chip and advanced rule value. */
export function VerificationFilterMenu({
  filter,
  showHeader = true,
  showConditions = true,
  disabled = false,
}: {
  filter: Filter;
  showHeader?: boolean;
  showConditions?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const updateFilter = useFilterValueUpdater();
  const value = parseVerificationFilter(filter.condition, filter.content ?? '');
  const cannotEdit = readOnly || disabled;
  const update = (patch: Partial<VerificationPredicate>) => {
    if (cannotEdit) return;
    updateFilter({
      filterId: filter.id,
      fieldId: filter.fieldId,
      ...(patch.condition === undefined ? {} : { condition: patch.condition }),
      transformContent: (current) => {
        const next = { ...parseVerificationFilter(filter.condition, current), ...patch };

        if (next.condition === VerificationFilterCondition.IsEmpty) {
          next.expiresAfterMicros = null;
          next.expiresBeforeMicros = null;
        }

        return serializeVerificationFilter(next);
      },
    });
  };

  return (
    <div className='flex flex-col gap-1' data-testid='verification-filter'>
      {showHeader && <FieldMenuTitle fieldId={filter.fieldId} filterId={filter.id} renderConditionSelect={null} />}
      {showConditions &&
        conditions.map((condition) => (
          <button
            key={condition}
            type='button'
            disabled={cannotEdit}
            data-testid={`filter-condition-${condition}`}
            aria-pressed={value.condition === condition}
            className={cn(dropdownMenuItemVariants({ variant: 'default' }), 'w-full text-left')}
            onClick={() => update({ condition })}
          >
            {t(conditionKeys[condition])}
            {value.condition === condition && <DropdownMenuItemTick />}
          </button>
        ))}
      {(value.condition === VerificationFilterCondition.Is || value.condition === VerificationFilterCondition.IsNot) &&
        statuses.map((status) => (
          <button
            key={status}
            type='button'
            disabled={cannotEdit}
            data-testid={`verification-filter-${status}`}
            aria-pressed={value.status === status}
            className={cn(dropdownMenuItemVariants({ variant: 'default' }), 'w-full text-left')}
            onClick={() => update({ status })}
          >
            {t(`grid.verification.status${statusNames[status]}`, { defaultValue: statusNames[status] })}
            {value.status === status && <DropdownMenuItemTick />}
          </button>
        ))}
      {value.condition !== VerificationFilterCondition.IsEmpty && (
        <>
          <VerificationExpiryFilter
            boundary='expiresAfterMicros'
            value={value.expiresAfterMicros}
            disabled={cannotEdit}
            update={update}
          />
          <VerificationExpiryFilter
            boundary='expiresBeforeMicros'
            value={value.expiresBeforeMicros}
            disabled={cannotEdit}
            update={update}
          />
        </>
      )}
    </div>
  );
}

export function VerificationFilterValue({ filter, disabled }: { filter: Filter; disabled?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const value = parseVerificationFilter(filter.condition, filter.content ?? '');

  if (value.condition === VerificationFilterCondition.IsEmpty) return <div className='min-w-0 flex-[7]' />;
  const name =
    value.condition === VerificationFilterCondition.IsNotEmpty
      ? t('grid.verification.expirationDate', { defaultValue: 'Expiration date' })
      : t(`grid.verification.status${statusNames[value.status]}`, { defaultValue: statusNames[value.status] });

  return (
    <div className='min-w-0 flex-[7]'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            className='h-8 w-full justify-start truncate'
            disabled={disabled}
            data-testid='advanced-filter-verification-input'
          >
            {name}
          </Button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-[320px] p-2'>
          <VerificationFilterMenu filter={filter} disabled={disabled} showHeader={false} showConditions={false} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function VerificationExpiryFilter({
  boundary,
  value,
  disabled,
  update,
}: {
  boundary: 'expiresBeforeMicros' | 'expiresAfterMicros';
  value: bigint | null;
  disabled: boolean;
  update: (patch: Partial<VerificationPredicate>) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const upper = boundary === 'expiresBeforeMicros';
  const label = upper
    ? t('grid.verification.expiresOnOrBefore', { defaultValue: 'Expires on or before' })
    : t('grid.verification.expiresOnOrAfter', { defaultValue: 'Expires on or after' });
  const candidate = value === null ? undefined : new Date(Number(value / 1000n));
  const date = candidate && Number.isFinite(candidate.getTime()) ? candidate : undefined;
  const dateLabel = date
    ? date.toLocaleDateString()
    : value === null
    ? t('grid.verification.anyDate', { defaultValue: 'Any date' })
    : t('grid.verification.unsupportedDate', { defaultValue: 'Unsupported date' });

  return (
    <div className='flex items-center gap-1'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant='ghost' size='sm' disabled={disabled} className='h-auto flex-1 justify-start py-2 text-left'>
            <span className='flex flex-col'>
              <span>{label}</span>
              <span className='text-text-secondary'>{dateLabel}</span>
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-fit p-2' onCloseAutoFocus={(event) => event.preventDefault()}>
          <Calendar
            mode='single'
            selected={date}
            defaultMonth={date}
            onSelect={(selected) => {
              // Bounds include the whole local calendar day, including microseconds.
              const micros = selected
                ? BigInt((upper ? endOfDay(selected) : startOfDay(selected)).getTime()) * 1000n + (upper ? 999n : 0n)
                : null;

              update({ [boundary]: micros });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {value !== null && (
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={`${t('button.clear', { defaultValue: 'Clear' })} ${label}`}
          disabled={disabled}
          onClick={() => update({ [boundary]: null })}
        >
          <ClearIcon className='h-4 w-4' />
        </Button>
      )}
    </div>
  );
}
