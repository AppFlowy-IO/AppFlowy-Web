import { useCallback, useEffect, useState } from 'react';

import { CalendarViewType } from '@/components/database/fullcalendar/types';

export const useDynamicDayMaxEventRows = (currentView: CalendarViewType, calendarElement: HTMLElement | null) => {
  const [dayMaxEventRows, setDayMaxEventRows] = useState(4);

  const calculateDayMaxEventRows = useCallback(() => {

    // 148: 148px is the height of the week header
    // 20: 20px is the padding-bottom of the calendar content
    // 6: 6 is the number of rows in the calendar
    const weekHeight = (window.innerHeight - 148 - 20) / 6;
    
    
    if (weekHeight < 114) return 2;
    if (weekHeight < 140) return 3; 
    if (weekHeight < 166) return 4;
    if (weekHeight < 192) return 5;
    return 6;
  }, []);

  const updateCalendarCellStyles = useCallback((weekHeight: number) => {
    if (!calendarElement) return;
    if (currentView === CalendarViewType.TIME_GRID_WEEK) {
      calendarElement.style.removeProperty('--calendar-day-min-height');
      return;
    }

    const minHeight = Math.max(weekHeight, 80);

    // Each mounted calendar owns its sizing, including historical previews.
    calendarElement.style.setProperty('--calendar-day-min-height', `${minHeight}px`);
  }, [calendarElement, currentView]);

  const updateDayMaxEventRows = useCallback(() => {
    const newRows = calculateDayMaxEventRows();
    const weekHeight = (window.innerHeight - 148 - 26) / 6;
    
    setDayMaxEventRows(newRows);
    updateCalendarCellStyles(weekHeight);
  }, [calculateDayMaxEventRows, updateCalendarCellStyles]);

  useEffect(() => {
    updateDayMaxEventRows();
    
    window.addEventListener('resize', updateDayMaxEventRows);
    
    return () => {
      window.removeEventListener('resize', updateDayMaxEventRows);
      calendarElement?.style.removeProperty('--calendar-day-min-height');
    };
  }, [calendarElement, updateDayMaxEventRows]);

  return { 
    dayMaxEventRows, 
    updateDayMaxEventRows 
  };
};
