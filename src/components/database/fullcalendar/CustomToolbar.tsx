import { CalendarApi } from '@fullcalendar/core';
import useMediaQuery from '@mui/material/useMediaQuery';
import dayjs from 'dayjs';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CalendarEvent } from '@/application/database-yjs';
import { ReactComponent as ChevronLeft } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ChevronRight } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as DropdownIcon } from '@/assets/icons/triangle_down.svg';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

import { changeCalendarView, navigateCalendar } from './calendarNavigation';
import { useCalendarKeyboardShortcuts } from './hooks';
import { NoDateButton } from './NoDateButton';
import { CALENDAR_DAY_COUNTS, CalendarViewType, getCalendarDayCount, getCalendarDayView, isTimeGridView } from './types';

interface CustomToolbarProps {
  calendar?: CalendarApi | null;
  currentView?: CalendarViewType;
  onViewChange?: (view: CalendarViewType) => void;
  slideDirection?: 'up' | 'down' | null;
  emptyEvents?: CalendarEvent[];
  onDragStart?: (rowId: string) => void;
  draggingRowId?: string | null;
  onDragEnd?: () => void;
}

export const CustomToolbar = memo(
  ({
    calendar,
    currentView = CalendarViewType.DAY_GRID_MONTH,
    onViewChange,
    slideDirection,
    emptyEvents = [],
    onDragStart,
    draggingRowId,
    onDragEnd,
  }: CustomToolbarProps) => {
    const { t } = useTranslation();
    const toolbarRef = useRef<HTMLDivElement>(null);
    const overlapDayMenu = useMediaQuery('(max-width: 520px)');
    const [menuOpen, setMenuOpen] = useState(false);
    const [currentMonth, setCurrentMonth] = useState('');
    const [animationKey, setAnimationKey] = useState(0);

    const getCurrentMonth = useCallback(() => {
      if (!calendar) return '';

      if (isTimeGridView(currentView)) {
        const start = dayjs(calendar.view.activeStart);
        const end = dayjs(calendar.view.activeEnd).subtract(1, 'day');

        if (start.year() !== end.year()) return `${start.format('MMM YYYY')} - ${end.format('MMM YYYY')}`;
        if (start.month() !== end.month()) return `${start.format('MMM')} - ${end.format('MMM YYYY')}`;
        return start.format('MMMM YYYY');
      }

      return dayjs(calendar.getDate()).format('MMMM YYYY');
    }, [calendar, currentView]);

    useEffect(() => {
      if (!calendar) return;
      const handleDateChange = () => {
        setCurrentMonth(getCurrentMonth());
        setAnimationKey((prev) => prev + 1);
      };

      calendar.on('datesSet', handleDateChange);
      setCurrentMonth(getCurrentMonth());
      return () => calendar.off('datesSet', handleDateChange);
    }, [calendar, getCurrentMonth]);

    const handlePrev = useCallback(() => navigateCalendar(calendar, -1), [calendar]);
    const handleNext = useCallback(() => navigateCalendar(calendar, 1), [calendar]);
    const handleToday = useCallback(() => calendar?.today(), [calendar]);
    const handleViewChange = useCallback(
      (view: CalendarViewType) => {
        setMenuOpen(false);
        if (!calendar || view === currentView) return;

        if (onViewChange) {
          onViewChange(view);
        } else {
          changeCalendarView(calendar, view);
        }
      },
      [calendar, currentView, onViewChange]
    );
    const views = useMemo(
      () => [
        { key: CalendarViewType.TIME_GRID_WEEK, label: t('calendar.week'), shortcut: HOT_KEY_NAME.CALENDAR_WEEK_VIEW },
        { key: CalendarViewType.DAY_GRID_MONTH, label: t('calendar.month'), shortcut: HOT_KEY_NAME.CALENDAR_MONTH_VIEW },
      ],
      [t]
    );
    const isCustomRange =
      currentView !== CalendarViewType.DAY_GRID_MONTH && currentView !== CalendarViewType.TIME_GRID_WEEK && currentView !== CalendarViewType.TIME_GRID_DAY;
    const label = currentView === CalendarViewType.TIME_GRID_DAY ? t('calendar.navigation.views.day') : isCustomRange
      ? t('calendar.dayCount', { count: getCalendarDayCount(currentView) })
      : views.find((view) => view.key === currentView)?.label;
    const navigationLabel = isCustomRange ? t('calendar.navigation.views.period') : label;
    const previousLabel = t('calendar.navigation.previous', { view: navigationLabel });
    const nextLabel = t('calendar.navigation.next', { view: navigationLabel });

    useCalendarKeyboardShortcuts({
      calendar,
      toolbarRef,
      currentView,
      onViewChange: handleViewChange,
      onPrev: handlePrev,
      onNext: handleNext,
      onToday: handleToday,
    });

    const selectionMark = (selected: boolean) => (
      <CheckIcon aria-hidden className={cn('h-5 w-5 shrink-0 text-fill-theme-thick', !selected && 'invisible')} />
    );

    return (
      <div
        ref={toolbarRef}
        data-testid='calendar-toolbar'
        className='flex flex-wrap items-center justify-between gap-x-4 gap-y-3 bg-background-primary px-1 py-4'
      >
        <div className='relative flex min-h-7 items-center'>
          <AnimatePresence mode='wait'>
            <motion.h2
              data-testid='calendar-title'
              key={`${currentMonth}-${animationKey}`}
              className='text-xl font-semibold text-text-primary'
              initial={{
                y: slideDirection === 'up' ? 32 : slideDirection === 'down' ? -32 : 0,
                opacity: slideDirection ? 0 : 1,
              }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25, duration: 0.5 }}
            >
              {currentMonth}
            </motion.h2>
          </AnimatePresence>
        </div>
        <div className='ml-auto flex max-w-full flex-wrap items-center justify-end gap-2'>
          <NoDateButton
            emptyEvents={emptyEvents}
            isWeekView={isTimeGridView(currentView)}
            onDragStart={onDragStart}
            draggingRowId={draggingRowId}
            onDragEnd={onDragEnd}
          />
          <div className='flex items-center gap-2'>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  data-testid='calendar-view-select'
                  variant='outline'
                  size='sm'
                  className='h-7 gap-1 rounded-300 pl-3 pr-2 font-medium'
                >
                  {label}
                  <DropdownIcon aria-hidden className='h-5 w-3 text-icon-secondary' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-60 rounded-400 bg-surface-layer-04'>
                <DropdownMenuRadioGroup value={currentView}>
                  {views.map((view) => (
                    <DropdownMenuRadioItem
                      key={view.key}
                      value={view.key}
                      onSelect={() => handleViewChange(view.key)}
                      className='h-8 gap-1 !rounded-200 data-[state=checked]:!bg-transparent'
                    >
                      {selectionMark(currentView === view.key)}
                      <span>{view.label}</span>
                      <DropdownMenuShortcut className='text-text-secondary'>
                        {createHotKeyLabel(view.shortcut)}
                      </DropdownMenuShortcut>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className='gap-1 rounded-200'>
                    {selectionMark(isCustomRange)}
                    {t('calendar.numberOfDays')}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent
                      className={cn(
                        'w-60 rounded-400 border border-border-primary bg-surface-layer-04',
                        overlapDayMenu && 'data-[side=right]:!ml-0'
                      )}
                      // Overlap the parent menu when two 240px menus cannot fit side by side.
                      sideOffset={overlapDayMenu ? -232 : 0}
                      collisionPadding={8}
                    >
                      <DropdownMenuRadioGroup value={currentView}>
                        {CALENDAR_DAY_COUNTS.map((count) => {
                          const view = getCalendarDayView(count)!;

                          return (
                            <DropdownMenuRadioItem
                              key={count}
                              value={view}
                              onSelect={() => handleViewChange(view)}
                              className='h-8 gap-1 !rounded-200 data-[state=checked]:!bg-transparent'
                            >
                              {selectionMark(currentView === view)}
                              <span>{t('calendar.dayCount', { count })}</span>
                              <DropdownMenuShortcut className='text-text-secondary'>{count}</DropdownMenuShortcut>
                            </DropdownMenuRadioItem>
                          );
                        })}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid='calendar-prev-button'
                    aria-label={previousLabel}
                    variant='ghost'
                    onClick={handlePrev}
                    size='icon'
                  >
                    <ChevronLeft aria-hidden className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {previousLabel} <TooltipShortcut>{createHotKeyLabel(HOT_KEY_NAME.CALENDAR_PREV)}</TooltipShortcut>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid='calendar-today-button'
                    variant='outline'
                    size='sm'
                    className='h-7 rounded-300 font-medium'
                    onClick={handleToday}
                  >
                    {t('calendar.navigation.today')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t('calendar.navigation.today')}{' '}
                  <TooltipShortcut>{createHotKeyLabel(HOT_KEY_NAME.CALENDAR_TODAY)}</TooltipShortcut>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid='calendar-next-button'
                    aria-label={nextLabel}
                    variant='ghost'
                    onClick={handleNext}
                    size='icon'
                  >
                    <ChevronRight aria-hidden className='h-5 w-5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {nextLabel} <TooltipShortcut>{createHotKeyLabel(HOT_KEY_NAME.CALENDAR_NEXT)}</TooltipShortcut>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
