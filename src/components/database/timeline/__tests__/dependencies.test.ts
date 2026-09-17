import {
  TimelineDependencyDirection,
  TimelineDependencyShift,
  TimelineDependencyType,
  TimelineLayout,
} from '@/application/database-yjs';

import { applyDragDelta, constraintStart } from '../hooks/useTimelineDrag';
import {
  buildDependencyGraph,
  collectDependents,
  dependencyArrowPath,
  dependencyLinkPath,
  linkOf,
} from '../scale/dependencies';
import { TimelineGeometry } from '../scale/geometry';
import { getTimelinePreset } from '../scale/presets';

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const geometry: TimelineGeometry = {
  preset: getTimelinePreset(TimelineLayout.Month),
  origin: local(2020, 11, 1),
  columnCount: 60,
};
const { columnWidth } = geometry.preset;

test.each([-2, 0, 1])('moving a timed bar by %i days preserves its time and duration', (days) => {
  const preview = applyDragDelta(
    geometry,
    {
      rowId: 'a',
      start: new Date(2020, 10, 5, 9, 7, 12),
      endExclusive: new Date(2020, 10, 5, 10, 7, 12),
      allDay: false,
      mode: 'move',
      shift: TimelineDependencyShift.MaintainGap,
      followers: [
        {
          rowId: 'b',
          start: new Date(2020, 10, 7, 14, 15),
          endExclusive: new Date(2020, 10, 7, 14, 45),
          allDay: false,
        },
      ],
    },
    columnWidth * (days + 0.1)
  );

  expect(preview.start).toEqual(new Date(2020, 10, 5 + days, 9, 7, 12));
  expect(preview.endExclusive).toEqual(new Date(2020, 10, 5 + days, 10, 7, 12));
  expect(preview.followers[0].start).toEqual(new Date(2020, 10, 7 + days, 14, 15));
  expect(preview.followers[0].endExclusive).toEqual(new Date(2020, 10, 7 + days, 14, 45));
});

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

  test('an upward connector leaves the bar top and enters the target horizontally', () => {
    const path = dependencyArrowPath(
      { rect: { left: 36, width: 36 }, index: 2 },
      { rect: { left: 72, width: 180 }, index: 1 },
      { rowHeight: 36, barInset: 7 }
    );

    expect(path.startsWith('M 54 79 ')).toBe(true);
    expect(path).toContain('V 59 a 5 5 0 0 1 5 -5 H 72');
    expect(path.endsWith('m -5 -5 l 5 5 l -5 5')).toBe(true);
  });

  test.each([1, 8, 18])('a narrow predecessor (%ipx) keeps its connector attached', (width) => {
    const path = dependencyArrowPath(
      { rect: { left: 36, width }, index: 1 },
      { rect: { left: 36 + width, width: 180 }, index: 0 },
      { rowHeight: 36, barInset: 7 }
    );
    const [, x, y] = /^M (\S+) (\S+)/.exec(path)!;

    expect(Number(x)).toBeGreaterThanOrEqual(36);
    expect(Number(x)).toBeLessThanOrEqual(36 + width);
    expect(Number(y)).toBe(43);
    expect(path).toContain(`H ${36 + width} m -5 -5`);
    expect(path).not.toMatch(/a -|NaN|Infinity/);
  });

  test('a successor that starts after the predecessor gets the short two-bend route', () => {
    const path = dependencyArrowPath(
      { rect: { left: 0, width: 100 }, index: 0 },
      { rect: { left: 160, width: 80 }, index: 2 },
      options
    );

    expect(path.startsWith('M 50 32 V ')).toBe(true);
    expect(path).toContain('H 160');
    expect(path.endsWith('m -5 -5 l 5 5 l -5 5')).toBe(true);
  });

  test('a successor that starts before the predecessor ends loops back with four bends', () => {
    const path = dependencyArrowPath(
      { rect: { left: 100, width: 100 }, index: 3 },
      { rect: { left: 60, width: 50 }, index: 1 },
      options
    );

    expect(path).toContain('H 46');
    expect((path.match(/ a /g) ?? []).length).toBe(3);
    expect(path).toContain('H 60 m -5 -5');
  });

  test.each([0, 2])('a backward connector from row %i turns away from its source bar', (index) => {
    const path = dependencyArrowPath(
      { rect: { left: 100, width: 100 }, index },
      { rect: { left: 60, width: 50 }, index: 1 },
      options
    );
    const direction = index === 0 ? 1 : -1;
    const startY = index === 0 ? 32 : 76;
    const bends = Array.from(path.matchAll(/a \S+ \S+ 0 0 [01] \S+ (\S+)/g));

    expect(path.startsWith(`M 118 ${startY} V ${startY} `)).toBe(true);
    expect(bends).toHaveLength(3);
    expect(bends.every((bend) => Number(bend[1]) * direction > 0)).toBe(true);
    expect(path).toContain('H 60 m -5 -5');
  });
});

const fs = (rowId: string, lag = 0) => ({ rowId, type: TimelineDependencyType.FinishToStart, lag });

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

  test('a dependent may be dragged over or before its dependency; only its own followers move', () => {
    const move = applyDragDelta(
      geometry,
      { ...span('b', 10, 2), mode: 'move', ...keepGap, followers: [span('c', 14, 1)] },
      -columnWidth * 5
    );

    // No clamp: the bar lands where it is dropped and its follower keeps the gap.
    expect(move.start).toEqual(local(2020, 11, 5));
    expect(move.endExclusive).toEqual(local(2020, 11, 7));
    expect(move.followers[0].start).toEqual(local(2020, 11, 9));

    const resize = applyDragDelta(geometry, { ...span('b', 10, 2), mode: 'resize-start' }, -columnWidth * 5);

    expect(resize.start).toEqual(local(2020, 11, 5));
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
      { ...span('b', 9, 2), predecessors: [fs('a')] },
      { ...span('c', 11, 1), predecessors: [fs('b')] },
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
      { ...span('a', 5, 3), mode: 'resize-end', followers: [{ ...span('b', 9, 2), predecessors: [fs('a')] }] },
      columnWidth * 3
    );

    expect(grow.endExclusive).toEqual(local(2020, 11, 11));
    expect(grow.followers[0].start).toEqual(local(2020, 11, 11));
  });

  test('"never" leaves followers alone', () => {
    const preview = applyDragDelta(
      geometry,
      {
        ...span('b', 10, 2),
        mode: 'move',
        shift: TimelineDependencyShift.Never,
        followers: [{ ...span('c', 14, 1), predecessors: [fs('b')] }],
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
        followers: [{ ...span('b', 9, 2), predecessors: [fs('a')] }],
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

describe('dependency direction and per-link metadata', () => {
  test('a "Blocking" field flips the edges and links carry their type and lag', () => {
    const graph = buildDependencyGraph(['a', 'b'], new Map([['a', ['b']]]), {
      direction: TimelineDependencyDirection.Blocking,
      links: { 'a:b': { type: TimelineDependencyType.StartToStart, lag: 3 } },
    });

    expect(graph.predecessors.get('b')).toEqual(['a']);
    expect(graph.dependents.get('a')).toEqual(['b']);
    expect(linkOf(graph, 'a', 'b')).toEqual({ type: TimelineDependencyType.StartToStart, lag: 3 });
    expect(linkOf(graph, 'b', 'a')).toEqual({ type: TimelineDependencyType.FinishToStart, lag: 0 });
  });

  test('constraintStart applies each link type and its lag to the successor', () => {
    const predecessor = { rowId: 'p', allDay: true, start: local(2020, 11, 5), endExclusive: local(2020, 11, 8) };
    const successor = { rowId: 's', allDay: true, start: local(2020, 11, 1), endExclusive: local(2020, 11, 3) };
    const at = (type: TimelineDependencyType, lag: number) => constraintStart({ type, lag }, predecessor, successor);

    expect(at(TimelineDependencyType.FinishToStart, 0)).toEqual(local(2020, 11, 8));
    expect(at(TimelineDependencyType.FinishToStart, 2)).toEqual(local(2020, 11, 10));
    expect(at(TimelineDependencyType.FinishToStart, -1)).toEqual(local(2020, 11, 7));
    expect(at(TimelineDependencyType.StartToStart, 0)).toEqual(local(2020, 11, 5));
    // The successor is two days long: its end must reach the predecessor's end.
    expect(at(TimelineDependencyType.FinishToFinish, 0)).toEqual(local(2020, 11, 6));
    expect(at(TimelineDependencyType.StartToFinish, 1)).toEqual(local(2020, 11, 4));
  });

  test('"only when overlapping" honours lag and start-to-start links when shifting', () => {
    const span = (rowId: string, day: number, days: number) => ({
      rowId,
      allDay: true,
      start: local(2020, 11, day),
      endExclusive: local(2020, 11, day + days),
    });
    const lagged = applyDragDelta(
      geometry,
      { ...span('a', 5, 3), mode: 'move', followers: [{ ...span('b', 9, 2), predecessors: [fs('a', 2)] }] },
      columnWidth * 2
    );

    // a: Nov 7–9 → with a 2-day lag b must start on the 12th.
    expect(lagged.followers[0].start).toEqual(local(2020, 11, 12));

    const startToStart = applyDragDelta(
      geometry,
      {
        ...span('a', 5, 3),
        mode: 'move',
        followers: [
          { ...span('b', 6, 1), predecessors: [{ rowId: 'a', type: TimelineDependencyType.StartToStart, lag: 0 }] },
        ],
      },
      columnWidth * 4
    );

    // a now starts on the 9th; b only has to start with it, not after it.
    expect(startToStart.followers[0].start).toEqual(local(2020, 11, 9));
  });
});

describe('dependencyLinkPath', () => {
  const options = { rowHeight: 36, barInset: 4 };

  test('finish-to-start uses the rounded vertical route', () => {
    const from = { rect: { left: 0, width: 100 }, index: 0 };
    const to = { rect: { left: 160, width: 80 }, index: 2 };

    expect(dependencyLinkPath(TimelineDependencyType.FinishToStart, from, to, options)).toBe(
      dependencyArrowPath(from, to, options)
    );
  });

  test('start-to-start leaves and enters the left edges with a right-pointing head', () => {
    const path = dependencyLinkPath(
      TimelineDependencyType.StartToStart,
      { rect: { left: 100, width: 100 }, index: 0 },
      { rect: { left: 160, width: 80 }, index: 1 },
      options
    );

    expect(path.startsWith('M 100 18 H 82 V 54 H 160')).toBe(true);
    expect(path.endsWith('m -5 -5 l 5 5 l -5 5')).toBe(true);
  });

  test('finish-to-finish enters the right edge with a left-pointing head, detouring when needed', () => {
    const direct = dependencyLinkPath(
      TimelineDependencyType.FinishToFinish,
      { rect: { left: 100, width: 100 }, index: 0 },
      { rect: { left: 40, width: 60 }, index: 1 },
      options
    );

    expect(direct).toBe('M 200 18 H 218 V 54 H 100 m 5 -5 l -5 5 l 5 5');

    const detour = dependencyLinkPath(
      TimelineDependencyType.FinishToFinish,
      { rect: { left: 0, width: 50 }, index: 0 },
      { rect: { left: 100, width: 100 }, index: 1 },
      options
    );

    expect(detour).toBe('M 50 18 H 68 V 36 H 218 V 54 H 200 m 5 -5 l -5 5 l 5 5');
  });

  test('start-to-finish reaches the right edge with a left-pointing head', () => {
    const path = dependencyLinkPath(
      TimelineDependencyType.StartToFinish,
      { rect: { left: 40, width: 60 }, index: 1 },
      { rect: { left: 100, width: 100 }, index: 0 },
      options
    );

    expect(path).toBe('M 40 54 H 22 V 36 H 218 V 18 H 200 m 5 -5 l -5 5 l 5 5');
  });
});
