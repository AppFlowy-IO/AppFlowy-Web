import { ReactNode, useState } from 'react';

import { DateFormat, TimeFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import DateTimeInput from '@/components/database/components/cell/date/DateTimeInput';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getDateFormat, getTimeFormat } from '@/utils/time';

/** The picked day (`from`), or the two ends of a range. */
export interface DateFilterSelection {
  from?: Date;
  to?: Date;
}

type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DateFilterValuePickerProps {
  /** A "between" condition: two days instead of one. */
  isRange: boolean;
  selected: DateFilterSelection;
  onSelect: (selection: DateFilterSelection) => void;
  /** The trigger's label: the formatted value, or a placeholder. */
  label: ReactNode;
  /** Text inputs above the calendar, to type the day(s). */
  withInputs?: boolean;
  /**
   * A single day is picked once: clicking the selected day keeps it (instead
   * of clearing the value) and the popover closes.
   */
  closeOnSingleSelect?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
}

/**
 * The date value of a filter: a button that opens a calendar for one day or a
 * range. It reads no database context, so the view filter menu and the
 * dashboard's global filter editor share it; each host encodes the selection
 * with `dateSelectionToFilterContent`.
 */
export function DateFilterValuePicker({
  isRange,
  selected,
  onSelect,
  label,
  withInputs = false,
  closeOnSingleSelect = false,
  disabled,
  'data-testid': testId,
}: DateFilterValuePickerProps) {
  const currentUser = useCurrentUserOptional();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date | undefined>(undefined);
  const startWeekOn = Number(currentUser?.metadata?.[MetadataKey.StartWeekOn]) || 0;
  const weekStartsOn = (startWeekOn >= 0 && startWeekOn <= 6 ? startWeekOn : 0) as WeekStart;
  const common = { defaultMonth: selected.from, showOutsideDays: true, month, onMonthChange: setMonth, weekStartsOn };
  const inputFormats = {
    dateFormat: getDateFormat(DateFormat.Local),
    timeFormat: getTimeFormat(TimeFormat.TwentyFourHour),
    includeTime: false,
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={'outline'} size={'sm'} disabled={disabled} className={'w-full justify-start'} data-testid={testId}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={withInputs ? 'w-[260px]' : 'w-fit p-2'}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
      >
        {withInputs && (
          <div className={'flex w-full flex-col gap-2 p-2'}>
            <DateTimeInput
              autoFocus
              {...inputFormats}
              date={selected.from}
              onDateChange={(date) => onSelect({ from: date, to: selected.to })}
            />
            {isRange && (
              <DateTimeInput
                {...inputFormats}
                date={selected.to}
                onDateChange={(date) => onSelect({ from: selected.from, to: date })}
              />
            )}
          </div>
        )}
        <div className={cn(withInputs && 'flex w-full justify-center')}>
          {isRange ? (
            <Calendar
              {...common}
              mode='range'
              selected={{ from: selected.from, to: selected.to }}
              onSelect={(range) => onSelect({ from: range?.from, to: range?.to })}
            />
          ) : closeOnSingleSelect ? (
            <Calendar
              {...common}
              mode='single'
              required
              selected={selected.from}
              onSelect={(date) => {
                if (date) onSelect({ from: date });
                setOpen(false);
              }}
            />
          ) : (
            <Calendar {...common} mode='single' selected={selected.from} onSelect={(date) => onSelect({ from: date })} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default DateFilterValuePicker;
