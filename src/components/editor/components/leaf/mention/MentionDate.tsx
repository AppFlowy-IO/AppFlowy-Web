import { useCallback, useMemo, useState } from 'react';
import { Editor, Text, Transforms } from 'slate';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { DateFormat, Mention, MentionType } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import { ReactComponent as DateSvg } from '@/assets/icons/date.svg';
import { ReactComponent as ReminderSvg } from '@/assets/icons/reminder_clock.svg';
import MentionDatePicker from '@/components/editor/components/leaf/mention/MentionDatePicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getDateFormat, getTimeFormat, renderDate } from '@/utils/time';

interface MentionDateProps {
  date: string;
  reminder?: { id: string; option: string };
  includeTime?: boolean;
  text: Text;
}

function MentionDate({ date, reminder, includeTime = false, text }: MentionDateProps) {
  const editor = useSlateStatic();
  const readonly = useReadOnly();
  const currentUser = useCurrentUser();
  const [open, setOpen] = useState(false);

  const dateFormat = useMemo(() => {
    return (currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) ?? DateFormat.Local;
  }, [currentUser?.metadata]);

  const formattedDate = useMemo(() => {
    const fmt = getDateFormat(dateFormat);
    const dateStr = renderDate(date, fmt);

    if (includeTime) {
      const timeFmt = getTimeFormat();
      const timeStr = renderDate(date, timeFmt);

      return `${dateStr} ${timeStr}`;
    }

    return dateStr;
  }, [date, dateFormat, includeTime]);

  const dateObj = useMemo(() => {
    return new Date(date);
  }, [date]);

  const updateMention = useCallback(
    (updates: Partial<Pick<Mention, 'date' | 'include_time' | 'reminder_option' | 'reminder_id'>>) => {
      try {
        const path = ReactEditor.findPath(editor, text);
        const mentionData: Mention = {
          type: MentionType.Date,
          date: updates.date ?? date,
          include_time: updates.include_time ?? includeTime,
          reminder_id: updates.reminder_id ?? reminder?.id,
          reminder_option: updates.reminder_option ?? reminder?.option,
        };

        Transforms.select(editor, {
          anchor: Editor.start(editor, path),
          focus: Editor.end(editor, path),
        });
        editor.addMark(EditorMarkFormat.Mention, mentionData);
        Transforms.collapse(editor, { edge: 'end' });
      } catch (e) {
        // Node may have been removed
      }
    },
    [editor, text, date, includeTime, reminder]
  );

  const handleDateChange = useCallback(
    (newDate: Date) => {
      updateMention({ date: newDate.toISOString() });
    },
    [updateMention]
  );

  const handleIncludeTimeChange = useCallback(
    (newIncludeTime: boolean) => {
      updateMention({ include_time: newIncludeTime });
    },
    [updateMention]
  );

  const handleReminderOptionChange = useCallback(
    (option: string) => {
      updateMention({
        reminder_option: option,
        reminder_id: reminder?.id ?? '',
      });
    },
    [updateMention, reminder?.id]
  );

  const triggerContent = (
    <span
      className={'mention-inline items-center gap-1'}
      style={{
        color: 'var(--text-primary)',
      }}
    >
      <span className={'mention-content ml-0 px-0'}>
        <span>@</span>
        {formattedDate}
      </span>
      {reminder ? <ReminderSvg /> : <DateSvg />}
    </span>
  );

  if (readonly) {
    return triggerContent;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {triggerContent}
      </PopoverTrigger>
      <PopoverContent
        side={'bottom'}
        align={'start'}
        sideOffset={8}
        className={'w-auto p-0'}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <MentionDatePicker
          date={dateObj}
          includeTime={includeTime}
          reminderOption={reminder?.option ?? 'none'}
          onDateChange={handleDateChange}
          onIncludeTimeChange={handleIncludeTimeChange}
          onReminderOptionChange={handleReminderOptionChange}
        />
      </PopoverContent>
    </Popover>
  );
}

export default MentionDate;
