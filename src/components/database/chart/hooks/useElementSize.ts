import { RefObject, useLayoutEffect, useRef, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

const EMPTY_SIZE: ElementSize = { width: 0, height: 0 };

/**
 * The content-box size of the element behind the returned ref, 0 × 0 until
 * measured. A `ResizeObserver` keeps it current; after the first measurement
 * its updates are coalesced to one per animation frame, so a row-height drag
 * re-lays the chart out at most once per frame.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>(): [RefObject<T>, ElementSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>(EMPTY_SIZE);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;
    const apply = (width: number, height: number) =>
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    const rect = element.getBoundingClientRect();

    apply(rect.width, rect.height);

    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => {
        const next = element.getBoundingClientRect();

        apply(next.width, next.height);
      };

      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    let frame: number | null = null;
    let pending: ElementSize | null = null;
    let measured = false;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];

      if (!entry) return;
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };

      if (!measured) {
        measured = true;
        apply(next.width, next.height);
        return;
      }

      pending = next;
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (pending) apply(pending.width, pending.height);
      });
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return [ref, size];
}

export default useElementSize;
