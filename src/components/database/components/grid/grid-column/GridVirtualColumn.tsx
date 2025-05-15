import { FieldType, useReadOnly } from '@/application/database-yjs';
import OpenAction from '@/components/database/components/database-row/OpenAction';
import GridCell from '@/components/database/components/grid/grid-cell/GridCell';
import { GridColumnType, RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row';
import { useGridContext } from '@/components/database/grid/useGridContext';
import { cn } from '@/lib/utils';
import { VirtualItem } from '@tanstack/react-virtual';
import React, { memo, useMemo } from 'react';

const MIN_HEIGHT = 35;
const borderStyle = '1px solid var(--border-primary)';

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
  onResizeColumnStart?: (fieldId: string, element: HTMLElement) => void;
}) {

  const rowIndex = row.index;
  const rowData = useMemo(() => data[rowIndex], [data, rowIndex]);
  const {
    setActiveCell,
    activeCell,
  } = useGridContext();
  const readOnly = useReadOnly();
  const columnData = useMemo(() => columns[column.index], [columns, column.index]);
  const { hoverRowId } = useGridContext();

  const isHoverRow = hoverRowId === rowData.rowId;
  const isActiveCell = activeCell && columnData.fieldType !== undefined && activeCell.rowId === rowData.rowId && activeCell.fieldId === columnData.fieldId && [
    FieldType.RichText,
    FieldType.URL,
    FieldType.Number,
  ].includes(columnData.fieldType);

  return (
    <div
      data-column-id={columnData.fieldId}
      key={column.key}
      data-is-primary={columnData.isPrimary}
      onClick={() => {
        if (readOnly) return;
        if (rowData.type === RenderRowType.Row && columnData.type === GridColumnType.Field && rowData.rowId && columnData.fieldId) {
          setActiveCell({
            rowId: rowData.rowId,
            fieldId: columnData.fieldId,
          });
        }

      }}
      className={cn(columnData.wrap ? 'wrap-cell' : 'whitespace-nowrap', 'grid-row-cell border-t border-l relative border-transparent', isActiveCell ? 'editing' : '')}
      style={{
        height: rowIndex === 0 ? MIN_HEIGHT : row.size,
        minHeight: 'fit-content',
        width: columnData.width,
        ...(rowIndex !== data.length - 1 && {
          borderBottom: borderStyle,
        }),
        ...(column.index === 0 || rowIndex === data.length - 1 ? {} : {
          borderLeft: borderStyle,
        }),
        ...(rowIndex === 0 ? {
          borderTop: '1px solid transparent',
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

      {isHoverRow && columnData.isPrimary && rowData.rowId &&
        <div className={'absolute right-2 top-2 min-w-0 transform '}>
          <OpenAction rowId={rowData.rowId} />
        </div>}
    </div>
  );
}

export default memo(GridVirtualColumn);