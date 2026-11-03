import { overlapArea, positionMapPopover, type MapRect } from '../mindmap-popover';

const bounds: MapRect = { x: 12, y: 12, width: 1376, height: 876 };
const size = { width: 300, height: 240 };
const anchor = { x: 600, y: 350, width: 220, height: 64 };

it('opens immediately beside a left-side node when that space is empty', () => {
  const position = positionMapPopover(anchor, size, bounds, [], 'left');
  expect(position.side).toBe('left');
  expect(position.x + size.width).toBe(anchor.x - 16);
  expect(position.y + position.arrowY).toBe(anchor.y + anchor.height / 2);
});

it('flips above or below when neighboring nodes block both horizontal sides', () => {
  const neighbors = [
    { x: 280, y: 350, width: 300, height: 64 },
    { x: 840, y: 350, width: 300, height: 64 },
  ];
  const position = positionMapPopover(anchor, size, bounds, neighbors, 'left');
  expect(['top', 'bottom']).toContain(position.side);
  for (const obstacle of [...neighbors, anchor]) expect(overlapArea({ ...position, ...size }, obstacle)).toBe(0);
});

it('shifts along a node edge to find a gap while keeping the arrow attached', () => {
  const neighbors = [
    { x: 280, y: 410, width: 300, height: 240 },
    { x: 840, y: 220, width: 300, height: 500 },
    { x: 600, y: 90, width: 220, height: 240 },
    { x: 600, y: 440, width: 220, height: 240 },
  ];
  const position = positionMapPopover(anchor, size, bounds, neighbors, 'left');
  expect(position.side).toBe('left');
  expect(position.y + size.height).toBeLessThanOrEqual(410);
  expect(position.y + position.arrowY).toBe(anchor.y + anchor.height / 2);
  for (const obstacle of [...neighbors, anchor]) expect(overlapArea({ ...position, ...size }, obstacle)).toBe(0);
});

it.each([
  [12, 12],
  [158, 12],
  [12, 744],
  [158, 744],
])('stays on a narrow screen and avoids covering a node at (%s, %s)', (x, y) => {
  const smallBounds = { x: 12, y: 12, width: 366, height: 808 };
  const node = { ...anchor, x, y };
  const position = positionMapPopover(node, size, smallBounds, [], 'left');
  expect(position.x).toBeGreaterThanOrEqual(smallBounds.x);
  expect(position.y).toBeGreaterThanOrEqual(smallBounds.y);
  expect(position.x + size.width).toBeLessThanOrEqual(smallBounds.x + smallBounds.width);
  expect(position.y + size.height).toBeLessThanOrEqual(smallBounds.y + smallBounds.height);
  expect(overlapArea({ ...position, ...size }, node)).toBe(0);
});

it('prioritizes the selected node and stays bounded when every position covers some content', () => {
  const crowded = [{ ...bounds }];
  const position = positionMapPopover(anchor, size, bounds, crowded, 'right');
  expect(overlapArea({ ...position, ...size }, anchor)).toBe(0);
  expect(overlapArea({ ...position, ...size }, bounds)).toBe(size.width * size.height);
  expect(Number.isFinite(position.x + position.y + position.arrowX + position.arrowY)).toBe(true);
});

it('stays attached to a partially clipped node even when nearby content occupies the corner', () => {
  const node = { x: -0.25, y: -0.25, width: 44, height: 13 };
  const neighbors = [{ x: 12, y: 28, width: 400, height: 300 }];
  const position = positionMapPopover(node, size, bounds, neighbors, 'left');
  expect(position.side).toBe('bottom');
  expect(position.y).toBe(node.y + node.height + 16);
  expect(overlapArea({ ...position, ...size }, node)).toBe(0);
});
