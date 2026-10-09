import { createContext, useContext, useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function matches() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/** Whether the user asked for reduced motion; charts then skip their entry animation (WP10 §2.5). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(matches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(QUERY);
    const onChange = () => setReduced(query.matches);

    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

/**
 * Whether the box around a chart is being resized: a dashboard row's width or
 * height drag, or a widget box easing to a new width. The dashboard widget box
 * provides it; it is `false` everywhere else.
 */
export const ChartResizingContext = createContext(false);

interface ChartMotionState {
  /** The data of the last render that decided. */
  data: unknown;
  /** The chart has been resized since `data` arrived: it draws without animation. */
  still: boolean;
}

/**
 * Whether a chart animates its marks (WP10 §2.5, W21): never with reduced
 * motion, and not while its box is resized (`ChartResizingContext`). Recharts
 * animates every size change from the previous geometry and re-creates its
 * marks on each frame of that animation.
 *
 * After a resize the chart stays still until its data changes: Recharts keeps
 * the geometry from before the resize as the start of its next animation, so
 * animating again for the same data would replay the resize. New data then
 * animates from the current geometry, as before. Outside a dashboard nothing
 * changes.
 *
 * `data` is what the plot hands Recharts, compared by reference: the charts
 * hand over a new build only when the content changed.
 */
export function useChartAnimation(data: unknown): boolean {
  const reducedMotion = useReducedMotion();
  const resizing = useContext(ChartResizingContext);
  const [motion, setMotion] = useState<ChartMotionState>(() => ({ data, still: resizing }));
  let next = motion;

  if (resizing) {
    if (!motion.still || motion.data !== data) next = { data, still: true };
  } else if (motion.still && motion.data !== data) {
    next = { data, still: false };
  }

  // State derived from the previous render, adjusted while rendering: no effect and no extra commit.
  if (next !== motion) setMotion(next);
  return !reducedMotion && !next.still;
}

export default useReducedMotion;
