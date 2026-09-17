import { useVirtualizer } from '@tanstack/react-virtual';
import { RefObject, useCallback } from 'react';

import { TIMELINE_HEADER_HEIGHT, TIMELINE_ROW_HEIGHT } from '../constants';

import { TimelineItem } from './useTimelineItems';

const estimateRowSize = () => TIMELINE_ROW_HEIGHT;

/** Fixed-height rows share the canvas geometry and keep measurements across viewport updates. */
export function useTimelineVirtualizer(items: TimelineItem[], scrollerRef: RefObject<HTMLElement | null>) {
  const getScrollElement = useCallback(() => scrollerRef.current, [scrollerRef]);
  // TanStack invalidates every row measurement when this function changes.
  // Scrolling and drag previews leave the item sequence unchanged.
  const getItemKey = useCallback((index: number) => items[index]?.key ?? index, [items]);

  return useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize: estimateRowSize,
    overscan: 8,
    scrollMargin: TIMELINE_HEADER_HEIGHT,
    getItemKey,
  });
}
