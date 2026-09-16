import { act, renderHook } from '@testing-library/react';

import { TimelineLayout } from '@/application/database-yjs';

import { useTimelineRange } from '../hooks/useTimelineRange';
import { dateToX, xToDate } from '../scale/geometry';

test.each([-365, 365])('pixel navigation expands the range to reach a bar %i days away', (days) => {
  const scroller = document.createElement('div');

  Object.defineProperty(scroller, 'clientWidth', { value: 1280 });
  scroller.scrollTo = jest.fn((options: ScrollToOptions) => {
    scroller.scrollLeft = options.left ?? 0;
  });
  const { result } = renderHook(() =>
    useTimelineRange({
      layout: TimelineLayout.Month,
      scrollerRef: { current: scroller },
      sidebarWidth: 280,
    })
  );
  const target = new Date();

  target.setDate(target.getDate() + days);
  act(() => result.current.scrollToX(dateToX(result.current.geometry, target), 0.25));
  const geometry = result.current.geometry;

  expect(geometry.origin.getTime()).toBeLessThan(target.getTime());
  expect(xToDate(geometry, geometry.columnCount * geometry.preset.columnWidth).getTime()).toBeGreaterThan(
    target.getTime()
  );
  expect(scroller.scrollLeft).toBeCloseTo(dateToX(geometry, target) - 250, 3);
});
