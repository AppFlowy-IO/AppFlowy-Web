import { useCallback, useEffect, useRef } from 'react';

import { Log } from '@/utils/log';
import { getScrollParent } from '@/components/global-comment/utils';

import { CalendarViewType } from '../types';

import type { CalendarApi } from '@fullcalendar/core';

/**
 * Custom hook to handle elastic scroll-based navigation for calendar
 * Pull beyond 150px threshold to trigger month navigation, otherwise bounce back
 */
export function useScrollNavigation(currentView: CalendarViewType, calendarApi: CalendarApi | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastNavigationTime = useRef(0);
  const throttleDelay = 300; // 300ms throttle between navigations

  // Scroll accumulation state for threshold detection
  const scrollAccumulator = useRef(0);
  const isAccumulating = useRef(false);
  const lastTriggerTime = useRef(0);

  const SCROLL_THRESHOLD = 500; // Total scroll amount needed to trigger navigation (further increased)
  const TRIGGER_COOLDOWN = 800; // Cooldown period after triggering to prevent rapid consecutive triggers

  /**
   * Get the scroll element for the calendar container
   */
  const getScrollElement = useCallback(() => {
    if (!containerRef.current) return null;
    return containerRef.current.closest('.appflowy-scroll-container') || getScrollParent(containerRef.current);
  }, []);

  /**
   * Check if we're at scroll boundary for the given direction
   */
  const isAtScrollBoundary = useCallback((direction: 'up' | 'down'): boolean => {
    const scrollElement = getScrollElement();

    if (!scrollElement) return false;

    const { scrollTop, scrollHeight, clientHeight } = scrollElement;
    const tolerance = 1; // Stricter boundary detection (was 5px)

    if (direction === 'up') {
      const isAtTop = scrollTop <= tolerance;

      return isAtTop;
    } else {
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - tolerance;

      return isAtBottom;
    }
  }, [getScrollElement]);

  /**
   * Reset scroll accumulator
   */
  const resetScrollAccumulator = useCallback(() => {
    scrollAccumulator.current = 0;
    isAccumulating.current = false;
  }, []);

  /**
   * Check if we're in cooldown period after last trigger
   */
  const isInCooldown = useCallback(() => {
    const now = Date.now();

    return now - lastTriggerTime.current < TRIGGER_COOLDOWN;
  }, [TRIGGER_COOLDOWN]);

  /**
   * Navigate to next/prev month and reset accumulator
   */
  const navigateMonth = useCallback((direction: 'up' | 'down') => {
    const now = Date.now();

    if (now - lastNavigationTime.current < throttleDelay) {
      return false;
    }

    lastNavigationTime.current = now;

    if (direction === 'down') {
      Log.debug('📅 Scroll Navigation: Moving to next month');
      calendarApi?.next();
    } else {
      Log.debug('📅 Scroll Navigation: Moving to previous month');
      calendarApi?.prev();
    }

    // Reset accumulator after navigation
    resetScrollAccumulator();
    return true;
  }, [calendarApi, throttleDelay, resetScrollAccumulator]);

    /**
   * Handle wheel events with scroll threshold detection
   */
  const handleWheel = useCallback((e: WheelEvent) => {
    const target = e.target as HTMLElement;

    // Skip if scrolling within popover
    if (target.closest('.fc-popover-body')) return;

    // Only handle vertical scrolling
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

    const direction = e.deltaY > 0 ? 'down' : 'up';

    // Check if we're at the scroll boundary for this direction
    if (isAtScrollBoundary(direction)) {
      e.preventDefault();

      // Check if we're in cooldown period
      if (isInCooldown()) {
        return;
      }

      // Start or continue accumulating scroll
      if (!isAccumulating.current) {
        isAccumulating.current = true;
        scrollAccumulator.current = 0;
      }

      // Only accumulate significant scroll amounts to reduce sensitivity
      const deltaY = Math.abs(e.deltaY);

      if (deltaY >= 8) { // Only count scrolls >= 8px to reduce sensitivity
        scrollAccumulator.current += deltaY;

        // Check if threshold is reached
        if (scrollAccumulator.current >= SCROLL_THRESHOLD) {
          // Set cooldown time and reset accumulator
          lastTriggerTime.current = Date.now();
          resetScrollAccumulator();
          navigateMonth(direction);
        }
      } else {
        // console.debug(`📅 Ignoring small scroll: ${deltaY}px`);
      }
    } else if (isAccumulating.current) {
      // Not at boundary anymore - reset accumulator
      resetScrollAccumulator();
    }
  }, [isAtScrollBoundary, navigateMonth, resetScrollAccumulator, isInCooldown, SCROLL_THRESHOLD]);

  useEffect(() => {
    const calendarContainer = containerRef.current;

    // Only enable scroll navigation in month view
    if (currentView !== CalendarViewType.DAY_GRID_MONTH || !calendarContainer || !calendarApi) {
      return;
    }

    calendarContainer.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      calendarContainer.removeEventListener('wheel', handleWheel);
    };
  }, [currentView, calendarApi, handleWheel]);

  return {
    containerRef,
  };
}
