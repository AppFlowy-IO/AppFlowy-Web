import { KeyboardEvent, PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { DASHBOARD_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';

const SIDE_PEEK = DASHBOARD_GEOMETRY.sidePeek;

/** Where the width the viewer dragged to is remembered, per device. */
export const SIDE_PEEK_WIDTH_STORAGE_KEY = 'af.sidePeek.width.v1';

/** The width bounds at a viewport width: `[minWidth, min(maxWidth, viewport − viewportReserve)]`. */
export function sidePeekBounds(viewportWidth: number) {
  const max = Math.min(SIDE_PEEK.maxWidth, viewportWidth - SIDE_PEEK.viewportReserve);

  return { min: SIDE_PEEK.minWidth, max: Math.max(SIDE_PEEK.minWidth, max) };
}

export function clampSidePeekWidth(width: number, viewportWidth: number) {
  const { min, max } = sidePeekBounds(viewportWidth);

  return Math.round(Math.min(Math.max(width, min), max));
}

/** `min(defaultWidth, defaultFraction × viewport)`, clamped (WP13 decision 8). */
export function defaultSidePeekWidth(viewportWidth: number) {
  return clampSidePeekWidth(Math.min(SIDE_PEEK.defaultWidth, SIDE_PEEK.defaultFraction * viewportWidth), viewportWidth);
}

function readStoredWidth(): number | null {
  try {
    const raw = window.localStorage.getItem(SIDE_PEEK_WIDTH_STORAGE_KEY);
    const width = raw === null ? NaN : Number(raw);

    return Number.isFinite(width) && width > 0 ? width : null;
  } catch {
    return null;
  }
}

function storeWidth(width: number) {
  try {
    window.localStorage.setItem(SIDE_PEEK_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Private windows and blocked storage: the width is only not remembered.
  }
}

const viewportWidth = () => (typeof window === 'undefined' ? SIDE_PEEK.defaultWidth : window.innerWidth);

/**
 * The side peek's width (WP13 §3.9): the remembered width or the default,
 * clamped to the viewport and clamped again when the window resizes; a
 * pointer drag on the left-edge resizer, or ←/→ in 20px steps, changes it and
 * the result is remembered.
 *
 * A drag is transient: each pointer move writes the width straight to the
 * panel (`panelRef`) and only the pointer-up commits it as state, so the
 * record inside the panel does not re-render per move.
 */
export function useSidePeekWidth() {
  const [preferred, setPreferred] = useState<number | null>(() => readStoredWidth());
  const [viewport, setViewport] = useState(viewportWidth);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);
  /** The panel the drag resizes in place. */
  const panelRef = useRef<HTMLElement | null>(null);
  const width = clampSidePeekWidth(preferred ?? defaultSidePeekWidth(viewport), viewport);
  // The width as shown: the committed one, or during a drag the last one written.
  const widthRef = useRef(width);

  const applyWidth = useCallback((next: number) => {
    widthRef.current = next;
    const panel = panelRef.current;

    if (panel) panel.style.width = `${next}px`;
  }, []);

  useLayoutEffect(() => {
    if (dragRef.current) {
      // A render during the drag (the viewport changed) re-applies the live width.
      applyWidth(clampSidePeekWidth(widthRef.current, viewport));
      return;
    }

    widthRef.current = width;
  });

  useEffect(() => {
    const onResize = () => setViewport(viewportWidth());

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: widthRef.current, pointerId: event.pointerId };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom and lost pointers.
    }

    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;

      if (!drag) return;
      // The resizer is the left edge: dragging left widens the panel.
      applyWidth(clampSidePeekWidth(drag.startWidth + drag.startX - event.clientX, viewport));
    },
    [applyWidth, viewport]
  );

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;

    if (!drag) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(drag.pointerId);
    } catch {
      // Already released.
    }

    setDragging(false);
    // One render commits the width the drag ended at; it is remembered.
    setPreferred(widthRef.current);
    storeWidth(widthRef.current);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? SIDE_PEEK.resizeStep : -SIDE_PEEK.resizeStep;
      const next = clampSidePeekWidth(widthRef.current + delta, viewport);

      setPreferred(next);
      storeWidth(next);
    },
    [viewport]
  );

  const bounds = sidePeekBounds(viewport);

  return {
    width,
    dragging,
    bounds,
    panelRef,
    resizerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
    },
  };
}
