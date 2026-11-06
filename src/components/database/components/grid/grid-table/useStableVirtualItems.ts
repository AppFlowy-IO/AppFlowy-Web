import { type VirtualItem } from '@tanstack/react-virtual';
import { useRef } from 'react';

/** Whether two items are the same item at the same offset, size and lane. */
function samePlacement(item: VirtualItem, other: VirtualItem) {
  return (
    item === other ||
    (item.key === other.key &&
      item.index === other.index &&
      item.start === other.start &&
      item.size === other.size &&
      item.lane === other.lane)
  );
}

/** Whether two windows hold the same items at the same offsets. */
export function sameVirtualItems(left: readonly VirtualItem[], right: readonly VirtualItem[]) {
  return left.length === right.length && left.every((item, position) => samePlacement(item, right[position]));
}

/**
 * A virtualizer's items, as the same array for as long as they hold the same
 * items at the same offsets. TanStack builds a new array whenever the visible
 * range moves, even when the overscan already rendered every item in it, so
 * each row that takes the items as a prop would re-render on such a scroll.
 *
 * Once they differ, each item that kept its place keeps its object: `measure()`
 * rebuilds every item, e.g. when only the New property column's fill changes,
 * and a memoized cell that takes its item as a prop keeps its render.
 */
export function useStableVirtualItems(items: VirtualItem[]): VirtualItem[] {
  const stableRef = useRef(items);
  const previous = stableRef.current;

  if (previous !== items && !sameVirtualItems(previous, items)) {
    const previousByKey = new Map(previous.map((item) => [item.key, item]));

    stableRef.current = items.map((item) => {
      const kept = previousByKey.get(item.key);

      return kept && samePlacement(kept, item) ? kept : item;
    });
  }

  return stableRef.current;
}
