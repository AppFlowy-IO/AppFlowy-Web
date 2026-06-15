import { CalendarApi } from '@fullcalendar/core';
import dayjs from 'dayjs';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CalendarEvent, useDatabaseContext, useDatabaseViewId } from '@/application/database-yjs';
import { ReactComponent as ChevronLeft } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as ChevronRight } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CalendarIcon } from '@/assets/icons/calendar.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

import { useCalendarKeyboardShortcuts } from './hooks';
import { NoDateButton } from './NoDateButton';
import { CalendarViewType } from './types';

interface CustomToolbarProps {
  calendar?: CalendarApi | null;
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
    onViewChange,
    slideDirection,
    emptyEvents = [],
    onDragStart,
    draggingRowId,
    onDragEnd,
  }: CustomToolbarProps) => {
    const { t } = useTranslation();

    const { calendarViewTypeMap, setCalendarViewType } = useDatabaseContext();
    const viewId = useDatabaseViewId();

    const currentView: CalendarViewType = useMemo(() => {
      return calendarViewTypeMap?.get(viewId) || CalendarViewType.DAY_GRID_MONTH;
    }, [calendarViewTypeMap, viewId]);

    const [currentMonth, setCurrentMonth] = useState('');
    const [animationKey, setAnimationKey] = useState(0);

    const getCurrentMonth = useCallback(() => {
      if (!calendar) return '';
      const currentDate = dayjs(calendar.getDate());

      if (currentView === CalendarViewType.TIME_GRID_WEEK) {
        const view = calendar.view;
        const startDate = dayjs(view.activeStart);
        const endDate = dayjs(view.activeEnd).subtract(1, 'day');

        if (startDate.month() === endDate.month()) {
          return `${startDate.format('MMMM YYYY')}`;
        } else {
          return `${startDate.format('MMM')} - ${endDate.format('MMM YYYY')}`;
        }
      }

      return currentDate.format('MMMM YYYY');
    }, [calendar, currentView]);

    useEffect(() => {
      if (!calendar) return;

      const handleDateChange = () => {
        const newMonth = getCurrentMonth();

        setCurrentMonth(newMonth);
        setAnimationKey((prev) => prev + 1);
      };

      calendar.on('datesSet', handleDateChange);

      const initialMonth = getCurrentMonth();

      setCurrentMonth(initialMonth);

      return () => {
        calendar.off('datesSet', handleDateChange);
      };
    }, [calendar, getCurrentMonth]);

    const handlePrev = useCallback(() => {
      calendar?.prev();
    }, [calendar]);

    const handleNext = useCallback(() => {
      calendar?.next();
    }, [calendar]);

    const handleToday = useCallback(() => {
      calendar?.today();
    }, [calendar]);

    const handleViewChange = useCallback(
      (view: CalendarViewType) => {
        // Update context map
        if (viewId && setCalendarViewType) {
          setCalendarViewType(viewId, view);
        }

        calendar?.changeView(view);
        onViewChange?.(view);
      },
      [calendar, onViewChange, viewId, setCalendarViewType]
    );

    const views = useMemo(
      () => [
        {
          key: CalendarViewType.TIME_GRID_WEEK,
          label: t('calendar.week'),
          icon: CalendarIcon,
          shortcutLabel: createHotKeyLabel(HOT_KEY_NAME.CALENDAR_WEEK_VIEW),
        },
        {
          key: CalendarViewType.DAY_GRID_MONTH,
          label: t('calendar.month'),
          icon: CalendarIcon,
          shortcutLabel: createHotKeyLabel(HOT_KEY_NAME.CALENDAR_MONTH_VIEW),
        },
      ],
      [t]
    );

    const label = useMemo(() => {
      return views.find((view) => view.key === currentView)?.label;
    }, [currentView, views]);

    useCalendarKeyboardShortcuts({
      calendar,
      currentView,
      onViewChange: handleViewChange,
      onPrev: handlePrev,
      onNext: handleNext,
      onToday: handleToday,
    });

    return (
      <div data-testid='calendar-toolbar' className='grid grid-cols-3 items-center bg-background-primary px-1 py-4'>
        <div className='relative flex h-8 items-center overflow-hidden'>
          <AnimatePresence mode='wait'>
            <motion.h2
              data-testid='calendar-title'
              key={`${currentMonth}-${animationKey}`}
              className='whitespace-nowrap text-xl font-semibold text-text-primary'
              initial={{
                y: slideDirection === 'up' ? 32 : slideDirection === 'down' ? -32 : 0,
                opacity: slideDirection ? 0 : 1,
              }}
              animate={{
                y: 0,
                opacity: 1,
              }}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 25,
                duration: 0.5,
              }}
            >
              {currentMonth}
            </motion.h2>
          </AnimatePresence>
        </div>

        <div className='flex items-center justify-center'>
          <div className='flex items-center gap-0.5 rounded-300 border border-border-primary bg-fill-content p-0.5'>
            {views.map((view) => (
              <Tooltip key={view.key}>
                <TooltipTrigger asChild>
                  <Button
                    variant={'ghost'}
                    size='sm'
                    onClick={() => handleViewChange(view.key)}
                    className={cn(
                      'min-w-[88px] border-transparent text-text-secondary hover:bg-fill-content hover:text-text-primary',

                      currentView === view.key && '!bg-fill-content-hover text-text-primary'
                    )}
                  >
                    {view.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {view.label} <TooltipShortcut>{view.shortcutLabel}</TooltipShortcut>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className='flex items-center justify-end gap-1 overflow-hidden'>
          <NoDateButton
            emptyEvents={emptyEvents}
            isWeekView={currentView === CalendarViewType.TIME_GRID_WEEK}
            onDragStart={onDragStart}
            draggingRowId={draggingRowId}
            onDragEnd={onDragEnd}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button data-testid='calendar-prev-button' variant='ghost' onClick={handlePrev} size='icon'>
                <ChevronLeft className='h-5 w-5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('calendar.navigation.previous', { view: label })}{' '}
              <TooltipShortcut>{createHotKeyLabel(HOT_KEY_NAME.CALENDAR_PREV)}</TooltipShortcut>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button data-testid='calendar-today-button' variant='outline' size='sm' onClick={handleToday}>
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
              <Button data-testid='calendar-next-button' variant='ghost' size='icon' onClick={handleNext}>
                <ChevronRight className='h-5 w-5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('calendar.navigation.next', { view: label })}{' '}
              <TooltipShortcut>{createHotKeyLabel(HOT_KEY_NAME.CALENDAR_NEXT)}</TooltipShortcut>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }
);