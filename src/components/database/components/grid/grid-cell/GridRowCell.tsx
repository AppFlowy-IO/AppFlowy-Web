import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FieldType, useCellSelector, useFieldWrap, useReadOnly } from '@/application/database-yjs';
import { CellProps, Cell as CellType } from '@/application/database-yjs/cell.type';
import { useFieldSelector } from '@/application/database-yjs/selector';
import { FieldId, YjsDatabaseKey } from '@/application/types';
import { Cell } from '@/components/database/components/cell';
import { PrimaryCell } from '@/components/database/components/cell/primary';
import { useGridRowContext } from '@/components/database/components/grid/grid-row/GridRowContext';
import { useGridContext } from '@/components/database/grid/useGridContext';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { cn } from '@/lib/utils';

export interface GridCellProps {
  rowId: string;
  fieldId: FieldId;
  columnIndex: number;
  rowIndex: number;
}

export function GridRowCell({ rowId, fieldId }: GridCellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { field } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type));
  const readOnly = useReadOnly();
  const isPrimary = field?.get(YjsDatabaseKey.is_primary);
  const disableRelationRollupEdit = isFieldEditingDisabled(fieldType as FieldType);
  const isReadOnlyCell = readOnly || disableRelationRollupEdit;
  const cell = useCellSelector({
    rowId,
    fieldId,
  });

  const { resizeRow } = useGridRowContext();
  const { activeCell, setActiveCell } = useGridContext();

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

  const isActive = activeCell?.rowId === rowId && activeCell?.fieldId === fieldId;

  const setEditing = useCallback(
    (status: boolean) => {
      if (status) {
        if (disableRelationRollupEdit) return;
        setActiveCell({
          rowId,
          fieldId,
        });
      } else {
        setActiveCell(undefined);
      }
    },
    [disableRelationRollupEdit, fieldId, rowId, setActiveCell]
  );

  const paddingVertical = useMemo(() => {
    switch (fieldType) {
      case FieldType.SingleSelect:
      case FieldType.MultiSelect:
        return 'py-[7px]';
      case FieldType.FileMedia:
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

  if (!field) return null;

  return (
    <div
      ref={ref}
      data-testid={`grid-cell-${rowId}-${fieldId}`}
      className={cn('grid-cell flex h-full w-full items-start overflow-hidden px-2 text-sm', paddingVertical)}
    >
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
    </div>
  );
}

export default GridRowCell;
