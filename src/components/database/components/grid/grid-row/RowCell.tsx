import { Column } from '@/application/database-yjs';
import { GridCell } from '@/components/database/components/grid/grid-cell';
import { RenderColumn } from '@/components/database/components/grid/grid-column';
import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row/useRenderRows';
import GridCalculateRowCell from '@/components/database/components/grid/grid-cell/GridCalculateRowCell';
import GridHeaderColumn from '@/components/database/components/grid/grid-column/GridHeaderColumn';
import React from 'react';

function RowCell ({
  rowIndex,
  columnIndex,
  data,
  columns,
}: {
  rowIndex: number,
  columnIndex: number,
  data: RenderRow[];
  columns: RenderColumn[];
}) {
  const row = data[rowIndex];
  const column = columns[columnIndex];
  const fieldId = column.fieldId as string;
  const rowId = row.rowId as string;

  switch (row.type) {
    case RenderRowType.Header:
      return <GridHeaderColumn
        column={column as unknown as Column}
      />;
    case RenderRowType.Row:
      return <div className={'flex px-2 py-1.5 items-center'}>
        <GridCell
          rowIndex={rowIndex}
          rowId={rowId}
          fieldId={fieldId}
          columnIndex={columnIndex}
        /></div>;
    case RenderRowType.CalculateRow:
      return <GridCalculateRowCell fieldId={fieldId} />;
    default:
      return null;
  }
}

export default RowCell;