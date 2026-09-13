/**
 * Pointer-driven move / resize / progress editing of timeline bars.
 *
 * The interaction model is frappe/gantt's `bind_bar_events` and
 * `bind_bar_progress` (MIT, Copyright (c) 2024 Frappe Technologies Pvt.
 * Ltd.): remember the bar's origin on pointer-down, translate the pointer
 * delta into a snapped date (or percent) delta on every move, and only commit
 * on pointer-up when the pointer actually travelled. Dates are computed from
 * the origin dates rather than from pixels so a bar never drifts across
 * repeated drags. Like frappe's `move_dependencies`, rows that depend on the
 * dragged one ("followers") shift with it, and a bar cannot start before its
 * dependencies do.
 */
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';

import { columnIndexOf, dateToX, snapDate, TimelineGeometry, xToDate } from '../scale/geometry';

export type TimelineDragMode = 'move' | 'resize-start' | 'resize-end' | 'progress';

export interface TimelineDragSpan {
  rowId: string;
  /** Bar start; a local midnight for all-day rows. */
  start: Date;
  /** Exclusive bar end (the day after the last covered day for all-day rows). */
  endExclusive: Date;
  allDay: boolean;
}

export interface TimelineDragOrigin extends TimelineDragSpan {
  /** Rows that shift with this one when it moves or its end moves. */
  followers?: TimelineDragSpan[];
  /** Earliest start allowed, e.g. the latest start among its dependencies. */
  minStart?: Date;
  /** Current 0–100 progress, required for the progress mode. */
  progress?: number;
}

export interface TimelineDragPreview extends TimelineDragSpan {
  mode: TimelineDragMode;
  followers: TimelineDragSpan[];
  /** Only set by the progress mode. */
  progress?: number;
}

interface ActiveDrag extends TimelineDragOrigin {
  mode: TimelineDragMode;
  pointerId: number;
  startClientX: number;
  startScrollLeft: number;
  moved: boolean;
}

/** Pointer travel before a press turns into a drag instead of a click. */
export const DRAG_THRESHOLD_PX = 4;
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_STEP_PX = 12;

export interface UseTimelineDragOptions {
  geometry: TimelineGeometry;
  scrollerRef: React.RefObject<HTMLElement | null>;
  /** Width of the sticky sidebar overlaying the left of the viewport. */
  sidebarWidth: number;
  onCommit: (preview: TimelineDragPreview) => void;
  onClick?: (rowId: string) => void;
}

function shiftDate(geometry: TimelineGeometry, date: Date, deltaPx: number): Date {
  return snapDate(geometry.preset, xToDate(geometry, dateToX(geometry, date) + deltaPx), 'round');
}

function shiftSpan(geometry: TimelineGeometry, span: TimelineDragSpan, deltaPx: number): TimelineDragSpan {
  const { preset } = geometry;
  const snapMs = preset.snapMinutes * 60_000;
  const durationColumns = columnIndexOf(geometry, span.endExclusive) - columnIndexOf(geometry, span.start);
  const start = shiftDate(geometry, span.start, deltaPx);
  let endExclusive = snapDate(
    preset,
    xToDate(geometry, dateToX(geometry, start) + durationColumns * preset.columnWidth),
    'round'
  );

  if (endExclusive.getTime() - start.getTime() < snapMs) endExclusive = new Date(start.getTime() + snapMs);
  return { rowId: span.rowId, allDay: span.allDay, start, endExclusive };
}

/** Pure delta application, exported for tests. */
export function applyDragDelta(
  geometry: TimelineGeometry,
  drag: TimelineDragOrigin & { mode: TimelineDragMode },
  deltaPx: number
): TimelineDragPreview {
  const { preset } = geometry;
  const snapMs = preset.snapMinutes * 60_000;
  const followers = drag.followers ?? [];
  const base = { rowId: drag.rowId, mode: drag.mode, allDay: drag.allDay };

  if (drag.mode === 'progress') {
    const width = dateToX(geometry, drag.endExclusive) - dateToX(geometry, drag.start);
    const origin = drag.progress ?? 0;
    const progress = Math.min(100, Math.max(0, Math.round(origin + (deltaPx / Math.max(width, 1)) * 100)));

    return { ...base, start: drag.start, endExclusive: drag.endExclusive, followers: [], progress };
  }

  if (drag.mode === 'move') {
    let moved = shiftSpan(geometry, drag, deltaPx);
    let effectiveDelta = deltaPx;

    if (drag.minStart && moved.start < drag.minStart) {
      // Clamp to the dependency and re-derive the pixel delta so followers
      // keep the offset the bar actually travelled.
      effectiveDelta = dateToX(geometry, drag.minStart) - dateToX(geometry, drag.start);
      moved = shiftSpan(geometry, drag, effectiveDelta);
    }

    return {
      ...base,
      ...moved,
      followers: followers.map((follower) => shiftSpan(geometry, follower, effectiveDelta)),
    };
  }

  if (drag.mode === 'resize-start') {
    let start = shiftDate(geometry, drag.start, deltaPx);

    if (drag.minStart && start < drag.minStart) start = drag.minStart;
    if (drag.endExclusive.getTime() - start.getTime() < snapMs) start = new Date(drag.endExclusive.getTime() - snapMs);

    return { ...base, start, endExclusive: drag.endExclusive, followers: [] };
  }

  let endExclusive = shiftDate(geometry, drag.endExclusive, deltaPx);

  if (endExclusive.getTime() - drag.start.getTime() < snapMs) endExclusive = new Date(drag.start.getTime() + snapMs);
  const effectiveDelta = dateToX(geometry, endExclusive) - dateToX(geometry, drag.endExclusive);

  return {
    ...base,
    start: drag.start,
    endExclusive,
    followers: followers.map((follower) => shiftSpan(geometry, follower, effectiveDelta)),
  };
}

function samePreview(a: TimelineDragPreview | null, b: TimelineDragPreview): boolean {
  if (!a || a.rowId !== b.rowId || a.mode !== b.mode || a.progress !== b.progress) return false;
  if (a.start.getTime() !== b.start.getTime() || a.endExclusive.getTime() !== b.endExclusive.getTime()) return false;
  if (a.followers.length !== b.followers.length) return false;

  return a.followers.every(
    (follower, index) =>
      follower.rowId === b.followers[index].rowId &&
      follower.start.getTime() === b.followers[index].start.getTime() &&
      follower.endExclusive.getTime() === b.followers[index].endExclusive.getTime()
  );
}

export function useTimelineDrag({ geometry, scrollerRef, sidebarWidth, onCommit, onClick }: UseTimelineDragOptions) {
  const [preview, setPreview] = useState<TimelineDragPreview | null>(null);
  const [active, setActive] = useState(false);
  const previewRef = useRef<TimelineDragPreview | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const geometryRef = useRef(geometry);
  const lastClientXRef = useRef(0);
  const autoScrollFrameRef = useRef(0);

  geometryRef.current = geometry;

  const updatePreview = useCallback(() => {
    const drag = dragRef.current;
    const scroller = scrollerRef.current;

    if (!drag || !scroller) return;
    const deltaPx = lastClientXRef.current - drag.startClientX + (scroller.scrollLeft - drag.startScrollLeft);

    if (!drag.moved && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const next = applyDragDelta(geometryRef.current, drag, deltaPx);

    if (samePreview(previewRef.current, next)) return;
    previewRef.current = next;
    setPreview(next);
  }, [scrollerRef]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current) cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = 0;
  }, []);

  const autoScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    const drag = dragRef.current;

    autoScrollFrameRef.current = 0;
    if (!scroller || !drag || drag.mode === 'progress') return;
    const bounds = scroller.getBoundingClientRect();
    const x = lastClientXRef.current;
    let step = 0;

    if (x < bounds.left + sidebarWidth + AUTO_SCROLL_EDGE_PX) step = -AUTO_SCROLL_STEP_PX;
    else if (x > bounds.right - AUTO_SCROLL_EDGE_PX) step = AUTO_SCROLL_STEP_PX;

    if (step !== 0) {
      scroller.scrollLeft += step;
      updatePreview();
      autoScrollFrameRef.current = requestAnimationFrame(autoScroll);
    }
  }, [scrollerRef, sidebarWidth, updatePreview]);

  const finish = useCallback(
    (commit: boolean) => {
      const drag = dragRef.current;
      const current = previewRef.current;

      dragRef.current = null;
      previewRef.current = null;
      stopAutoScroll();
      setPreview(null);
      setActive(false);
      if (!drag) return;

      if (!drag.moved) {
        if (commit && drag.mode !== 'progress') onClick?.(drag.rowId);
        return;
      }

      if (commit && current && current.rowId === drag.rowId) onCommit(current);
    },
    [onClick, onCommit, stopAutoScroll]
  );

  useEffect(() => {
    if (!active) return;

    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;

      if (!drag || event.pointerId !== drag.pointerId) return;
      lastClientXRef.current = event.clientX;
      updatePreview();
      if (!autoScrollFrameRef.current) autoScrollFrameRef.current = requestAnimationFrame(autoScroll);
    };

    const handleUp = (event: PointerEvent) => {
      const drag = dragRef.current;

      if (!drag || event.pointerId !== drag.pointerId) return;
      finish(true);
    };

    const handleCancel = (event: PointerEvent) => {
      const drag = dragRef.current;

      if (!drag || event.pointerId !== drag.pointerId) return;
      finish(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) {
        event.preventDefault();
        finish(false);
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
  }, [active, autoScroll, finish, updatePreview]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, origin: TimelineDragOrigin, mode: TimelineDragMode) => {
      if (event.button !== 0) return;
      const scroller = scrollerRef.current;

      if (!scroller) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        ...origin,
        mode,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startScrollLeft: scroller.scrollLeft,
        moved: false,
      };
      lastClientXRef.current = event.clientX;
      previewRef.current = null;
      setActive(true);
    },
    [scrollerRef]
  );

  return { preview, dragging: active, startDrag };
}
