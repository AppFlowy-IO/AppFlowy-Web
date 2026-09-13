import { TimelineDependencyShift, TimelineLayout } from '@/application/database-yjs';

import { applyDragDelta } from '../hooks/useTimelineDrag';
import { buildDependencyGraph, collectDependents, dependencyArrowPath } from '../scale/dependencies';
import { TimelineGeometry } from '../scale/geometry';
import { getTimelinePreset } from '../scale/presets';

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const geometry: TimelineGeometry = {
  preset: getTimelinePreset(TimelineLayout.Month),
  origin: local(2020, 11, 1),
  columnCount: 60,
};
const { columnWidth } = geometry.preset;

describe('dependency graph', () => {
  const rows = ['a', 'b', 'c', 'd'];
  const relations = new Map<string, string[]>([
    ['b', ['a']],
    ['c', ['b', 'zzz-not-in-view']],
    ['d', ['a', 'd']],
  ]);
  const graph = buildDependencyGraph(rows, relations);

  test('keeps only in-view links, drops self links, and indexes both directions', () => {
    expect(graph.predecessors.get('b')).toEqual(['a']);
    expect(graph.predecessors.get('c')).toEqual(['b']);
    expect(graph.predecessors.get('d')).toEqual(['a']);
    expect(graph.dependents.get('a')).toEqual(['b', 'd']);
    expect(graph.dependents.get('b')).toEqual(['c']);
  });

  test('collects transitive dependents once each', () => {
    expect(collectDependents('a', graph).sort()).toEqual(['b', 'c', 'd']);
    expect(collectDependents('b', graph)).toEqual(['c']);
    expect(collectDependents('c', graph)).toEqual([]);
  });

  test('survives cycles', () => {
    const cyclic = buildDependencyGraph(
      ['x', 'y'],
      new Map([
        ['x', ['y']],
        ['y', ['x']],
      ])
    );

    expect(collectDependents('x', cyclic)).toEqual(['y']);
  });
});

describe('dependency arrow path', () => {
  const options = { rowHeight: 36, barInset: 4 };

  test('a successor that starts after the predecessor gets the short two-bend route', () => {
    const path = dependencyArrowPath(
      { rect: { left: 0, width: 100 }, index: 0 },
      { rect: { left: 160, width: 80 }, index: 2 },
      options
    );

    expect(path.startsWith('M 40 32 V ')).toBe(true);
    expect(path).toContain('L 147 90');
    expect(path.endsWith('m -5 -5 l 5 5 l -5 5')).toBe(true);
  });

  test('a successor that starts before the predecessor ends loops back with four bends', () => {
    const path = dependencyArrowPath(
      { rect: { left: 100, width: 100 }, index: 3 },
      { rect: { left: 60, width: 50 }, index: 1 },
      options
    );

    expect(path).toContain('H 42');
    expect((path.match(/ a /g) ?? []).length).toBe(3);
    expect(path).toContain('L 47 54');
  });
});

describe('applyDragDelta with dependencies and progress', () => {
  const span = (rowId: string, day: number, days: number) => ({
    rowId,
    allDay: true,
    start: local(2020, 11, day),
    endExclusive: local(2020, 11, day + days),
  });

  const keepGap = { shift: TimelineDependencyShift.MaintainGap };

  test('"maintain gap" moves followers by the same snapped delta', () => {
    const preview = applyDragDelta(
      geometry,
      { ...span('a', 5, 3), mode: 'move', ...keepGap, followers: [span('b', 9, 2), span('c', 12, 1)] },
      columnWidth * 2 + 5
    );

    expect(preview.start).toEqual(local(2020, 11, 7));
    expect(preview.endExclusive).toEqual(local(2020, 11, 10));
    expect(preview.followers.map((follower) => [follower.start, follower.endExclusive])).toEqual([
      [local(2020, 11, 11), local(2020, 11, 13)],
      [local(2020, 11, 14), local(2020, 11, 15)],
    ]);
  });

  test('a bar cannot move or start before its dependencies, and followers only travel the clamped distance', () => {
    const move = applyDragDelta(
      geometry,
      { ...span('b', 10, 2), mode: 'move', ...keepGap, minStart: local(2020, 11, 8), followers: [span('c', 14, 1)] },
      -columnWidth * 5
    );

    expect(move.start).toEqual(local(2020, 11, 8));
    expect(move.endExclusive).toEqual(local(2020, 11, 10));
    expect(move.followers[0].start).toEqual(local(2020, 11, 12));

    const resize = applyDragDelta(
      geometry,
      { ...span('b', 10, 2), mode: 'resize-start', minStart: local(2020, 11, 8) },
      -columnWidth * 5
    );

    expect(resize.start).toEqual(local(2020, 11, 8));
    expect(resize.followers).toEqual([]);
  });

  test('"maintain gap": extending the end pushes followers along; shrinking pulls them back', () => {
    const grow = applyDragDelta(
      geometry,
      { ...span('a', 5, 3), mode: 'resize-end', ...keepGap, followers: [span('b', 9, 2)] },
      columnWidth * 2
    );

    expect(grow.endExclusive).toEqual(local(2020, 11, 10));
    expect(grow.followers[0].start).toEqual(local(2020, 11, 11));

    const shrink = applyDragDelta(
      geometry,
      { ...span('a', 5, 3), mode: 'resize-end', ...keepGap, followers: [span('b', 9, 2)] },
      -columnWidth * 10
    );

    // Never shorter than one snap unit; followers move by the effective delta.
    expect(shrink.endExclusive).toEqual(local(2020, 11, 6));
    expect(shrink.followers[0].start).toEqual(local(2020, 11, 7));
  });

  test('"only when overlapping" (default) moves a follower just past its dependency and cascades', () => {
    // a: Nov 5–7, b (depends on a): Nov 9–10, c (depends on b): Nov 11
    const followers = [
      { ...span('b', 9, 2), predecessors: ['a'] },
      { ...span('c', 11, 1), predecessors: ['b'] },
    ];
    const small = applyDragDelta(geometry, { ...span('a', 5, 3), mode: 'move', followers }, columnWidth);

    // a now ends Nov 9 (exclusive): b still starts on the 9th, nothing overlaps.
    expect(small.followers.map((follower) => follower.start)).toEqual([local(2020, 11, 9), local(2020, 11, 11)]);

    const big = applyDragDelta(geometry, { ...span('a', 5, 3), mode: 'move', followers }, columnWidth * 4);

    // a: Nov 9–11 → b must start on the 12th (2 days → ends 14th) → c on the 14th.
    expect(big.followers.map((follower) => [follower.start, follower.endExclusive])).toEqual([
      [local(2020, 11, 12), local(2020, 11, 14)],
      [local(2020, 11, 14), local(2020, 11, 15)],
    ]);

    // Moving earlier never pulls followers back.
    const earlier = applyDragDelta(geometry, { ...span('a', 5, 3), mode: 'move', followers }, -columnWidth * 3);

    expect(earlier.followers.map((follower) => follower.start)).toEqual([local(2020, 11, 9), local(2020, 11, 11)]);
  });

  test('"only when overlapping" also applies when the end handle grows into a follower', () => {
    const grow = applyDragDelta(
      geometry,
      { ...span('a', 5, 3), mode: 'resize-end', followers: [{ ...span('b', 9, 2), predecessors: ['a'] }] },
      columnWidth * 3
    );

    expect(grow.endExclusive).toEqual(local(2020, 11, 11));
    expect(grow.followers[0].start).toEqual(local(2020, 11, 11));
  });

  test('"never" leaves followers alone and lets a dependent be dragged before its dependency', () => {
    const preview = applyDragDelta(
      geometry,
      {
        ...span('b', 10, 2),
        mode: 'move',
        shift: TimelineDependencyShift.Never,
        minStart: local(2020, 11, 8),
        followers: [{ ...span('c', 14, 1), predecessors: ['b'] }],
      },
      -columnWidth * 5
    );

    expect(preview.start).toEqual(local(2020, 11, 5));
    expect(preview.followers).toEqual([]);
  });

  test('avoid weekends pushes a shifted follower to the next Monday', () => {
    // Nov 2020: the 14th is a Saturday, the 16th a Monday.
    const overlap = applyDragDelta(
      geometry,
      {
        ...span('a', 5, 3),
        mode: 'move',
        avoidWeekends: true,
        followers: [{ ...span('b', 9, 2), predecessors: ['a'] }],
      },
      columnWidth * 6
    );

    // a: Nov 11–13 → b would start Saturday the 14th → Monday the 16th.
    expect(overlap.followers[0].start).toEqual(local(2020, 11, 16));
    expect(overlap.followers[0].endExclusive).toEqual(local(2020, 11, 18));

    const gap = applyDragDelta(
      geometry,
      { ...span('a', 5, 3), mode: 'move', ...keepGap, avoidWeekends: true, followers: [span('b', 9, 2)] },
      columnWidth * 5
    );

    expect(gap.followers[0].start).toEqual(local(2020, 11, 16));
  });

  test('progress drags convert pixels to a clamped whole percent and never touch dates', () => {
    const origin = { ...span('a', 5, 4), mode: 'progress' as const, progress: 25 };
    const width = columnWidth * 4;

    expect(applyDragDelta(geometry, origin, width / 4).progress).toBe(50);
    expect(applyDragDelta(geometry, origin, -width).progress).toBe(0);
    expect(applyDragDelta(geometry, origin, width * 3).progress).toBe(100);
    const preview = applyDragDelta(geometry, origin, 10);

    expect(preview.start).toEqual(origin.start);
    expect(preview.endExclusive).toEqual(origin.endExclusive);
    expect(preview.followers).toEqual([]);
  });
});
