import { baseInputStyles, inputVariants } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import React, { useEffect, useMemo, useState } from 'react';
import { format, isValid, parse, setHours, setMinutes, setSeconds } from 'date-fns';

function DateTimeInput ({
  date,
  includeTime = false,
  dateFormat,
  timeFormat,
  onDateChange,
}: {
  date?: Date;
  onDateChange?: (date?: Date) => void;
  includeTime?: boolean;
  dateFormat: string;
  timeFormat: string;
}) {
  const [focused, setFocused] = useState(false);

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
    if (date) {
      return format(date, replacedDateFormat);
    }

    return '';
  });

  const [timeValue, setTimeValue] = useState(() => {
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
      console.log(error);
    }
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    setTimeValue(inputValue);
  };

  const handleTimeBlur = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    const isAM = inputValue.toLowerCase().includes('am');

    try {
      let parsedTime = parse(inputValue, replacedTimeFormat, new Date());

      if (!isValid(parsedTime)) {
        parsedTime = new Date();
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
      console.log(error);
    }
  };

  return (
    <div
      data-slot="input"
      className={cn(
        inputVariants({ variant: 'default', size: 'sm' }),
        'flex items-center w-full gap-2',
      )}
      data-focused={focused}
    >
      <input
        type={'text'}
        className={cn(
          'flex-1',
          baseInputStyles,
        )}
        onFocus={() => {
          setFocused(true);
        }}
        placeholder={datePlaceholder}
        onBlur={() => {
          setFocused(false);
        }}
        value={dateValue}
        onChange={handleDateChange}
      />
      {includeTime && (
        <>
          <Separator
            className={'!h-4'}
            orientation={'vertical'}
          />
          <input
            className={cn(
              is12HourFormat ? 'w-[70px]' : 'w-[50px]',
              baseInputStyles,
            )}
            type={'text'}
            placeholder={timePlaceholder}
            onFocus={() => {
              setFocused(true);
            }}
            onBlur={(e) => {
              setFocused(false);
              handleTimeBlur(e);
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