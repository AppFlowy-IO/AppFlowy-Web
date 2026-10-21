import dayjs from 'dayjs';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DateFilter,
  DateFilterCondition,
  DateFilterRelativeDate,
} from '@/application/database-yjs/fields/date/date.type';
import {
  isDateComparisonCondition,
  isRelativeDateComparison,
  relativeDateForFilter,
  resolveRelativeDates,
} from '@/application/database-yjs/fields/date/relativeDate';
import { DateFormat, TimeFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import DateTimeInput from '@/components/database/components/cell/date/DateTimeInput';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getDateFormat, getTimeFormat, renderDate } from '@/utils/time';

import { useRelativeDateFilterWrites } from '../hooks/useRelativeDateFilterWrites';

interface DateFilterValuePickerProps {
  filter: DateFilter;
  disabled?: boolean;
  variant?: 'simple' | 'advanced';
  onChange: (content: string) => void;
}

// Both filter editors persist the operand, never the day it happens to resolve to.
export default function DateFilterValuePicker({
  filter,
  disabled,
  variant = 'simple',
  onChange,
}: DateFilterValuePickerProps) {
  const { t } = useTranslation();
  const allowRelativeComparisons = useRelativeDateFilterWrites();
  const readOnly = disabled || (!allowRelativeComparisons && isRelativeDateComparison(filter.condition, filter.content));
  const relativeLabels = {
    [DateFilterRelativeDate.Today]: t('relativeDates.today'),
    [DateFilterRelativeDate.Yesterday]: t('relativeDates.yesterday'),
    [DateFilterRelativeDate.Tomorrow]: t('relativeDates.tomorrow'),
  };
  const currentUser = useCurrentUser();
  const weekStart = Number(currentUser?.metadata?.[MetadataKey.StartWeekOn]) || 0;
  const weekStartsOn = weekStart >= 0 && weekStart <= 6 ? (weekStart as 0 | 1 | 2 | 3 | 4 | 5 | 6) : 0;
  const isRange = [DateFilterCondition.DateStartsBetween, DateFilterCondition.DateEndsBetween].includes(
    filter.condition
  );
  const relative = relativeDateForFilter(filter);
  const { start, end, timestamp } = resolveRelativeDates(filter);
  const dateRange = useMemo(() => {
    const toDate = (value?: number) => (typeof value === 'number' ? dayjs.unix(value).toDate() : undefined);

    return { from: toDate(isRange ? start : timestamp), to: isRange ? toDate(end) : undefined };
  }, [isRange, start, end, timestamp]);
  const [month, setMonth] = useState<Date>();
  const selectDate = (range: { from: Date | undefined; to?: Date } | undefined) => {
    if (readOnly) return;
    // Desktop deserializes Option<i64>; an unselected date must be null, not "".
    const from = range?.from ? dayjs(range.from).startOf('day').unix() : null;
    const to = range?.to ? dayjs(range.to).startOf('day').unix() : null;

    onChange(JSON.stringify(isRange ? { start: from, end: to } : { timestamp: from }));
  };

  const dateFormat = getDateFormat((currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) || DateFormat.Local);
  const text = relative
    ? relativeLabels[relative]
    : isRange && typeof start === 'number' && typeof end === 'number'
    ? `${renderDate(start, dateFormat, true)} - ${renderDate(end, dateFormat, true)}`
    : !isRange && typeof timestamp === 'number'
    ? renderDate(timestamp, getDateFormat(DateFormat.Local), true)
    : t('grid.dateFilter.chooseDate');

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setMonth(dateRange.from ?? new Date());
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          disabled={readOnly}
          className={
            variant === 'advanced'
              ? 'h-8 w-full justify-start overflow-hidden rounded-md px-2 text-left'
              : 'w-full justify-start'
          }
          data-testid={variant === 'advanced' ? 'advanced-filter-date-input' : 'date-filter-date-picker'}
        >
          <span className='truncate'>{text}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent onCloseAutoFocus={(e) => e.preventDefault()} className='w-[260px]'>
        <fieldset disabled={readOnly}>
          {allowRelativeComparisons && isDateComparisonCondition(filter.condition) && (
            <div className='flex flex-col gap-1 border-b border-border-primary p-2'>
              {Object.values(DateFilterRelativeDate).map((day) => (
                <Button
                  key={day}
                  variant='ghost'
                  size='sm'
                  className='justify-start aria-pressed:bg-fill-theme-select'
                  aria-pressed={relative === day}
                  data-testid={`date-filter-relative-${day.toLowerCase()}`}
                  onClick={() => {
                    if (readOnly) return;
                    onChange(JSON.stringify({ relative_date: day }));
                    const resolved = resolveRelativeDates({ ...filter, relative_date: day });

                    setMonth(dayjs.unix(resolved.timestamp ?? dayjs().unix()).toDate());
                  }}
                >
                  {relativeLabels[day]}
                </Button>
              ))}
            </div>
          )}
          <div className='flex w-full flex-col gap-2 p-2'>
            <DateTimeInput
              autoFocus
              dateFormat={getDateFormat(DateFormat.Local)}
              timeFormat={getTimeFormat(TimeFormat.TwentyFourHour)}
              date={dateRange.from}
              includeTime={false}
              onDateChange={(date) => selectDate({ from: date, to: dateRange.to })}
            />
            {isRange && (
              <DateTimeInput
                dateFormat={getDateFormat(DateFormat.Local)}
                timeFormat={getTimeFormat(TimeFormat.TwentyFourHour)}
                date={dateRange.to}
                includeTime={false}
                onDateChange={(date) => selectDate({ from: dateRange.from, to: date })}
              />
            )}
          </div>
          <div className='flex w-full justify-center'>
            <Calendar
              defaultMonth={dateRange.from}
              showOutsideDays
              month={month}
              onMonthChange={setMonth}
              weekStartsOn={weekStartsOn}
              {...(isRange
                ? { mode: 'range', selected: dateRange, onSelect: selectDate }
                : { mode: 'single', selected: dateRange.from, onSelect: (date) => selectDate({ from: date }) })}
            />
          </div>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
