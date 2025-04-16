import { Column } from '@/application/database-yjs';
import GridDragColumn from '@/components/database/components/grid/drag-and-drop/GridDragColumn';
import { GridRowCell } from '@/components/database/components/grid/grid-cell/index';
import { RenderColumn } from '@/components/database/components/grid/grid-column';
import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row/useRenderRows';
import GridCalculateRowCell from '@/components/database/components/grid/grid-cell/GridCalculateRowCell';
import GridHeaderColumn from '@/components/database/components/grid/grid-column/GridHeaderColumn';
import React from 'react';

function GridCell ({
  rowIndex,
  columnIndex,
  data,
  columns,
  onResizeColumnStart,
}: {
  rowIndex: number,
  columnIndex: number,
  data: RenderRow[];
  columns: RenderColumn[];
  onResizeColumnStart: (fieldId: string, element: HTMLElement) => void;
}) {
  const row = data[rowIndex];
  const column = columns[columnIndex];
  const fieldId = column.fieldId as string;
  const rowId = row.rowId as string;

  switch (row.type) {
    case RenderRowType.Header:
      return <GridDragColumn
        columnIndex={columnIndex}
        column={column}
      ><GridHeaderColumn
        onResizeColumnStart={onResizeColumnStart}
        column={column as unknown as Column}
      /></GridDragColumn>;
    case RenderRowType.Row:
      return <div className={'flex px-2 py-1.5 items-center'}>
        <GridRowCell
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

export default GridCell;