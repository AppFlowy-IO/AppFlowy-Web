import { act, renderHook } from '@testing-library/react';
import { PointerEvent as ReactPointerEvent } from 'react';

import { TimelineDependencyShift, TimelineLayout } from '@/application/database-yjs';

import { useTimelineDrag } from '../hooks/useTimelineDrag';
import { useTimelineRange } from '../hooks/useTimelineRange';

function pointer(type: string, clientX: number) {
  const event = new MouseEvent(type, { clientX, button: 0 });

  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

test('prepending during a drag preserves its delta and real autoscroll still moves the committed rows', () => {
  const frames: FrameRequestCallback[] = [];
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  const scroller = document.createElement('div');

  Object.defineProperties(scroller, { clientWidth: { value: 1280 }, scrollWidth: { value: 100_000 } });
  scroller.getBoundingClientRect = () => ({ left: 0, right: 1280 } as DOMRect);
  const scrollerRef = { current: scroller };
  const onCommit = jest.fn();
  const { result, unmount } = renderHook(() => {
    const range = useTimelineRange({ layout: TimelineLayout.Month, scrollerRef, sidebarWidth: 280 });
    const drag = useTimelineDrag({ geometry: range.geometry, scrollerRef, sidebarWidth: 280, onCommit });

    return { range, drag };
  });
  const original = {
    rowId: 'a',
    allDay: false,
    start: new Date(2026, 8, 16, 9, 7),
    endExclusive: new Date(2026, 8, 16, 10, 7),
    shift: TimelineDependencyShift.MaintainGap,
    followers: [
      { rowId: 'b', allDay: false, start: new Date(2026, 8, 17, 14), endExclusive: new Date(2026, 8, 17, 15) },
    ],
  };

  scroller.scrollLeft = 720;
  act(() =>
    result.current.drag.startDrag(
      pointer('pointerdown', 336) as unknown as ReactPointerEvent<HTMLElement>,
      original,
      'move'
    )
  );
  act(() => {
    window.dispatchEvent(pointer('pointermove', 300));
  });
  expect(result.current.drag.preview?.start).toEqual(new Date(2026, 8, 15, 9, 7));
  const oldOrigin = result.current.range.geometry.origin;

  act(() => result.current.range.handleScroll());
  expect(result.current.range.geometry.origin.getTime()).toBeLessThan(oldOrigin.getTime());
  expect(scroller.scrollLeft).toBe(720 + 62 * 36);
  act(() => {
    window.dispatchEvent(pointer('pointermove', 300));
  });
  expect(result.current.drag.preview?.start).toEqual(new Date(2026, 8, 15, 9, 7));

  // Three genuine left-edge autoscroll frames move another calendar day.
  for (let frame = 0; frame < 3; frame += 1) act(() => frames.shift()?.(frame * 16));
  act(() => {
    window.dispatchEvent(pointer('pointerup', 300));
  });
  expect(onCommit).toHaveBeenCalledTimes(1);
  const committed = onCommit.mock.calls[0][0];

  expect(committed.start).toEqual(new Date(2026, 8, 14, 9, 7));
  expect(committed.endExclusive).toEqual(new Date(2026, 8, 14, 10, 7));
  expect(committed.followers[0].start).toEqual(new Date(2026, 8, 15, 14));
  expect(committed.followers[0].endExclusive).toEqual(new Date(2026, 8, 15, 15));
  unmount();
  raf.mockRestore();
  cancel.mockRestore();
});
