import { render, renderHook, screen } from '@testing-library/react';

import { DatabaseGrouping, GridGroup, TimelineLayout } from '@/application/database-yjs';

import { TimelineDragPreview } from '../hooks/useTimelineDrag';
import { useTimelineItems } from '../hooks/useTimelineItems';
import { useTimelineRects } from '../hooks/useTimelineRects';
import { TimelineRowModel } from '../hooks/useTimelineRows';
import { buildDependencyGraph } from '../scale/dependencies';
import { dateToX, TimelineGeometry } from '../scale/geometry';
import { getTimelinePreset } from '../scale/presets';
import { TimelineArrows } from '../TimelineArrows';

const day = (date: number) => new Date(2026, 2, date);
const rows: TimelineRowModel[] = ['a', 'b'].map((rowId, index) => ({
  rowId,
  title: rowId,
  start: day(18 + index * 2),
  allDay: true,
  isRange: false,
}));
const groups: GridGroup[] = ['first', 'second'].map((id) => ({
  id,
  label: id,
  rows: [
    { id: 'a', height: 36 },
    { id: 'b', height: 36 },
  ],
  isDefault: false,
  visible: true,
  hidden: false,
  automaticallyHidden: false,
  collapsed: false,
}));
const grouping: DatabaseGrouping = {
  isGrouped: true,
  groups,
  visibleGroups: groups,
  activeGroupIds: groups.map(({ id }) => id),
  hideEmptyGroups: false,
  ready: true,
};
const geometry: TimelineGeometry = {
  origin: day(1),
  preset: getTimelinePreset(TimelineLayout.Month),
  columnCount: 90,
};

test('group-qualified keys stay stable and previews update all root and follower occurrences', () => {
  const preview: TimelineDragPreview = {
    rowId: 'a',
    start: day(21),
    endExclusive: day(22),
    allDay: true,
    mode: 'move',
    followers: [{ rowId: 'b', start: day(22), endExclusive: day(23), allDay: true }],
  };
  const { result, rerender } = renderHook(
    ({ preview, groups }) => {
      const items = useTimelineItems(rows, { ...grouping, visibleGroups: groups }, true);
      const rects = useTimelineRects(items, geometry, preview);

      return { items, ...rects };
    },
    { initialProps: { preview: null as TimelineDragPreview | null, groups } }
  );
  const initialKeys = result.current.items.map(({ key }) => key);

  expect(new Set(initialKeys).size).toBe(initialKeys.length);
  rerender({ preview, groups });
  const rowItems = result.current.items.filter((item) => item.kind === 'row');

  expect(rowItems).toHaveLength(4);
  result.current.items.forEach((item, index) => {
    if (item.kind !== 'row') return;
    expect(result.current.rects[index]?.left).toBe(dateToX(geometry, day(item.row.rowId === 'a' ? 21 : 22)));
  });
  rerender({ preview, groups: [...groups].reverse() });
  expect(new Set(result.current.items.map(({ key }) => key))).toEqual(new Set(initialKeys));
});

test('each duplicated successor gets a connector in its group without cross-product arrows', () => {
  const { result } = renderHook(() => {
    const items = useTimelineItems(rows, grouping, true);

    return { items, ...useTimelineRects(items, geometry, null) };
  });
  const { items, rects } = result.current;
  const graph = buildDependencyGraph(['a', 'b'], new Map([['b', ['a']]]));

  render(
    <TimelineArrows
      rowIds={items.map((item) => (item.kind === 'row' ? item.row.rowId : ''))}
      groupIds={items.map((item) => (item.kind === 'row' ? item.groupId : undefined))}
      rects={rects}
      graph={graph}
      firstVisibleIndex={0}
      lastVisibleIndex={items.length}
      canvasWidth={2000}
      bodyHeight={400}
      left={280}
    />
  );
  const arrows = screen.getAllByTestId('timeline-arrow');

  expect(arrows).toHaveLength(2);
  const origins = arrows.map((arrow) => Number(arrow.getAttribute('d')!.split(' ')[2]));

  expect(origins[0]).toBeGreaterThanOrEqual(36);
  expect(origins[0]).toBeLessThanOrEqual(72);
  expect(origins[1] - origins[0]).toBe(144);
  expect(arrows.every((arrow) => arrow.getAttribute('data-link') === 'a:b')).toBe(true);
});
