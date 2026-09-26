import { createContext, ReactNode, UIEvent, useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react';

/** Leave room for dates even when every property is shown. */
export function timelineTableViewportWidth(contentWidth: number, availableWidth: number) {
  return Math.min(contentWidth, Math.max(0, availableWidth) * 0.6);
}

interface TableScroll {
  contentWidth: number;
  viewportWidth: number;
  register: (element: HTMLDivElement) => () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

const TableScrollContext = createContext<TableScroll | null>(null);

/** Sync native horizontal scrolling without re-rendering virtualized rows. */
export function TimelineTableProvider({
  contentWidth,
  viewportWidth,
  children,
}: {
  contentWidth: number;
  viewportWidth: number;
  children: ReactNode;
}) {
  const elements = useRef(new Set<HTMLDivElement>());
  const offset = useRef(0);
  const register = useCallback((element: HTMLDivElement) => {
    elements.current.add(element);
    element.scrollLeft = offset.current;
    return () => {
      elements.current.delete(element);
    };
  }, []);
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollLeft;

    if (next === offset.current) return;
    offset.current = next;
    elements.current.forEach((element) => {
      if (element !== event.currentTarget) element.scrollLeft = next;
    });
  }, []);

  useLayoutEffect(() => {
    offset.current = Math.min(offset.current, Math.max(0, contentWidth - viewportWidth));
    elements.current.forEach((element) => {
      element.scrollLeft = offset.current;
    });
  }, [contentWidth, viewportWidth]);

  const value = useMemo(
    () => ({ contentWidth, viewportWidth, register, onScroll }),
    [contentWidth, viewportWidth, register, onScroll]
  );

  return <TableScrollContext.Provider value={value}>{children}</TableScrollContext.Provider>;
}

export function TimelineTableViewport({ children, scrollbar = false }: { children?: ReactNode; scrollbar?: boolean }) {
  const table = useContext(TableScrollContext);
  const ref = useRef<HTMLDivElement>(null);
  const register = table?.register;
  const visible = !scrollbar || Boolean(table && table.contentWidth > table.viewportWidth);

  useLayoutEffect(() => {
    if (ref.current && register) return register(ref.current);
  }, [register, visible]);

  if (!table) throw new Error('TimelineTableViewport requires TimelineTableProvider');
  if (!visible) return null;

  return (
    <div
      ref={ref}
      className={
        scrollbar
          ? 'appflowy-scroller h-3 shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain'
          : 'sticky left-0 z-10 h-full shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      }
      style={{ width: table.viewportWidth }}
      onScroll={table.onScroll}
      data-testid={scrollbar ? 'timeline-table-scrollbar' : 'timeline-table-viewport'}
    >
      <div className={scrollbar ? 'h-px' : 'h-full'} style={{ width: table.contentWidth }}>
        {children}
      </div>
    </div>
  );
}
