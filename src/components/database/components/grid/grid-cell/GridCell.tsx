import GridDragColumn from '@/components/database/components/grid/drag-and-drop/GridDragColumn';
import GridCalculateRowCell from '@/components/database/components/grid/grid-cell/GridCalculateRowCell';
import { GridRowCell } from '@/components/database/components/grid/grid-cell/index';
import { GridColumnType, RenderColumn } from '@/components/database/components/grid/grid-column';
import GridHeaderColumn from '@/components/database/components/grid/grid-column/GridHeaderColumn';
import { getRenderRowKey, RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row/useRenderRows';

function GridCell({
  rowIndex,
  rowData: row,
  columnIndex,
  columns,
  onResizeColumnStart,
}: {
  rowIndex: number;
  /** The render row at `rowIndex`. */
  rowData: RenderRow;
  columnIndex: number;
  columns: RenderColumn[];
  onResizeColumnStart?: (fieldId: string, element: HTMLElement) => void;
}) {
  const column = columns[columnIndex];
  const fieldId = column.fieldId as string;
  const rowId = row.rowId as string;

  switch (row.type) {
    case RenderRowType.Header:
      return (
        <GridDragColumn columnIndex={columnIndex} column={column}>
          <GridHeaderColumn onResizeColumnStart={onResizeColumnStart} column={column} />
        </GridDragColumn>
      );
    case RenderRowType.Row:
      return (
        <GridRowCell
          rowIndex={rowIndex}
          rowId={rowId}
          rowKey={getRenderRowKey(row)}
          fieldId={fieldId}
          columnIndex={columnIndex}
        />
      );
    case RenderRowType.CalculateRow:
      if (column.type !== GridColumnType.Field) {
        return null;
      }

      return <GridCalculateRowCell fieldId={fieldId} />;
    default:
      return null;
  }
}

export default GridCell;
