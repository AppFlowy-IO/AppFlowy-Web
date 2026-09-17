import { KeyboardEvent, PointerEvent, useCallback, useEffect, useRef, useState } from 'react';

import { DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP } from '../constants';
import { clampRowHeight } from '../utils';

import { startPointerDrag } from './pointerDrag';

interface UseRowHeightResizeOptions {
  height: number;
  enabled: boolean;
  onCommit: (height: number) => void;
}

/**
 * Drag the handle under a row to change the height every widget of the row
 * shares. The preview height is local until pointer up (Escape cancels);
 * arrow keys change it by `DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP`.
 */
export function useRowHeightResize({ height, enabled, onCommit }: UseRowHeightResizeOptions) {
  const [preview, setPreview] = useState<number | null>(null);
  const heightRef = useRef(height);
  const onCommitRef = useRef(onCommit);
  const cancelRef = useRef<(() => void) | null>(null);

  heightRef.current = height;
  onCommitRef.current = onCommit;

  useEffect(() => () => cancelRef.current?.(), []);

  useEffect(() => {
    if (!enabled) cancelRef.current?.();
  }, [enabled]);

  const startResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      cancelRef.current?.();

      const startHeight = heightRef.current;
      let next = startHeight;

      setPreview(startHeight);
      cancelRef.current = startPointerDrag(event, {
        cursor: 'row-resize',
        onMove: (_deltaX, deltaY) => {
          const clamped = clampRowHeight(startHeight + deltaY);

          if (clamped === next) return;
          next = clamped;
          setPreview(clamped);
        },
        onEnd: (commit) => {
          cancelRef.current = null;
          setPreview(null);
          if (commit && next !== startHeight) onCommitRef.current(next);
        },
      });
    },
    [enabled]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      const step =
        event.key === 'ArrowUp'
          ? -DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP
          : event.key === 'ArrowDown'
          ? DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP
          : 0;

      if (step === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const next = clampRowHeight(heightRef.current + step);

      if (next !== heightRef.current) onCommitRef.current(next);
    },
    [enabled]
  );

  return { preview, height: preview ?? height, startResize, handleKeyDown };
}
