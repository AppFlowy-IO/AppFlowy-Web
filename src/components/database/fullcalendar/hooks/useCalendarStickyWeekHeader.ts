import { useCallback, useEffect, useRef, useState } from 'react';

import { getScrollParent } from '@/components/global-comment/utils';

import { CalendarViewType, getCalendarDayCount, isTimeGridView } from '../types';

import type { CalendarApi } from '@fullcalendar/core';

/**
 * Interface for header cell data
 */
interface HeaderCellData {
  date: Date;
  dayName: string;
  dayNumber: number;
  isToday: boolean;
  isWeekend: boolean;
}

/**
 * Custom hook to handle sticky week header using Calendar API data
 * Generates header cells based on current calendar view and date range
 */
export function useCalendarStickyWeekHeader(
  calendarApi: CalendarApi | null, 
  {
    currentView,
    firstDayOfWeek,
    numberOfDays = getCalendarDayCount(currentView) ?? 7,
  }: {
    currentView: CalendarViewType,
    firstDayOfWeek: number,
    numberOfDays?: number,
  }
) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [headerCells, setHeaderCells] = useState<HeaderCellData[]>([]);
  const [scrollLeft, setScrollLeft] = useState(0);

  /**
   * Generate header cells from Calendar API data
   */
  const generateHeaderCells = useCallback(() => {
    if (!calendarApi) return [];

    const view = calendarApi.view;
    const currentDate = view.currentStart;

    const today = new Date();
    const cellsData: HeaderCellData[] = [];

    // Generate cells based on view type
    if (isTimeGridView(currentView)) {
      // FullCalendar supplies the aligned week start or the custom range anchor.
      const startOfWeek = new Date(currentDate);
      
      for (let i = 0; i < numberOfDays; i++) {
        const date = new Date(startOfWeek);

        date.setDate(startOfWeek.getDate() + i);
        
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNumber = date.getDate();
        const isToday = 
          date.getDate() === today.getDate() &&
          date.getMonth() === today.getMonth() &&
          date.getFullYear() === today.getFullYear();
        const isWeekend = date.getDay() === 0 || date.getDay() === 6; // Sunday or Saturday

        cellsData.push({
          date: new Date(date),
          dayName,
          dayNumber,
          isToday,
          isWeekend,
        });
      }
    } else if (currentView === CalendarViewType.DAY_GRID_MONTH) {
      // Month view: show days of week (just day names) starting from firstDayOfWeek
      const startDay = firstDayOfWeek || 0; // 0 = Sunday, 1 = Monday
      
      for (let i = 0; i < 7; i++) {
        const dayIndex = (startDay + i) % 7;
        // Create a date for the specific day to get localized day name
        const tempDate = new Date();

        tempDate.setDate(tempDate.getDate() - tempDate.getDay() + dayIndex);
        const dayName = tempDate.toLocaleDateString('en-US', { weekday: 'short' });
        const isWeekend = dayIndex === 0 || dayIndex === 6;

        cellsData.push({
          date: new Date(), // Not specific date for month view
          dayName,
          dayNumber: 0, // Not applicable for month view
          isToday: false, // Not applicable for month view header
          isWeekend,
        });
      }
    }

    return cellsData;
  }, [calendarApi, currentView, firstDayOfWeek, numberOfDays]);

  /**
   * Update header cells data
   */
  const updateHeaderCells = useCallback(() => {
    const cells = generateHeaderCells();

    setHeaderCells(cells);
  }, [generateHeaderCells]);

  /**
   * Get scroll element for the calendar container
   */
  const getScrollElement = useCallback(() => {
    if (!parentRef.current) return null;
    return parentRef.current.closest('.appflowy-scroll-container') || getScrollParent(parentRef.current);
  }, []);

  // Week header sticky state will be managed by parent component
  // since it should match the toolbar sticky state

  /**
   * Check if current view should show sticky week header
   */
  const shouldShowForCurrentView = useCallback(() => {
    if (!currentView) return true;
    
    // Show for all views
    return true;
  }, [currentView]);

  /**
   * Handle horizontal scroll synchronization
   */
  const handleHorizontalScroll = useCallback(() => {
    const scrollElement = getScrollElement();

    if (scrollElement) {
      setScrollLeft(scrollElement.scrollLeft);
    }
  }, [getScrollElement]);

  /**
   * Setup horizontal scroll monitoring only
   */
  useEffect(() => {
    const scrollElement = getScrollElement();

    if (!scrollElement || !shouldShowForCurrentView()) return;

    scrollElement.addEventListener('scroll', handleHorizontalScroll);
    
    // Initial check
    handleHorizontalScroll();

    return () => {
      scrollElement.removeEventListener('scroll', handleHorizontalScroll);
    };
  }, [getScrollElement, handleHorizontalScroll, shouldShowForCurrentView]);

  /**
   * Initialize header generation when calendar API is available
   * and when calendar dates change
   */
  useEffect(() => {
    if (!calendarApi || !shouldShowForCurrentView()) return;

    // Generate header cells when calendar is ready
    updateHeaderCells();

    calendarApi.on('datesSet', updateHeaderCells);

    return () => {
      calendarApi.off('datesSet', updateHeaderCells);
    };
  }, [calendarApi, updateHeaderCells, shouldShowForCurrentView]);



  return {
    parentRef,
    headerCells,
    scrollLeft,
    shouldShowWeekHeader: shouldShowForCurrentView() && headerCells.length > 0,
    updateHeaderCells,
  };
}
