import dayjs from 'dayjs';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Date picker — wires the shared `Calendar` primitive into a popover
 * trigger styled to match the desktop form preview
 * (`form_preview_inputs.dart::_DateTimeInput`): a bordered tap-target
 * showing "Your answer" as muted placeholder text, with a trailing
 * chevron-down glyph. Replaces the previous calendar-icon button so
 * the visual reads as a generic input rather than a calendar-specific
 * affordance.
 *
 * The wire format is ISO 8601 (UTC midnight on the picked day) so the
 * server doesn't have to guess the client's timezone for a date-only
 * question.
 */
export function FormDateInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          className={cn(
            'flex w-full items-center justify-between rounded-md border border-line-divider px-3 py-2 text-left text-sm transition-colors',
            'hover:border-fill-default',
            'focus:border-fill-default focus:outline-none',
            !date && 'text-text-tertiary',
          )}
        >
          <span>{date ? dayjs(date).format('MMM D, YYYY') : 'Your answer'}</span>
          <ChevronDown className='h-4 w-4 shrink-0 text-text-tertiary' />
        </button>
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0' align='start'>
        <Calendar
          mode='single'
          selected={date}
          onSelect={(d) => {
            // `mode='single'` passes `Date | undefined`. Translate undefined
            // → null so the answer-map cleanly distinguishes "cleared" from
            // "untouched" (relevant for required-field validation). Use
            // YYYY-MM-DD over a full ISO so the server treats this as
            // date-only (no spurious timezone shift on the cell renderer).
            onChange(d ? dayjs(d).format('YYYY-MM-DD') : null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
