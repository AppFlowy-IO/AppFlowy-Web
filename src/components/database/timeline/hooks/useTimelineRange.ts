/**
 * Rendered date range of the timeline canvas.
 *
 * The range starts as a chunk of columns on either side of today and grows in
 * chunks whenever the viewport nears an edge, which is how frappe/gantt's
 * `infinite_padding` works (MIT, Copyright (c) 2024 Frappe Technologies Pvt.
 * Ltd.). Growing to the left prepends columns, so the scroll position is
 * shifted by the same width in a layout effect to keep the view still.
 */
import { RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { TimelineLayout } from '@/application/database-yjs';

import { addColumns, columnIndexOf, dateToX, floorToColumn, TimelineGeometry, xToDate } from '../scale/geometry';
import { getTimelinePreset } from '../scale/presets';

interface RangeState {
  layout: TimelineLayout;
  origin: Date;
  columnCount: number;
}

interface ScrollTarget {
  date: Date;
  /** Where `date` lands in the visible canvas: 0 = left edge, 0.5 = centre. */
  anchor: number;
  behavior: ScrollBehavior;
}

interface PendingScroll {
  /** Shift `scrollLeft` by this many pixels once prepended columns are laid out. */
  deltaX: number;
  target?: ScrollTarget;
}

function buildRange(layout: TimelineLayout, around: Date): RangeState {
  const preset = getTimelinePreset(layout);
  const center = floorToColumn(preset, around);

  return {
    layout,
    origin: addColumns(preset, center, -preset.chunkColumns),
    columnCount: preset.chunkColumns * 2,
  };
}

export interface UseTimelineRangeOptions {
  layout: TimelineLayout;
  scrollerRef: RefObject<HTMLElement | null>;
  /** Width of the sticky sidebar that overlays the left of the viewport. */
  sidebarWidth: number;
}

export function useTimelineRange({ layout, scrollerRef, sidebarWidth }: UseTimelineRangeOptions) {
  const [range, setRange] = useState<RangeState>(() => buildRange(layout, new Date()));
  const pendingRef = useRef<PendingScroll>({ deltaX: 0 });
  // Set while a growth state update is in flight so scroll events can't
  // queue the same prepend twice (frappe's `extended` flag).
  const growingRef = useRef(false);
  const geometry = useMemo<TimelineGeometry>(
    () => ({ preset: getTimelinePreset(range.layout), origin: range.origin, columnCount: range.columnCount }),
    [range]
  );
  const geometryRef = useRef(geometry);

  geometryRef.current = geometry;

  const visibleCanvasWidth = useCallback(
    () => Math.max(0, (scrollerRef.current?.clientWidth ?? 0) - sidebarWidth),
    [scrollerRef, sidebarWidth]
  );

  // A layout change rebuilds the range around the date at the centre of the
  // viewport, so the scale changes around what the user is looking at.
  const previousZoomRef = useRef(layout);

  if (previousZoomRef.current !== layout) {
    previousZoomRef.current = layout;
    const scroller = scrollerRef.current;
    const centre = xToDate(geometryRef.current, (scroller?.scrollLeft ?? 0) + visibleCanvasWidth() / 2);

    pendingRef.current = { deltaX: 0, target: { date: centre, anchor: 0.5, behavior: 'auto' } };
    setRange(buildRange(layout, centre));
  }

  const grow = useCallback((prependChunks: number, appendChunks: number) => {
    if (prependChunks === 0 && appendChunks === 0) return;
    const preset = geometryRef.current.preset;

    growingRef.current = true;
    if (prependChunks > 0) {
      pendingRef.current.deltaX += prependChunks * preset.chunkColumns * preset.columnWidth;
    }

    setRange((prev) => ({
      ...prev,
      origin: addColumns(preset, prev.origin, -prependChunks * preset.chunkColumns),
      columnCount: prev.columnCount + (prependChunks + appendChunks) * preset.chunkColumns,
    }));
  }, []);

  /** Chunks needed so `date` sits at least one chunk inside both edges. */
  const chunksToContain = useCallback((date: Date) => {
    const current = geometryRef.current;
    const { chunkColumns } = current.preset;
    const index = columnIndexOf(current, date);
    const prepend = index < chunkColumns ? Math.ceil((chunkColumns - index) / chunkColumns) : 0;
    const overflow = index + chunkColumns - current.columnCount;
    const append = overflow > 0 ? Math.ceil(overflow / chunkColumns) : 0;

    return { prepend, append };
  }, []);

  const scrollToDate = useCallback(
    (date: Date, anchor = 0, behavior: ScrollBehavior = 'smooth') => {
      const scroller = scrollerRef.current;

      if (!scroller) return;
      const { prepend, append } = chunksToContain(date);

      if (prepend === 0 && append === 0) {
        const x = dateToX(geometryRef.current, date) - anchor * visibleCanvasWidth();

        scroller.scrollTo({ left: Math.max(0, x), behavior });
        return;
      }

      pendingRef.current.target = { date, anchor, behavior };
      grow(prepend, append);
    },
    [chunksToContain, grow, scrollerRef, visibleCanvasWidth]
  );

  const scrollByColumns = useCallback(
    (columns: number) => {
      const scroller = scrollerRef.current;

      if (!scroller) return;
      const current = geometryRef.current;
      const targetDate = xToDate(current, scroller.scrollLeft + columns * current.preset.columnWidth);

      scrollToDate(targetDate, 0, 'smooth');
    },
    [scrollToDate, scrollerRef]
  );

  /** Call from the scroller's scroll handler to grow the range near the edges. */
  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current;

    if (!scroller || growingRef.current) return;
    const viewport = scroller.clientWidth;
    const { scrollLeft, scrollWidth } = scroller;
    const prepend = scrollLeft < viewport ? 1 : 0;
    const append = scrollWidth - (scrollLeft + viewport) < viewport ? 1 : 0;

    grow(prepend, append);
  }, [grow, scrollerRef]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const pending = pendingRef.current;

    pendingRef.current = { deltaX: 0 };
    growingRef.current = false;
    if (!scroller) return;

    if (pending.target) {
      const { date, anchor, behavior } = pending.target;
      const x = dateToX(geometry, date) - anchor * Math.max(0, scroller.clientWidth - sidebarWidth);

      scroller.scrollTo({ left: Math.max(0, x), behavior });
      return;
    }

    if (pending.deltaX) {
      scroller.scrollLeft += pending.deltaX;
    }
  }, [geometry, scrollerRef, sidebarWidth]);

  // First paint lands on today, a quarter of the way into the canvas.
  const initialisedRef = useRef(false);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;

    if (initialisedRef.current || !scroller) return;
    initialisedRef.current = true;
    const x = dateToX(geometry, new Date()) - 0.25 * Math.max(0, scroller.clientWidth - sidebarWidth);

    scroller.scrollLeft = Math.max(0, x);
  }, [geometry, scrollerRef, sidebarWidth]);

  return { geometry, handleScroll, scrollToDate, scrollByColumns };
}
