import { KeyboardEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DashboardWidget } from '@/application/database-yjs/dashboard.type';

import { clampDashboardWidthDelta, dashboardMinWidgetColumns, dashboardPixelsToColumns } from '../grid-layout';

import { startPointerDrag } from './pointerDrag';

export interface WidthResizePreview {
  /** Boundary index: the widget at `index` grows by `delta`, its right neighbour shrinks. */
  index: number;
  delta: number;
  /** Fewest columns either neighbour keeps (see `dashboardMinWidgetColumns`). */
  minColumns: number;
}

/** The grabbed pair, by id: a collaborator may move widgets while it is dragged. */
interface WidthDrag {
  leftId: string;
  rightId: string;
  delta: number;
  minColumns: number;
}

interface UseWidthResizeOptions {
  widgets: DashboardWidget[];
  enabled: boolean;
  /** Returns the row's track element; its width converts pixels to columns. */
  getRowElement: () => HTMLElement | null;
  onCommit: (index: number, delta: number, minColumns: number) => void;
}

const widthsOf = (widgets: DashboardWidget[]) => widgets.map((widget) => widget.width);

/** Index of the boundary between `leftId` and `rightId`, or -1 once they are no longer neighbours. */
function findBoundary(widgets: DashboardWidget[], leftId: string, rightId: string) {
  const index = widgets.findIndex((widget) => widget.id === leftId);

  return index >= 0 && widgets[index + 1]?.id === rightId ? index : -1;
}

/**
 * Drag a boundary between two widgets to trade whole grid columns between
 * them. While dragging only a local preview changes; the row is written once
 * on pointer up (Escape cancels). Arrow keys nudge by one column. Neither
 * neighbour gets narrower than `dashboardMinWidgetColumns` of the track it
 * was measured on (2 columns and 240px), read on every move with the current
 * widget count, since a collaborator may insert a widget meanwhile.
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
    () => (drag && dragIndex >= 0 ? { index: dragIndex, delta: drag.delta, minColumns: drag.minColumns } : null),
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
      let minColumns = dashboardMinWidgetColumns(rowWidth, widgetsRef.current.length);

      setDrag({ leftId, rightId, delta: 0, minColumns });
      cancelRef.current = startPointerDrag(event, {
        cursor: 'col-resize',
        onMove: (deltaX) => {
          const current = findBoundary(widgetsRef.current, leftId, rightId);

          if (current < 0) {
            cancelRef.current?.();
            return;
          }

          const count = widgetsRef.current.length;
          const nextMinColumns = dashboardMinWidgetColumns(rowWidth, count);
          const next = clampDashboardWidthDelta(
            widthsOf(widgetsRef.current),
            current,
            dashboardPixelsToColumns(deltaX, rowWidth, count),
            nextMinColumns
          );

          if (next === delta && nextMinColumns === minColumns) return;
          delta = next;
          minColumns = nextMinColumns;
          setDrag({ leftId, rightId, delta: next, minColumns: nextMinColumns });
        },
        onEnd: (commit) => {
          cancelRef.current = null;
          setDrag(null);
          const current = findBoundary(widgetsRef.current, leftId, rightId);

          if (commit && delta !== 0 && current >= 0) onCommitRef.current(current, delta, minColumns);
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
      const widgets = widgetsRef.current;
      const rowWidth = getRowElement()?.getBoundingClientRect().width ?? 0;
      const minColumns = rowWidth > 0 ? dashboardMinWidgetColumns(rowWidth, widgets.length) : 1;
      const delta = clampDashboardWidthDelta(widthsOf(widgets), index, step, minColumns);

      if (delta !== 0) onCommitRef.current(index, delta, minColumns);
    },
    [enabled, getRowElement]
  );

  return { preview, startResize, handleKeyDown };
}

/** Widths shown while a boundary is dragged. */
export function applyWidthPreview(widgets: DashboardWidget[], preview: WidthResizePreview | null) {
  const widths = widthsOf(widgets);

  if (!preview || preview.delta === 0) return widths;
  const delta = clampDashboardWidthDelta(widths, preview.index, preview.delta, preview.minColumns);

  return widths.map((width, index) => {
    if (index === preview.index) return width + delta;
    if (index === preview.index + 1) return width - delta;
    return width;
  });
}

/** `aria-valuemin` / `aria-valuemax` of the handle after `index`: the widths the left widget can reach. */
export function getWidthHandleBounds(widths: number[], index: number, minColumns: number) {
  const left = widths[index] ?? 0;
  const right = widths[index + 1] ?? 0;

  return { min: Math.min(minColumns, left), max: left + right - Math.min(minColumns, right) };
}
