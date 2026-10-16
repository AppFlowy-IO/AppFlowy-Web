import { useCallback, useEffect, useRef } from 'react';

import { useDatabaseFields, useDatabaseView } from '@/application/database-yjs';
import { useDuplicateRowDispatch, useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { getGridGroupCellsData } from '@/components/database/components/grid/grid-row/GridNewRow';
import { useGridContext, useIsGridRowHovered } from '@/components/database/grid/useGridContext';
import { useRowCreationAction } from '@/components/database/hooks/useRowCreationAction';

export function useHoverControlsDisplay(rowKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const isHover = useIsGridRowHovered(rowKey);

  const handleMouseMove = useCallback(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
  }, []);

  const handleMouseLeave = useCallback(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
  }, []);

  useEffect(() => {
    if (isHover) {
      handleMouseMove();
    } else {
      handleMouseLeave();
    }
  }, [handleMouseLeave, handleMouseMove, isHover]);

  return {
    ref,
    isHover,
  };
}

export function useHoverControlsActions(rowId: string, groupFieldId?: string, groupId?: string) {
  const { pending: addBelowLoading, run: runBelow } = useRowCreationAction();
  const { pending: addAboveLoading, run: runAbove } = useRowCreationAction();
  const { pending: duplicateLoading, run: runDuplicate } = useRowCreationAction();
  const { rowOrders } = useGridContext();
  const onNewRow = useNewRowDispatch();
  const duplicateRow = useDuplicateRowDispatch();
  const fields = useDatabaseFields();
  const view = useDatabaseView();
  const getCellsData = useCallback(
    () => getGridGroupCellsData(fields, groupFieldId, groupId, view),
    [fields, groupFieldId, groupId, view]
  );

  const onAddRowBelow = useCallback(async () => {
    await runBelow(() => onNewRow({ beforeRowId: rowId, cellsData: getCellsData() }));
  }, [getCellsData, onNewRow, rowId, runBelow]);

  const onAddRowAbove = useCallback(async () => {
    if (!rowOrders) return;
    const index = rowOrders.findIndex((row) => row.id === rowId);
    const beforeRowId = index > 0 ? rowOrders[index - 1].id : undefined;

    await runAbove(() => onNewRow({ beforeRowId, cellsData: getCellsData() }));
  }, [getCellsData, onNewRow, rowId, rowOrders, runAbove]);

  const onDuplicateRow = useCallback(async () => {
    await runDuplicate(() => duplicateRow(rowId));
  }, [duplicateRow, rowId, runDuplicate]);

  return {
    onAddRowBelow,
    onDuplicateRow,
    onAddRowAbove,
    addAboveLoading,
    addBelowLoading,
    duplicateLoading,
  };
}
