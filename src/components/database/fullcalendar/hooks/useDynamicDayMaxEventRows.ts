import { useCallback, useEffect, useState } from 'react';

import { CalendarViewType, isTimeGridView } from '@/components/database/fullcalendar/types';

export const useDynamicDayMaxEventRows = (currentView: CalendarViewType) => {
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
    if (isTimeGridView(currentView)) return;

    const minHeight = Math.max(weekHeight, 80);
    
    const styleId = 'dynamic-calendar-styles';
    let styleElement = document.getElementById(styleId) as HTMLStyleElement;
    
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }
    
    styleElement.textContent = `
      .fc-daygrid-day,
      .fc-daygrid-day-frame {
        min-height: ${minHeight}px !important;
      }
    `;
  }, [currentView]);

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
    };
  }, [updateDayMaxEventRows]);

  return { 
    dayMaxEventRows, 
    updateDayMaxEventRows 
  };
};
