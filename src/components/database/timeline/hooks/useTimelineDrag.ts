/**
 * Pointer-driven move / resize / progress editing of timeline bars.
 *
 * The interaction model is frappe/gantt's `bind_bar_events` and
 * `bind_bar_progress` (MIT, Copyright (c) 2024 Frappe Technologies Pvt.
 * Ltd.): remember the bar's origin on pointer-down, translate the pointer
 * delta into a snapped date (or percent) delta on every move, and only commit
 * on pointer-up when the pointer actually travelled. Dates are computed from
 * the origin dates rather than from pixels so a bar never drifts across
 * repeated drags. Rows that depend on the dragged one ("followers") move with
 * it according to Notion's "Shift dependents" setting: only as far as needed
 * to avoid overlapping (default), by the same distance like frappe's
 * `move_dependencies`, or not at all. The dragged bar itself is never
 * constrained by its own dependencies, as in Notion: it lands where it is
 * dropped and the arrow re-routes.
 */
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';

import { TimelineDependencyLink, TimelineDependencyShift, TimelineDependencyType } from '@/application/database-yjs';

import { calendarDaysBetween, dateToX, snapDate, startOfDay, TimelineGeometry, xToDate } from '../scale/geometry';

export type TimelineDragMode = 'move' | 'resize-start' | 'resize-end' | 'progress';

/** A follower's link to one of its predecessors inside the moving set. */
export interface TimelineDragLink extends TimelineDependencyLink {
  rowId: string;
}

export interface TimelineDragSpan {
  rowId: string;
  /** Bar start; a local midnight for all-day rows. */
  start: Date;
  /** Exclusive bar end (the day after the last covered day for all-day rows). */
  endExclusive: Date;
  allDay: boolean;
  /** For followers: the links to rows it depends on, limited to the dragged bar and other followers. */
  predecessors?: TimelineDragLink[];
}

export interface TimelineDragOrigin extends TimelineDragSpan {
  /** Rows that depend (transitively) on this one, in dependency order. */
  followers?: TimelineDragSpan[];
  /** How followers move; defaults to Notion's "only when dates overlap". */
  shift?: TimelineDependencyShift;
  /** Shifted followers never land on a Saturday or Sunday. */
  avoidWeekends?: boolean;
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
  geometryOrigin: Date;
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

function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());

  next.setDate(next.getDate() + days);
  return next;
}

function shiftDate(geometry: TimelineGeometry, date: Date, deltaPx: number, allDay = false): Date {
  const target = xToDate(geometry, dateToX(geometry, date) + deltaPx);

  if (!allDay) return snapDate(geometry.preset, target, 'round');
  const day = startOfDay(target);
  const nextDay = addCalendarDays(day, 1);

  // All-day endpoints remain local midnights, including on hour scales and
  // on 23/25-hour days. A fractional-day edit must not become a stored range.
  return target.getTime() - day.getTime() < nextDay.getTime() - target.getTime() ? day : nextDay;
}

function shiftSpan(geometry: TimelineGeometry, span: TimelineDragSpan, deltaPx: number): TimelineDragSpan {
  if (span.allDay) return moveSpanTo(span, shiftDate(geometry, span.start, deltaPx, true));
  const { preset } = geometry;
  // Snap movement rather than either endpoint, keeping times and duration.
  const minutesPerColumn = preset.unit === 'hour' ? 60 : 24 * 60;
  const steps = Math.round(((deltaPx / preset.columnWidth) * minutesPerColumn) / preset.snapMinutes);
  const minutes = steps * preset.snapMinutes;
  const start = new Date(span.start.getTime());

  if (preset.unit === 'day') start.setDate(start.getDate() + minutes / (24 * 60));
  else start.setTime(start.getTime() + minutes * 60_000);
  return moveSpanTo(span, start);
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();

  return day === 0 || day === 6;
}

/** Same time of day on the next Monday when `date` falls on a weekend. */
function skipWeekend(date: Date): Date {
  if (!isWeekend(date)) return date;
  const next = new Date(date.getTime());

  while (isWeekend(next)) next.setDate(next.getDate() + 1);
  return next;
}

const MS_PER_DAY = 86_400_000;

/**
 * Earliest start of `successor` that satisfies `link` given `predecessor`'s
 * dates: the classic finish/start-to-start/finish rules plus a lag in days
 * (negative = lead). End-type links are expressed through the successor's
 * current length.
 */
export function constraintStart(
  link: TimelineDependencyLink,
  predecessor: TimelineDragSpan,
  successor: TimelineDragSpan
): Date {
  const fromStart =
    link.type === TimelineDependencyType.StartToStart || link.type === TimelineDependencyType.StartToFinish;
  const toFinish =
    link.type === TimelineDependencyType.FinishToFinish || link.type === TimelineDependencyType.StartToFinish;
  const anchor = fromStart ? predecessor.start : predecessor.endExclusive;
  const withLag = predecessor.allDay
    ? addCalendarDays(anchor, link.lag)
    : new Date(anchor.getTime() + link.lag * MS_PER_DAY);

  if (!toFinish) return withLag;
  // Each endpoint retains its own semantics: all-day lag follows the
  // predecessor's calendar, while the successor's length can be timed.
  return successor.allDay
    ? addCalendarDays(withLag, -calendarDaysBetween(successor.start, successor.endExclusive))
    : new Date(withLag.getTime() - (successor.endExclusive.getTime() - successor.start.getTime()));
}

/** Move a span so it starts at `start`, keeping its length (calendar days for all-day rows). */
function moveSpanTo(span: TimelineDragSpan, start: Date): TimelineDragSpan {
  const endExclusive = new Date(start.getTime());

  if (span.allDay) endExclusive.setDate(endExclusive.getDate() + calendarDaysBetween(span.start, span.endExclusive));
  else endExclusive.setTime(start.getTime() + (span.endExclusive.getTime() - span.start.getTime()));

  return { ...span, start, endExclusive };
}

/**
 * Notion's "Shift only when dates overlap": every follower moves just far
 * enough to start once the bars it depends on end, cascading through the
 * follower chain. Followers whose dependencies did not move stay put.
 */
function resolveOverlaps(
  movedRoot: TimelineDragSpan,
  followers: TimelineDragSpan[],
  avoidWeekends: boolean
): TimelineDragSpan[] {
  const current = new Map<string, TimelineDragSpan>([[movedRoot.rowId, movedRoot]]);

  followers.forEach((follower) => current.set(follower.rowId, follower));

  // Followers arrive in breadth-first order, which is not always topological;
  // iterate to a fixed point (bounded, so cycles terminate).
  for (let pass = 0; pass <= followers.length; pass += 1) {
    let changed = false;

    followers.forEach((follower) => {
      const span = current.get(follower.rowId) ?? follower;
      let required = 0;

      (follower.predecessors ?? []).forEach((link) => {
        const predecessor = current.get(link.rowId);

        if (predecessor) required = Math.max(required, constraintStart(link, predecessor, span).getTime());
      });
      if (required <= span.start.getTime()) return;
      let start = new Date(required);

      // An all-day follower starts on the first whole day after its dependency.
      if (span.allDay && startOfDay(start).getTime() !== start.getTime()) {
        start = startOfDay(start);
        start.setDate(start.getDate() + 1);
      }

      if (avoidWeekends) start = skipWeekend(start);
      current.set(follower.rowId, moveSpanTo(span, start));
      changed = true;
    });
    if (!changed) break;
  }

  return followers.map((follower) => current.get(follower.rowId) ?? follower);
}

function shiftFollowers(
  geometry: TimelineGeometry,
  drag: TimelineDragOrigin,
  movedRoot: TimelineDragSpan,
  deltaPx: number
): TimelineDragSpan[] {
  const followers = drag.followers ?? [];
  const shift = drag.shift ?? TimelineDependencyShift.OverlapOnly;

  if (followers.length === 0 || shift === TimelineDependencyShift.Never) return [];
  if (shift === TimelineDependencyShift.OverlapOnly)
    return resolveOverlaps(movedRoot, followers, drag.avoidWeekends === true);

  return followers.map((follower) => {
    const shifted = shiftSpan(geometry, follower, deltaPx);

    return drag.avoidWeekends && isWeekend(shifted.start) ? moveSpanTo(shifted, skipWeekend(shifted.start)) : shifted;
  });
}

/**
 * Resizing affects only links anchored to the endpoint that changed. Compare
 * each edge's old and new constraint, then cascade through moved followers;
 * a start resize must not move an unrelated finish-to-start branch.
 */
function resizeFollowers(
  geometry: TimelineGeometry,
  drag: TimelineDragOrigin,
  resized: TimelineDragSpan,
  effectiveDelta: number,
  mode: 'resize-start' | 'resize-end'
): TimelineDragSpan[] {
  const followers = drag.followers ?? [];
  const shift = drag.shift ?? TimelineDependencyShift.OverlapOnly;

  if (followers.length === 0 || shift === TimelineDependencyShift.Never) return [];
  const original = new Map([[drag.rowId, drag], ...followers.map((span) => [span.rowId, span] as const)]);
  const current = new Map(original);

  current.set(drag.rowId, resized);
  // Metadata-free spans predate typed links and imply finish-to-start.
  if (mode === 'resize-end' && shift === TimelineDependencyShift.MaintainGap) {
    for (const follower of followers) {
      if (follower.predecessors?.length) continue;
      let moved = shiftSpan(geometry, follower, effectiveDelta);

      if (drag.avoidWeekends) moved = moveSpanTo(moved, skipWeekend(moved.start));
      current.set(follower.rowId, moved);
    }
  }

  for (let pass = 0; pass <= followers.length; pass += 1) {
    let changed = false;

    for (const follower of followers) {
      let constraintChanged = false;
      let required = Number.NEGATIVE_INFINITY;

      for (const link of follower.predecessors ?? []) {
        const previous = original.get(link.rowId);
        const next = current.get(link.rowId);

        if (!previous || !next) continue;
        const before = constraintStart(link, previous, follower);
        const after = constraintStart(link, next, follower);

        constraintChanged ||= before.getTime() !== after.getTime();
        const candidate =
          shift === TimelineDependencyShift.MaintainGap
            ? follower.allDay
              ? addCalendarDays(follower.start, calendarDaysBetween(before, after))
              : new Date(follower.start.getTime() + after.getTime() - before.getTime())
            : after;

        required = Math.max(required, candidate.getTime());
      }

      if (!constraintChanged) continue;
      if (shift === TimelineDependencyShift.OverlapOnly) required = Math.max(required, follower.start.getTime());
      let start = new Date(required);

      if (follower.allDay && startOfDay(start).getTime() !== start.getTime())
        start = addCalendarDays(startOfDay(start), 1);
      if (drag.avoidWeekends) start = skipWeekend(start);
      if (current.get(follower.rowId)?.start.getTime() === start.getTime()) continue;
      current.set(follower.rowId, moveSpanTo(follower, start));
      changed = true;
    }

    if (!changed) break;
  }

  return followers.flatMap((follower) => {
    const moved = current.get(follower.rowId) ?? follower;

    return moved.start.getTime() !== follower.start.getTime() ||
      moved.endExclusive.getTime() !== follower.endExclusive.getTime()
      ? [moved]
      : [];
  });
}

/** Pure delta application, exported for tests. */
export function applyDragDelta(
  geometry: TimelineGeometry,
  drag: TimelineDragOrigin & { mode: TimelineDragMode },
  deltaPx: number
): TimelineDragPreview {
  const { preset } = geometry;
  const snapMs = preset.snapMinutes * 60_000;
  const base = { rowId: drag.rowId, mode: drag.mode, allDay: drag.allDay };

  if (drag.mode === 'progress') {
    const width = dateToX(geometry, drag.endExclusive) - dateToX(geometry, drag.start);
    const origin = drag.progress ?? 0;
    const progress = Math.min(100, Math.max(0, Math.round(origin + (deltaPx / Math.max(width, 1)) * 100)));

    return { ...base, start: drag.start, endExclusive: drag.endExclusive, followers: [], progress };
  }

  if (drag.mode === 'move') {
    const moved = shiftSpan(geometry, drag, deltaPx);
    const effectiveDelta = dateToX(geometry, moved.start) - dateToX(geometry, drag.start);

    return { ...base, ...moved, followers: shiftFollowers(geometry, drag, moved, effectiveDelta) };
  }

  if (drag.mode === 'resize-start') {
    let start = shiftDate(geometry, drag.start, deltaPx, drag.allDay);
    const latestStart = drag.allDay
      ? addCalendarDays(drag.endExclusive, -1)
      : new Date(drag.endExclusive.getTime() - snapMs);

    if (start > latestStart) start = latestStart;
    const resized = { ...base, start, endExclusive: drag.endExclusive };
    const effectiveDelta = dateToX(geometry, start) - dateToX(geometry, drag.start);

    return { ...resized, followers: resizeFollowers(geometry, drag, resized, effectiveDelta, drag.mode) };
  }

  let endExclusive = shiftDate(geometry, drag.endExclusive, deltaPx, drag.allDay);
  const earliestEnd = drag.allDay ? addCalendarDays(drag.start, 1) : new Date(drag.start.getTime() + snapMs);

  if (endExclusive < earliestEnd) endExclusive = earliestEnd;
  const effectiveDelta = dateToX(geometry, endExclusive) - dateToX(geometry, drag.endExclusive);
  const resized = { rowId: drag.rowId, allDay: drag.allDay, start: drag.start, endExclusive };

  return { ...base, ...resized, followers: resizeFollowers(geometry, drag, resized, effectiveDelta, drag.mode) };
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
  // The browser fires a click after the pointer-up that ends a drag (on the
  // common ancestor of the press and release targets); it must not be read
  // as a click on the canvas.
  const clickAfterDragRef = useRef(false);

  geometryRef.current = geometry;

  const updatePreview = useCallback(() => {
    const drag = dragRef.current;
    const scroller = scrollerRef.current;

    if (!drag || !scroller) return;
    // A prepend changes both the origin and scrollLeft to keep the viewport
    // still. Remove only that origin offset, retaining real edge autoscroll.
    const originOffset = dateToX(geometryRef.current, drag.geometryOrigin);
    const deltaPx =
      lastClientXRef.current - drag.startClientX + (scroller.scrollLeft - drag.startScrollLeft) - originOffset;

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

      clickAfterDragRef.current = true;
      window.setTimeout(() => {
        clickAfterDragRef.current = false;
      }, 0);
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
        geometryOrigin: geometryRef.current.origin,
        moved: false,
      };
      lastClientXRef.current = event.clientX;
      previewRef.current = null;
      setActive(true);
    },
    [scrollerRef]
  );

  return { preview, dragging: active, startDrag, clickAfterDragRef };
}
