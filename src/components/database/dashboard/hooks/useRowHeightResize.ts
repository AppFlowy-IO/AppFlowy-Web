import { KeyboardEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP } from '../constants';
import { clampRowHeight } from '../utils';

import { startPointerDrag } from './pointerDrag';

/** CSS custom property (on the row's grid) that the grid and its cards take their height from. */
export const ROW_HEIGHT_CSS_VARIABLE = '--dashboard-row-height';

/**
 * The height being dragged, `null` outside a drag. An external store rather
 * than state: a drag changes it on every pointer move, and only the handle's
 * badge and the widgets' nested databases need to follow it through React.
 */
export interface RowHeightPreview {
  subscribe: (listener: () => void) => () => void;
  get: () => number | null;
}

interface UseRowHeightResizeOptions {
  height: number;
  enabled: boolean;
  onCommit: (height: number) => void;
  /** The element carrying `ROW_HEIGHT_CSS_VARIABLE`; a drag writes the variable directly. */
  getRowElement: () => HTMLElement | null;
}

/**
 * Drag the handle under a row to change the height every widget of the row
 * shares. The preview height is local until pointer up (Escape cancels);
 * arrow keys change it by `DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP`.
 *
 * A pointer move updates the CSS variable and the `preview` store, not React
 * state: the row and its cards resize through CSS, so the row never
 * re-renders per pixel. Only `dragging` is state.
 */
export function useRowHeightResize({ height, enabled, onCommit, getRowElement }: UseRowHeightResizeOptions) {
  const [dragging, setDragging] = useState(false);
  const heightRef = useRef(height);
  const onCommitRef = useRef(onCommit);
  const getRowElementRef = useRef(getRowElement);
  const cancelRef = useRef<(() => void) | null>(null);
  const previewRef = useRef<number | null>(null);
  const listenersRef = useRef(new Set<() => void>());

  heightRef.current = height;
  onCommitRef.current = onCommit;
  getRowElementRef.current = getRowElement;

  const preview = useMemo<RowHeightPreview>(
    () => ({
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
      get: () => previewRef.current,
    }),
    []
  );

  const setPreview = useCallback((next: number | null) => {
    if (previewRef.current === next) return;
    previewRef.current = next;
    // `null` puts the persisted height back; a commit then re-renders the row
    // with the new one in the same task, so nothing flashes.
    getRowElementRef.current()?.style.setProperty(ROW_HEIGHT_CSS_VARIABLE, `${next ?? heightRef.current}px`);
    listenersRef.current.forEach((listener) => listener());
  }, []);

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

      setDragging(true);
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
          setDragging(false);
          setPreview(null);
          if (commit && next !== startHeight) onCommitRef.current(next);
        },
      });
    },
    [enabled, setPreview]
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

  return { dragging, preview, startResize, handleKeyDown };
}
