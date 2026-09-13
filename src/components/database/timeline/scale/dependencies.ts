/**
 * Dependency graph helpers and the arrow routing between bars.
 *
 * The arrow path is a port of frappe/gantt's `Arrow.calculate_path` (MIT,
 * Copyright (c) 2024 Frappe Technologies Pvt. Ltd.): leave the predecessor
 * from underneath its bar, drop to the successor's row and enter its left
 * edge, looping back with two extra bends when the successor starts before
 * the predecessor ends.
 */
import { BarRect } from './geometry';

export interface DependencyGraph {
  /** rowId → rows it depends on (must finish before it). */
  predecessors: Map<string, string[]>;
  /** rowId → rows that depend on it. */
  dependents: Map<string, string[]>;
}

/** Build both directions of the graph, ignoring links to rows outside the view. */
export function buildDependencyGraph(rowIds: string[], relations: Map<string, string[]>): DependencyGraph {
  const known = new Set(rowIds);
  const predecessors = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();

  rowIds.forEach((rowId) => {
    const linked = (relations.get(rowId) ?? []).filter((id) => id !== rowId && known.has(id));

    if (linked.length === 0) return;
    predecessors.set(rowId, linked);
    linked.forEach((predecessor) => {
      const list = dependents.get(predecessor) ?? [];

      list.push(rowId);
      dependents.set(predecessor, list);
    });
  });

  return { predecessors, dependents };
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
