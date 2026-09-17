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
  groupIds?: (string | undefined)[];
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
    groupIds,
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
      const indicesOf = new Map<string, number[]>();

      rowIds.forEach((rowId, index) => {
        if (!rowId || !rects[index]) return;
        const indices = indicesOf.get(rowId) ?? [];

        indices.push(index);
        indicesOf.set(rowId, indices);
      });
      const result: { key: string; linkKey: string; d: string; predecessorId: string; successorId: string }[] = [];

      graph.predecessors.forEach((predecessors, rowId) => {
        const toIndices = indicesOf.get(rowId) ?? [];

        predecessors.forEach((predecessor) => {
          const fromIndices = indicesOf.get(predecessor) ?? [];

          if (fromIndices.length === 0) return;
          toIndices.forEach((toIndex) => {
            // Prefer the occurrence in this group. For cross-group links, use
            // the nearest occurrence, so one dependency never fans out into
            // every combination of duplicated rows.
            const fromIndex = fromIndices.reduce((nearest, candidate) => {
              const nearestGroup = groupIds?.[nearest] === groupIds?.[toIndex];
              const candidateGroup = groupIds?.[candidate] === groupIds?.[toIndex];

              if (nearestGroup !== candidateGroup) return candidateGroup ? candidate : nearest;
              return Math.abs(candidate - toIndex) < Math.abs(nearest - toIndex) ? candidate : nearest;
            });
            const fromRect = rects[fromIndex];
            const toRect = rects[toIndex];
            const touchesWindow =
              (fromIndex >= firstVisibleIndex && fromIndex <= lastVisibleIndex) ||
              (toIndex >= firstVisibleIndex && toIndex <= lastVisibleIndex);

            if (!fromRect || !toRect || !touchesWindow) return;
            result.push({
              key: `${predecessor}:${rowId}:${fromIndex}:${toIndex}`,
              linkKey: `${predecessor}:${rowId}`,
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
      });

      return result;
    }, [firstVisibleIndex, graph, groupIds, lastVisibleIndex, rects, rowIds]);

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
          <g key={path.key} className={path.linkKey === selectedKey ? 'text-fill-theme-thick' : undefined}>
            <path
              d={path.d}
              fill='none'
              stroke='currentColor'
              strokeWidth={path.linkKey === selectedKey ? 2 : 1.4}
              data-testid='timeline-arrow'
              data-link={path.linkKey}
            />
            {/* Wide invisible twin used by isPointInStroke when the canvas is clicked. */}
            <path
              d={path.d}
              fill='none'
              stroke='transparent'
              strokeWidth={10}
              data-testid={`timeline-arrow-hit-${path.linkKey}`}
              data-hit-link={path.linkKey}
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
