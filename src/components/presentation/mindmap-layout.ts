import { MapNode, MindMap } from './types';

export function indexMap(map: MindMap) {
  const byId = new Map(map.nodes.map((node) => [node.id, node]));
  const children = new Map<string, MapNode[]>();
  const sourceNumbers = new Map<string, number>();

  for (const node of map.nodes) {
    // Number the complete map once, independent of visible branches or drill-down.
    for (const id of node.sourceIds) {
      if (!sourceNumbers.has(id)) sourceNumbers.set(id, sourceNumbers.size + 1);
    }

    if (node.parentId) {
      const siblings = children.get(node.parentId) ?? [];

      siblings.push(node);
      children.set(node.parentId, siblings);
    }
  }

  const root = map.nodes.find((node) => node.parentId === null)!;
  const descendants = new Map<string, string[]>();

  function visit(node: MapNode): string[] {
    const ids = (children.get(node.id) ?? []).flatMap((child) => [child.id, ...visit(child)]);

    descendants.set(node.id, ids);
    return ids;
  }

  visit(root);
  return { byId, children, root, descendants, sourceNumbers };
}

export type MapIndex = ReturnType<typeof indexMap>;
export type MapStructure = 'right' | 'left' | 'balanced' | 'down';
export type MapBranchLine = 'rounded' | 'curved';
export const MAP_NODE_WIDTH = 220;
export const MAP_NODE_HEIGHT = 64;

export type MapPosition = {
  node: MapNode;
  x: number;
  y: number;
  // Zero is the vertical center chain leading to a two-sided branch point.
  side: number;
  depth: number;
  descendantCount: number;
};

export function layoutMap(
  index: MapIndex,
  collapsed: Set<string>,
  focused?: string,
  structure: MapStructure = 'balanced'
) {
  const { children, descendants } = index;
  const root = (focused && index.byId.get(focused)) || index.root;
  const positions: MapPosition[] = [];
  const stem = [root];

  if (structure === 'balanced') {
    // Documents often have one title heading above all sections. Keep that
    // chain in the center, then split at its first fork instead of putting
    // the entire document on one side. Use the full tree so folding is stable.
    let next = children.get(root.id) ?? [];

    while (next.length === 1) {
      stem.push(next[0]);
      next = children.get(next[0].id) ?? [];
    }

    if (!next.length) stem.splice(1); // A linear chain has no branches to split.
  }

  const foldedAt = stem.findIndex((node) => collapsed.has(node.id));
  const visibleStem = foldedAt < 0 ? stem : stem.slice(0, foldedAt + 1);
  const branchRoot = visibleStem[visibleStem.length - 1];
  const visibleChildren = (node: MapNode) => (collapsed.has(node.id) ? [] : children.get(node.id) ?? []);
  const leafCount = (node: MapNode, visible: boolean): number => {
    const list = visible ? visibleChildren(node) : children.get(node.id) ?? [];

    return list.length ? list.reduce((total, child) => total + leafCount(child, visible), 0) : 1;
  };

  const sides: MapNode[][] = [[], []];
  const fullCounts = [0, 0];
  const counts = [0, 0];

  for (const child of visibleChildren(branchRoot)) {
    // Balance using the full tree so collapsing a branch never flips siblings
    // to the opposite side of the root.
    const side = structure === 'left' || (structure === 'balanced' && fullCounts[0] <= fullCounts[1]) ? 0 : 1;

    sides[side].push(child);
    fullCounts[side] += leafCount(child, false);
    counts[side] += leafCount(child, true);
  }

  const rows = Math.max(1, ...counts);
  const vertical = structure === 'down';
  const laneGap = vertical ? 260 : 90;
  const depthGap = vertical ? 152 : 300;
  const add = (node: MapNode, x: number, y: number, side: number, depth: number) => {
    positions.push({
      node,
      x: vertical ? y : x,
      y: vertical ? x : y,
      side,
      depth,
      descendantCount: descendants.get(node.id)!.length,
    });
  };

  function layoutSide(branches: MapNode[], direction: number, count: number) {
    let row = 0;

    function visit(node: MapNode, depth: number): number {
      const ys = visibleChildren(node).map((child) => visit(child, depth + 1));
      const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : (row++ + (rows - count) / 2) * laneGap;

      add(node, direction * depth * depthGap, y, direction, depth + visibleStem.length - 1);
      return y;
    }

    branches.forEach((node) => visit(node, 1));
  }

  layoutSide(sides[0], -1, counts[0]);
  layoutSide(sides[1], 1, counts[1]);
  visibleStem.forEach((node, depth) =>
    add(
      node,
      0,
      ((rows - 1) * laneGap) / 2 - (visibleStem.length - depth - 1) * 152,
      depth < stem.length - 1 ? 0 : structure === 'left' ? -1 : 1,
      depth
    )
  );
  const minX = Math.min(...positions.map((p) => p.x));
  const maxX = Math.max(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));
  const maxY = Math.max(...positions.map((p) => p.y));

  positions.forEach((p) => {
    p.x += 40 - minX;
    p.y += 40 - minY;
  });
  return {
    root,
    positions,
    width: maxX - minX + MAP_NODE_WIDTH + 80,
    height: Math.max(400, maxY - minY + MAP_NODE_HEIGHT + 80),
  };
}

/** Connect node edges along the layout's growth axis, including left-facing trees. */
export function mapBranchPath(parent: MapPosition, child: MapPosition, structure: MapStructure, line: MapBranchLine) {
  const vertical = structure === 'down' || (parent.side === 0 && parent.x === child.x);
  const direction = vertical || child.x > parent.x ? 1 : -1;
  const start = vertical ? parent.y + MAP_NODE_HEIGHT : parent.x + (direction > 0 ? MAP_NODE_WIDTH : 0);
  const end = vertical ? child.y : child.x + (direction > 0 ? 0 : MAP_NODE_WIDTH);
  const from = vertical ? parent.x + MAP_NODE_WIDTH / 2 : parent.y + MAP_NODE_HEIGHT / 2;
  const to = vertical ? child.x + MAP_NODE_WIDTH / 2 : child.y + MAP_NODE_HEIGHT / 2;
  const middle = (start + end) / 2;
  const point = (axis: number, cross: number) => (vertical ? `${cross} ${axis}` : `${axis} ${cross}`);

  if (line === 'curved') {
    return `M ${point(start, from)} C ${point(middle, from)}, ${point(middle, to)}, ${point(end, to)}`;
  }

  if (from === to) return `M ${point(start, from)} L ${point(end, to)}`;
  const crossDirection = Math.sign(to - from);
  const radius = Math.min(12, Math.abs(to - from) / 2, Math.abs(end - start) / 4);

  return [
    `M ${point(start, from)} L ${point(middle - direction * radius, from)}`,
    `Q ${point(middle, from)} ${point(middle, from + crossDirection * radius)}`,
    `L ${point(middle, to - crossDirection * radius)}`,
    `Q ${point(middle, to)} ${point(middle + direction * radius, to)}`,
    `L ${point(end, to)}`,
  ].join(' ');
}

export function expandBranch(index: MapIndex, collapsed: Set<string>, id: string) {
  const next = new Set(collapsed);

  [id, ...(index.descendants.get(id) ?? [])].forEach((nodeId) => next.delete(nodeId));
  return next;
}

export function collapseBranches(index: MapIndex, collapsed: Set<string>, rootId: string) {
  const next = new Set(collapsed);

  next.delete(rootId);
  for (const id of index.descendants.get(rootId) ?? []) {
    if (index.children.has(id)) next.add(id);
  }

  return next;
}

export function initialCollapsed(index: MapIndex) {
  const collapsed = new Set<string>();

  [...index.byId.values()].slice(80).forEach((node) => {
    if (node.parentId && index.byId.get(node.parentId)?.parentId) collapsed.add(node.parentId);
  });
  if (layoutMap(index, collapsed).positions.length > 80) collapsed.add(index.root.id);
  return collapsed;
}
