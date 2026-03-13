import { useCallback, useEffect, useMemo, useState } from 'react';

import { DateFormat, TimeFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { ReactComponent as ClockAlarmSvg } from '@/assets/icons/clock_alarm.svg';
import { ReactComponent as ReminderSvg } from '@/assets/icons/reminder_clock.svg';
import DateTimeInput from '@/components/database/components/cell/date/DateTimeInput';
import { REMINDER_OPTIONS, getFilteredReminderOptions, getReminderLabel } from '@/components/editor/components/leaf/mention/reminder-options';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getDateFormat, getTimeFormat } from '@/utils/time';

interface MentionDatePickerProps {
  date: Date;
  includeTime: boolean;
  reminderOption: string;
  onDateChange: (date: Date) => void;
  onIncludeTimeChange: (includeTime: boolean) => void;
  onReminderOptionChange: (option: string) => void;
}

function MentionDatePicker({
  date,
  includeTime,
  reminderOption,
  onDateChange,
  onIncludeTimeChange,
  onReminderOptionChange,
}: MentionDatePickerProps) {
  const currentUser = useCurrentUser();
  const [reminderOpen, setReminderOpen] = useState(false);
  const [month, setMonth] = useState<Date>(date);

  useEffect(() => {
    setMonth(date);
  }, [date]);

  const dateFormat = useMemo(() => {
    const fmt = (currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) ?? DateFormat.Local;

    return getDateFormat(fmt);
  }, [currentUser?.metadata]);

  const timeFormat = useMemo(() => {
    const fmt = (currentUser?.metadata?.[MetadataKey.TimeFormat] as TimeFormat) ?? TimeFormat.TwelveHour;

    return getTimeFormat(fmt);
  }, [currentUser?.metadata]);

  const handleDateInputChange = useCallback(
    (newDate?: Date) => {
      if (newDate) {
        onDateChange(newDate);
        setMonth(newDate);
      }
    },
    [onDateChange]
  );

  const handleCalendarSelect = useCallback(
    (selectedDate: Date | undefined) => {
      if (!selectedDate) return;
      // Preserve the time from the current date
      const newDate = new Date(selectedDate);

      if (includeTime) {
        newDate.setHours(date.getHours(), date.getMinutes(), date.getSeconds());
      }

      onDateChange(newDate);
    },
    [date, includeTime, onDateChange]
  );

  const handleIncludeTimeToggle = useCallback(
    (checked: boolean) => {
      onIncludeTimeChange(checked);
      // If toggling time off and current reminder requires time, reset to 'none'
      if (!checked) {
        const current = REMINDER_OPTIONS.find((opt) => opt.name === reminderOption);

        if (current?.requiresTime) {
          onReminderOptionChange('none');
        }
      }
    },
    [onIncludeTimeChange, reminderOption, onReminderOptionChange]
  );

  const filteredOptions = useMemo(() => getFilteredReminderOptions(includeTime), [includeTime]);
  const reminderLabel = useMemo(() => getReminderLabel(reminderOption), [reminderOption]);

  return (
    <div
      className={'flex w-[260px] flex-col gap-0 p-2'}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <DateTimeInput
        date={date}
        includeTime={includeTime}
        dateFormat={dateFormat}
        timeFormat={timeFormat}
        onDateChange={handleDateInputChange}
      />
      <Calendar
        mode={'single'}
        selected={date}
        onSelect={handleCalendarSelect}
        month={month}
        onMonthChange={setMonth}
        showOutsideDays
      />
      <Separator />
      <div
        className={
          'flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm text-text-primary hover:bg-fill-content-hover'
        }
      >
        <ClockAlarmSvg className={'h-4 w-4 text-text-secondary'} />
        <span className={'flex-1'}>Include time</span>
        <Switch checked={includeTime} onCheckedChange={handleIncludeTimeToggle} />
      </div>
      <Separator />
      <Popover open={reminderOpen} onOpenChange={setReminderOpen}>
        <PopoverTrigger asChild>
          <div
            className={
              'flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm text-text-primary hover:bg-fill-content-hover'
            }
          >
            <ReminderSvg className={'h-4 w-4 text-text-secondary'} />
            <span className={'flex-1'}>Reminder</span>
            <span className={'text-xs text-text-secondary'}>{reminderLabel} &#x25B8;</span>
          </div>
        </PopoverTrigger>
        <PopoverContent side={'right'} sideOffset={8} align={'start'} className={'w-[220px] p-1'}>
          <div className={'flex flex-col'}>
            {filteredOptions.map((option) => (
              <div
                key={option.name}
                className={
                  'flex cursor-pointer items-center justify-between rounded-[8px] px-2 py-1.5 text-sm text-text-primary hover:bg-fill-content-hover'
                }
                onClick={() => {
                  onReminderOptionChange(option.name);
                  setReminderOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.name === reminderOption && (
                  <svg className={'h-4 w-4 shrink-0 text-text-primary'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default MentionDatePicker;
