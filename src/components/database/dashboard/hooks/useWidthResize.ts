import { KeyboardEvent, PointerEvent, useCallback, useEffect, useRef, useState } from 'react';

import { DashboardWidget } from '@/application/database-yjs/dashboard.type';

import { clampWidthDelta, pixelsToColumns } from '../utils';

import { startPointerDrag } from './pointerDrag';

export interface WidthResizePreview {
  /** Boundary index: the widget at `index` grows by `delta`, its right neighbour shrinks. */
  index: number;
  delta: number;
}

interface UseWidthResizeOptions {
  widgets: DashboardWidget[];
  enabled: boolean;
  /** Returns the row's grid element; its width converts pixels to columns. */
  getRowElement: () => HTMLElement | null;
  onCommit: (index: number, delta: number) => void;
}

/**
 * Drag a boundary between two widgets to trade whole grid columns between
 * them. While dragging only a local preview changes; the row is written once
 * on pointer up (Escape cancels). Arrow keys nudge by one column.
 */
export function useWidthResize({ widgets, enabled, getRowElement, onCommit }: UseWidthResizeOptions) {
  const [preview, setPreview] = useState<WidthResizePreview | null>(null);
  const widgetsRef = useRef(widgets);
  const onCommitRef = useRef(onCommit);
  const cancelRef = useRef<(() => void) | null>(null);

  widgetsRef.current = widgets;
  onCommitRef.current = onCommit;

  useEffect(() => () => cancelRef.current?.(), []);

  useEffect(() => {
    if (!enabled) cancelRef.current?.();
  }, [enabled]);

  const startResize = useCallback(
    (index: number, event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      const rowWidth = getRowElement()?.getBoundingClientRect().width ?? 0;

      if (rowWidth <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      cancelRef.current?.();

      let delta = 0;

      setPreview({ index, delta: 0 });
      cancelRef.current = startPointerDrag(event, {
        cursor: 'col-resize',
        onMove: (deltaX) => {
          const next = clampWidthDelta(widgetsRef.current, index, pixelsToColumns(deltaX, rowWidth));

          if (next === delta) return;
          delta = next;
          setPreview({ index, delta: next });
        },
        onEnd: (commit) => {
          cancelRef.current = null;
          setPreview(null);
          if (commit && delta !== 0) onCommitRef.current(index, delta);
        },
      });
    },
    [enabled, getRowElement]
  );

  const handleKeyDown = useCallback(
    (index: number, event: KeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;

      if (step === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = clampWidthDelta(widgetsRef.current, index, step);

      if (delta !== 0) onCommitRef.current(index, delta);
    },
    [enabled]
  );

  return { preview, startResize, handleKeyDown };
}

/** Widths shown while a boundary is dragged. */
export function applyWidthPreview(widgets: DashboardWidget[], preview: WidthResizePreview | null) {
  if (!preview || preview.delta === 0) return widgets.map((widget) => widget.width);
  const delta = clampWidthDelta(widgets, preview.index, preview.delta);

  return widgets.map((widget, index) => {
    if (index === preview.index) return widget.width + delta;
    if (index === preview.index + 1) return widget.width - delta;
    return widget.width;
  });
}
