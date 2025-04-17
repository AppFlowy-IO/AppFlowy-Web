import GridCell from '@/components/database/components/grid/grid-cell/GridCell';
import { RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import { cn } from '@/lib/utils';
import { VirtualItem } from '@tanstack/react-virtual';
import React, { memo, useMemo } from 'react';

const MIN_HEIGHT = 35;
const borderStyle = '1px solid var(--border-grey-tertiary)';

function GridVirtualColumn ({
  data,
  columns,
  row,
  column,
  onResizeColumnStart,
}: {
  data: RenderRow[];
  columns: RenderColumn[];
  row: VirtualItem;
  column: VirtualItem;
  onResizeColumnStart: (fieldId: string, element: HTMLElement) => void;
}) {
  const rowIndex = row.index;
  const columnData = useMemo(() => columns[column.index], [columns, column.index]);

  return (
    <div
      data-column-id={columnData.fieldId}
      key={column.key}
      className={cn(columnData.wrap ? 'wrap-cell' : 'whitespace-nowrap', 'border-t border-l border-transparent')}
      style={{
        minHeight: rowIndex === 0 ? MIN_HEIGHT : row.size,
        width: columnData.width,
        ...(rowIndex !== data.length - 1 && {
          borderBottom: borderStyle,
        }),
        ...(column.index === 0 || rowIndex === data.length - 1 ? {} : {
          borderLeft: borderStyle,
        }),
        ...(rowIndex === 0 ? {
          borderTop: borderStyle,
        } : {}),
      }}
    >
      <GridCell
        rowIndex={row.index}
        columnIndex={column.index}
        columns={columns}
        data={data}
        onResizeColumnStart={onResizeColumnStart}
      />

    </div>
  );
}

export default memo(GridVirtualColumn);