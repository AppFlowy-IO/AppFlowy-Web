import dayjs from 'dayjs';
import { useCallback, useMemo, useState } from 'react';

import { DateFilter, DateFilterCondition } from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import { DateFormat, TimeFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import DateTimeInput from '@/components/database/components/cell/date/DateTimeInput';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getDateFormat, getTimeFormat, renderDate } from '@/utils/time';

function DateTimeFilterDatePicker({ filter }: { filter: DateFilter }) {
  const currentUser = useCurrentUser();

  const weekStartsOn = useMemo(() => {
    const value = Number(currentUser?.metadata?.[MetadataKey.StartWeekOn]) || 0;

    return value >= 0 && value <= 6 ? (value as 0 | 1 | 2 | 3 | 4 | 5 | 6) : 0;
  }, [currentUser?.metadata]);

  const isRange = useMemo(() => {
    return [DateFilterCondition.DateStartsBetween, DateFilterCondition.DateEndsBetween].includes(filter.condition);
  }, [filter.condition]);

  const [dateRange, setDateRange] = useState<
    | {
        from: Date | undefined;
        to?: Date | undefined;
      }
    | undefined
  >(() => {
    const { start, end, timestamp } = filter;
    const from =
      isRange && start ? new Date(Number(start) * 1000) : timestamp ? new Date(Number(timestamp) * 1000) : undefined;
    const to = isRange && end ? new Date(Number(filter.end) * 1000) : undefined;

    return {
      from,
      to,
    };
  });

  const updateFilter = useUpdateFilter();

  const onSelect = useCallback(
    (dateRange: { from: Date | undefined; to?: Date | undefined } | undefined) => {
      const newDateRange = dateRange;

      setDateRange(newDateRange);
      const data = newDateRange?.from ? dayjs(newDateRange.from).unix() : '';
      const endTimestamp = newDateRange?.to ? dayjs(newDateRange.to).unix() : undefined;

      const content = JSON.stringify({
        ...(isRange
          ? {
              start: data,
              end: endTimestamp,
            }
          : {
              timestamp: data,
            }),
      });

      updateFilter({
        filterId: filter.id,
        fieldId: filter.fieldId,
        content,
      });
    },
    [filter.id, filter.fieldId, isRange, updateFilter]
  );

  const text = useMemo(() => {
    if (!filter.content) return;

    const { timestamp, end, start } = filter;

    if (isRange && start && end) {
      const dateFormat = currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat | DateFormat.Local;

      return `${renderDate(start.toString(), getDateFormat(dateFormat), true)} - ${renderDate(
        end.toString(),
        getDateFormat(dateFormat),
        true
      )}`;
    }

    if (!timestamp) return '';

    return renderDate(timestamp.toString(), getDateFormat(DateFormat.Local), true);
  }, [filter, isRange, currentUser?.metadata]);

  const [month, setMonth] = useState<Date | undefined>(undefined);

  const onMonthChange = useCallback((date: Date) => {
    setMonth(date);
  }, []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={'outline'} size={'sm'} className={'w-full justify-start'}>
          {text}
        </Button>
      </PopoverTrigger>
      <PopoverContent onCloseAutoFocus={(e) => e.preventDefault()} className={'w-[260px]'}>
        <div className={'flex w-full flex-col gap-2 p-2'}>
          <DateTimeInput
            autoFocus
            dateFormat={getDateFormat(DateFormat.Local)}
            timeFormat={getTimeFormat(TimeFormat.TwentyFourHour)}
            date={dateRange?.from}
            includeTime={false}
            onDateChange={(date) => {
              onSelect({
                from: date,
                to: dateRange?.to,
              });
            }}
          />
          {isRange && (
            <DateTimeInput
              dateFormat={getDateFormat(DateFormat.Local)}
              timeFormat={getTimeFormat(TimeFormat.TwentyFourHour)}
              date={dateRange?.to}
              includeTime={false}
              onDateChange={(date) => {
                onSelect({
                  from: dateRange?.from,
                  to: date,
                });
              }}
            />
          )}
        </div>
        <div className={'flex w-full justify-center'}>
          <Calendar
            defaultMonth={dateRange?.from}
            showOutsideDays
            month={month}
            onMonthChange={onMonthChange}
            weekStartsOn={weekStartsOn}
            {...(isRange
              ? {
                  mode: 'range',
                  selected: dateRange,
                  onSelect,
                }
              : {
                  mode: 'single',
                  selected: dateRange?.from,
                  onSelect: (date) => {
                    onSelect({
                      from: date,
                    });
                  },
                })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default DateTimeFilterDatePicker;
