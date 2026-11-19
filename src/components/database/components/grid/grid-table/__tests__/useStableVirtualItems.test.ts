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

  it.each([
    ['moves', { start: 120, end: 220 }],
    ['resizes', { size: 140, end: 240 }],
    ['takes another index', { index: 2 }],
    ['takes another lane', { lane: 1 }],
  ])('takes a new array once an item %s, with the objects of the items that did not change', (_label, change) => {
    const first = [item(0), item(1), item(2)];
    const { result, rerender } = renderHook(({ items }) => useStableVirtualItems(items), {
      initialProps: { items: first },
    });
    // `measure()` rebuilt every item, and only the middle one changed.
    const measured = [item(0), item(1, change), item(2)];

    rerender({ items: measured });
    expect(result.current).toEqual(measured);
    expect(result.current[0]).toBe(first[0]);
    expect(result.current[1]).toBe(measured[1]);
    expect(result.current[2]).toBe(first[2]);

    // That window is the stable one from then on.
    const stable = result.current;

    rerender({ items: [item(0), item(1, change), item(2)] });
    expect(result.current).toBe(stable);
  });

  it('keeps the objects of the items that stay while others enter or leave', () => {
    const first = [item(0), item(1)];
    const { result, rerender } = renderHook(({ items }) => useStableVirtualItems(items), {
      initialProps: { items: first },
    });
    // A wider grid: a third item enters, and every item is a new object.
    const wider = [item(0), item(1), item(2)];

    rerender({ items: wider });
    expect(result.current).toEqual(wider);
    expect(result.current[0]).toBe(first[0]);
    expect(result.current[1]).toBe(first[1]);
    expect(result.current[2]).toBe(wider[2]);

    // A sideways scroll: the first item leaves.
    rerender({ items: [item(1), item(2)] });
    expect(result.current).toEqual([item(1), item(2)]);
    expect(result.current[0]).toBe(first[1]);
    expect(result.current[1]).toBe(wider[2]);
  });
});
