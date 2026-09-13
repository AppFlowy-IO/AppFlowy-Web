import { memo, useMemo } from 'react';

import { TIMELINE_BAR_INSET, TIMELINE_ROW_HEIGHT } from './constants';
import { DependencyGraph, dependencyArrowPath } from './scale/dependencies';
import { BarRect } from './scale/geometry';

interface TimelineArrowsProps {
  rowIds: string[];
  rects: (BarRect | null)[];
  graph: DependencyGraph;
  /** Rows currently rendered; arrows touching them are drawn. */
  firstVisibleIndex: number;
  lastVisibleIndex: number;
  canvasWidth: number;
  bodyHeight: number;
  /** Horizontal offset of the canvas inside the body (the sticky sidebar). */
  left: number;
}

/**
 * Dependency arrows drawn as one SVG overlay under the bars. Only pairs that
 * touch the rendered row window are emitted so very long lists stay cheap.
 */
export const TimelineArrows = memo(
  ({
    rowIds,
    rects,
    graph,
    firstVisibleIndex,
    lastVisibleIndex,
    canvasWidth,
    bodyHeight,
    left,
  }: TimelineArrowsProps) => {
    const paths = useMemo(() => {
      const indexOf = new Map(rowIds.map((rowId, index) => [rowId, index] as const));
      const result: { key: string; d: string }[] = [];

      graph.predecessors.forEach((predecessors, rowId) => {
        const toIndex = indexOf.get(rowId);
        const toRect = toIndex === undefined ? null : rects[toIndex];

        if (toIndex === undefined || !toRect) return;
        predecessors.forEach((predecessor) => {
          const fromIndex = indexOf.get(predecessor);
          const fromRect = fromIndex === undefined ? null : rects[fromIndex];

          if (fromIndex === undefined || !fromRect) return;
          const touchesWindow =
            (fromIndex >= firstVisibleIndex && fromIndex <= lastVisibleIndex) ||
            (toIndex >= firstVisibleIndex && toIndex <= lastVisibleIndex);

          if (!touchesWindow) return;
          result.push({
            key: `${predecessor}->${rowId}`,
            d: dependencyArrowPath(
              { rect: fromRect, index: fromIndex },
              { rect: toRect, index: toIndex },
              { rowHeight: TIMELINE_ROW_HEIGHT, barInset: TIMELINE_BAR_INSET }
            ),
          });
        });
      });

      return result;
    }, [firstVisibleIndex, graph, lastVisibleIndex, rects, rowIds]);

    if (paths.length === 0) return null;

    return (
      <svg
        aria-hidden
        className='pointer-events-none absolute top-0 z-[1] text-icon-secondary'
        style={{ left, width: canvasWidth, height: bodyHeight }}
        width={canvasWidth}
        height={bodyHeight}
        data-testid='timeline-arrows'
      >
        {paths.map((path) => (
          <path
            key={path.key}
            d={path.d}
            fill='none'
            stroke='currentColor'
            strokeWidth={1.4}
            data-testid='timeline-arrow'
          />
        ))}
      </svg>
    );
  }
);

TimelineArrows.displayName = 'TimelineArrows';
