import { useEffect, useRef } from 'react';

import { Log } from '@/utils/log';
import { useCalendarLayoutSetting } from '@/application/database-yjs';

import { CalendarViewType } from '../types';

import type { CalendarApi } from '@fullcalendar/core';

/**
 * Custom hook to enhance the current time indicator with time label
 * Adds a time label (e.g., "9:07 AM") next to the current time line in week view
 */
export function useCurrentTimeIndicator(calendarApi: CalendarApi | null, currentView: CalendarViewType) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const isCurrentWeekRef = useRef(false);
  const setting = useCalendarLayoutSetting();

  useEffect(() => {
    if (!calendarApi || currentView !== CalendarViewType.TIME_GRID_WEEK) {
      // Clear interval if not in week view
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      // Remove existing custom line when switching away from week view
      const existingLine = document.querySelector('.custom-now-indicator-line');

      if (existingLine) {
        existingLine.remove();
      }

      // Reset time slot visibility when leaving week view
      resetTimeSlotVisibility();

      return;
    }

    const isCurrentWeek = () => {
      if (!calendarApi) return false;

      const now = new Date();
      const currentViewStart = calendarApi.view.activeStart;
      const currentViewEnd = calendarApi.view.activeEnd;

      // Check if current time falls within the displayed week range
      return now >= currentViewStart && now < currentViewEnd;
    };

    const updateTimeLabel = () => {
      // Check if we're viewing the current week
      if (!isCurrentWeek()) {
        isCurrentWeekRef.current = false;
        // Remove horizontal line if not in current week
        const existingLine = document.querySelector('.custom-now-indicator-line');

        if (existingLine) {
          existingLine.remove();
          // Reset time slot visibility on unmount
          resetTimeSlotVisibility();
        }


        return;
      }

      isCurrentWeekRef.current = true;

      // We're in the current week, try to find and update the time indicator
      const tryUpdateTimeIndicator = (retryCount = 0) => {
        const nowIndicatorArrow = document.querySelector('.fc-timegrid-now-indicator-arrow') as HTMLElement;

        if (nowIndicatorArrow) {
          // Get current time
          const now = new Date();
          const timeString = now.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: !setting?.use24Hour
          });
          const [time, period] = timeString.split(' ');
          // Set the content directly to the arrow element

          if (period) {
            nowIndicatorArrow.innerHTML = `<span class="font-medium mr-0.5">${time}</span><span class="font-normal">${period}</span>`;

          } else {
            nowIndicatorArrow.innerHTML = `<span class="font-medium">${time}</span>`;
          }

          // Handle dynamic time slot visibility
          handleTimeSlotVisibility(now);

          // Create or update the horizontal line across the week view
          createHorizontalTimeLine(nowIndicatorArrow);
        } else if (retryCount < 3) {
          // Retry after a short delay if element not found yet
          setTimeout(() => tryUpdateTimeIndicator(retryCount + 1), 100);
        }
      };

      tryUpdateTimeIndicator();
    };

    const handleTimeSlotVisibility = (currentTime: Date) => {
      if (!isCurrentWeekRef.current) return;
      const currentHour = currentTime.getHours();
      const currentMinute = currentTime.getMinutes();

      // Hide/show hourly time slots based on proximity to current time
      for (let hour = 0; hour < 24; hour++) {
        const timeString = String(hour).padStart(2, '0') + ':00:00';
        const timeSlot = document.querySelector(`[data-time="${timeString}"]`) as HTMLElement;

        if (timeSlot) {
          const shouldHide = shouldHideTimeSlot(currentHour, currentMinute, hour);

          if (shouldHide) {
            timeSlot.classList.add('hidden-text');
          } else {
            timeSlot.classList.remove('hidden-text');
          }
        }
      }
    };

    const shouldHideTimeSlot = (currentHour: number, currentMinute: number, slotHour: number): boolean => {
      // If current time is between X:46 and (X+1):16, hide the (X+1):00 slot

      // Case 1: Current time is X:46-X:59, hide next hour slot
      if (currentMinute >= 46 && slotHour === (currentHour + 1) % 24) {
        return true;
      }

      // Case 2: Current time is X:00-X:16, hide current hour slot  
      if (currentMinute <= 16 && slotHour === currentHour) {
        return true;
      }

      return false;
    };


    const createHorizontalTimeLine = (arrowElement: HTMLElement) => {
      // Remove existing line if it exists
      const existingLine = document.querySelector('.custom-now-indicator-line');

      if (existingLine) {
        existingLine.remove();
      }

      // Find the FullCalendar's native now indicator line to align with
      const nowIndicatorLine = document.querySelector('.fc-timegrid-now-indicator-line') as HTMLElement;

      if (!nowIndicatorLine) return;

      // Find the week view container
      const weekViewContainer = document.querySelector('.database-calendar.week-view .fc') as HTMLElement;

      if (!weekViewContainer) return;

      // Get the positions
      const lineRect = nowIndicatorLine.getBoundingClientRect();
      const containerRect = weekViewContainer.getBoundingClientRect();
      const arrowRect = arrowElement.getBoundingClientRect();

      // Debug: Log positions to console
      Log.debug('Position Debug:', {
        nowIndicatorLine: { top: lineRect.top, height: lineRect.height },
        arrow: { top: arrowRect.top, height: arrowRect.height },
        container: { top: containerRect.top }
      });

      // Create the horizontal line element
      const horizontalLine = document.createElement('div');

      horizontalLine.className = 'custom-now-indicator-line';

      // Position the line to align with fc-timegrid-now-indicator-line
      const lineTop = lineRect.top - containerRect.top + 0.5;
      const lineLeft = arrowRect.right - containerRect.left; // Start from arrow's right edge + gap
      const lineWidth = containerRect.width - lineLeft;

      horizontalLine.style.top = `${lineTop}px`;
      horizontalLine.style.left = `${lineLeft}px`;
      horizontalLine.style.width = `${lineWidth}px`;


      // Append the line to the week view container
      weekViewContainer.appendChild(horizontalLine);
    };

    // Initial update
    updateTimeLabel();

    // Update every 15s to keep the time accurate
    intervalRef.current = setInterval(updateTimeLabel, 15000);

    // Listen for date range changes (when user navigates to different weeks)
    const handleDatesSet = () => {
      updateTimeLabel();
    };

    calendarApi.on('datesSet', handleDatesSet);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      calendarApi.off('datesSet', handleDatesSet);
    };
  }, [calendarApi, currentView, setting]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      // Remove custom line on unmount
      const existingLine = document.querySelector('.custom-now-indicator-line');

      if (existingLine) {
        existingLine.remove();
      }

      // Reset time slot visibility on unmount
      resetTimeSlotVisibility();
    };
  }, []);

  // Define resetTimeSlotVisibility outside the main effect so it can be accessed in cleanup
  const resetTimeSlotVisibility = () => {
    // Reset all time slot labels to fully opaque
    for (let hour = 0; hour < 24; hour++) {
      const timeString = String(hour).padStart(2, '0') + ':00:00';
      const timeSlot = document.querySelector(`[data-time="${timeString}"]`) as HTMLElement;

      if (timeSlot) {
        timeSlot.classList.remove('hidden-text');
      }
    }
  };
}