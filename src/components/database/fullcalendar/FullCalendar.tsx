import dayjs from 'dayjs';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { CalendarEvent, useDatabaseContext } from '@/application/database-yjs';
import DatabaseStickyTopOverlay from '@/components/database/components/sticky-overlay/DatabaseStickyTopOverlay';
import { Log } from '@/utils/log';
import { getPlatform } from '@/utils/platform';

import { CalendarContent } from './CalendarContent';
import { CalendarUnsupportedPage } from './CalendarUnsupportedPage';
import { StickyCalendarToolbar } from './StickyCalendarToolbar';
import { StickyWeekHeader } from './StickyWeekHeader';
import { CalendarViewType } from './types';

import type { CalendarApi } from '@fullcalendar/core';

/**
 * Calendar data interface from CalendarContent
 */
interface CalendarData {
  calendarApi: CalendarApi | null;
  currentView: CalendarViewType;
  showStickyToolbar: boolean;
  shouldShowWeekHeader: boolean;
  weekHeaderCells: Array<{
    date: Date;
    dayName: string;
    dayNumber: number;
    isToday: boolean;
    isWeekend: boolean;
  }>;
  weekHeaderScrollLeft: number;
  handleViewChange: (view: CalendarViewType) => void;
  emptyEvents: CalendarEvent[];
}

/**
 * Main Calendar component with separated toolbar and sticky header support
 */
function Calendar() {
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
  const normalToolbarRef = useRef<HTMLDivElement>(null);

  const [slideDirection, setSlideDirection] = useState<'up' | 'down' | null>(null);
  const prevMonthRef = useRef('');

  // Drag state management
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);

  // Drag handlers
  const handleDragStart = useCallback((rowId: string) => {
    Log.debug('🎯 Drag started for rowId:', rowId);
    setDraggingRowId(rowId);
  }, []);

  const handleDragEnd = useCallback(() => {
    Log.debug('🎯 Drag ended');
    setDraggingRowId(null);
  }, []);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  const { onRendered } = useDatabaseContext();

  // Check for mobile device on component mount
  useEffect(() => {
    const { isMobile } = getPlatform();

    setIsMobile(isMobile);
  }, []);

  // Notify parent when calendar data is ready (rendered)
  useEffect(() => {
    if (calendarData) {
      onRendered?.();
    }
  }, [calendarData, onRendered]);

  // Handle calendar data changes from CalendarContent
  const handleCalendarDataChange = useCallback((data: CalendarData) => {
    if (data.calendarApi) {
      const currentDate = dayjs(data.calendarApi.getDate());
      const currentMonth = currentDate.format('MMMM YYYY');
      const prevMonth = prevMonthRef.current;

      if (prevMonth && currentMonth !== prevMonth) {
        const current = dayjs(currentMonth, 'MMMM YYYY');
        const previous = dayjs(prevMonth, 'MMMM YYYY');

        if (current.isAfter(previous)) {
          setSlideDirection('up');
        } else {
          setSlideDirection('down');
        }

        setTimeout(() => {
          setSlideDirection(null);
        }, 300);
      }

      prevMonthRef.current = currentMonth;
    }

    setCalendarData(data);
  }, []);

  // Return unsupported page for mobile devices
  if (isMobile) {
    return <CalendarUnsupportedPage />;
  }

  return (
    <div className='calendar-wrapper pb-5'>
      {/* Normal toolbar - always visible */}
      <div ref={normalToolbarRef}>
        <StickyCalendarToolbar
          calendar={calendarData?.calendarApi}
          currentView={calendarData?.currentView}
          onViewChange={calendarData?.handleViewChange}
          slideDirection={slideDirection}
          emptyEvents={calendarData?.emptyEvents}
          onDragStart={handleDragStart}
          draggingRowId={draggingRowId}
          onDragEnd={handleDragEnd}
        />
      </div>

      {/* Normal week header - always visible for comparison */}
      <StickyWeekHeader
        headerCells={calendarData?.weekHeaderCells}
        visible={true}
        scrollLeft={calendarData?.weekHeaderScrollLeft}
        currentView={calendarData?.currentView}
      />

      {/* Calendar content without toolbar */}
      <CalendarContent
        onDataChange={handleCalendarDataChange}
        normalToolbarRef={normalToolbarRef}
        onDragEnd={handleDragEnd}
      />

      {/* Sticky toolbar and week header via DatabaseStickyTopOverlay */}
      {calendarData?.showStickyToolbar && (
        <DatabaseStickyTopOverlay>
          <StickyCalendarToolbar
            calendar={calendarData.calendarApi}
            currentView={calendarData.currentView}
            onViewChange={calendarData.handleViewChange}
            slideDirection={slideDirection}
            emptyEvents={calendarData.emptyEvents}
            onDragStart={handleDragStart}
            draggingRowId={draggingRowId}
            onDragEnd={handleDragEnd}
          />
          <StickyWeekHeader
            headerCells={calendarData.weekHeaderCells}
            visible={true}
            isSticky={true}
            scrollLeft={calendarData.weekHeaderScrollLeft}
            currentView={calendarData.currentView}
          />
        </DatabaseStickyTopOverlay>
      )}
    </div>
  );
}

// Export the memoized component
export default memo(Calendar);

// Named export for backward compatibility
export { Calendar };
