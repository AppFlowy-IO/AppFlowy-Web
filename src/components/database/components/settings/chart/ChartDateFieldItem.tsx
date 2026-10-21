import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { DATE_CONDITION_OPTIONS } from '@/components/database/components/settings/chart/chartSettingsOptions';
import { ChartOptionItem } from '@/components/database/components/settings/chart/ChartSettingsRows';
import {
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Desktop `ChartDateFieldPopoverItem`: a date field row with a chevron that
 * opens the date groupings on hover or click. Clicking the row also selects the
 * field; desktop shows no tick on a selected date row. Picking a grouping
 * selects the field too and closes only this submenu.
 */
export function ChartDateFieldItem({
  fieldId,
  fieldType,
  name,
  selected,
  dateCondition,
  onFieldSelect,
  onDateConditionSelect,
}: {
  fieldId: string;
  fieldType: FieldType;
  name: string;
  selected: boolean;
  dateCondition: DateGroupCondition;
  onFieldSelect: () => void;
  onDateConditionSelect: (condition: DateGroupCondition) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The trigger is always focused before its submenu opens (hover, click or
  // keyboard), so this is where focus returns after a grouping is picked.
  const triggerRef = useRef<HTMLElement | null>(null);
  // Set while Radix handles an Enter / Space keydown on the row.
  const activationKeyRef = useRef(false);
  const selectedCueId = useId();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Radix opens the submenu on Enter and Space without a click (but not on a
    // Space that continues a typeahead search); select the field too so the
    // keyboard matches a pointer click.
    if (next && activationKeyRef.current) {
      activationKeyRef.current = false;
      onFieldSelect();
    }
  };

  return (
    <DropdownMenuSub open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuSubTrigger
        aria-describedby={selected ? selectedCueId : undefined}
        aria-label={name}
        className='gap-2 py-1.5 [&>svg:last-child]:text-icon-secondary'
        data-selected={selected ? 'true' : undefined}
        data-testid={`chart-x-axis-field-${fieldId}`}
        textValue={name}
        onClick={onFieldSelect}
        onFocus={(event) => {
          triggerRef.current = event.currentTarget;
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          if (open) {
            // Already open from a hover: Radix only moves focus into the submenu.
            onFieldSelect();
            return;
          }

          // Radix handles the key right after this handler and goes through
          // `handleOpenChange` when it opens the submenu. The flag is cleared
          // once the event is done, so a later hover can never pick it up.
          activationKeyRef.current = true;
          queueMicrotask(() => {
            activationKeyRef.current = false;
          });
        }}
      >
        <FieldTypeIcon className='text-icon-primary' type={fieldType} />
        <span className='min-w-0 flex-1 truncate'>{name}</span>
        {selected ? (
          // A sub trigger stays a `menuitem` (no `aria-checked`), so the
          // selection is announced as a description instead of a tick.
          <span className='sr-only' id={selectedCueId}>
            {t('chart.selectedXAxisField', 'Selected X-axis field')}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        {/*
          The shared sub content adds `ml-2` on its right side only, so Radix
          measures it 8px wider there. On the database page the date rows end
          exactly within that band of free space, so the submenu fit on the
          left, flipped back to the right, overflowed, flipped left again, and
          so on every frame. A side-independent size, with `sideOffset` for the
          gap, lets the placement settle: it lands on the left there, like
          desktop's `leftWithTopAligned` popover.
        */}
        <DropdownMenuSubContent
          className='w-[172px] min-w-0 p-1.5 data-[side=right]:ml-0'
          data-testid='chart-date-condition-menu'
          sideOffset={8}
        >
          {DATE_CONDITION_OPTIONS.map((option) => (
            <ChartOptionItem
              key={option.value}
              label={t(option.labelKey, option.fallback)}
              selected={dateCondition === option.value}
              testId={`chart-date-condition-${option.slug}`}
              onSelect={() => {
                setOpen(false);
                onDateConditionSelect(option.value);
                triggerRef.current?.focus();
              }}
            />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
