import {
  collapseBranches,
  expandBranch,
  indexMap,
  initialCollapsed,
  layoutMap,
  mapBranchPath,
  MAP_NODE_WIDTH,
  MAP_NODE_HEIGHT,
  type MapStructure,
} from '../mindmap-layout';
import type { MindMap } from '../types';

const map: MindMap = {
  warnings: [],
  nodes: [
    ['root', null],
    ['a', 'root'],
    ['a1', 'a'],
    ['a2', 'a'],
    ['a11', 'a1'],
    ['b', 'root'],
    ['b1', 'b'],
    ['c', 'root'],
    ['c1', 'c'],
  ].map(([id, parentId]) => ({ id: id!, parentId, label: id!, summary: '', sourceIds: ['source'] })),
};
const index = indexMap(map);

const wrappedMap: MindMap = {
  ...map,
  nodes: [
    map.nodes[0],
    { ...map.nodes[0], id: 'title', parentId: 'root', label: 'Document title' },
    { ...map.nodes[0], id: 'section', parentId: 'title', label: 'Main section' },
    ...map.nodes.slice(1).map((node) => ({ ...node, parentId: node.parentId === 'root' ? 'section' : node.parentId })),
  ],
};

it('balances the first branching section beneath a single-heading chain without losing hierarchy or content', () => {
  const wrapped = indexMap(wrappedMap);
  const before = JSON.stringify(wrappedMap);
  const layout = layoutMap(wrapped, new Set());
  const positions = new Map(layout.positions.map((p) => [p.node.id, p]));
  const root = positions.get('root')!;
  const title = positions.get('title')!;
  const section = positions.get('section')!;
  const branches = ['a', 'b', 'c'].map((id) => positions.get(id)!);
  expect(branches.some((p) => p.x < root.x)).toBe(true);
  expect(branches.some((p) => p.x > root.x)).toBe(true);
  expect(root.x).toBe(title.x);
  expect(title.x).toBe(section.x);
  expect(root.y + MAP_NODE_HEIGHT).toBeLessThan(title.y);
  expect(title.y + MAP_NODE_HEIGHT).toBeLessThan(section.y);
  expect(layout.positions).toHaveLength(wrappedMap.nodes.length);
  expect(JSON.stringify(wrappedMap)).toBe(before);
  for (const p of layout.positions) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + MAP_NODE_WIDTH).toBeLessThanOrEqual(layout.width);
    expect(p.y + MAP_NODE_HEIGHT).toBeLessThanOrEqual(layout.height);
    for (const other of layout.positions) {
      if (p === other) continue;
      expect(Math.abs(p.x - other.x) >= MAP_NODE_WIDTH || Math.abs(p.y - other.y) >= MAP_NODE_HEIGHT).toBe(true);
    }
  }
  for (const line of ['rounded', 'curved'] as const) {
    const path = mapBranchPath(root, title, 'balanced', line);
    expect(path).toMatch(new RegExp(`^M ${root.x + MAP_NODE_WIDTH / 2} ${root.y + MAP_NODE_HEIGHT} `));
    expect(path).toMatch(new RegExp(`${title.x + MAP_NODE_WIDTH / 2} ${title.y}$`));
  }
  for (const collapsed of [new Set(['a']), new Set(['title']), new Set(['section']), new Set(['root'])]) {
    const folded = layoutMap(wrapped, collapsed);
    for (const p of folded.positions) expect(p.side).toBe(positions.get(p.node.id)!.side);
    const reopened = layoutMap(wrapped, expandBranch(wrapped, collapsed, 'root'));
    expect(reopened.positions).toEqual(layout.positions);
  }
  const drilled = layoutMap(wrapped, new Set(), 'title');
  const hub = drilled.positions.find((p) => p.node.id === 'section')!;
  expect(drilled.positions.some((p) => p.x < hub.x)).toBe(true);
  expect(drilled.positions.some((p) => p.x > hub.x)).toBe(true);
  expect(drilled.positions.some((p) => p.node.id === 'root')).toBe(false);
});

it('keeps an unbranched chain intact and preserves single-sided and top-down layouts', () => {
  const chain: MindMap = { ...wrappedMap, nodes: wrappedMap.nodes.slice(0, 3) };
  const linear = layoutMap(indexMap(chain), new Set());
  expect(linear.positions).toHaveLength(3);
  expect(linear.positions.every((p) => p.y === linear.positions[0].y)).toBe(true);
  for (const structure of ['left', 'right', 'down'] as const) {
    const layout = layoutMap(indexMap(wrappedMap), new Set(), undefined, structure);
    const positions = new Map(layout.positions.map((p) => [p.node.id, p]));
    for (const child of layout.positions) {
      const parent = positions.get(child.node.parentId ?? '');
      if (!parent) continue;
      if (structure === 'down') expect(child.y).toBeGreaterThan(parent.y + MAP_NODE_HEIGHT);
      else if (structure === 'left') expect(child.x + MAP_NODE_WIDTH).toBeLessThan(parent.x);
      else expect(child.x).toBeGreaterThan(parent.x + MAP_NODE_WIDTH);
    }
  }
});

it('keeps branches on their original sides when collapsed and isolates a drilled branch', () => {
  const full = layoutMap(index, new Set());
  const folded = layoutMap(index, new Set(['a']));
  for (const position of folded.positions) {
    const original = full.positions.find((p) => p.node.id === position.node.id)!;
    expect(position.side).toBe(original.side);
  }
  const drilled = layoutMap(index, new Set(), 'a');
  expect(drilled.positions.map((p) => p.node.id).sort()).toEqual(['a', 'a1', 'a11', 'a2']);
});

it('counts all hidden descendants and expands nested folds without changing other branches', () => {
  expect(index.descendants.get('a')).toHaveLength(3);
  const collapsed = new Set(['a', 'a1', 'b']);
  const expanded = expandBranch(index, collapsed, 'a');
  expect(expanded).toEqual(new Set(['b']));
  expect(collapsed).toEqual(new Set(['a', 'a1', 'b']));
  expect(layoutMap(index, expanded).positions.map((p) => p.node.id)).toContain('a11');
});

it('collapses all to the current root and its immediate children, including when drilled into a branch', () => {
  const folded = collapseBranches(index, new Set(['root']), 'root');
  expect(
    layoutMap(index, folded)
      .positions.map((p) => p.node.id)
      .sort()
  ).toEqual(['a', 'b', 'c', 'root']);
  const branch = collapseBranches(index, new Set(['b']), 'a');
  expect(
    layoutMap(index, branch, 'a')
      .positions.map((p) => p.node.id)
      .sort()
  ).toEqual(['a', 'a1', 'a2']);
  expect(branch.has('b')).toBe(true);
});

it('keeps all nodes recoverable when the initial visible-node budget is exceeded', () => {
  const large: MindMap = {
    warnings: [],
    nodes: [
      map.nodes[0],
      ...Array.from({ length: 149 }, (_, i) => ({
        id: `leaf-${i}`,
        parentId: 'root',
        label: `Leaf ${i}`,
        summary: '',
        sourceIds: ['source'],
      })),
    ],
  };
  const largeIndex = indexMap(large);
  expect(layoutMap(largeIndex, initialCollapsed(largeIndex)).positions).toHaveLength(1);
  expect(largeIndex.descendants.get('root')).toHaveLength(149);
  expect(layoutMap(largeIndex, expandBranch(largeIndex, initialCollapsed(largeIndex), 'root')).positions).toHaveLength(
    150
  );
});

describe.each<MapStructure>(['right', 'left', 'balanced', 'down'])('%s structure', (structure) => {
  it('keeps every node inside the canvas without overlapping and grows in the selected direction', () => {
    for (const [collapsed, focused] of [
      [new Set<string>(), undefined],
      [new Set(['a1']), 'a'],
    ] as const) {
      const layout = layoutMap(index, collapsed, focused, structure);
      const positions = new Map(layout.positions.map((position) => [position.node.id, position]));
      expect(layout.positions).toHaveLength(focused ? 3 : map.nodes.length);
      for (const position of layout.positions) {
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.x + MAP_NODE_WIDTH).toBeLessThanOrEqual(layout.width);
        expect(position.y + MAP_NODE_HEIGHT).toBeLessThanOrEqual(layout.height);
        for (const other of layout.positions) {
          if (position === other) continue;
          expect(
            Math.abs(position.x - other.x) >= MAP_NODE_WIDTH || Math.abs(position.y - other.y) >= MAP_NODE_HEIGHT
          ).toBe(true);
        }
        const parent = positions.get(position.node.parentId ?? '');
        if (!parent) continue;
        if (structure === 'down') expect(position.y).toBeGreaterThan(parent.y + MAP_NODE_HEIGHT);
        else if (structure === 'left') expect(position.x + MAP_NODE_WIDTH).toBeLessThan(parent.x);
        else if (structure === 'right') expect(position.x).toBeGreaterThan(parent.x + MAP_NODE_WIDTH);
        else expect(Math.sign(position.x - parent.x)).toBe(position.side);
        // Both branch styles must terminate on the same two node edges.
        const curved = mapBranchPath(parent, position, structure, 'curved');
        const rounded = mapBranchPath(parent, position, structure, 'rounded');
        expect(curved).not.toMatch(/NaN|Infinity/);
        expect(rounded).not.toMatch(/NaN|Infinity/);
        expect(curved.split(' ').slice(0, 3)).toEqual(rounded.split(' ').slice(0, 3));
        expect(curved.split(' ').slice(-2)).toEqual(rounded.split(' ').slice(-2));
        expect(curved).toContain(' C ');
        expect(rounded).not.toContain(' C ');
      }
    }
  });

  it('keeps usable bounds for a lone root after collapsing the whole map', () => {
    const layout = layoutMap(index, new Set(['root']), undefined, structure);
    expect(layout.positions).toHaveLength(1);
    expect(layout.width).toBeGreaterThan(MAP_NODE_WIDTH);
    expect(layout.height).toBeGreaterThan(MAP_NODE_HEIGHT);
  });
});
