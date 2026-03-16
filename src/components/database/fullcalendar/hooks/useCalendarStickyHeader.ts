import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { getScrollParent } from '@/components/global-comment/utils';

import type { CalendarApi } from '@fullcalendar/core';

/**
 * Custom hook to handle sticky header for calendar toolbar
 * Similar to useGridVirtualizer pattern for scroll-based sticky behavior
 */
export function useCalendarStickyHeader(calendarApi: CalendarApi | null, toolbarRef?: React.RefObject<HTMLDivElement>) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const toolbarOffsetRef = useRef(0);
  const [showStickyToolbar, setShowStickyToolbar] = useState(false);

  /**
   * Update normal toolbar offset position
   * Monitor when the normal toolbar reaches the top of viewport
   */
  const updateToolbarOffset = useCallback(() => {
    const targetElement = toolbarRef?.current || parentRef.current;

    if (targetElement) {
      const rect = targetElement.getBoundingClientRect();

      toolbarOffsetRef.current = rect.top;
    }
  }, [toolbarRef]);

  /**
   * Get scroll element for the calendar container
   * Reuses the same logic as useGridVirtualizer
   */
  const getScrollElement = useCallback(() => {
    if (!parentRef.current) return null;
    return parentRef.current.closest('.appflowy-scroll-container') || getScrollParent(parentRef.current);
  }, []);

  /**
   * Handle scroll events to show/hide sticky toolbar
   */
  useEffect(() => {
    const scrollElement = getScrollElement();

    if (!scrollElement) return;

    const handleScroll = () => {
      const parent = parentRef.current;

      if (!parent) return;
      updateToolbarOffset();
      // Show sticky toolbar when normal toolbar reaches the app header area
      // App header is approximately 48px, so show sticky when toolbar goes above 48px from top
      const APP_HEADER_HEIGHT = 48;

      const bottom = parent.getBoundingClientRect().bottom ?? 0;

      const shouldShow = toolbarOffsetRef.current <= APP_HEADER_HEIGHT && bottom - 200 >= APP_HEADER_HEIGHT;

      setShowStickyToolbar(shouldShow);
    };

    // Initial check
    handleScroll();
    const scrollListenerOptions: AddEventListenerOptions = { passive: true };

    scrollElement.addEventListener('scroll', handleScroll, scrollListenerOptions);
    
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll, scrollListenerOptions);
    };
  }, [getScrollElement, updateToolbarOffset]);

  /**
   * Update offset on layout changes
   */
  useLayoutEffect(() => {
    updateToolbarOffset();
  }, [updateToolbarOffset]);

  /**
   * Monitor scroll element changes to recalculate offset
   * Similar to useGridVirtualizer resize monitoring
   */
  useLayoutEffect(() => {
    const scrollElement = getScrollElement();

    if (!scrollElement) return;

    const handleResize = () => {
      updateToolbarOffset();
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(handleResize)
        : undefined;

    resizeObserver?.observe(scrollElement);

    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [getScrollElement, updateToolbarOffset]);

  useEffect(() => {
    return () => {
      setShowStickyToolbar(false);
    }
  }, [])

  return {
    parentRef,
    showStickyToolbar,
    updateToolbarOffset,
    getScrollElement,
  };
}
