import { VirtualItem } from '@tanstack/react-virtual';
import { memo, useMemo } from 'react';

import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import OpenAction from '@/components/database/components/database-row/OpenAction';
import GridCell from '@/components/database/components/grid/grid-cell/GridCell';
import { GridColumnType, RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row';
import { useGridContext } from '@/components/database/grid/useGridContext';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { cn } from '@/lib/utils';


function GridVirtualColumn({
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
  const { setActiveCell, activeCell } = useGridContext();
  const readOnly = useReadOnly();
  const columnData = useMemo(() => columns[column.index], [columns, column.index]);
  const { hoverRowId } = useGridContext();
  const { field } = useFieldSelector(columnData.fieldId || '');
  const fieldType = field ? (Number(field?.get(YjsDatabaseKey.type)) as FieldType) : undefined;
  const disableRelationRollupEdit = isFieldEditingDisabled(fieldType);
  const notNeedSelected = useMemo(
    () =>
      [
        FieldType.Checkbox,
        FieldType.AISummaries,
        FieldType.AITranslations,
        FieldType.CreatedTime,
        FieldType.LastEditedTime,
      ].includes(fieldType as FieldType) || disableRelationRollupEdit,
    [disableRelationRollupEdit, fieldType]
  );
  const isActiveCell =
    !notNeedSelected &&
    activeCell &&
    fieldType !== undefined &&
    activeCell.rowId === rowData.rowId &&
    activeCell.fieldId === columnData.fieldId;
  const isHoverRow = hoverRowId === rowData.rowId && !isActiveCell;

  const showActions = Boolean(isHoverRow && columnData.isPrimary && rowData.rowId);
  const rowType = rowData.type;

  return (
    <div
      data-column-id={columnData.fieldId}
      key={column.key}
      data-is-primary={columnData.isPrimary}
      onClick={(e) => {
        if (readOnly) return;
        if (disableRelationRollupEdit) return;
        if (
          rowData.type === RenderRowType.Row &&
          columnData.type === GridColumnType.Field &&
          rowData.rowId &&
          columnData.fieldId
        ) {
          e.stopPropagation();
          setActiveCell({
            rowId: rowData.rowId,
            fieldId: columnData.fieldId,
          });
        }
      }}
      className={cn(
        'grid-row-cell relative min-h-fit',
        readOnly ||
          [FieldType.CreatedTime, FieldType.LastEditedTime].includes(fieldType as FieldType) ||
          disableRelationRollupEdit
          ? 'cursor-text'
          : 'cursor-pointer',
        columnData.wrap ? 'whitespace-prewrap' : 'whitespace-nowrap',
        rowType === RenderRowType.Header && 'hover:bg-fill-content-hover',
        column.index === 0 || rowType === RenderRowType.CalculateRow ? '' : 'border-l border-border-primary',
        rowIndex === 0 || rowType === RenderRowType.CalculateRow ? '' : 'border-t border-border-primary',
        readOnly && rowType === RenderRowType.CalculateRow ? 'border-t border-border-primary' : ''
      )}
      style={{
        width: columnData.width,
      }}
    >
      <GridCell
        rowIndex={row.index}
        columnIndex={column.index}
        columns={columns}
        data={data}
        onResizeColumnStart={onResizeColumnStart}
      />

      {showActions && (
        <div className={'absolute right-2 top-1.5 z-10 min-w-0 transform '}>
          <OpenAction rowId={rowData.rowId!} />
        </div>
      )}
      {isActiveCell && (
        <div
          style={{
            boxShadow: 'var(--fill-theme-thick) 0px 0px 0px 2px inset, var(--fill-info-light) 0px 0px 0px 1px inset',
          }}
          className={
            'border-info-light pointer-events-none absolute bottom-[-1px] left-0 top-[-0.5px] z-10 w-[calc(100%+1px)] rounded-[2px] border'
          }
        />
      )}
    </div>
  );
}

export default memo(GridVirtualColumn);
