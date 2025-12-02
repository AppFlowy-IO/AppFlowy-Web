import { format, isValid, parse, setHours, setMinutes, setSeconds } from 'date-fns';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Log } from '@/utils/log';
import { baseInputStyles, inputVariants } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

function DateTimeInput({
  date,
  includeTime = false,
  dateFormat,
  timeFormat,
  onDateChange,
  autoFocus,
}: {
  date?: Date;
  onDateChange?: (date?: Date) => void;
  includeTime?: boolean;
  dateFormat: string;
  timeFormat: string;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(autoFocus);
  const [invalid, setInvalid] = useState<boolean>(false);

  const replacedDateFormat = useMemo(() => {
    return dateFormat.replace('DD', 'dd').replace('YYYY', 'yyyy');
  }, [dateFormat]);

  const replacedTimeFormat = useMemo(() => {
    return timeFormat.replace('A', 'aa');
  }, [timeFormat]);

  const is12HourFormat = useMemo(() => {
    return replacedTimeFormat.includes('aa');
  }, [replacedTimeFormat]);

  const datePlaceholder = useMemo(() => {
    const today = new Date();

    return format(today, replacedDateFormat);
  }, [replacedDateFormat]);

  const timePlaceholder = useMemo(() => {
    const today = new Date();

    return format(today, replacedTimeFormat);
  }, [replacedTimeFormat]);

  const [dateValue, setDateValue] = useState(() => {
    if (!isValid(date)) return '';
    if (date) {
      return format(date, replacedDateFormat);
    }

    return '';
  });

  const [timeValue, setTimeValue] = useState(() => {
    if (!isValid(date)) return '';
    if (date) {
      return format(date, replacedTimeFormat);
    }

    return '';
  });

  useEffect(() => {
    if (date) {
      setDateValue(format(date, replacedDateFormat));
      if (includeTime) {
        setTimeValue(format(date, replacedTimeFormat));
      }
    } else {
      setDateValue('');
      setTimeValue('');
    }
  }, [date, includeTime, replacedDateFormat, replacedTimeFormat]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    setDateValue(inputValue);

    if (inputValue.length !== replacedDateFormat.length) {
      return;
    }

    try {
      let parsedDate = parse(inputValue, replacedDateFormat, new Date());

      if (!isValid(parsedDate)) {
        parsedDate = new Date();
      }

      const newDate = new Date(date || Date.now());

      newDate.setFullYear(parsedDate.getFullYear());
      newDate.setMonth(parsedDate.getMonth());
      newDate.setDate(parsedDate.getDate());

      onDateChange?.(newDate);
    } catch (error) {
      Log.debug(error);
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    setTimeValue(inputValue);
  };

  const checkDate = useCallback(
    (value: string) => {
      if (!value) return;
      const parseDate = parse(value, replacedDateFormat, new Date());

      setInvalid(!isValid(parseDate));
    },
    [replacedDateFormat]
  );

  const handleTimeBlur = (inputValue: string) => {
    const isAM = inputValue.toLowerCase().includes('am');

    try {
      let parsedTime = parse(inputValue, replacedTimeFormat, new Date());

      if (!isValid(parsedTime)) {
        setInvalid(true);
        parsedTime = new Date();
      } else {
        setInvalid(false);
      }

      const newDate = new Date(date || Date.now());

      let hours = parsedTime.getHours();
      const minutes = parsedTime.getMinutes();
      const seconds = parsedTime.getSeconds();

      const updatedDate = setSeconds(setMinutes(setHours(newDate, hours), minutes), seconds);

      if (is12HourFormat) {
        hours = parsedTime.getHours() % 12;
        if (isAM) {
          updatedDate.setHours(hours);
        } else {
          updatedDate.setHours(hours + 12);
        }
      }

      onDateChange?.(updatedDate);
    } catch (error) {
      Log.debug(error);
    }
  };

  return (
    <div
      data-slot='input'
      className={cn(
        inputVariants({ variant: invalid ? 'destructive' : 'default', size: 'sm' }),
        'flex w-full items-center gap-2'
      )}
      data-focused={focused}
    >
      <input
        data-testid="datetime-date-input"
        autoFocus={autoFocus}
        type={'text'}
        className={cn('flex-1', baseInputStyles)}
        onFocus={(e) => {
          setFocused(true);
          checkDate(e.target.value);
        }}
        placeholder={datePlaceholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setFocused(false);
            e.stopPropagation();
            (e.target as HTMLInputElement).blur();
            checkDate((e.target as HTMLInputElement).value);
          }
        }}
        onBlur={(e) => {
          setFocused(false);
          checkDate(e.target.value);
        }}
        value={dateValue}
        onChange={handleDateChange}
      />
      {includeTime && (
        <>
          <Separator className={'!h-4'} orientation={'vertical'} />
          <input
            data-testid="datetime-time-input"
            className={cn(is12HourFormat ? 'w-[70px]' : 'w-[50px]', baseInputStyles)}
            type={'text'}
            placeholder={timePlaceholder}
            onFocus={() => {
              setFocused(true);
            }}
            onBlur={(e) => {
              setFocused(false);
              handleTimeBlur(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                (e.target as HTMLInputElement).blur();
                setFocused(false);
                handleTimeBlur((e.target as HTMLInputElement).value);
              }
            }}
            value={timeValue}
            onChange={handleTimeChange}
          />
        </>
      )}
    </div>
  );
}

export default DateTimeInput;
