import { PointerEvent, useCallback, useEffect, useMemo, useRef } from 'react';

/** How long a touch must rest before it counts as a long press. */
export const LONG_PRESS_MS = 500;
/** Movement that turns a press into a scroll or a drag. */
const LONG_PRESS_SLOP = 8;

/**
 * Pointer handlers that call `onLongPress` after a 500ms touch that stays
 * within 8px. Mouse and pen presses are ignored (they click), as are presses
 * that move, end or are cancelled before the delay.
 */
export function useLongPress(onLongPress: () => void) {
  const callbackRef = useRef(onLongPress);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  callbackRef.current = onLongPress;

  const cancel = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return useMemo(
    () => ({
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.pointerType !== 'touch') return;
        cancel();
        startRef.current = { x: event.clientX, y: event.clientY };
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          startRef.current = null;
          callbackRef.current();
        }, LONG_PRESS_MS);
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const start = startRef.current;

        if (!start) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
    }),
    [cancel]
  );
}
