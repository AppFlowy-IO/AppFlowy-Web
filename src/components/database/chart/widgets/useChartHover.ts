import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChartType } from '@/application/database-yjs/chart-enums';
import { resolveChartTap } from '@/components/database/chart/hooks/chartTap';

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

/**
 * The hovered (on mobile: the tapped) category, the data it is an index into
 * (a category list or a series build) and, for a tap selection, its key.
 */
interface HoverState {
  index: number;
  data: object;
  key?: string;
}

/** A tapped mark: its index in the hover data and its category key (`resolveChartTap`'s `tappedKey`). */
export interface ChartTapTarget {
  index: number;
  key: string;
}

export interface ChartHoverOptions {
  /**
   * The mobile context (`useMobileContext`): touch has no hover, so the
   * tooltip follows taps instead of the pointer (WP14 §1.4.6). The first tap
   * on a category selects it and its tooltip stays; a second tap drills.
   */
  mobile?: boolean;
  /** The chart type `resolveChartTap` reads (the Number chart drills at once). */
  chartType?: ChartType;
}

function sameHover(previous: HoverState | null, next: HoverState | null) {
  return (
    previous === next ||
    (previous !== null &&
      next !== null &&
      previous.index === next.index &&
      previous.data === next.data &&
      previous.key === next.key)
  );
}

/** The native event of a React event (or the event itself), which identifies one click across handlers. */
function nativeEventOf(event: unknown): object | null {
  if (!event || typeof event !== 'object') return null;
  const native = (event as { nativeEvent?: unknown }).nativeEvent;

  return native && typeof native === 'object' ? native : event;
}

/**
 * Hover shared by the chart, its band and its tooltip (WP10 §1.6), and the
 * taps of a mobile context (WP14 §1.4.6).
 *
 * Only the hovered category is state, so the chart renders when the pointer
 * enters another category, not on every move inside one, and at most once per
 * animation frame (W13): the first change of a frame applies at once, and a
 * sweep across many thin bars keeps only the last category of each frame. The position lives in `pointer`, which the
 * tooltip layer follows by itself.
 *
 * The hover ends on pointer leave or cancel, on a click (before the
 * drill-down opens), on window blur, on any scroll, and when the chart gets
 * new data, so a tooltip never outlives the pointer or the data it shows.
 * `ChartProvider` hands over a new array only when the content changed, so a
 * reference check is the content check.
 *
 * In a mobile context the pointer neither shows nor moves the tooltip: `tap`
 * selects a category (its tooltip stays where it was tapped), and the
 * selection ends on a tap outside every mark, a tap outside the chart, window
 * blur, any scroll, new data or a drill.
 */
export function useChartHover(data: object, { mobile = false, chartType = ChartType.Bar }: ChartHoverOptions = {}) {
  const [hover, setHoverState] = useState<HoverState | null>(null);
  // The same value, readable in event handlers without making them change on every hover.
  const hoverRef = useRef<HoverState | null>(null);
  const [pointer] = useState(createChartPointer);
  // A hover of earlier data is over: derived, so no effect has to reset it.
  const hoveredIndex = hover !== null && hover.data === data ? hover.index : null;

  // A pointer move's hover change opens a frame: until the next animation
  // frame, later moves only leave their hover here, and the last one applies then.
  const frameRequestRef = useRef<number | null>(null);
  const pendingRef = useRef<{ next: HoverState | null } | null>(null);

  const closeFrame = useCallback(() => {
    pendingRef.current = null;
    if (frameRequestRef.current === null) return;
    cancelAnimationFrame(frameRequestRef.current);
    frameRequestRef.current = null;
  }, []);

  /** Applies `next`; a change from a pointer move opens the frame (`throttled`). */
  const apply = useCallback((next: HoverState | null, throttled: boolean) => {
    if (sameHover(hoverRef.current, next)) return;
    hoverRef.current = next;
    setHoverState(next);
    if (!throttled) return;
    frameRequestRef.current = requestAnimationFrame(() => {
      frameRequestRef.current = null;
      const pending = pendingRef.current;

      pendingRef.current = null;
      if (pending) apply(pending.next, true);
    });
  }, []);

  /** A leave, a click, a tap or a clear: at once, dropping a pointer move left for the next frame. */
  const commit = useCallback(
    (next: HoverState | null) => {
      closeFrame();
      apply(next, false);
    },
    [apply, closeFrame]
  );

  /** A pointer move: at once when no change was made this frame, else the last move of the frame wins. */
  const schedule = useCallback(
    (next: HoverState | null) => {
      if (frameRequestRef.current !== null) {
        pendingRef.current = { next };
        return;
      }

      apply(next, true);
    },
    [apply]
  );

  useEffect(() => closeFrame, [closeFrame]);

  const clear = useCallback(() => commit(null), [commit]);

  const track = useCallback(
    (event?: PointerLike | null) => {
      if (event?.clientX === undefined || event.clientY === undefined) return;
      pointer.set({ clientX: event.clientX, clientY: event.clientY });
    },
    [pointer]
  );

  /** Show category `index` at the pointer (Recharts gives the index, the event the position). Taps drive a mobile chart. */
  const show = useCallback(
    (index: number | undefined | null, event?: PointerLike | null) => {
      if (mobile) return;
      if (typeof index !== 'number' || index < 0) {
        schedule(null);
        return;
      }

      track(event);
      schedule({ index, data });
    },
    [mobile, data, track, schedule]
  );

  /** The pointer left the chart or a mark: the hover ends. A tap selection stays. */
  const leave = useCallback(() => {
    if (!mobile) commit(null);
  }, [mobile, commit]);

  /** Recharts `onMouseMove(state, event)`: the active category, or none outside the plot. */
  const onChartMouseMove = useCallback(
    (state: RechartsMouseState | null | undefined, event?: PointerLike) => {
      show(state?.isTooltipActive ? state.activeTooltipIndex : undefined, event);
    },
    [show]
  );

  // The clicks a mark already answered: a segment, the band behind it and the frame all see the same click.
  const [answered] = useState(() => new WeakSet<object>());

  /**
   * A tap (or click) on `target`, or outside every mark (`null`):
   * `resolveChartTap` decides. `select` shows the target's tooltip at the
   * tap; `drill` clears the selection and runs `drill`; `clear` clears it.
   * The first handler that sees a click answers it; the others ignore it.
   */
  const tap = useCallback(
    (target: ChartTapTarget | null, event: unknown, drill: () => void) => {
      const native = nativeEventOf(event);

      if (native) {
        if (answered.has(native)) return;
        answered.add(native);
      }

      const current = hoverRef.current;
      const selectedKey = current && current.data === data ? current.key ?? null : null;
      const action = resolveChartTap({ mobile, chartType, selectedKey, tappedKey: target?.key ?? null });

      if (action === 'select' && target) {
        track(event as PointerLike | null);
        commit({ index: target.index, data, key: target.key });
        return;
      }

      commit(null);
      if (action === 'drill') drill();
    },
    [answered, data, mobile, chartType, track, commit]
  );

  const active = hoveredIndex !== null;
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;
    // A layout shift can move the chart away under a still pointer, and then no leave event
    // follows: the next move anywhere outside the frame ends the hover too. A tap selection
    // ends with a press anywhere outside the frame instead.
    const onDocumentPointer = (event: Event) => {
      const frame = frameRef.current;

      if (frame && event.target instanceof Node && !frame.contains(event.target)) clear();
    };

    const outsideEvents = mobile ? ['pointerdown', 'mousedown'] : ['pointermove', 'mousemove'];

    window.addEventListener('blur', clear);
    document.addEventListener('scroll', clear, true);
    outsideEvents.forEach((type) => document.addEventListener(type, onDocumentPointer, true));
    return () => {
      window.removeEventListener('blur', clear);
      document.removeEventListener('scroll', clear, true);
      outsideEvents.forEach((type) => document.removeEventListener(type, onDocumentPointer, true));
    };
  }, [active, mobile, clear]);

  const frameHandlers = useMemo(
    () =>
      mobile
        ? {
            ref: frameRef,
            // A tap in the frame that no mark answered (an axis, the legend, the padding) clears the selection.
            onClick: (event: { nativeEvent?: unknown }) => tap(null, event, () => undefined),
          }
        : {
            ref: frameRef,
            onPointerMove: track,
            onMouseMove: track,
            onPointerLeave: clear,
            onMouseLeave: clear,
            onPointerCancel: clear,
            onClickCapture: clear,
          },
    [mobile, tap, track, clear]
  );

  return { hoveredIndex, pointer, show, clear, leave, tap, onChartMouseMove, frameHandlers };
}

export default useChartHover;
