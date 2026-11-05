import { type VirtualItem } from '@tanstack/react-virtual';
import { useRef } from 'react';

/** Whether two windows hold the same items at the same offsets. */
export function sameVirtualItems(left: readonly VirtualItem[], right: readonly VirtualItem[]) {
  if (left.length !== right.length) return false;

  return left.every((item, position) => {
    const other = right[position];

    return (
      item === other ||
      (item.key === other.key &&
        item.index === other.index &&
        item.start === other.start &&
        item.size === other.size &&
        item.lane === other.lane)
    );
  });
}

/**
 * A virtualizer's items, as the same array for as long as they hold the same
 * items at the same offsets. TanStack builds a new array whenever the visible
 * range moves, even when the overscan already rendered every item in it, so
 * each row that takes the items as a prop would re-render on such a scroll.
 */
export function useStableVirtualItems(items: VirtualItem[]): VirtualItem[] {
  const stableRef = useRef(items);

  if (stableRef.current !== items && !sameVirtualItems(stableRef.current, items)) {
    stableRef.current = items;
  }

  return stableRef.current;
}
