/**
 * Dependency graph helpers and the arrow routing between bars.
 *
 * The arrow path is a port of frappe/gantt's `Arrow.calculate_path` (MIT,
 * Copyright (c) 2024 Frappe Technologies Pvt. Ltd.): leave the predecessor
 * from underneath its bar, drop to the successor's row and enter its left
 * edge, looping back with two extra bends when the successor starts before
 * the predecessor ends.
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

function pushUnique(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key) ?? [];

  if (!list.includes(value)) list.push(value);
  map.set(key, list);
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

  rowIds.forEach((rowId) => {
    const linked = (relations.get(rowId) ?? []).filter((id) => id !== rowId && known.has(id));

    linked.forEach((other) => {
      // A "Blocking" field lists the rows this one precedes; flip the edge.
      const [predecessor, successor] = listsSuccessors ? [rowId, other] : [other, rowId];

      pushUnique(predecessors, successor, predecessor);
      pushUnique(dependents, predecessor, successor);
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
  // The head tip sits 13px outside the entered edge, as in the finish-to-start route.
  const entryX = entry === 'start' ? to.rect.left - 13 : to.rect.left + to.rect.width + 13;
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

  let startX = from.rect.left + from.rect.width / 2;

  // Walk the exit point left until the successor's start is reachable.
  while (to.rect.left < startX + padding && startX > from.rect.left + padding) {
    startX -= 10;
  }

  startX -= 10;
  const startY = rowTop(from.index) + barInset + barHeight;
  const endX = to.rect.left - 13;
  const endY = rowTop(to.index) + rowHeight / 2;
  const fromIsBelowTo = from.index > to.index;
  const clockwise = fromIsBelowTo ? 1 : 0;
  let curve = options.curve ?? 5;
  let curveY = fromIsBelowTo ? -curve : curve;

  if (to.rect.left <= from.rect.left + padding) {
    let down1 = padding / 2 - curve;

    if (down1 < 0) {
      down1 = 0;
      curve = padding / 2;
      curveY = fromIsBelowTo ? -curve : curve;
    }

    const down2 = rowTop(to.index) + barInset + barHeight / 2 - curveY;
    const left = to.rect.left - padding;

    return [
      `M ${startX} ${startY}`,
      `v ${down1}`,
      `a ${curve} ${curve} 0 0 1 ${-curve} ${curve}`,
      `H ${left}`,
      `a ${curve} ${curve} 0 0 ${clockwise} ${-curve} ${curveY}`,
      `V ${down2}`,
      `a ${curve} ${curve} 0 0 ${clockwise} ${curve} ${curveY}`,
      `L ${endX} ${endY}`,
      'm -5 -5 l 5 5 l -5 5',
    ].join(' ');
  }

  if (endX < startX + curve) curve = endX - startX;
  const offset = fromIsBelowTo ? endY + curve : endY - curve;

  return [
    `M ${startX} ${startY}`,
    `V ${offset}`,
    `a ${curve} ${curve} 0 0 ${clockwise} ${curve} ${curve}`,
    `L ${endX} ${endY}`,
    'm -5 -5 l 5 5 l -5 5',
  ].join(' ');
}
