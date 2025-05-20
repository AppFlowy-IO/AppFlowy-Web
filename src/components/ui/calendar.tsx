import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { ReactComponent as ChevronLeft } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ChevronRight } from '@/assets/icons/alt_arrow_right.svg';

function Calendar ({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-2', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-2',
        month: 'flex flex-col gap-4',
        caption: 'flex px-1 justify-between relative items-center w-full',
        caption_label: 'text-sm font-medium text-text-primary',
        nav: 'flex items-center gap-1',
        nav_button: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
        ),
        table: 'w-full border-collapse',
        head_row: 'flex gap-1',
        head_cell:
          'text-text-secondary w-7 text-center font-medium text-xs',
        row: 'flex w-full mt-2',
        cell: cn(
          'relative py-0 text-center px-0.5 text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-fill-theme-select [&:has([aria-selected].day-range-end)]:rounded-r-full',
          props.mode === 'range'
            ? '[&:has(>.day-range-end.day-range-start)]:bg-transparent [&:has(>.day-range-end)]:rounded-r-full [&:has(>.day-range-start)]:rounded-l-full first:[&:has([aria-selected])]:rounded-l-none last:[&:has([aria-selected])]:rounded-r-none'
            : '[&:has([aria-selected])]:rounded-full [&:has([aria-selected])]:bg-transparent',
        ),
        day: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'aria-selected:bg-fill-theme-thick aria-selected:text-text-on-fill rounded-full cursor-pointer',
        ),
        day_range_start:
          'day-range-start aria-selected:bg-fill-theme-thick aria-selected:text-text-on-fill',
        day_range_end:
          'day-range-end aria-selected:bg-fill-theme-thick aria-selected:text-text-on-fill',
        day_selected:
          'bg-surface-primary text-text-primary hover:bg-surface-primary-hover focus:bg-surface-primary focus:text-text-primary',
        day_today: 'bg-transparent border border-border-theme-thick text-text-primary',
        day_outside:
          'day-outside text-text-tertiary aria-selected:text-text-on-fill',
        day_disabled: 'text-text-tertiary',
        day_range_middle:
          'aria-selected:bg-transparent aria-selected:text-text-primary',
        day_hidden: 'invisible',
        ...classNames,
      }}
      components={{
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={cn('w-5 h-5', className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={cn('w-5 h-5', className)} {...props} />
        ),
      }}

      {...props}
    />
  );
}

export { Calendar };
