import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChartDataItem } from '@/application/database-yjs/chart.type';

/** A pointer position in viewport coordinates. */
export interface ChartPointerPosition {
  clientX: number;
  clientY: number;
}

/**
 * Where the pointer is over a chart. It is not React state: a pointer move
 * updates it and calls its listeners (the tooltip layer, which re-places
 * itself), and nothing renders.
 */
export interface ChartPointer {
  get(): ChartPointerPosition;
  set(position: ChartPointerPosition): void;
  /** `listener` runs after every `set`. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createChartPointer(initial: ChartPointerPosition = { clientX: 0, clientY: 0 }): ChartPointer {
  let position = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => position,
    set: (next) => {
      if (next.clientX === position.clientX && next.clientY === position.clientY) return;
      position = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

interface PointerLike {
  clientX?: number;
  clientY?: number;
}

/** The part of a Recharts mouse state the hover reads. */
interface RechartsMouseState {
  isTooltipActive?: boolean;
  activeTooltipIndex?: number;
}

/** The hovered category, and the data it is an index into. */
interface HoverState {
  index: number;
  data: ChartDataItem[];
}

/**
 * Hover shared by the chart, its band and its tooltip (WP10 §1.6).
 *
 * Only the hovered category is state, so the chart renders when the pointer
 * enters another category, not on every move inside one. The position lives
 * in `pointer`, which the tooltip layer follows by itself.
 *
 * The hover ends on pointer leave or cancel, on a click (before the
 * drill-down opens), on window blur, on any scroll, and when the chart gets
 * new data, so a tooltip never outlives the pointer or the data it shows.
 * `ChartProvider` hands over a new array only when the content changed, so a
 * reference check is the content check.
 */
export function useChartHover(data: ChartDataItem[]) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [pointer] = useState(createChartPointer);
  // A hover of earlier data is over: derived, so no effect has to reset it.
  const hoveredIndex = hover !== null && hover.data === data ? hover.index : null;

  const clear = useCallback(() => setHover(null), []);

  const track = useCallback(
    (event?: PointerLike | null) => {
      if (event?.clientX === undefined || event.clientY === undefined) return;
      pointer.set({ clientX: event.clientX, clientY: event.clientY });
    },
    [pointer]
  );

  /** Show category `index` at the pointer (Recharts gives the index, the event the position). */
  const show = useCallback(
    (index: number | undefined | null, event?: PointerLike | null) => {
      if (typeof index !== 'number' || index < 0) {
        setHover(null);
        return;
      }

      track(event);
      setHover((previous) => (previous && previous.index === index && previous.data === data ? previous : { index, data }));
    },
    [data, track]
  );

  /** Recharts `onMouseMove(state, event)`: the active category, or none outside the plot. */
  const onChartMouseMove = useCallback(
    (state: RechartsMouseState | null | undefined, event?: PointerLike) => {
      show(state?.isTooltipActive ? state.activeTooltipIndex : undefined, event);
    },
    [show]
  );

  const active = hoveredIndex !== null;
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;
    // A layout shift can move the chart away under a still pointer, and then no leave event
    // follows: the next move anywhere outside the frame ends the hover too.
    const onDocumentMove = (event: Event) => {
      const frame = frameRef.current;

      if (frame && event.target instanceof Node && !frame.contains(event.target)) clear();
    };

    window.addEventListener('blur', clear);
    document.addEventListener('scroll', clear, true);
    document.addEventListener('pointermove', onDocumentMove, true);
    document.addEventListener('mousemove', onDocumentMove, true);
    return () => {
      window.removeEventListener('blur', clear);
      document.removeEventListener('scroll', clear, true);
      document.removeEventListener('pointermove', onDocumentMove, true);
      document.removeEventListener('mousemove', onDocumentMove, true);
    };
  }, [active, clear]);

  const frameHandlers = useMemo(
    () => ({
      ref: frameRef,
      onPointerMove: track,
      onMouseMove: track,
      onPointerLeave: clear,
      onMouseLeave: clear,
      onPointerCancel: clear,
      onClickCapture: clear,
    }),
    [track, clear]
  );

  return { hoveredIndex, pointer, show, clear, onChartMouseMove, frameHandlers };
}

export default useChartHover;
