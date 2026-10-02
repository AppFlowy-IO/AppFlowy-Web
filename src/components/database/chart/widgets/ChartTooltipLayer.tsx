import { ReactNode, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Above the app chrome and popovers, below MUI dialogs (1300), so a drill-down covers it. */
export const CHART_TOOLTIP_Z_INDEX = 1250;

/** Pointer offset of the tooltip's corner (right and below, flipped near an edge). */
const POINTER_OFFSET = 12;

export interface ChartTooltipLayerProps {
  /** Where the pointer is, in viewport coordinates; nothing renders without it. */
  position: { clientX: number; clientY: number } | null;
  children?: ReactNode;
}

/**
 * Renders the chart tooltip in a portal on `document.body` with fixed
 * positioning, so the widget card never clips it. It follows the pointer
 * 12px right and below, and flips left or up to stay inside the viewport.
 * It never takes pointer events.
 */
export function ChartTooltipLayer({ position, children }: ChartTooltipLayerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element || !position) return;
    const { width, height } = element.getBoundingClientRect();
    let left = position.clientX + POINTER_OFFSET;
    let top = position.clientY + POINTER_OFFSET;

    if (left + width > window.innerWidth) left = position.clientX - POINTER_OFFSET - width;
    if (top + height > window.innerHeight) top = position.clientY - POINTER_OFFSET - height;
    element.style.left = `${Math.max(0, left)}px`;
    element.style.top = `${Math.max(0, top)}px`;
  });

  if (!position || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className='pointer-events-none fixed'
      data-testid='chart-tooltip-layer'
      ref={ref}
      role='tooltip'
      style={{
        left: position.clientX + POINTER_OFFSET,
        top: position.clientY + POINTER_OFFSET,
        zIndex: CHART_TOOLTIP_Z_INDEX,
      }}
    >
      {children}
    </div>,
    document.body
  );
}

export default ChartTooltipLayer;
