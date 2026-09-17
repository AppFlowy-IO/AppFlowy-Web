/**
 * Dependency graph helpers and the arrow routing between bars.
 *
 * The finish-to-start route is adapted from frappe/gantt's
 * `Arrow.calculate_path` (MIT, Copyright (c) 2024 Frappe Technologies Pvt.
 * Ltd.): leave the predecessor toward the successor's row and enter its
 * left edge, looping along the row boundary when there is too little room
 * for a direct turn.
 */
import {
  TimelineDependencyDirection,
  TimelineDependencyLink,
  TimelineDependencyType,
  timelineLinkKey,
} from '@/application/database-yjs';

import { BarRect } from './geometry';

export interface DependencyGraph {
  /** rowId → rows it depends on (must finish before it). */
  predecessors: Map<string, string[]>;
  /** rowId → rows that depend on it. */
  dependents: Map<string, string[]>;
  /** Per-link type and lag by `timelineLinkKey`; absent links are finish-to-start with no lag. */
  links: Record<string, TimelineDependencyLink>;
}

export const DEFAULT_DEPENDENCY_LINK: TimelineDependencyLink = { type: TimelineDependencyType.FinishToStart, lag: 0 };

export function linkOf(graph: DependencyGraph, predecessorId: string, successorId: string): TimelineDependencyLink {
  return graph.links[timelineLinkKey(predecessorId, successorId)] ?? DEFAULT_DEPENDENCY_LINK;
}

export interface BuildDependencyGraphOptions {
  /** Whether `relations` lists each row's predecessors (default) or its successors. */
  direction?: TimelineDependencyDirection;
  links?: Record<string, TimelineDependencyLink>;
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);

  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Build both directions of the graph, ignoring links to rows outside the view. */
export function buildDependencyGraph(
  rowIds: string[],
  relations: Map<string, string[]>,
  options: BuildDependencyGraphOptions = {}
): DependencyGraph {
  const known = new Set(rowIds);
  const predecessors = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  const listsSuccessors = options.direction === TimelineDependencyDirection.Blocking;
  // A cell may repeat an id; each edge is recorded once.
  const seen = new Set<string>();

  rowIds.forEach((rowId) => {
    (relations.get(rowId) ?? []).forEach((other) => {
      if (other === rowId || !known.has(other)) return;
      // A "Blocking" field lists the rows this one precedes; flip the edge.
      const [predecessor, successor] = listsSuccessors ? [rowId, other] : [other, rowId];
      const edge = timelineLinkKey(predecessor, successor);

      if (seen.has(edge)) return;
      seen.add(edge);
      push(predecessors, successor, predecessor);
      push(dependents, predecessor, successor);
    });
  });

  return { predecessors, dependents, links: options.links ?? {} };
}

/** Every row that transitively depends on `rowId` (frappe's `get_all_dependent_tasks`). */
export function collectDependents(rowId: string, graph: DependencyGraph): string[] {
  const seen = new Set<string>();
  const queue = [rowId];

  while (queue.length > 0) {
    const current = queue.shift() as string;

    (graph.dependents.get(current) ?? []).forEach((dependent) => {
      if (seen.has(dependent) || dependent === rowId) return;
      seen.add(dependent);
      queue.push(dependent);
    });
  }

  return Array.from(seen);
}

export interface ArrowEndpoint {
  rect: BarRect;
  /** Row index in the rendered list. */
  index: number;
}

export interface ArrowGeometryOptions {
  rowHeight: number;
  /** Vertical inset of a bar inside its row. */
  barInset: number;
  /** Horizontal clearance used for the loop-back route. */
  padding?: number;
  /** Corner radius of the bends. */
  curve?: number;
}

/** Which bar edge a link leaves and enters, per link type. */
function linkAnchors(type: TimelineDependencyType): { exit: 'start' | 'finish'; entry: 'start' | 'finish' } {
  switch (type) {
    case TimelineDependencyType.StartToStart:
      return { exit: 'start', entry: 'start' };
    case TimelineDependencyType.FinishToFinish:
      return { exit: 'finish', entry: 'finish' };
    case TimelineDependencyType.StartToFinish:
      return { exit: 'start', entry: 'finish' };
    default:
      return { exit: 'finish', entry: 'start' };
  }
}

/**
 * SVG path for a link of any type. Finish-to-start keeps frappe's route; the
 * other types run orthogonally from the exit edge's midpoint to the entry
 * edge, detouring along the row boundary when the direct route would cross
 * either bar. The head points into the entered edge.
 */
export function dependencyLinkPath(
  type: TimelineDependencyType,
  from: ArrowEndpoint,
  to: ArrowEndpoint,
  options: ArrowGeometryOptions
): string {
  if (type === TimelineDependencyType.FinishToStart) return dependencyArrowPath(from, to, options);
  const { rowHeight } = options;
  const padding = options.padding ?? 18;
  const { exit, entry } = linkAnchors(type);
  const rowMid = (index: number) => index * rowHeight + rowHeight / 2;
  const exitX = exit === 'finish' ? from.rect.left + from.rect.width : from.rect.left;
  const exitY = rowMid(from.index);
  const exitClearX = exit === 'finish' ? exitX + padding : exitX - padding;
  const entryX = entry === 'start' ? to.rect.left : to.rect.left + to.rect.width;
  const entryY = rowMid(to.index);
  const entryDir = entry === 'start' ? 1 : -1;
  const head = entry === 'start' ? 'm -5 -5 l 5 5 l -5 5' : 'm 5 -5 l -5 5 l 5 5';
  const direct = Math.sign(entryX - exitClearX) === entryDir || entryX === exitClearX;

  if (direct) {
    return [`M ${exitX} ${exitY}`, `H ${exitClearX}`, `V ${entryY}`, `H ${entryX}`, head].join(' ');
  }

  // Detour: leave along the row boundary nearest the successor, then come back
  // at the entered edge from the correct side.
  const gapY = to.index < from.index ? from.index * rowHeight : (from.index + 1) * rowHeight;
  const entryClearX = entryX - entryDir * padding;

  return [
    `M ${exitX} ${exitY}`,
    `H ${exitClearX}`,
    `V ${gapY}`,
    `H ${entryClearX}`,
    `V ${entryY}`,
    `H ${entryX}`,
    head,
  ].join(' ');
}

/** SVG path from the end of `from` to the start of `to`, including the arrow head. */
export function dependencyArrowPath(from: ArrowEndpoint, to: ArrowEndpoint, options: ArrowGeometryOptions): string {
  const { rowHeight, barInset } = options;
  const padding = options.padding ?? 18;
  const barHeight = rowHeight - barInset * 2;
  const rowTop = (index: number) => index * rowHeight;

  // Stay inside even a very narrow bar, while leaving room for the turn.
  const startX = Math.min(
    from.rect.left + from.rect.width / 2,
    Math.max(from.rect.left + padding, to.rect.left - padding)
  );
  const fromIsBelowTo = from.index > to.index;
  const direction = fromIsBelowTo ? -1 : 1;
  const startY = rowTop(from.index) + barInset + (fromIsBelowTo ? 0 : barHeight);
  const endX = to.rect.left;
  const endY = rowTop(to.index) + rowHeight / 2;
  const clockwise = fromIsBelowTo ? 1 : 0;
  let curve = Math.max(0, options.curve ?? 5);

  if (endX - startX < padding) {
    // Keep the detour between rows, and fit each bend into the available
    // clearance so short bars and upward links never double back.
    const gapY = rowTop(from.index) + (fromIsBelowTo ? 0 : rowHeight);
    const left = Math.min(startX, endX) - padding;

    curve = Math.min(curve, barInset, (startX - left) / 2, (endX - left) / 2, Math.abs(endY - gapY) / 2);
    const curveY = direction * curve;

    return [
      `M ${startX} ${startY}`,
      `V ${gapY - curveY}`,
      `a ${curve} ${curve} 0 0 ${fromIsBelowTo ? 0 : 1} ${-curve} ${curveY}`,
      `H ${left + curve}`,
      `a ${curve} ${curve} 0 0 ${clockwise} ${-curve} ${curveY}`,
      `V ${endY - curveY}`,
      `a ${curve} ${curve} 0 0 ${clockwise} ${curve} ${curveY}`,
      `H ${endX}`,
      'm -5 -5 l 5 5 l -5 5',
    ].join(' ');
  }

  curve = Math.min(curve, (endX - startX) / 2, Math.abs(endY - startY));
  const curveY = direction * curve;

  return [
    `M ${startX} ${startY}`,
    `V ${endY - curveY}`,
    `a ${curve} ${curve} 0 0 ${clockwise} ${curve} ${curveY}`,
    `H ${endX}`,
    'm -5 -5 l 5 5 l -5 5',
  ].join(' ');
}
