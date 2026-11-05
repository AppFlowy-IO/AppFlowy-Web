import { type VirtualItem } from '@tanstack/react-virtual';
import { renderHook } from '@testing-library/react';

import { sameVirtualItems, useStableVirtualItems } from '../useStableVirtualItems';

function item(index: number, overrides: Partial<VirtualItem> = {}): VirtualItem {
  return { key: `field-${index}`, index, start: index * 100, end: (index + 1) * 100, size: 100, lane: 0, ...overrides };
}

describe('sameVirtualItems', () => {
  it('compares items by what they place, not by identity', () => {
    expect(sameVirtualItems([item(0), item(1)], [item(0), item(1)])).toBe(true);
    expect(sameVirtualItems([], [])).toBe(true);
  });

  it.each([
    ['another length', [item(0), item(1), item(2)]],
    ['another key', [item(0), item(1, { key: 'renamed' })]],
    ['another index', [item(0), item(1, { index: 2 })]],
    ['another offset', [item(0), item(1, { start: 120, end: 220 })]],
    ['another size', [item(0), item(1, { size: 140, end: 240 })]],
    ['another lane', [item(0), item(1, { lane: 1 })]],
  ])('tells apart a window with %s', (_label, other) => {
    expect(sameVirtualItems([item(0), item(1)], other)).toBe(false);
  });
});

describe('useStableVirtualItems', () => {
  it('keeps the first array while new arrays hold the same items', () => {
    const first = [item(0), item(1)];
    const { result, rerender } = renderHook(({ items }) => useStableVirtualItems(items), {
      initialProps: { items: first },
    });

    // TanStack's new array after the visible range moved: the same item objects.
    rerender({ items: [...first] });
    expect(result.current).toBe(first);
    // Rebuilt measurements: new objects with the same placement.
    rerender({ items: [item(0), item(1)] });
    expect(result.current).toBe(first);
  });

  it('takes the new array once an item moves, resizes, enters or leaves', () => {
    const first = [item(0), item(1)];
    const { result, rerender } = renderHook(({ items }) => useStableVirtualItems(items), {
      initialProps: { items: first },
    });
    const resized = [item(0), item(1, { size: 160, end: 260 })];

    rerender({ items: resized });
    expect(result.current).toBe(resized);

    const scrolled = [item(1, { size: 160, end: 260 }), item(2, { start: 260, end: 360 })];

    rerender({ items: scrolled });
    expect(result.current).toBe(scrolled);

    const narrower = [scrolled[0]];

    rerender({ items: narrower });
    expect(result.current).toBe(narrower);
  });
});
