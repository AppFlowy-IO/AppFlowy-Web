import { RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRow } from '@/components/database/components/grid/grid-row';
import RowCell from '@/components/database/components/grid/grid-row/RowCell';
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
}: {
  data: RenderRow[];
  columns: RenderColumn[];
  row: VirtualItem;
  column: VirtualItem;
}) {
  const rowIndex = row.index;
  const columnData = useMemo(() => columns[column.index], [columns, column.index]);

  return (
    <div
      data-field-id={columnData.fieldId}
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
      <RowCell
        rowIndex={row.index}
        columnIndex={column.index}
        columns={columns}
        data={data}
      />

    </div>
  );
}

export default memo(GridVirtualColumn);