import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RelativeDirection, RelativeUnit } from '@/application/database-yjs/fields/date/date.type';
import {
  RELATIVE_AMOUNT_MAX,
  RELATIVE_AMOUNT_MIN,
  RELATIVE_DIRECTIONS,
  RELATIVE_UNITS,
  relativeDateRange,
  RelativeDateSpec,
  relativeUnitName,
} from '@/application/database-yjs/fields/date/relativeDate';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import { useDebouncedFilterInput } from '@/components/database/components/filters/hooks/useDebouncedFilterInput';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const DIRECTION_DEFAULTS: Record<RelativeDirection, string> = { past: 'Past', this: 'This', next: 'Next' };

const triggerClassName =
  'h-7 justify-between gap-1 border border-border-primary px-2 text-xs font-medium text-text-primary';

export interface RelativeDateFilterBuilderProps {
  spec: RelativeDateSpec;
  onChange: (spec: RelativeDateSpec) => void;
  /** `dashboard-global-filter` in the pill editor, `date-filter` in the view filter menus. */
  testIdPrefix: string;
  readOnly?: boolean;
  /** Focus the amount input (or the direction for `this`) on mount. */
  autoFocus?: boolean;
  /** One row only (the advanced filter panel): no calendar preview, no hint. */
  compact?: boolean;
}

function parseAmount(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const amount = Number(text);

  return amount >= RELATIVE_AMOUNT_MIN && amount <= RELATIVE_AMOUNT_MAX ? amount : null;
}

/**
 * "Is relative to today" (WP08 §1.10): Past / This / Next, an amount (not for
 * This) and a unit, a read-only calendar of this month with the range the
 * filter covers today, and a note that the range follows the date. Shared by
 * the dashboard pill editor and the view (and widget) date filter menus.
 */
export function RelativeDateFilterBuilder({
  spec,
  onChange,
  testIdPrefix,
  readOnly = false,
  autoFocus = false,
  compact = false,
}: RelativeDateFilterBuilderProps) {
  const { t } = useTranslation();
  const [today] = useState(() => dayjs());
  const range = useMemo(() => relativeDateRange(spec, today), [spec, today]);
  const selected = useMemo(() => ({ from: range.start.toDate(), to: range.end.toDate() }), [range]);
  const specRef = useRef(spec);

  specRef.current = spec;
  // Typing writes once the input pauses; an empty or invalid amount is not written.
  const commitAmount = useCallback(
    ({ content }: { content?: string }) => {
      const amount = typeof content === 'string' ? parseAmount(content) : null;

      if (amount === null || amount === specRef.current.amount) return;
      onChange({ ...specRef.current, amount });
    },
    [onChange]
  );
  const { value: amountText, updateValue: setAmountText } = useDebouncedFilterInput({
    content: String(spec.amount),
    filterId: testIdPrefix,
    fieldId: 'relative_amount',
    updateFilter: commitAmount,
  });
  const draftAmount = parseAmount(amountText) ?? spec.amount;
  const plural = spec.direction !== 'this' && draftAmount !== 1;
  const [directionButton, setDirectionButton] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (autoFocus && spec.direction === 'this') directionButton?.focus();
    // Only on mount: later direction changes keep the focus where the user put it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directionButton]);

  const directionText = (direction: RelativeDirection) =>
    t(`dashboard.globalFilters.relative.${direction}`, { defaultValue: DIRECTION_DEFAULTS[direction] });

  return (
    <div className='flex flex-col gap-2' data-testid={`${testIdPrefix}-relative`}>
      <div className='flex h-7 items-center gap-1.5'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={readOnly}>
            <Button
              className={cn(triggerClassName, 'w-[72px]')}
              data-testid={`${testIdPrefix}-relative-direction`}
              data-value={spec.direction}
              ref={setDirectionButton}
              size='sm'
              variant='ghost'
            >
              <span className='truncate'>{directionText(spec.direction)}</span>
              <ArrowDownSvg aria-hidden='true' className='h-3 w-3 shrink-0 text-icon-secondary' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='min-w-[120px]'>
            <DropdownMenuGroup>
              {RELATIVE_DIRECTIONS.map((direction) => (
                <DropdownMenuItem
                  data-testid={`${testIdPrefix}-relative-direction-option`}
                  data-value={direction}
                  key={direction}
                  onSelect={() => {
                    if (direction !== spec.direction) onChange({ ...spec, direction });
                  }}
                >
                  {directionText(direction)}
                  {direction === spec.direction && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {spec.direction !== 'this' && (
          <Input
            aria-label={t('dashboard.globalFilters.relative.amount', { defaultValue: 'Amount' })}
            autoFocus={autoFocus}
            className='h-7 w-12 px-2 text-center text-xs'
            data-testid={`${testIdPrefix}-relative-amount`}
            disabled={readOnly}
            inputMode='numeric'
            max={RELATIVE_AMOUNT_MAX}
            min={RELATIVE_AMOUNT_MIN}
            onChange={(event) => setAmountText(event.target.value)}
            size='sm'
            type='number'
            value={amountText}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={readOnly}>
            <Button
              className={cn(triggerClassName, 'min-w-[72px]')}
              data-testid={`${testIdPrefix}-relative-unit`}
              data-value={spec.unit}
              size='sm'
              variant='ghost'
            >
              <span className='truncate'>{relativeUnitName(spec.unit, plural ? draftAmount : 1, t)}</span>
              <ArrowDownSvg aria-hidden='true' className='h-3 w-3 shrink-0 text-icon-secondary' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start' className='min-w-[120px]'>
            <DropdownMenuGroup>
              {RELATIVE_UNITS.map((unit: RelativeUnit) => (
                <DropdownMenuItem
                  data-testid={`${testIdPrefix}-relative-unit-option`}
                  data-value={unit}
                  key={unit}
                  onSelect={() => {
                    if (unit !== spec.unit) onChange({ ...spec, unit });
                  }}
                >
                  {relativeUnitName(unit, plural ? draftAmount : 1, t)}
                  {unit === spec.unit && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {compact ? null : (
        <>
          <div aria-hidden='true' className='pointer-events-none' data-testid={`${testIdPrefix}-relative-preview`}>
            <Calendar className='p-0' defaultMonth={today.toDate()} mode='range' selected={selected} />
          </div>
          <p className='text-xs text-text-tertiary' data-testid={`${testIdPrefix}-relative-hint`}>
            {t('dashboard.globalFilters.relativeHint', { defaultValue: 'Filter will update with the current date' })}
          </p>
        </>
      )}
    </div>
  );
}

export default RelativeDateFilterBuilder;
