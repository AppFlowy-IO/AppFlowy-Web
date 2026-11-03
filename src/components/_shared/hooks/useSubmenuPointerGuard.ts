import { type PointerEvent, useCallback, useRef } from 'react';

/**
 * Radix closes a hover-opened submenu as soon as the pointer leaves its
 * trigger. When the portaled content opens to the left of the trigger, the
 * pointer leaves the trigger on its way into the content, so keep the
 * submenu open whenever the pointer is heading there.
 */
export function useSubmenuPointerGuard<T extends HTMLElement = HTMLDivElement>() {
  const contentRef = useRef<T>(null);
  const onTriggerPointerLeave = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && contentRef.current?.contains(event.relatedTarget)) {
      event.preventDefault();
    }
  }, []);

  return { contentRef, onTriggerPointerLeave };
}
