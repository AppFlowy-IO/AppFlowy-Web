import { renderHook } from '@testing-library/react';

import { TIMELINE_ROW_HEIGHT } from '../constants';
import { TimelineItem } from '../hooks/useTimelineItems';
import { useTimelineVirtualizer } from '../hooks/useTimelineVirtualizer';

test('viewport and preview renders retain measurements, while reordered occurrences receive current keys', () => {
  const scrollerRef = { current: document.createElement('div') };
  // The same row can appear in several groups. Both occurrences must remain
  // distinct when a grouping/sort update changes their order.
  const items: TimelineItem[] = Array.from({ length: 2000 }, (_, index) => ({
    kind: 'row',
    key: `row:group-${index}:shared`,
    groupId: `group-${index}`,
    row: { rowId: 'shared', title: 'Shared row', allDay: true, isRange: false },
  }));
  const { result, rerender } = renderHook(
    ({ currentItems }) => {
      const virtualizer = useTimelineVirtualizer(currentItems, scrollerRef);

      // TimelineView reads this during every render, including scroll and
      // pointer previews. Exercise the real TanStack measurement cache.
      virtualizer.getTotalSize();
      return virtualizer;
    },
    { initialProps: { currentItems: items } }
  );
  const initialMeasurements = result.current.measurementsCache;

  expect(initialMeasurements).toHaveLength(items.length);
  expect(result.current.getTotalSize()).toBe(items.length * TIMELINE_ROW_HEIGHT);

  for (let frame = 0; frame < 3; frame += 1) {
    rerender({ currentItems: items });
    expect(result.current.measurementsCache).toBe(initialMeasurements);
  }

  const reordered = [...items].reverse();

  rerender({ currentItems: reordered });
  expect(result.current.measurementsCache).not.toBe(initialMeasurements);
  expect(result.current.measurementsCache.map(({ key }) => key)).toEqual(reordered.map(({ key }) => key));
});
