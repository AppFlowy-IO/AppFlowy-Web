export type MapRect = { x: number; y: number; width: number; height: number };
export type MapPopoverSide = 'left' | 'right' | 'top' | 'bottom';

const gap = 16;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function overlapArea(a: MapRect, b: MapRect) {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}

/** Keep the card attached to its node; prefer empty space over a fixed side. */
export function positionMapPopover(
  anchor: MapRect,
  size: { width: number; height: number },
  bounds: MapRect,
  obstacles: MapRect[],
  preferred: MapPopoverSide
) {
  const width = Math.min(size.width, bounds.width);
  const height = Math.min(size.height, bounds.height);
  const centerX = anchor.x + anchor.width / 2;
  const centerY = anchor.y + anchor.height / 2;
  const sides = [preferred, ...(['left', 'right', 'top', 'bottom'] as const).filter((side) => side !== preferred)];
  const padded = obstacles.map((rect) => ({
    x: rect.x - 4,
    y: rect.y - 4,
    width: rect.width + 8,
    height: rect.height + 8,
  }));
  const candidates: { x: number; y: number; side: MapPopoverSide; detached: number; score: number }[] = [];

  for (const [rank, side] of sides.entries()) {
    const horizontal = side === 'left' || side === 'right';
    const crossSize = horizontal ? height : width;
    const center = horizontal ? centerY : centerX;
    const low = horizontal ? bounds.y : bounds.x;
    const high = low + (horizontal ? bounds.height : bounds.width) - crossSize;
    const visibleCenter = clamp(center, low + gap, high + crossSize - gap);
    // Shifting along an edge is allowed only while the arrow can point at the node.
    const crossMin = Math.max(low, visibleCenter - crossSize + gap);
    const crossMax = Math.min(high, visibleCenter - gap);
    const shifts = [center - crossSize / 2, center - gap, center - crossSize + gap];

    for (const rect of padded) {
      const start = horizontal ? rect.y : rect.x;
      const end = start + (horizontal ? rect.height : rect.width);

      shifts.push(start - crossSize, end);
    }

    for (const shift of new Set(shifts)) {
      const cross = crossMin <= crossMax ? clamp(shift, crossMin, crossMax) : clamp(shift, low, high);
      const x = clamp(
        horizontal ? (side === 'left' ? anchor.x - width - gap : anchor.x + anchor.width + gap) : cross,
        bounds.x,
        bounds.x + bounds.width - width
      );
      const y = clamp(
        horizontal ? cross : side === 'top' ? anchor.y - height - gap : anchor.y + anchor.height + gap,
        bounds.y,
        bounds.y + bounds.height - height
      );
      const rect = { x, y, width, height };
      const covered = padded.reduce((area, obstacle) => area + overlapArea(rect, obstacle), 0);
      const distance = Math.abs((horizontal ? y + height / 2 : x + width / 2) - center);
      const crossStart = horizontal ? anchor.y : anchor.x;
      const crossEnd = crossStart + (horizontal ? anchor.height : anchor.width);
      const arrow = horizontal ? y + clamp(centerY - y, gap, height - gap) : x + clamp(centerX - x, gap, width - gap);
      const wrongSide =
        side === 'left'
          ? x + width - anchor.x
          : side === 'right'
          ? anchor.x + anchor.width - x
          : side === 'top'
          ? y + height - anchor.y
          : anchor.y + anchor.height - y;

      candidates.push({
        x,
        y,
        side,
        detached: Math.max(0, wrongSide) + Math.max(0, crossStart - arrow, arrow - crossEnd),
        score: overlapArea(rect, anchor) * 1000 + covered + distance * 0.01 + rank * 0.001,
      });
    }
  }

  const best = candidates.reduce((a, b) =>
    b.detached < a.detached || (b.detached === a.detached && b.score < a.score) ? b : a
  );

  return {
    x: best.x,
    y: best.y,
    side: best.side,
    arrowX: clamp(centerX - best.x, gap, width - gap),
    arrowY: clamp(centerY - best.y, gap, height - gap),
  };
}
