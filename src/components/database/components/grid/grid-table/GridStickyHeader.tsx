import { RenderColumn } from '@/components/database/components/grid/grid-column';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import { cn } from '@/lib/utils';
import { VirtualItem } from '@tanstack/react-virtual';
import React, { forwardRef } from 'react';

const GridStickyHeader = forwardRef<HTMLDivElement, {
  columns: RenderColumn[];
  row: VirtualItem;
  data: RenderRow[];
  totalSize: number,
  columnItems: VirtualItem[];
  onScrollLeft: (left: number) => void,
} & React.HTMLAttributes<HTMLDivElement>>(({
  columns,
  row,
  data,
  totalSize,
  columnItems,
  onScrollLeft,
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
      className={cn('grid-sticky-header flex w-full overflow-x-auto bg-background-primary appflowy-custom-scroller', props.className)}

    >
      <GridVirtualRow
        isSticky
        row={row}
        columns={columns}
        data={data}
        totalSize={totalSize}
        columnItems={columnItems}
      />
    </div>

  );
});

export default GridStickyHeader;