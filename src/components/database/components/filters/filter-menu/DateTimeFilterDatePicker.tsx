import {
  DateFilter,
  DateFilterCondition,
  DateFormat,
  getDateFormat,
  getTimeFormat,
  TimeFormat,
} from '@/application/database-yjs';
import { useUpdateFilter } from '@/application/database-yjs/dispatch';
import DateTimeInput from '@/components/database/components/cell/date/DateTimeInput';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { renderDate } from '@/utils/time';
import { format } from 'date-fns';
import dayjs from 'dayjs';
import React, { useCallback, useMemo, useState } from 'react';

function DateTimeFilterDatePicker ({
  filter,
}: {
  filter: DateFilter
}) {
  const isRange = useMemo(() => {
    return [DateFilterCondition.DateStartsBetween, DateFilterCondition.DateEndsBetween].includes(filter.condition);
  }, [filter.condition]);

  const [dateRange, setDateRange] = useState<{
    from: Date | undefined;
    to?: Date | undefined;
  } | undefined>(() => {
    const from = isRange ? new Date(Number(filter.start) * 1000) : new Date(Number(filter.timestamp) * 1000);
    const to = isRange ? new Date(Number(filter.end) * 1000) : undefined;

    return {
      from,
      to,
    };
  });

  const updateFilter = useUpdateFilter();

  const onSelect = useCallback((dateRange: { from: Date | undefined; to?: Date | undefined } | undefined) => {
    const newDateRange = dateRange;

    setDateRange(newDateRange);
    const data = newDateRange?.from ? dayjs(newDateRange.from).unix() : '';
    const endTimestamp = newDateRange?.to ? dayjs(newDateRange.to).unix() : '';

    const content = JSON.stringify({
      ...(isRange ? {
        start: data,
        end: endTimestamp,
      } : {
        timestamp: data,
      }),
    });

    updateFilter({
      filterId: filter.id,
      content,
    });
  }, [filter.id, isRange, updateFilter]);

  const text = useMemo(() => {
    if (!filter.content) return;

    const { timestamp, end, start } = filter;

    if (isRange && start && end) {
      return `${renderDate(start.toString(), getDateFormat(DateFormat.Local), true)} - ${renderDate(end.toString(), getDateFormat(DateFormat.Local), true)}`;
    }

    if (!timestamp) return '';

    return renderDate(timestamp.toString(), getDateFormat(DateFormat.Local), true);
  }, [filter, isRange]);

  return (
    <Popover>
      <PopoverTrigger
        asChild
      >
        <Button
          variant={'outline'}
          size={'sm'}
          className={'w-full justify-start'}
        >
          {text}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
        className={'w-[260px]'}
      >
        <div className={'flex flex-col w-full gap-2 p-2'}>
          <DateTimeInput
            dateFormat={getDateFormat(DateFormat.Local)}
            timeFormat={getTimeFormat(TimeFormat.TwentyFourHour)}
            date={dateRange?.from}
            includeTime={false}
            onDateChange={date => {
              onSelect({
                from: date,
                to: dateRange?.to,
              });
            }}
          />
          {isRange && <DateTimeInput
            dateFormat={getDateFormat(DateFormat.Local)}
            timeFormat={getTimeFormat(TimeFormat.TwentyFourHour)}
            date={dateRange?.to}
            includeTime={false}
            onDateChange={date => {
              onSelect({
                from: dateRange?.from,
                to: date,
              });
            }}
          />}
        </div>
        <div className={'flex w-full justify-center'}>
          <Calendar
            showOutsideDays
            {...(isRange ? {
              mode: 'range',
              selected: dateRange,
              onSelect: (newDateRange) => {
                const newData = newDateRange;

                if (dateRange?.from && !dateRange.to) {
                  onSelect(newData);
                } else {
                  const existSet = new Set([dateRange?.from?.getTime(), dateRange?.to?.getTime()]);

                  onSelect({
                    from: existSet.has(newData?.from?.getTime()) ? newData?.to : newData?.from,
                    to: undefined,
                  });
                }
              },
            } : {
              mode: 'single',
              selected: dateRange?.from,
              onSelect: (date) => {
                onSelect({
                  from: date,
                });
              },
            })}
            formatters={{
              formatWeekdayName: (date) => {
                return format(date, 'EEE');
              },
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default DateTimeFilterDatePicker;