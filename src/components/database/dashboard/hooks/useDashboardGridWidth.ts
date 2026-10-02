import { RefObject, useLayoutEffect, useState } from 'react';

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

/**
 * The dashboard grid's content width in CSS px, or `null` until it is first
 * measured (an unmeasured row never wraps). Follows the element through a
 * ResizeObserver; a window resize re-measures it too, for browsers without
 * one. Rows derive their wrap from this width (`dashboardWrapColumns`).
 */
export function useDashboardGridWidth(ref: RefObject<HTMLElement>) {
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;
    const update = (next: number | null) => setWidth((current) => (current === next ? current : next));
    const handleWindowResize = () => update(measureContentWidth(element));

    handleWindowResize();
    window.addEventListener('resize', handleWindowResize);

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];

            if (!entry) return;
            update(entry.contentRect.width > 0 ? entry.contentRect.width : null);
          });

    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      observer?.disconnect();
    };
  }, [ref]);

  return width;
}
