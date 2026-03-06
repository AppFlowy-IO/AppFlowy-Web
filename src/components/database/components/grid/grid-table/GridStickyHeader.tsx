import { VirtualItem } from '@tanstack/react-virtual';
import React, { forwardRef, memo } from 'react';

import { RenderColumn } from '@/components/database/components/grid/grid-column';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import { cn } from '@/lib/utils';

const GridStickyHeader = forwardRef<HTMLDivElement, {
  columns: RenderColumn[];
  row: VirtualItem;
  data: RenderRow[];
  totalSize: number,
  columnItems: VirtualItem[];
  onScrollLeft: (left: number) => void,
  onResizeColumnStart?: (fieldId: string, element: HTMLElement) => void;
} & React.HTMLAttributes<HTMLDivElement>>(({
  columns,
  row,
  data,
  totalSize,
  columnItems,
  onScrollLeft,
  onResizeColumnStart,
  style,
  ...props
}, ref) => {

  return (
    <div
      ref={ref}
      onScroll={e => {
        const scrollLeft = e.currentTarget.scrollLeft;

        onScrollLeft(scrollLeft);
      }}
      {...props}
      style={{
        scrollBehavior: 'auto',
        ...style,
      }}
      className={cn('grid-sticky-header flex border-t border-border-primary absolute left-0 right-0 top-0 overflow-x-auto bg-background-primary appflowy-custom-scroller', props.className)}

    >
      <GridVirtualRow
        isSticky
        row={row}
        columns={columns}
        data={data}
        totalSize={totalSize}
        columnItems={columnItems}
        onResizeColumnStart={onResizeColumnStart}
      />
    </div>

  );
});

export default memo(GridStickyHeader);