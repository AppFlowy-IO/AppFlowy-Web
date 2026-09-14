import { memo, MutableRefObject, useMemo } from 'react';

import { TIMELINE_BAR_INSET, TIMELINE_ROW_HEIGHT } from './constants';
import { TimelineLinkDrag } from './hooks/useTimelineLinkDrag';
import { DependencyGraph, dependencyLinkPath, linkOf } from './scale/dependencies';
import { BarRect } from './scale/geometry';

export interface TimelineLinkSelection {
  predecessorId: string;
  successorId: string;
  /** Click position in canvas coordinates, where the link editor anchors. */
  x: number;
  y: number;
}

/**
 * The link whose stroke lies under a client point, if any. The arrows sit
 * beneath the rows, so the view calls this from the row canvas's click.
 */
export function hitTestLink(svg: SVGSVGElement | null, clientX: number, clientY: number): TimelineLinkSelection | null {
  if (!svg) return null;
  const bounds = svg.getBoundingClientRect();
  const point = new DOMPoint(clientX - bounds.left, clientY - bounds.top);

  for (const path of Array.from(svg.querySelectorAll<SVGPathElement>('path[data-hit-link]'))) {
    if (!path.isPointInStroke(point)) continue;
    const [predecessorId, successorId] = (path.dataset.hitLink ?? '').split(':');

    if (predecessorId && successorId) return { predecessorId, successorId, x: point.x, y: point.y };
  }

  return null;
}

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
  /** A connector being dragged from a bar's link handle. */
  pending?: TimelineLinkDrag | null;
  /** Exposes the SVG so the view can hit-test clicks against the link strokes. */
  svgRef?: MutableRefObject<SVGSVGElement | null>;
  /** The link currently open in the editor, drawn highlighted. */
  selectedKey?: string;
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
    pending,
    svgRef,
    selectedKey,
  }: TimelineArrowsProps) => {
    const paths = useMemo(() => {
      const indexOf = new Map(rowIds.map((rowId, index) => [rowId, index] as const));
      const result: { key: string; d: string; predecessorId: string; successorId: string }[] = [];

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
            key: `${predecessor}:${rowId}`,
            predecessorId: predecessor,
            successorId: rowId,
            d: dependencyLinkPath(
              linkOf(graph, predecessor, rowId).type,
              { rect: fromRect, index: fromIndex },
              { rect: toRect, index: toIndex },
              { rowHeight: TIMELINE_ROW_HEIGHT, barInset: TIMELINE_BAR_INSET }
            ),
          });
        });
      });

      return result;
    }, [firstVisibleIndex, graph, lastVisibleIndex, rects, rowIds]);

    if (paths.length === 0 && !pending) return null;

    return (
      // Under the bars (and the sticky table), like Notion: cards cover the
      // lines, and the table hides them when the canvas scrolls. Clicks on a
      // line reach the row's canvas, which asks `hitTestLink` about them.
      <svg
        ref={svgRef}
        aria-hidden
        className='pointer-events-none absolute top-0 z-[1] text-icon-secondary'
        style={{ left, width: canvasWidth, height: bodyHeight }}
        width={canvasWidth}
        height={bodyHeight}
        data-testid='timeline-arrows'
      >
        {paths.map((path) => (
          <g key={path.key} className={path.key === selectedKey ? 'text-fill-theme-thick' : undefined}>
            <path
              d={path.d}
              fill='none'
              stroke='currentColor'
              strokeWidth={path.key === selectedKey ? 2 : 1.4}
              data-testid='timeline-arrow'
              data-link={path.key}
            />
            {/* Wide invisible twin used by isPointInStroke when the canvas is clicked. */}
            <path
              d={path.d}
              fill='none'
              stroke='transparent'
              strokeWidth={10}
              data-testid={`timeline-arrow-hit-${path.key}`}
              data-hit-link={path.key}
            />
          </g>
        ))}
        {pending ? (
          <g className='text-fill-theme-thick' data-testid='timeline-link-preview'>
            <path
              d={`M ${pending.from.x} ${pending.from.y} C ${pending.from.x + 24} ${pending.from.y}, ${
                pending.to.x - 24
              } ${pending.to.y}, ${pending.to.x} ${pending.to.y}`}
              fill='none'
              stroke='currentColor'
              strokeWidth={1.5}
              strokeDasharray='4 3'
            />
            <circle cx={pending.to.x} cy={pending.to.y} r={4} fill='currentColor' />
          </g>
        ) : null}
      </svg>
    );
  }
);

TimelineArrows.displayName = 'TimelineArrows';
