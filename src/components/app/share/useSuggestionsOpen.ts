import { RefObject, useEffect, useState } from 'react';

/**
 * Whether the people and groups that can be added are listed before anything is typed. An Add
 * button opens the list; it stays open while the user works inside `container` (adding several in a
 * row) and closes when a click or keyboard focus lands outside it.
 */
export function useSuggestionsOpen(container: RefObject<HTMLElement>) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: Event) => {
      const root = container.current;

      if (root && event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    };

    document.addEventListener('pointerdown', closeIfOutside, true);
    document.addEventListener('focusin', closeIfOutside, true);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true);
      document.removeEventListener('focusin', closeIfOutside, true);
    };
  }, [container, open]);

  return [open, setOpen] as const;
}
