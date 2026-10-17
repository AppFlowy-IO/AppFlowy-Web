import { createContext, useContext, useLayoutEffect, useState } from 'react';

import { LIST_ROW_ACTIONS_WIDTH, LIST_ROW_NARROW_BREAKPOINT } from './list.constants';

import type { ComponentPropsWithoutRef } from 'react';

/**
 * Desktop's `LayoutBuilder` decides per row whether the trailing properties sit
 * beside the title (wide) or on a second line (narrow). Every row of a List
 * shares one width, so the List measures once and hands the result down.
 */
export type ListRowLayout = 'wide' | 'narrow';

const ListRowLayoutContext = createContext<ListRowLayout>('wide');

export const ListRowLayoutProvider = ListRowLayoutContext.Provider;

export const useListRowLayout = () => useContext(ListRowLayoutContext);

/**
 * `rowWidth` is the row's full width, gutter included (the List content box).
 * An unmeasured width (hidden tab, jsdom) keeps the desktop default.
 */
export function resolveListRowLayout(rowWidth: number): ListRowLayout {
  return rowWidth > 0 && rowWidth - LIST_ROW_ACTIONS_WIDTH < LIST_ROW_NARROW_BREAKPOINT ? 'narrow' : 'wide';
}

function measureContentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);

  return element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

/**
 * Resolves the layout for the rows inside `element` and follows its resizes.
 * The first measurement runs in a layout effect so a narrow screen never
 * paints the wide layout first.
 */
export function useMeasuredListRowLayout(element: HTMLElement | null): ListRowLayout {
  const [layout, setLayout] = useState<ListRowLayout>('wide');

  useLayoutEffect(() => {
    if (!element) return;

    const update = (width: number) => {
      const next = resolveListRowLayout(width);

      setLayout((current) => (current === next ? current : next));
    };

    update(measureContentWidth(element));
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];

      if (entry) update(entry.contentRect.width);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return layout;
}

/**
 * The List content box: measured once for every row it contains. Owning the
 * measurement here keeps its re-render away from the List, so the rows and
 * the sort subscription only re-render when the layout actually flips.
 */
export function ListRowLayoutScope({ children, ...props }: ComponentPropsWithoutRef<'div'>) {
  // Callback ref: the box mounts late (once the row orders resolve) and may remount.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const layout = useMeasuredListRowLayout(element);

  return (
    <div {...props} ref={setElement}>
      <ListRowLayoutProvider value={layout}>{children}</ListRowLayoutProvider>
    </div>
  );
}
