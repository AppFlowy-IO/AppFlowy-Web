import { KeyboardEvent, PointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP } from '../constants';
import { snapDashboardRowHeight } from '../grid-layout';

import { startPointerDrag } from './pointerDrag';

/**
 * @deprecated No element sets it any more: the row writes `height` on its
 * boxes (`applyRowHeight`). An inherited custom property on the track
 * restyled the row's whole subtree on every drag step (W10). Kept only while
 * `PendingWidgetBox` still names it; the row writes that box's height too.
 */
export const ROW_HEIGHT_CSS_VARIABLE = '--dashboard-row-height';

/**
 * Writes `height` on every box of a row track (its element children: the
 * widget boxes and a pending slot), skipping the boxes that already have it.
 * A box's own height restyles that box only, where an inherited property on
 * the track restyled every element of the row.
 */
export function applyRowHeight(track: HTMLElement | null, height: number) {
  if (!track) return;
  const value = `${height}px`;

  for (const box of Array.from(track.children)) {
    if (box instanceof HTMLElement && box.style.height !== value) box.style.height = value;
  }
}

/**
 * The height being dragged, `null` outside a drag. An external store rather
 * than state: a drag changes it on every 20px step, and only the handle's
 * value needs to follow it through React.
 */
export interface RowHeightPreview {
  subscribe: (listener: () => void) => () => void;
  get: () => number | null;
}

interface UseRowHeightResizeOptions {
  height: number;
  enabled: boolean;
  onCommit: (height: number) => void;
  /**
   * The row track. The hook writes the height on its children (the widget
   * boxes); a box may seed its own height on mount, the hook is its writer
   * from then on.
   */
  getRowElement: () => HTMLElement | null;
}

/**
 * Drag the handle under a row to change the height every widget of the row
 * shares. The preview snaps to 20px (`snapDashboardRowHeight`) and stays
 * local until pointer up (Escape cancels); arrow keys change it by
 * `DASHBOARD_ROW_HEIGHT_KEYBOARD_STEP` and snap the same way.
 *
 * A drag step writes the boxes' `height` and the `preview` store, not React
 * state, so the row never re-renders per step: the boxes and the track follow
 * the pointer while the widgets' content keeps its height until the commit
 * (see `DashboardWidget`). Only `dragging` is state. Outside a drag the boxes
 * hold the persisted `height`.
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
    // `null` puts the persisted height back; a commit then writes the new one
    // from the layout effect below before the next paint, so nothing flashes.
    applyRowHeight(getRowElementRef.current(), next ?? heightRef.current);
    listenersRef.current.forEach((listener) => listener());
  }, []);

  // After every render of the row: a committed height (a drag, the keyboard,
  // a collaborator), and the boxes mounted since (a widget added or moved in).
  // Written here rather than through React's style prop: React diffs against
  // the value it last rendered, not the DOM a drag wrote, and could skip the
  // write. A running drag keeps its preview on every box; its end puts the
  // latest height back.
  useLayoutEffect(() => {
    applyRowHeight(getRowElementRef.current(), previewRef.current ?? heightRef.current);
  });

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
          const snapped = snapDashboardRowHeight(startHeight + deltaY);

          if (snapped === next) return;
          next = snapped;
          setPreview(snapped);
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
      // The same snap as a drag: a stored height off the 20px grid lands on it with the first key.
      const next = snapDashboardRowHeight(heightRef.current + step);

      if (next !== heightRef.current) onCommitRef.current(next);
    },
    [enabled]
  );

  return { dragging, preview, startResize, handleKeyDown };
}
