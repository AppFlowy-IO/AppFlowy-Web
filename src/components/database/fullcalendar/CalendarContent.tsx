// Remove Atlaskit drag and drop - using FullCalendar's native external dragging instead
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { EventReceiveArg } from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { debounce } from 'lodash-es';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import './FullCalendar.styles.scss';

import { useDatabaseContext } from '@/application/database-yjs';
import { useConditionsContext } from '@/components/database/components/conditions/context';
import { AddButton } from '@/components/database/fullcalendar/AddButton';
import { MoreLinkContent } from '@/components/database/fullcalendar/event/MoreLinkContent';
import { useFullCalendarSetup } from '@/components/database/fullcalendar/FullCalendar.hooks';
import {
  useAddButton,
  useCalendarHandlers,
  useCalendarPermissions,
  useCalendarResize,
  useCalendarStickyHeader,
  useCalendarStickyWeekHeader,
  useCurrentTimeIndicator,
  useDynamicDayMaxEventRows,
  useScrollDetection,
  useScrollNavigation,
  useTimeFormat,
} from '@/components/database/fullcalendar/hooks';
import { dayCellContent } from '@/components/database/fullcalendar/utils/dayCellContent';
import { Log } from '@/utils/log';
import { dateToUnixTimestamp } from '@/utils/time';

// CustomToolbar will be handled by parent component
import EventWithPopover from './event/EventWithPopover';
import { CalendarViewType } from './types';

import type { CalendarApi, EventContentArg, MoreLinkContentArg } from '@fullcalendar/core';

import { EventDef } from '@fullcalendar/core/internal';

// Context to provide the clearNewEvent function to EventWithPopover components
const EventContext = createContext<{
  clearNewEvent: (rowId: string) => void;
  setOpenEventRowId: (rowId: string | null) => void;
  markEventAsNew: (rowId: string) => void;
  markEventAsUpdate: (rowId: string) => void;
  clearUpdateEvent: (rowId: string) => void;
} | null>(null);

export const useEventContext = () => {
  const context = useContext(EventContext);

  if (!context) {
    throw new Error('useEventContext must be used within EventContext.Provider');
  }

  return context;
};

/**
 * Calendar data and handlers interface for parent components
 */
interface CalendarContentData {
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
  emptyEvents: import('@/application/database-yjs').CalendarEvent[];
}

/**
 * Props for CalendarContent component
 */
interface CalendarContentProps {
  onDataChange?: (data: CalendarContentData) => void;
  normalToolbarRef?: React.RefObject<HTMLDivElement>;
  onDragEnd?: () => void;
}

/**
 * Inner calendar component that uses the popover context
 */
export function CalendarContent({ onDataChange, normalToolbarRef, onDragEnd }: CalendarContentProps) {
  // State to track newly created events
  const [newEventRowIds, setNewEventRowIds] = useState<Set<string>>(new Set());
  const [openEventRowId, setOpenEventRowId] = useState<string | null>(null);
  const [updateEventRowIds, setUpdateEventRowIds] = useState<Set<string>>(new Set());

  // Calendar handlers and state
  const {
    currentView,
    calendarTitle,
    handleViewChange,
    handleDatesSet,
    handleMoreLinkClick,
    handleEventDrop,
    handleEventResize,
    handleSelect: originalHandleSelect,
    handleAdd: originalHandleAdd,
    updateEventTime,
    morelinkInfo,
    closeMorePopover,
  } = useCalendarHandlers();

  // Get calendar data and setup
  const { events, emptyEvents, firstDayOfWeek } = useFullCalendarSetup(
    newEventRowIds,
    openEventRowId,
    updateEventRowIds,
    currentView
  );

  // Time formatting hook
  const { formatSlotLabel } = useTimeFormat();
  const { paddingStart, paddingEnd, isDocumentBlock, onRendered } = useDatabaseContext();
  const conditionsContext = useConditionsContext();
  const expanded = conditionsContext?.expanded ?? false;

  // Calendar permissions and behavior based on field type
  const { permissions, isAddButtonEnabled, createEvent } = useCalendarPermissions();
  // Calendar reference for API access
  const calendarRef = useRef<FullCalendar>(null);

  const [calendarElement, setCalendarElement] = useState<HTMLDivElement | null>(null);
  // Get calendar API instance
  const calendarApi = calendarRef.current?.getApi() || null;

  // Resize handling
  const resizeRef = useCalendarResize(onRendered, expanded, isDocumentBlock, calendarApi || undefined);

  // Function to clear new event status
  const clearNewEvent = useCallback((rowId: string) => {
    setNewEventRowIds((prev) => {
      const newSet = new Set(prev);

      newSet.delete(rowId);
      return newSet;
    });
  }, []);

  // Function to mark event as new (for duplicate functionality)
  const markEventAsNew = useCallback((rowId: string) => {
    Log.debug('[CalendarContent] Marking event as new:', rowId);
    setNewEventRowIds((prev) => new Set(prev).add(rowId));
  }, []);

  const markEventAsUpdate = useCallback((rowId: string) => {
    Log.debug('[CalendarContent] Marking event as updated:', rowId);
    setUpdateEventRowIds((prev) => new Set(prev).add(rowId));
  }, []);

  const clearUpdateEvent = useCallback((rowId: string) => {
    setUpdateEventRowIds((prev) => {
      const newSet = new Set(prev);

      newSet.delete(rowId);
      return newSet;
    });
  }, []);

  // Wrap handleAdd to mark event as new after creating
  const handleAdd = useCallback(
    async (date: Date) => {
      let rowId: string | null = null;

      if (createEvent) {
        // For created/modified time fields, use custom dispatch
        rowId = await createEvent();
      } else {
        // For regular date fields, use the original handler
        rowId = await originalHandleAdd(date);
      }

      if (rowId) {
        // Mark this event as newly created
        setNewEventRowIds((prev) => new Set(prev).add(rowId!));
      }

      return rowId;
    },
    [originalHandleAdd, createEvent]
  );

  // Create debounced version of the select handler to prevent double-click issues
  const debouncedSelectHandler = useMemo(
    () =>
      debounce(
        async (selectInfo: Parameters<typeof originalHandleSelect>[0]) => {
          let rowId: string | null = null;

          if (createEvent) {
            // For created/modified time fields, use custom dispatch
            rowId = await createEvent();
          } else {
            // For regular date fields, use the original handler
            rowId = await originalHandleSelect(selectInfo);
          }

          if (rowId) {
            // Mark this event as newly created
            setNewEventRowIds((prev) => new Set(prev).add(rowId!));
          }

          return rowId;
        },
        300,
        { leading: true, trailing: false }
      ), // Leading edge trigger to prevent double-click
    [originalHandleSelect, createEvent]
  );

  // Wrap handleSelect to use debounced version
  const handleSelect = useCallback(
    (selectInfo: Parameters<typeof originalHandleSelect>[0]) => {
      return debouncedSelectHandler(selectInfo);
    },
    [debouncedSelectHandler]
  );

  // Handle external event creation (FullCalendar eventReceive callback)
  const handleEventReceive = useCallback(
    (receiveInfo: EventReceiveArg) => {
      Log.debug('📅 FullCalendar eventReceive:', receiveInfo);

      try {
        const event = receiveInfo.event;
        const rowId = event.extendedProps?.rowId;

        if (!rowId) {
          console.error('❌ No rowId found in dropped event');
          receiveInfo.revert();
          return;
        }

        // Get the date information from the dropped event
        const startDate = event.start;
        const endDate = event.end;
        const allDay = event.allDay;

        if (!startDate) {
          console.error('❌ No start date found in dropped event');
          receiveInfo.revert();
          return;
        }

        // Convert to timestamps
        const startTimestamp = dateToUnixTimestamp(startDate);
        let endTimestamp = undefined;

        if (endDate) {
          endTimestamp = dateToUnixTimestamp(endDate);
        } else if (!allDay) {
          // Default 1 hour duration for timed events without end time
          const defaultEndDate = new Date(startDate);

          defaultEndDate.setHours(startDate.getHours() + 1);
          endTimestamp = dateToUnixTimestamp(defaultEndDate);
        }

        // Update the row's date field to move it from NoDate to calendar
        updateEventTime(rowId, startTimestamp, endTimestamp, allDay);

        // Mark the event as new for visual feedback
        setNewEventRowIds((prev) => new Set(prev).add(rowId));

        // Remove the external event since we'll show our own calendar event
        receiveInfo.revert();

        // Reset drag state after successful drop
        onDragEnd?.();

        Log.debug('📅 NoDateRow successfully converted to calendar event');
      } catch (error) {
        console.error('❌ Failed to handle external event receive:', error);
        receiveInfo.revert();
        onDragEnd?.(); // Also reset on error
      }
    },
    [updateEventTime, onDragEnd]
  );

  // No need for manual drop target setup - FullCalendar handles this with droppable: true

  // Scroll navigation with threshold detection
  const { containerRef: scrollRef } = useScrollNavigation(currentView, calendarApi);

  // Dynamic day max event rows
  const { dayMaxEventRows, updateDayMaxEventRows } = useDynamicDayMaxEventRows(currentView);

  // Sticky header handling
  const { parentRef: stickyHeaderRef, showStickyToolbar } = useCalendarStickyHeader(calendarApi, normalToolbarRef);

  // Sticky week header handling
  const {
    parentRef: stickyWeekHeaderRef,
    headerCells,
    scrollLeft,
    shouldShowWeekHeader,
  } = useCalendarStickyWeekHeader(calendarApi, { currentView, firstDayOfWeek });

  // Add button functionality
  const {
    ref: addButtonRef,
    addButtonState,
    handleAddButtonClick,
    handleAddButtonMouseLeave,
  } = useAddButton({
    readOnly: false, // We handle enabled state via isAddButtonEnabled function
    currentView,
    calendarElement,
    onAddEvent: handleAdd,
    isAddButtonEnabled,
  });

  // Scroll detection (handles add button visibility via CSS)
  useScrollDetection(scrollRef, addButtonRef);

  // Enhanced current time indicator with time label
  useCurrentTimeIndicator(calendarApi, currentView);

  // Combine refs for container element
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      resizeRef.current = node;
      scrollRef.current = node;
      stickyHeaderRef.current = node;
      stickyWeekHeaderRef.current = node;
      setCalendarElement(node);
    },
    [resizeRef, scrollRef, stickyHeaderRef, stickyWeekHeaderRef]
  );

  // Memoized handlers with proper dependencies
  const memoizedHandleViewChange = useCallback(
    (view: CalendarViewType) => handleViewChange(view, calendarApi),
    [handleViewChange, calendarApi]
  );

  const memoizedHandleDatesSet = useCallback(
    (dateInfo: Parameters<typeof handleDatesSet>[0]) => {
      handleDatesSet(dateInfo, calendarApi);
    },
    [handleDatesSet, calendarApi]
  );

  // Memoized style object
  const containerStyle = useMemo(
    () => ({
      marginLeft: paddingStart === undefined ? undefined : paddingStart,
      marginRight: paddingEnd === undefined ? undefined : paddingEnd,
    }),
    [paddingStart, paddingEnd]
  );

  // Memoized className
  const containerClassName = useMemo(() => {
    let viewClass = 'week-view'; // default

    if (currentView === CalendarViewType.DAY_GRID_MONTH) {
      viewClass = 'month-view';
    }

    return `database-calendar relative z-[1] mx-24 min-h-full h-auto text-sm max-sm:!mx-6 ${viewClass}`;
  }, [currentView]);

  // Memoized calendar plugins array
  const calendarPlugins = useMemo(() => [dayGridPlugin, timeGridPlugin, interactionPlugin], []);

  // Memoized day header format for week view
  const dayHeaderFormat = useMemo(
    () =>
      currentView === CalendarViewType.DAY_GRID_MONTH
        ? undefined
        : {
            weekday: 'short' as const,
            day: 'numeric' as const,
          },
    [currentView]
  );

  // Memoized slot label content component
  const slotLabelContent = useCallback((args: { date: Date }) => formatSlotLabel(args.date), [formatSlotLabel]);

  // Memoized day header content for week view
  const dayHeaderContent = useCallback(
    (args: { date: Date; isToday: boolean }) => {
      if (currentView === CalendarViewType.DAY_GRID_MONTH) return undefined;

      const dayName = args.date.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNumber = args.date.getDate();

      if (args.isToday) {
        return (
          <>
            {dayName} <span className='today-date'>{dayNumber}</span>
          </>
        );
      }

      return `${dayName} ${dayNumber}`;
    },
    [currentView]
  );

  // Memoized event content component
  const eventContent = useCallback(
    (eventInfo: EventContentArg) => (
      <EventWithPopover
        event={eventInfo.event}
        eventInfo={eventInfo}
        isWeekView={currentView === CalendarViewType.TIME_GRID_WEEK}
      />
    ),
    [currentView]
  );

  // Memoized day cell content for month view
  const dayCellContentCallback = useCallback(
    (args: { date: Date; dayNumberText: string; isToday: boolean }) => {
      if (currentView !== CalendarViewType.DAY_GRID_MONTH) return undefined;
      return dayCellContent(args);
    },
    [currentView]
  );

  // Memoized day popover format for title
  const dayPopoverFormat = useMemo(
    () => ({
      month: 'short' as const,
      day: 'numeric' as const,
    }),
    []
  );

  const eventOrder = useMemo(() => {
    return [
      (a: EventDef) => {
        if (a.extendedProps.isNew) {
          return -1;
        }

        if (a.extendedProps.isUpdate) {
          return -1;
        }

        if (!a.extendedProps.includeTime) {
          return -1;
        }

        if (a.extendedProps.isMultipleDayEvent) {
          return -1;
        }

        return 1;
      },

      'start',
    ];
  }, []);

  // Sync calendar data to parent component
  useEffect(() => {
    if (onDataChange) {
      onDataChange({
        calendarApi,
        currentView,
        showStickyToolbar,
        shouldShowWeekHeader,
        weekHeaderCells: headerCells,
        weekHeaderScrollLeft: scrollLeft,
        handleViewChange: memoizedHandleViewChange,
        emptyEvents,
      });
    }
  }, [
    onDataChange,
    calendarApi,
    currentView,
    calendarTitle,
    showStickyToolbar,
    shouldShowWeekHeader,
    headerCells,
    scrollLeft,
    memoizedHandleViewChange,
    emptyEvents,
  ]);

  const renderMoreLinkContent = useCallback(
    (props: MoreLinkContentArg) => {
      if (!calendarApi) return null;
      return (
        <MoreLinkContent onClose={closeMorePopover} calendar={calendarApi} data={props} moreLinkInfo={morelinkInfo} />
      );
    },
    [closeMorePopover, calendarApi, morelinkInfo]
  );

  return (
    <EventContext.Provider
      value={{ clearNewEvent, setOpenEventRowId, markEventAsNew, markEventAsUpdate, clearUpdateEvent }}
    >
      <div ref={setContainerRef} style={containerStyle} className={containerClassName}>
        <FullCalendar
          initialView={currentView}
          viewDidMount={updateDayMaxEventRows}
          ref={calendarRef}
          plugins={calendarPlugins}
          headerToolbar={false}
          dayHeaders={false}
          events={events}
          slotEventOverlap={false}
          firstDay={firstDayOfWeek}
          dayMaxEventRows={currentView === CalendarViewType.TIME_GRID_WEEK ? 3 : dayMaxEventRows}
          eventDisplay='block'
          showNonCurrentDates={true}
          height={'auto'}
          scrollTimeReset={false}
          slotMinTime='00:00:00'
          slotMaxTime='24:00:00'
          snapDuration='00:30:00'
          slotDuration='00:30:00'
          slotLabelContent={slotLabelContent}
          dayHeaderFormat={currentView === CalendarViewType.TIME_GRID_WEEK ? dayHeaderFormat : undefined}
          dayHeaderContent={currentView === CalendarViewType.TIME_GRID_WEEK ? dayHeaderContent : undefined}
          dayCellContent={currentView === CalendarViewType.DAY_GRID_MONTH ? dayCellContentCallback : undefined}
          nowIndicator={true}
          datesSet={memoizedHandleDatesSet}
          eventContent={eventContent}
          moreLinkClick={handleMoreLinkClick}
          moreLinkContent={renderMoreLinkContent}
          dayPopoverFormat={dayPopoverFormat}
          // eslint-disable-next-line
          eventOrder={currentView === CalendarViewType.TIME_GRID_WEEK ? ['start', 'title'] : (eventOrder as any)}
          eventOrderStrict={false}
          editable={permissions.editable}
          selectable={permissions.selectable}
          droppable={permissions.droppable}
          eventResizableFromStart={permissions.eventResizable}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          eventReceive={handleEventReceive}
          select={handleSelect}
          fixedMirrorParent={document.body}
          dragScroll={true}
        />
      </div>
      <AddButton
        ref={addButtonRef}
        visible={addButtonState.visible}
        position={addButtonState.position}
        date={addButtonState.date}
        onClick={handleAddButtonClick}
        onMouseLeave={handleAddButtonMouseLeave}
        container={calendarElement}
      />
    </EventContext.Provider>
  );
}
