import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { CalendarEvent, TimelineLayout } from '@/application/database-yjs';
import { ReactComponent as ChevronLeft } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ChevronRight } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as DropdownIcon } from '@/assets/icons/triangle_down.svg';
import { NoDateButton } from '@/components/database/fullcalendar/NoDateButton';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { TIMELINE_SCALE_PRESETS, TIMELINE_LAYOUT_ORDER } from './scale/presets';

interface TimelineToolbarProps {
  /** Month (or day, on hour scales) at the left edge of the viewport. */
  title: string;
  layout: TimelineLayout;
  onLayoutChange: (layout: TimelineLayout) => void;
  onToday: () => void;
  onStep: (direction: -1 | 1) => void;
  emptyEvents: CalendarEvent[];
}

/** Same composition as the calendar toolbar: title left; No date, scale, ‹ Today › right. */
export const TimelineToolbar = memo(
  ({ title, layout, onLayoutChange, onToday, onStep, emptyEvents }: TimelineToolbarProps) => {
    const { t } = useTranslation();
    const preset = TIMELINE_SCALE_PRESETS[layout];
    const previousLabel = t('timeline.previous', { defaultValue: 'Earlier' });
    const nextLabel = t('timeline.next', { defaultValue: 'Later' });
    const selectionMark = (selected: boolean) => (
      <CheckIcon aria-hidden className={cn('h-5 w-5 shrink-0 text-fill-theme-thick', !selected && 'invisible')} />
    );

    return (
      <div
        data-testid='timeline-toolbar'
        className='flex flex-wrap items-center justify-between gap-x-4 gap-y-3 bg-background-primary px-1 py-4'
      >
        <div className='relative flex min-h-7 items-center'>
          <h2 data-testid='timeline-title' className='text-xl font-semibold text-text-primary'>
            {title}
          </h2>
        </div>
        <div className='ml-auto flex max-w-full flex-wrap items-center justify-end gap-2'>
          <NoDateButton emptyEvents={emptyEvents} isWeekView={false} />
          <div className='flex items-center gap-2'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  data-testid='timeline-zoom-trigger'
                  variant='outline'
                  size='sm'
                  className='h-7 gap-1 rounded-300 pl-3 pr-2 font-medium'
                >
                  {t(preset.labelKey, { defaultValue: preset.label })}
                  <DropdownIcon aria-hidden className='h-5 w-3 text-icon-secondary' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-60 rounded-400 bg-surface-layer-04'>
                <DropdownMenuRadioGroup value={String(layout)}>
                  {TIMELINE_LAYOUT_ORDER.map((option) => {
                    const optionPreset = TIMELINE_SCALE_PRESETS[option];

                    return (
                      <DropdownMenuRadioItem
                        key={option}
                        value={String(option)}
                        onSelect={() => onLayoutChange(option)}
                        className='h-8 gap-1 !rounded-200 data-[state=checked]:!bg-transparent'
                        data-testid={`timeline-zoom-${option}`}
                      >
                        {selectionMark(option === layout)}
                        <span>{t(optionPreset.labelKey, { defaultValue: optionPreset.label })}</span>
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid='timeline-step-previous'
                    aria-label={previousLabel}
                    variant='ghost'
                    size='icon'
                    onClick={() => onStep(-1)}
                  >
                    <ChevronLeft aria-hidden className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{previousLabel}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid='timeline-today'
                    variant='outline'
                    size='sm'
                    className='h-7 rounded-300 font-medium'
                    onClick={onToday}
                  >
                    {t('timeline.today', { defaultValue: 'Today' })}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('timeline.today', { defaultValue: 'Today' })}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid='timeline-step-next'
                    aria-label={nextLabel}
                    variant='ghost'
                    size='icon'
                    onClick={() => onStep(1)}
                  >
                    <ChevronRight aria-hidden className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{nextLabel}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

TimelineToolbar.displayName = 'TimelineToolbar';
