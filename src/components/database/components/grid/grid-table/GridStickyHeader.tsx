import { RenderColumn } from '@/components/database/components/grid/grid-column';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import GridVirtualRow from '@/components/database/components/grid/grid-row/GridVirtualRow';
import { VirtualItem } from '@tanstack/react-virtual';
import React, { forwardRef } from 'react';

const GridStickyHeader = forwardRef<HTMLDivElement, {
  columns: RenderColumn[];
  row: VirtualItem;
  data: RenderRow[];
  totalSize: number,
  columnItems: VirtualItem[];
  onScrollLeft: (left: number) => void,

}>(({
  columns,
  row,
  data,
  totalSize,
  columnItems,
  onScrollLeft,
}, ref) => {
  return (
    <div
      ref={ref}
      onScroll={e => {
        const scrollLeft = e.currentTarget.scrollLeft;

        onScrollLeft(scrollLeft);
      }}
      className={'grid-sticky-header flex w-full overflow-x-auto bg-background-primary appflowy-custom-scroller'}
    >
      <GridVirtualRow
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