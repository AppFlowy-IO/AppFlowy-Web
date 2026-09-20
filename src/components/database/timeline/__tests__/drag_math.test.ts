import { TimelineDependencyShift, TimelineDependencyType, TimelineLayout } from '@/application/database-yjs';
import { correctAllDayEndForStorage } from '@/utils/time';

import { applyDragDelta, constraintStart, TimelineDragSpan } from '../hooks/useTimelineDrag';
import { dateToX, getBarSpan, TimelineGeometry } from '../scale/geometry';
import { getTimelinePreset } from '../scale/presets';

const day = (month: number, date: number, hour = 0) => new Date(2026, month - 1, date, hour);
const span = (rowId: string, start: Date, endExclusive: Date, allDay = true): TimelineDragSpan => ({
  rowId,
  start,
  endExclusive,
  allDay,
});
const geometry = (layout = TimelineLayout.Month): TimelineGeometry => ({
  preset: getTimelinePreset(layout),
  origin: day(3, 1),
  columnCount: 1000,
});

describe.each([TimelineLayout.Hours, TimelineLayout.Day])('all-day bounds on hour scale %s', (layout) => {
  const scale = geometry(layout);
  const original = span('a', day(3, 7), day(3, 9));

  test.each(['move', 'resize-start', 'resize-end'] as const)('%s ignores a one-hour delta', (mode) => {
    const result = applyDragDelta(scale, { ...original, mode }, scale.preset.columnWidth);

    expect(result.start).toEqual(original.start);
    expect(result.endExclusive).toEqual(original.endExclusive);
    expect(getBarSpan(result.start, correctAllDayEndForStorage(result.endExclusive), true)).toEqual({
      start: original.start,
      endExclusive: original.endExclusive,
    });
  });

  test('an unsnapped all-day move does not shift a timed follower', () => {
    const follower = span('b', day(3, 9, 9), day(3, 9, 10), false);
    const result = applyDragDelta(
      scale,
      {
        ...original,
        mode: 'move',
        shift: TimelineDependencyShift.MaintainGap,
        followers: [follower],
      },
      scale.preset.columnWidth
    );

    expect(result.followers[0].start).toEqual(follower.start);
    expect(result.followers[0].endExclusive).toEqual(follower.endExclusive);
  });

  test('moving across spring DST keeps a two-calendar-day span at midnight', () => {
    const delta = dateToX(scale, day(3, 8)) - dateToX(scale, original.start);
    const result = applyDragDelta(scale, { ...original, mode: 'move' }, delta);

    expect(result.start).toEqual(day(3, 8));
    expect(result.endExclusive).toEqual(day(3, 10));
  });

  test.each(['resize-start', 'resize-end'] as const)('%s cannot shrink below one calendar day', (mode) => {
    const original = span('a', day(3, 8), day(3, 9));
    const delta = scale.preset.columnWidth * (mode === 'resize-start' ? 48 : -48);
    const result = applyDragDelta(scale, { ...original, mode }, delta);

    expect(result.start).toEqual(day(3, 8));
    expect(result.endExclusive).toEqual(day(3, 9));
  });
});

describe.each([TimelineDependencyShift.OverlapOnly, TimelineDependencyShift.MaintainGap])(
  'resize-start mode %s',
  (shift) => {
    test('updates SS/SF branches and their followers without moving FS/FF branches', () => {
      const scale = geometry();
      const root = span('a', day(3, 3), day(3, 10));
      const follow = (id: string, type: TimelineDependencyType, start: Date, end: Date) => ({
        ...span(id, start, end),
        predecessors: [{ rowId: 'a', type, lag: 0 }],
      });
      const result = applyDragDelta(
        scale,
        {
          ...root,
          mode: 'resize-start',
          shift,
          followers: [
            follow('ss', TimelineDependencyType.StartToStart, day(3, 3), day(3, 4)),
            follow('sf', TimelineDependencyType.StartToFinish, day(3, 2), day(3, 3)),
            follow('fs', TimelineDependencyType.FinishToStart, day(3, 10), day(3, 11)),
            follow('ff', TimelineDependencyType.FinishToFinish, day(3, 9), day(3, 10)),
            {
              ...span('chain', day(3, 4), day(3, 5)),
              predecessors: [{ rowId: 'ss', type: TimelineDependencyType.FinishToStart, lag: 0 }],
            },
          ],
        },
        2 * scale.preset.columnWidth
      );
      const updates = new Map(result.followers.map((follower) => [follower.rowId, follower]));

      expect(result.followers.map((follower) => follower.rowId)).toEqual(['ss', 'sf', 'chain']);
      expect(result.start).toEqual(day(3, 5));
      expect(updates.get('ss')?.start).toEqual(day(3, 5));
      expect(updates.get('sf')?.endExclusive).toEqual(day(3, 5));
      expect(updates.get('chain')?.start).toEqual(day(3, 6));
      expect(updates.get('fs')?.start ?? day(3, 10)).toEqual(day(3, 10));
      expect(updates.get('ff')?.start ?? day(3, 9)).toEqual(day(3, 9));
    });
  }
);

test('maintain-gap start resizing uses the clamped start and can pull SS followers earlier', () => {
  const scale = geometry();
  const root = span('a', day(3, 3), day(3, 5));
  const follower = {
    ...span('b', day(3, 4), day(3, 6)),
    predecessors: [{ rowId: 'a', type: TimelineDependencyType.StartToStart, lag: 0 }],
  };
  const resize = (days: number) =>
    applyDragDelta(
      scale,
      {
        ...root,
        mode: 'resize-start',
        shift: TimelineDependencyShift.MaintainGap,
        followers: [follower],
      },
      days * scale.preset.columnWidth
    );

  expect(resize(10).start).toEqual(day(3, 4));
  expect(resize(10).followers[0].start).toEqual(day(3, 5));
  expect(resize(-2).followers[0].start).toEqual(day(3, 2));
});

test('never shifting dependents also applies when resizing the start', () => {
  const scale = geometry();
  const result = applyDragDelta(
    scale,
    {
      ...span('a', day(3, 3), day(3, 10)),
      mode: 'resize-start',
      shift: TimelineDependencyShift.Never,
      followers: [
        {
          ...span('b', day(3, 3), day(3, 4)),
          predecessors: [{ rowId: 'a', type: TimelineDependencyType.StartToStart, lag: 0 }],
        },
      ],
    },
    2 * scale.preset.columnWidth
  );

  expect(result.followers).toEqual([]);
});

// Run this file with TZ=America/New_York as well as the default zone: these
// dates straddle both DST transitions, while the assertions use local dates.
describe.each([
  [3, 8],
  [11, 1],
])('calendar dependency arithmetic around %i/%i', (month, date) => {
  const predecessor = span('a', day(month, date - 1), day(month, date));
  const successor = span('b', day(month, date), day(month, date + 2));

  test.each([1, -1])('all-day lag %i retains local midnight', (lag) => {
    expect(constraintStart({ type: TimelineDependencyType.FinishToStart, lag }, predecessor, successor)).toEqual(
      day(month, date + lag)
    );
  });

  test('finish constraints subtract calendar length, independent of the old DST duration', () => {
    const movedPredecessor = span('a', day(month, date + 2), day(month, date + 4));

    expect(
      constraintStart({ type: TimelineDependencyType.FinishToFinish, lag: 0 }, movedPredecessor, successor)
    ).toEqual(day(month, date + 2));
  });

  test('all-day lag cascades through a dependency chain without an extra day', () => {
    const scale = geometry();
    const result = applyDragDelta(
      scale,
      {
        ...span('a', day(month, date - 2), day(month, date - 1)),
        mode: 'move',
        followers: [
          {
            ...span('b', day(month, date - 2), day(month, date - 1)),
            predecessors: [{ rowId: 'a', type: TimelineDependencyType.FinishToStart, lag: 1 }],
          },
          {
            ...span('c', day(month, date - 1), day(month, date)),
            predecessors: [{ rowId: 'b', type: TimelineDependencyType.FinishToStart, lag: 0 }],
          },
        ],
      },
      scale.preset.columnWidth
    );

    expect(result.followers[0].start).toEqual(day(month, date + 1));
    expect(result.followers[1].start).toEqual(day(month, date + 2));
  });

  test('a timed successor keeps its elapsed duration after an all-day lag', () => {
    const timed = span('timed', day(month, date - 2, 9), day(month, date - 2, 10), false);
    const start = constraintStart({ type: TimelineDependencyType.FinishToFinish, lag: 1 }, predecessor, timed);

    expect(start.getTime()).toBe(day(month, date + 1).getTime() - 60 * 60 * 1000);
  });

  test('an all-day successor subtracts calendar days from a timed finish', () => {
    const timedPredecessor = span('timed', day(month, date + 4, 9), day(month, date + 4, 10), false);
    const start = constraintStart({ type: TimelineDependencyType.FinishToFinish, lag: 0 }, timedPredecessor, successor);

    expect(start).toEqual(day(month, date + 2, 10));
  });
});
