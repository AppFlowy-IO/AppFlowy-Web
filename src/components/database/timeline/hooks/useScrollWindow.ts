import { RefObject, useEffect, useState } from 'react';

export interface ScrollWindow {
  scrollLeft: number;
  clientWidth: number;
}

const EMPTY: ScrollWindow = { scrollLeft: 0, clientWidth: 0 };

/**
 * Horizontal viewport of a scroll container, throttled to animation frames.
 * The vertical axis is deliberately not tracked: the row virtualizer owns it,
 * and publishing it here would re-render the whole view on every scroll frame.
 */
export function useScrollWindow(scrollerRef: RefObject<HTMLElement | null>): ScrollWindow {
  const [window, setWindow] = useState<ScrollWindow>(EMPTY);

  useEffect(() => {
    const element = scrollerRef.current;

    if (!element) return;

    let frame = 0;
    const read = () => {
      frame = 0;
      const next = { scrollLeft: element.scrollLeft, clientWidth: element.clientWidth };

      setWindow((prev) => (prev.scrollLeft === next.scrollLeft && prev.clientWidth === next.clientWidth ? prev : next));
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(read);
    };

    read();
    element.addEventListener('scroll', schedule, { passive: true });

    let observer: ResizeObserver | undefined;

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      observer.observe(element);
    } else {
      globalThis.addEventListener('resize', schedule);
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      element.removeEventListener('scroll', schedule);
      observer?.disconnect();
      globalThis.removeEventListener('resize', schedule);
    };
  }, [scrollerRef]);

  return window;
}
