import { KeyboardEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DashboardWidget } from '@/application/database-yjs/dashboard.type';

import { clampWidthDelta, pixelsToColumns } from '../utils';

import { startPointerDrag } from './pointerDrag';

export interface WidthResizePreview {
  /** Boundary index: the widget at `index` grows by `delta`, its right neighbour shrinks. */
  index: number;
  delta: number;
}

/** The grabbed pair, by id: a collaborator may move widgets while it is dragged. */
interface WidthDrag {
  leftId: string;
  rightId: string;
  delta: number;
}

interface UseWidthResizeOptions {
  widgets: DashboardWidget[];
  enabled: boolean;
  /** Returns the row's grid element; its width converts pixels to columns. */
  getRowElement: () => HTMLElement | null;
  onCommit: (index: number, delta: number) => void;
}

/** Index of the boundary between `leftId` and `rightId`, or -1 once they are no longer neighbours. */
function findBoundary(widgets: DashboardWidget[], leftId: string, rightId: string) {
  const index = widgets.findIndex((widget) => widget.id === leftId);

  return index >= 0 && widgets[index + 1]?.id === rightId ? index : -1;
}

/**
 * Drag a boundary between two widgets to trade whole grid columns between
 * them. While dragging only a local preview changes; the row is written once
 * on pointer up (Escape cancels). Arrow keys nudge by one column.
 *
 * A pointer drag follows the grabbed pair by id, not by position: if a
 * collaborator's edit separates the pair, the drag is cancelled instead of
 * resizing whichever widgets took its place.
 */
export function useWidthResize({ widgets, enabled, getRowElement, onCommit }: UseWidthResizeOptions) {
  const [drag, setDrag] = useState<WidthDrag | null>(null);
  const widgetsRef = useRef(widgets);
  const onCommitRef = useRef(onCommit);
  const cancelRef = useRef<(() => void) | null>(null);

  widgetsRef.current = widgets;
  onCommitRef.current = onCommit;

  const dragIndex = drag ? findBoundary(widgets, drag.leftId, drag.rightId) : -1;
  const preview = useMemo<WidthResizePreview | null>(
    () => (drag && dragIndex >= 0 ? { index: dragIndex, delta: drag.delta } : null),
    [drag, dragIndex]
  );

  useEffect(() => () => cancelRef.current?.(), []);

  useEffect(() => {
    if (!enabled) cancelRef.current?.();
  }, [enabled]);

  useEffect(() => {
    if (drag && dragIndex < 0) cancelRef.current?.();
  }, [drag, dragIndex]);

  const startResize = useCallback(
    (index: number, event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      const leftId = widgetsRef.current[index]?.id;
      const rightId = widgetsRef.current[index + 1]?.id;
      const rowWidth = getRowElement()?.getBoundingClientRect().width ?? 0;

      if (!leftId || !rightId || rowWidth <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      cancelRef.current?.();

      let delta = 0;

      setDrag({ leftId, rightId, delta: 0 });
      cancelRef.current = startPointerDrag(event, {
        cursor: 'col-resize',
        onMove: (deltaX) => {
          const current = findBoundary(widgetsRef.current, leftId, rightId);

          if (current < 0) {
            cancelRef.current?.();
            return;
          }

          const next = clampWidthDelta(widgetsRef.current, current, pixelsToColumns(deltaX, rowWidth));

          if (next === delta) return;
          delta = next;
          setDrag({ leftId, rightId, delta: next });
        },
        onEnd: (commit) => {
          cancelRef.current = null;
          setDrag(null);
          const current = findBoundary(widgetsRef.current, leftId, rightId);

          if (commit && delta !== 0 && current >= 0) onCommitRef.current(current, delta);
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
