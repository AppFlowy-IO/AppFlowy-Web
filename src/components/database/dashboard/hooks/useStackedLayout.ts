import { RefObject, useLayoutEffect, useState } from 'react';

import { DASHBOARD_STACK_BREAKPOINT } from '@/application/database-yjs/dashboard.type';
import { DASHBOARD_STACK_CONTAINER_BREAKPOINT } from '@/components/database/dashboard/constants';

/** Whether a measured width is below `breakpoint` (an unmeasured width of 0 never is). */
export function isStackedWidth(width: number, breakpoint = DASHBOARD_STACK_BREAKPOINT) {
  return width > 0 && width < breakpoint;
}

export interface StackedLayoutBreakpoints {
  /** Viewport width below which widgets stack (phones, small tablets). */
  viewportBreakpoint?: number;
  /** Grid width below which widgets stack whatever the viewport (side panels, narrow columns). */
  containerBreakpoint?: number;
}

/**
 * Widgets stack on a narrow screen, or when the grid itself is too narrow for
 * widgets side by side. The viewport decides for ordinary pages: the grid of a
 * desktop window is much narrower than the window (sidebar, page padding), so
 * comparing it with the viewport breakpoint would stack regular layouts.
 */
export function isStackedLayout(
  { viewportWidth, containerWidth }: { viewportWidth: number; containerWidth: number },
  {
    viewportBreakpoint = DASHBOARD_STACK_BREAKPOINT,
    containerBreakpoint = DASHBOARD_STACK_CONTAINER_BREAKPOINT,
  }: StackedLayoutBreakpoints = {}
) {
  return isStackedWidth(viewportWidth, viewportBreakpoint) || isStackedWidth(containerWidth, containerBreakpoint);
}

function viewportWidth() {
  return typeof window === 'undefined' ? 0 : window.innerWidth;
}

/**
 * Track whether the dashboard grid should stack its widgets, following both
 * the viewport width and the grid's own width.
 */
export function useStackedLayout(
  ref: RefObject<HTMLElement>,
  { viewportBreakpoint, containerBreakpoint }: StackedLayoutBreakpoints = {}
) {
  const [stacked, setStacked] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;
    let containerWidth = element.getBoundingClientRect().width;
    const update = () => {
      const next = isStackedLayout(
        { viewportWidth: viewportWidth(), containerWidth },
        { viewportBreakpoint, containerBreakpoint }
      );

      setStacked((current) => (current === next ? current : next));
    };

    const handleWindowResize = () => {
      containerWidth = element.getBoundingClientRect().width;
      update();
    };

    update();
    window.addEventListener('resize', handleWindowResize);

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];

            if (!entry) return;
            containerWidth = entry.contentRect.width;
            update();
          });

    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      observer?.disconnect();
    };
  }, [containerBreakpoint, ref, viewportBreakpoint]);

  return stacked;
}
