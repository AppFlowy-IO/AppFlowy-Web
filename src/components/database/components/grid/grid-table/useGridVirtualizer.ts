import { PADDING_END, useDatabaseContext } from '@/application/database-yjs';
import { RenderColumn } from '@/components/database/components/grid/grid-column';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import { getScrollParent } from '@/components/global-comment/utils';
import { useVirtualizer } from '@tanstack/react-virtual';
import React, { useCallback } from 'react';

const MIN_HEIGHT = 36;

export const PADDING_INLINE = 96;

export function useGridVirtualizer ({
  data,
  columns,
}: {
  columns: RenderColumn[];
  data: RenderRow[];
}) {
  const parentRef = React.useRef<HTMLDivElement | null>(null);

  const parentOffsetRef = React.useRef(0);

  React.useLayoutEffect(() => {
    parentOffsetRef.current = parentRef.current?.getBoundingClientRect()?.top ?? 0;
  }, []);

  const virtualizer = useVirtualizer({
    count: data.length,
    estimateSize: () => MIN_HEIGHT,
    overscan: 5,
    scrollMargin: parentOffsetRef.current,
    getScrollElement: () => {
      if (!parentRef.current) return null;
      return parentRef.current.closest('.appflowy-scroll-container') || getScrollParent(parentRef.current);
    },
    paddingStart: 0,
    paddingEnd: PADDING_END,
  });

  const getColumn = useCallback((index: number) => columns[index], [columns]);
  const getColumnWidth = useCallback((index: number) => getColumn(index).width, [getColumn]);

  const {
    paddingStart,
    paddingEnd,
  } = useDatabaseContext();

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: getColumnWidth,
    overscan: 5,
    paddingStart: paddingStart || PADDING_INLINE,
    paddingEnd: paddingEnd || PADDING_INLINE,
  });

  return {
    parentRef,
    virtualizer,
    columnVirtualizer,
    scrollMarginTop: parentOffsetRef.current,
  };
}