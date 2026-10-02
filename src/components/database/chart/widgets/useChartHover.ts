import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { chartDataEqual } from './chartUtils';

/** The hovered category and where the pointer is, in viewport coordinates. */
export interface ChartHoverState {
  index: number;
  clientX: number;
  clientY: number;
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

/**
 * Hover state shared by the chart, its band and its tooltip (WP10 §1.6).
 * It resets on pointer leave or cancel, on a click (before the drill-down
 * opens), on window blur, on any scroll, and when the charted data changes
 * by content, so a tooltip never outlives the pointer or the data it shows.
 */
export function useChartHover(data: ChartDataItem[]) {
  const [hover, setHover] = useState<ChartHoverState | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const clear = useCallback(() => setHover(null), []);

  /** Show category `index` at the pointer (Recharts gives the index, the event the position). */
  const show = useCallback((index: number | undefined | null, event?: PointerLike | null) => {
    if (typeof index !== 'number' || index < 0) {
      setHover(null);
      return;
    }

    const clientX = event?.clientX ?? pointer.current.x;
    const clientY = event?.clientY ?? pointer.current.y;

    pointer.current = { x: clientX, y: clientY };
    setHover((previous) =>
      previous && previous.index === index && previous.clientX === clientX && previous.clientY === clientY
        ? previous
        : { index, clientX, clientY }
    );
  }, []);

  /** Recharts `onMouseMove(state, event)`: the active category, or none outside the plot. */
  const onChartMouseMove = useCallback(
    (state: RechartsMouseState | null | undefined, event?: PointerLike) => {
      show(state?.isTooltipActive ? state.activeTooltipIndex : undefined, event);
    },
    [show]
  );

  const onPointerMove = useCallback((event: PointerLike) => {
    if (event.clientX === undefined || event.clientY === undefined) return;
    const x = event.clientX;
    const y = event.clientY;

    pointer.current = { x, y };
    setHover((previous) => (previous && (previous.clientX !== x || previous.clientY !== y) ? { ...previous, clientX: x, clientY: y } : previous));
  }, []);

  // The data compares by content: the memoized charts get a new array only when what they draw changed.
  const dataRef = useRef(data);

  useEffect(() => {
    if (chartDataEqual(dataRef.current, data)) return;
    dataRef.current = data;
    setHover(null);
  }, [data]);

  const active = hover !== null;
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
      onPointerMove,
      onMouseMove: onPointerMove,
      onPointerLeave: clear,
      onMouseLeave: clear,
      onPointerCancel: clear,
      onClickCapture: clear,
    }),
    [onPointerMove, clear]
  );

  return { hover, show, clear, onChartMouseMove, frameHandlers };
}

export default useChartHover;
