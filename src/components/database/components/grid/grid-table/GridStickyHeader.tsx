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
  columnItems: VirtualItem[]
}>(({
  columns,
  row,
  data,
  totalSize,
  columnItems,
}, ref) => {
  return (
    <div
      ref={ref}
      className={'flex w-full overflow-x-auto bg-background-primary appflowy-custom-scroller'}
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