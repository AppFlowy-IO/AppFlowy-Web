import { useMemo } from 'react';

import { getBarRect, getSpanRect, minBarWidth, TimelineGeometry } from '../scale/geometry';

import type { TimelineDragPreview } from './useTimelineDrag';
import type { TimelineItem } from './useTimelineItems';

/** A row can occur in several groups; every occurrence shares its date preview. */
export function useTimelineRects(
  items: TimelineItem[],
  geometry: TimelineGeometry,
  preview: TimelineDragPreview | null
) {
  const baseRects = useMemo(
    () =>
      items.map((item) =>
        item.kind === 'row' && item.row.start
          ? getBarRect(geometry, item.row.start, item.row.end, item.row.allDay)
          : null
      ),
    [geometry, items]
  );
  const rects = useMemo(() => {
    if (!preview || preview.mode === 'progress') return baseRects;
    const spans = new Map([preview, ...preview.followers].map((span) => [span.rowId, span]));

    return items.map((item, index) => {
      const span = item.kind === 'row' ? spans.get(item.row.rowId) : undefined;

      return span && baseRects[index]
        ? getSpanRect(geometry, span, minBarWidth(geometry, span.allDay))
        : baseRects[index];
    });
  }, [baseRects, geometry, items, preview]);
  const previewRect = useMemo(() => {
    if (!preview) return null;
    const index = items.findIndex((item) => item.kind === 'row' && item.row.rowId === preview.rowId);

    return rects[index] ?? null;
  }, [items, preview, rects]);

  return { rects, previewRect };
}
