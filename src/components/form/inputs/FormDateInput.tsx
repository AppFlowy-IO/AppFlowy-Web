import dayjs from 'dayjs';
import { CalendarIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Date picker — wires the shared `Calendar` primitive into a popover
 * trigger styled like the other form inputs. The wire format is ISO 8601
 * (UTC midnight on the picked day) so the server doesn't have to guess
 * the client's timezone for a date-only question.
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
  const label = date ? dayjs(date).format('MMM D, YYYY') : 'Pick a date';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          className={cn(
            'w-full justify-start text-left font-normal',
            !date && 'text-text-tertiary',
          )}
        >
          <CalendarIcon className='mr-2 h-4 w-4' />
          {label}
        </Button>
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
