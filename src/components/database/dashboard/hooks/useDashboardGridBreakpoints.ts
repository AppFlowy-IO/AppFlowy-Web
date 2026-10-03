import { RefObject, useLayoutEffect, useRef, useState } from 'react';

import { DASHBOARD_MAX_WIDGETS_PER_ROW } from '@/application/database-yjs/dashboard.type';

import { DASHBOARD_WIDGET_BOX_INSET } from '../constants';
import { dashboardMinWidgetColumns, dashboardWrapColumns } from '../grid-layout';

/** Content width of `element` (its padding excluded); `null` while it has no width yet. */
export function measureContentWidth(element: HTMLElement): number | null {
  const style = typeof window === 'undefined' ? null : window.getComputedStyle(element);
  const padding = (value: string | undefined) => {
    const parsed = Number.parseFloat(value ?? '');

    return Number.isFinite(parsed) ? parsed : 0;
  };

  const width =
    element.getBoundingClientRect().width -
    padding(style?.paddingLeft) -
    padding(style?.paddingRight) -
    padding(style?.borderLeftWidth) -
    padding(style?.borderRightWidth);

  return width > 0 ? width : null;
}

/** What the rows need from the measured track, by the number of widgets in the row (index 0 is unused). */
export interface DashboardGridBreakpoints {
  /** Widgets per line (`dashboardWrapColumns`). */
  wrapColumns: readonly number[];
  /** Resize minimum in columns (`dashboardMinWidgetColumns`). */
  minColumns: readonly number[];
}

function breakpointsOf(trackWidth: number): DashboardGridBreakpoints {
  const wrapColumns = [0];
  const minColumns = [0];

  for (let count = 1; count <= DASHBOARD_MAX_WIDGETS_PER_ROW; count += 1) {
    wrapColumns.push(dashboardWrapColumns(trackWidth, count));
    minColumns.push(dashboardMinWidgetColumns(trackWidth, count));
  }

  return { wrapColumns, minColumns };
}

function sameBreakpoints(a: DashboardGridBreakpoints | null, b: DashboardGridBreakpoints | null) {
  if (a === null || b === null) return a === b;
  return (
    a.wrapColumns.every((value, count) => value === b.wrapColumns[count]) &&
    a.minColumns.every((value, count) => value === b.minColumns[count])
  );
}

/**
 * The wrap and resize breakpoints of the dashboard grid, or `null` until it
 * is first measured (an unmeasured row never wraps). Follows the element
 * through a ResizeObserver, or through window resizes in a browser without
 * one.
 *
 * The row track is the grid's content width plus the box bleed on both sides.
 * Its width is written to `data-track-width` on every measure (the BDD
 * helpers read it), but only a change of a breakpoint is state: resizing the
 * window re-renders the grid a few times, not once per pixel.
 */
export function useDashboardGridBreakpoints(ref: RefObject<HTMLElement>) {
  const [breakpoints, setBreakpoints] = useState<DashboardGridBreakpoints | null>(null);
  // What the state holds, to skip the state write (and React's render to
  // bail out of it) while a resize crosses no breakpoint.
  const latestRef = useRef(breakpoints);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;
    const update = (contentWidth: number | null) => {
      const trackWidth = contentWidth === null ? null : contentWidth + 2 * DASHBOARD_WIDGET_BOX_INSET;
      const next = trackWidth === null ? null : breakpointsOf(trackWidth);

      element.dataset.trackWidth = trackWidth === null ? '' : String(trackWidth);
      if (sameBreakpoints(latestRef.current, next)) return;
      latestRef.current = next;
      setBreakpoints(next);
    };

    update(measureContentWidth(element));

    if (typeof ResizeObserver === 'undefined') {
      const handleWindowResize = () => update(measureContentWidth(element));

      window.addEventListener('resize', handleWindowResize);
      return () => window.removeEventListener('resize', handleWindowResize);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];

      if (!entry) return;
      update(entry.contentRect.width > 0 ? entry.contentRect.width : null);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return breakpoints;
}
