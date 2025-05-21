import {
  DateFormat,
  getDateFormat,
  getTimeFormat,
  getTypeOptions, TimeFormat,
  useFieldSelector,
} from '@/application/database-yjs';
import { DateTimeCell } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import DateTimeFormatMenu from '@/components/database/components/cell/date/DateTimeFormatMenu';
import DateTimeInput from '@/components/database/components/cell/date/DateTimeInput';
import { Calendar } from '@/components/ui/calendar';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import dayjs from 'dayjs';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Separator } from '@/components/ui/separator';
import { ReactComponent as DateSvg } from '@/assets/icons/date.svg';
import { ReactComponent as TimeIcon } from '@/assets/icons/time.svg';
import { ReactComponent as ChevronRight } from '@/assets/icons/alt_arrow_right.svg';
import { setHours, setMinutes, setSeconds, setMilliseconds, format } from 'date-fns';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

function DateTimeCellPicker ({ open, onOpenChange, cell, fieldId, rowId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cell?: DateTimeCell;
  fieldId: string;
  rowId: string;
}) {
  const { t } = useTranslation();

  const [isRange, setIsRange] = useState<boolean>(() => {
    if (!cell) return false;
    return cell.isRange || false;
  });

  const [includeTime, setIncludeTime] = useState<boolean>(() => {
    if (!cell) return false;
    return cell.includeTime || false;
  });

  const { field, clock } = useFieldSelector(fieldId);

  const currentTime = useMemo(() => {
    return new Date();
  }, []);

  const typeOptionValue = useMemo(() => {
    const typeOption = getTypeOptions(field);

    return {
      timeFormat: getTimeFormat(Number(typeOption.get(YjsDatabaseKey.time_format)) as TimeFormat),
      dateFormat: getDateFormat(Number(typeOption.get(YjsDatabaseKey.date_format)) as DateFormat),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, clock]);

  const updateCell = useUpdateCellDispatch(rowId, fieldId);

  const setCurrentTime = useCallback((date: Date) => {

    let newDate = date;

    newDate = setHours(newDate, currentTime.getHours());
    newDate = setMinutes(newDate, currentTime.getMinutes());
    newDate = setSeconds(newDate, currentTime.getSeconds());
    newDate = setMilliseconds(newDate, currentTime.getMilliseconds());

    return newDate;
  }, [currentTime]);

  const [dateRange, setDateRange] = useState<{
    from: Date | undefined;
    to?: Date | undefined;
  } | undefined>(() => {
    if (!cell) return undefined;
    const from = cell.data ? new Date(Number(cell.data) * 1000) : undefined;
    const to = cell.endTimestamp ? new Date(Number(cell.endTimestamp) * 1000) : undefined;

    return {
      from,
      to,
    };
  });

  const dateOptsRef = useRef<{
    includeTime?: boolean;
    isRange?: boolean;
  }>({
    includeTime,
    isRange,
  });

  const onSelect = useCallback((dateRange: { from: Date | undefined; to?: Date | undefined } | undefined) => {
    const newDateRange = dateRange;

    setDateRange(newDateRange);
    const data = newDateRange?.from ? dayjs(newDateRange.from).unix().toString() : '';
    const endTimestamp = newDateRange?.to ? dayjs(newDateRange.to).unix().toString() : '';

    updateCell(data, {
      includeTime: dateOptsRef.current?.includeTime,
      isRange: dateOptsRef.current?.isRange,
      endTimestamp,
    });
  }, [updateCell]);

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
    >
      <PopoverTrigger
        className={'absolute left-0 top-0 w-full h-full z-[-1]'}
      />
      <PopoverContent
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
        className={'w-[260px] overflow-y-auto'}
      >
        <div className={'flex flex-col w-full gap-2 p-2'}>
          <DateTimeInput
            timeFormat={typeOptionValue.timeFormat}
            dateFormat={typeOptionValue.dateFormat}
            date={dateRange?.from}
            includeTime={includeTime}
            onDateChange={date => {
              onSelect({
                from: date,
                to: dateRange?.to,
              });
            }}
          />
          {isRange && <DateTimeInput
            timeFormat={typeOptionValue.timeFormat}
            dateFormat={typeOptionValue.dateFormat}
            date={dateRange?.to}
            includeTime={includeTime}
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
                const newData = {
                  from: newDateRange?.from ? setCurrentTime(newDateRange?.from) : undefined,
                  to: newDateRange?.to ? setCurrentTime(newDateRange?.to) : undefined,
                };

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
                  from: date ? setCurrentTime(date) : undefined,
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
        <Separator className={'my-2'} />
        <div className={'px-2'}>
          <div
            className={cn(dropdownMenuItemVariants({
              variant: 'default',
            }), 'hover:bg-transparent w-full')}
          >
            <DateSvg className={'w-5 h-5'} />
            {t('grid.dateFilter.endDate')}
            <Switch
              className={'ml-auto'}
              checked={isRange}
              onCheckedChange={checked => {
                setIsRange(checked);
                dateOptsRef.current = {
                  ...dateOptsRef.current,
                  isRange: checked,
                };
                if (checked) {
                  onSelect({
                    from: dateRange?.from || currentTime,
                    to: dateRange?.to || dateRange?.from || currentTime,
                  });
                } else {
                  onSelect({
                    from: dateRange?.from || currentTime,
                    to: undefined,
                  });
                }
              }}
            />
          </div>
          <div
            className={cn(dropdownMenuItemVariants({
              variant: 'default',
            }), 'hover:bg-transparent w-full')}
          >
            <TimeIcon className={'w-5 h-5'} />
            {t('grid.field.includeTime')}
            <Switch
              className={'ml-auto'}
              checked={includeTime}
              onCheckedChange={checked => {
                setIncludeTime(checked);
                dateOptsRef.current = {
                  ...dateOptsRef.current,
                  includeTime: checked,
                };
                onSelect(dateRange ? dateRange : {
                  from: currentTime,
                  to: isRange ? currentTime : undefined,
                });
              }}
            />
          </div>
        </div>
        <Separator className={'my-2'} />
        <div className={'px-2'}>
          <DateTimeFormatMenu fieldId={fieldId}>
            <div
              className={cn(dropdownMenuItemVariants({
                variant: 'default',
              }), 'w-full')}
            >
              {`${t('datePicker.dateFormat')} & ${t('datePicker.timeFormat')}`}

              <ChevronRight className={'ml-auto w-5 h-5 text-text-tertiary'} />

            </div>
          </DateTimeFormatMenu>
        </div>
        <div className={'px-2 pb-2'}>
          <div
            onClick={(e) => {
              e.stopPropagation();
              setIsRange(false);
              setIncludeTime(false);
              dateOptsRef.current = {
                isRange: false,
                includeTime: false,
              };

              onSelect(undefined);

              onOpenChange(false);
            }}
            className={cn(dropdownMenuItemVariants({
              variant: 'default',
            }), 'w-full')}
          >
            {t('grid.field.clearDate')}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default DateTimeCellPicker;