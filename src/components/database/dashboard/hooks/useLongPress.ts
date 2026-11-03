import { MouseEvent, PointerEvent, useCallback, useEffect, useMemo, useRef } from 'react';

/** How long a touch must rest before it counts as a long press. */
export const LONG_PRESS_MS = 500;
/** Movement that turns a press into a scroll or a drag. */
const LONG_PRESS_SLOP = 8;

/**
 * Handlers that call `onLongPress` after a 500ms touch that stays within
 * 8px. Mouse and pen presses are ignored (they click), as are presses that
 * move, end or are cancelled before the delay.
 *
 * Some browsers (Safari on iOS and iPadOS) still send a `click` when a long
 * touch is released. That click belongs to the long press, so it is swallowed
 * once: an element whose click toggles what the long press opened would
 * otherwise close it again.
 */
export function useLongPress(onLongPress: () => void) {
  const callbackRef = useRef(onLongPress);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // The current press fired `onLongPress`: its click, if any, is not a click.
  const firedRef = useRef(false);

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
        // A new press of any kind: a long press that sent no click is over.
        firedRef.current = false;
        if (event.pointerType !== 'touch') return;
        cancel();
        startRef.current = { x: event.clientX, y: event.clientY };
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          startRef.current = null;
          firedRef.current = true;
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
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        if (!firedRef.current) return;
        firedRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    }),
    [cancel]
  );
}
