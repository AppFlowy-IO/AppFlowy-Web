import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FieldType, useFieldWrap, useIsRowLoaded, useReadOnly } from '@/application/database-yjs';
import { CellProps, Cell as CellType } from '@/application/database-yjs/cell.type';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { FieldId, YjsDatabaseKey } from '@/application/types';
import { Cell, CellValue } from '@/components/database/components/cell';
import { PrimaryCell } from '@/components/database/components/cell/primary';
import { useGridRowContext } from '@/components/database/components/grid/grid-row/GridRowContext';
import { useGridInteractionActions, useIsGridCellActive } from '@/components/database/grid/useGridContext';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { cn } from '@/lib/utils';

export interface GridCellProps {
  rowId: string;
  rowKey: string;
  fieldId: FieldId;
  columnIndex: number;
  rowIndex: number;
}

export function GridRowCell({ rowId, rowKey, fieldId }: GridCellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { field } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type));
  const readOnly = useReadOnly();
  const isPrimary = field?.get(YjsDatabaseKey.is_primary);
  const disableRelationRollupEdit = isFieldEditingDisabled(fieldType as FieldType);
  const isReadOnlyCell = readOnly || disableRelationRollupEdit;
  const isRowLoaded = useIsRowLoaded(rowId);

  const { resizeRow } = useGridRowContext();
  const { setActiveCell } = useGridInteractionActions();

  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const cellEl = ref.current;

    if (!cellEl) return;

    const gridRowCell = cellEl.closest('.grid-row-cell') as HTMLDivElement;

    if (!gridRowCell) return;

    const handleMouseEnter = () => {
      setHovered(true);
    };

    const handleMouseLeave = () => {
      setHovered(false);
    };

    gridRowCell.addEventListener('mouseenter', handleMouseEnter);
    gridRowCell.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      gridRowCell.removeEventListener('mouseenter', handleMouseEnter);
      gridRowCell.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  const Component = useMemo(() => {
    if (isPrimary) {
      return PrimaryCell;
    }

    return Cell;
  }, [isPrimary]) as React.FC<CellProps<CellType>>;

  const wrap = useFieldWrap(fieldId);

  const isActive = useIsGridCellActive(rowKey, fieldId);

  const setEditing = useCallback(
    (status: boolean) => {
      if (status) {
        if (disableRelationRollupEdit) return;
        setActiveCell({
          rowId,
          rowKey,
          fieldId,
        });
      } else {
        setActiveCell(undefined);
      }
    },
    [disableRelationRollupEdit, fieldId, rowId, rowKey, setActiveCell]
  );

  const paddingVertical = useMemo(() => {
    switch (fieldType) {
      case FieldType.SingleSelect:
      case FieldType.MultiSelect:
        return 'py-[7px]';
      case FieldType.Media:
        return 'py-1';
      default:
        return 'py-2';
    }
  }, [fieldType]);

  const wrapRef = useRef(wrap);
  const isActiveRef = useRef(isActive);

  useEffect(() => {
    // Check if the wrap or isActive has changed
    if (wrapRef.current !== wrap || isActiveRef.current !== isActive) {
      if (!wrap || !isActive) {
        resizeRow();
      }

      wrapRef.current = wrap;
      isActiveRef.current = isActive;
    }
  }, [wrap, isActive, resizeRow]);

  // Stable while the cell's props are: a re-render of this component alone
  // (the row and field hooks re-render it on mount) does not render the cell again.
  const renderCell = useCallback(
    (cell: CellType | undefined) => (
      <Component
        cell={cell}
        rowId={rowId}
        fieldId={fieldId}
        readOnly={isReadOnlyCell}
        editing={isActive}
        setEditing={setEditing}
        isHovering={hovered}
        wrap={wrap}
      />
    ),
    [Component, fieldId, hovered, isActive, isReadOnlyCell, rowId, setEditing, wrap]
  );

  if (!field) return null;

  // While the row's collab content is still loading from IndexedDB/network,
  // render blank non-primary cells. The primary cell renders a loading
  // indicator (handled inside PrimaryCell).
  if (!isRowLoaded && !isPrimary) {
    return (
      <div
        ref={ref}
        data-testid={`grid-cell-${rowId}-${fieldId}`}
        className={cn('grid-cell flex h-full w-full items-start overflow-hidden px-2 text-sm', paddingVertical)}
      />
    );
  }

  return (
    <div
      ref={ref}
      data-testid={`grid-cell-${rowId}-${fieldId}`}
      className={cn('grid-cell flex h-full w-full items-start overflow-hidden px-2 text-sm', paddingVertical)}
    >
      {/* Only Rollup and Formula cells run the rollup and formula hooks (W17). */}
      <CellValue rowId={rowId} fieldId={fieldId} fieldType={fieldType as FieldType}>
        {renderCell}
      </CellValue>
    </div>
  );
}

export default GridRowCell;
