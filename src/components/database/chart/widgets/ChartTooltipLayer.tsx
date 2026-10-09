import { memo, ReactNode, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { ChartPointer, ChartPointerPosition } from './useChartHover';

/** Above the app chrome and popovers, below MUI dialogs (1300), so a drill-down covers it. */
export const CHART_TOOLTIP_Z_INDEX = 1250;

/** Pointer offset of the tooltip's corner (right and below, flipped near an edge). */
const POINTER_OFFSET = 12;

export interface ChartTooltipLayerProps {
  /** The pointer the tooltip follows; nothing renders without it. */
  pointer: ChartPointer | null;
  /** The tooltip. Keep its identity while its content is the same: a new element is measured again. */
  children?: ReactNode;
}

/** 12px right of and below the pointer, flipped left or up to stay inside the viewport. */
function place(element: HTMLElement, { clientX, clientY }: ChartPointerPosition, size: { width: number; height: number }) {
  let left = clientX + POINTER_OFFSET;
  let top = clientY + POINTER_OFFSET;

  if (left + size.width > window.innerWidth) left = clientX - POINTER_OFFSET - size.width;
  if (top + size.height > window.innerHeight) top = clientY - POINTER_OFFSET - size.height;
  element.style.left = `${Math.max(0, left)}px`;
  element.style.top = `${Math.max(0, top)}px`;
}

/**
 * Renders the chart tooltip in a portal on `document.body` with fixed
 * positioning, so the widget card never clips it. It follows the pointer
 * 12px right and below, and flips left or up to stay inside the viewport.
 * It never takes pointer events.
 *
 * The tooltip is measured when its content changes, not on a pointer move: a
 * move only writes the new position from the cached size, which costs neither
 * a render nor a layout read.
 */
function ChartTooltipLayerImpl({ pointer, children }: ChartTooltipLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  // New content (or a tooltip that just opened): measure once, then place.
  // It runs before paint, so the tooltip never shows at a stale position.
  useLayoutEffect(() => {
    const element = ref.current;

    if (!element || !pointer) return;
    const { width, height } = element.getBoundingClientRect();

    sizeRef.current = { width, height };
    place(element, pointer.get(), sizeRef.current);
  }, [pointer, children]);

  useLayoutEffect(() => {
    if (!pointer) return;
    return pointer.subscribe(() => {
      if (ref.current) place(ref.current, pointer.get(), sizeRef.current);
    });
  }, [pointer]);

  if (!pointer || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className='pointer-events-none fixed'
      data-testid='chart-tooltip-layer'
      ref={ref}
      role='tooltip'
      // `left` and `top` are written by `place`, so React never resets them.
      style={{ zIndex: CHART_TOOLTIP_Z_INDEX }}
    >
      {children}
    </div>,
    document.body
  );
}

export const ChartTooltipLayer = memo(ChartTooltipLayerImpl);

export default ChartTooltipLayer;
