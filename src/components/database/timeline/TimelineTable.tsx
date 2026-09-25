import { createContext, ReactNode, UIEvent, useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react';

import { TIMELINE_TABLE_COLUMN_WIDTH } from './constants';

const EMPTY_COLUMN_WIDTHS: ReadonlyMap<string, number> = new Map();

/** Leave room for dates even when every property is shown. */
export function timelineTableViewportWidth(contentWidth: number, availableWidth: number) {
  return Math.min(contentWidth, Math.max(0, availableWidth) * 0.6);
}

interface TableScroll {
  contentWidth: number;
  viewportWidth: number;
  columnWidths: ReadonlyMap<string, number>;
  register: (element: HTMLDivElement) => () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

const TableScrollContext = createContext<TableScroll | null>(null);

/** Sync native horizontal scrolling without re-rendering virtualized rows. */
export function TimelineTableProvider({
  contentWidth,
  viewportWidth,
  columnWidths = EMPTY_COLUMN_WIDTHS,
  children,
}: {
  contentWidth: number;
  viewportWidth: number;
  columnWidths?: ReadonlyMap<string, number>;
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
    () => ({ contentWidth, viewportWidth, columnWidths, register, onScroll }),
    [contentWidth, viewportWidth, columnWidths, register, onScroll]
  );

  return <TableScrollContext.Provider value={value}>{children}</TableScrollContext.Provider>;
}

export function useTimelineTableColumnWidths() {
  return useContext(TableScrollContext)?.columnWidths ?? EMPTY_COLUMN_WIDTHS;
}

export function timelinePropertyColumnWidth(widths: ReadonlyMap<string, number>, fieldId: string) {
  return widths.get(fieldId) ?? TIMELINE_TABLE_COLUMN_WIDTH;
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
