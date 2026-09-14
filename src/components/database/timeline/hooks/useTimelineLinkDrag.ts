/**
 * Drag from a bar's link handle onto another bar to make the second depend on
 * the first (Notion's drag-to-connect). The pointer is tracked in canvas
 * coordinates so a connector can be drawn while dragging; the bar under the
 * pointer is hit-tested through `data-timeline-bar` on each bar root.
 */
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';

import { TIMELINE_HEADER_HEIGHT } from '../constants';

export interface TimelineLinkPoint {
  x: number;
  y: number;
}

export interface TimelineLinkDrag {
  sourceRowId: string;
  /** Right edge of the source bar, in canvas coordinates. */
  from: TimelineLinkPoint;
  /** Pointer position, in canvas coordinates. */
  to: TimelineLinkPoint;
  /** Bar currently under the pointer, if any (never the source). */
  targetRowId: string | null;
}

export interface UseTimelineLinkDragOptions {
  scrollerRef: React.RefObject<HTMLElement | null>;
  sidebarWidth: number;
  onCommit: (sourceRowId: string, targetRowId: string) => void;
}

function rowIdUnderPointer(clientX: number, clientY: number): string | null {
  const element = document.elementFromPoint(clientX, clientY);
  const bar = element instanceof Element ? element.closest<HTMLElement>('[data-timeline-bar]') : null;

  return bar?.dataset.timelineBar ?? null;
}

export function useTimelineLinkDrag({ scrollerRef, sidebarWidth, onCommit }: UseTimelineLinkDragOptions) {
  const [link, setLink] = useState<TimelineLinkDrag | null>(null);
  const activeRef = useRef<{ sourceRowId: string; pointerId: number; from: TimelineLinkPoint } | null>(null);
  /** True for the click the browser fires right after a connector is released. */
  const clickAfterDragRef = useRef(false);

  const toCanvas = useCallback(
    (clientX: number, clientY: number): TimelineLinkPoint => {
      const scroller = scrollerRef.current;

      if (!scroller) return { x: 0, y: 0 };
      const bounds = scroller.getBoundingClientRect();

      return {
        x: clientX - bounds.left + scroller.scrollLeft - sidebarWidth,
        y: clientY - bounds.top + scroller.scrollTop - TIMELINE_HEADER_HEIGHT,
      };
    },
    [scrollerRef, sidebarWidth]
  );

  useEffect(() => {
    if (!link) return;

    const handleMove = (event: PointerEvent) => {
      const active = activeRef.current;

      if (!active || event.pointerId !== active.pointerId) return;
      const target = rowIdUnderPointer(event.clientX, event.clientY);

      setLink({
        sourceRowId: active.sourceRowId,
        from: active.from,
        to: toCanvas(event.clientX, event.clientY),
        targetRowId: target && target !== active.sourceRowId ? target : null,
      });
    };

    const finish = (commit: boolean) => (event: PointerEvent) => {
      const active = activeRef.current;

      if (!active || event.pointerId !== active.pointerId) return;
      const target = commit ? rowIdUnderPointer(event.clientX, event.clientY) : null;

      activeRef.current = null;
      setLink(null);
      clickAfterDragRef.current = true;
      window.setTimeout(() => {
        clickAfterDragRef.current = false;
      }, 0);
      if (target && target !== active.sourceRowId) onCommit(active.sourceRowId, target);
    };

    const handleUp = finish(true);
    const handleCancel = finish(false);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeRef.current) {
        event.preventDefault();
        activeRef.current = null;
        setLink(null);
      }
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('keydown', handleKey, true);
    };
  }, [link, onCommit, toCanvas]);

  /** Begin on the handle's pointer-down; `from` is the source bar's right edge in canvas coordinates. */
  const startLink = useCallback(
    (event: ReactPointerEvent<HTMLElement>, sourceRowId: string, from: TimelineLinkPoint) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      activeRef.current = { sourceRowId, pointerId: event.pointerId, from };
      setLink({ sourceRowId, from, to: from, targetRowId: null });
    },
    []
  );

  return { link, startLink, clickAfterDragRef };
}
