import { RefObject, useLayoutEffect, useState } from 'react';

/** Content-box size of `ref`, kept current with a `ResizeObserver` (desktop's `LayoutBuilder`). */
export function useElementSize(ref: RefObject<HTMLElement>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;

    const update = (width: number, height: number) =>
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    const rect = element.getBoundingClientRect();

    update(rect.width, rect.height);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export default useElementSize;
