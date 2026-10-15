import { useLayoutEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/** Whether a scroll area has content below what it shows. A pixel of rounding is not "more". */
export function useMoreContentBelow(element: HTMLElement | null): boolean {
  const [moreBelow, setMoreBelow] = useState(false);

  useLayoutEffect(() => {
    if (!element) return;
    const update = () => setMoreBelow(element.scrollHeight - element.scrollTop - element.clientHeight > 1);

    update();
    element.addEventListener('scroll', update, { passive: true });
    // The window or the content can change size without a scroll (a type switch, a loaded list).
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);

    observer?.observe(element);
    Array.from(element.children).forEach((child) => observer?.observe(child));
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [element]);

  return moreBelow;
}

/**
 * A fade at the bottom of a scroll area while more content is below it, so a cut-off section
 * reads as "scroll for more". Place it as the last child of the scroll area: it sticks to the
 * bottom edge, takes no space and no pointer or screen reader attention.
 */
export function MoreBelowFade({ visible, className }: { visible: boolean; className?: string }) {
  return (
    <div
      aria-hidden='true'
      data-testid='more-below-fade'
      data-visible={visible}
      className={cn(
        'pointer-events-none sticky bottom-0 -mt-10 h-10 shrink-0 bg-gradient-to-t from-surface-primary to-transparent',
        'transition-opacity duration-150 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
        className
      )}
    />
  );
}
