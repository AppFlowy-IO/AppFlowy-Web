import { useCallback, useEffect, useRef, useState } from 'react';

import { useDatabaseFields } from '@/application/database-yjs';
import { useDuplicateRowDispatch, useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { getGridGroupCellsData } from '@/components/database/components/grid/grid-row/GridNewRow';
import { useGridContext, useIsGridRowHovered } from '@/components/database/grid/useGridContext';

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
  const [addBelowLoading, setAddBelowLoading] = useState<boolean>(false);
  const [addAboveLoading, setAddAboveLoading] = useState<boolean>(false);
  const [duplicateLoading, setDuplicateLoading] = useState<boolean>(false);
  const { rowOrders } = useGridContext();
  const onNewRow = useNewRowDispatch();
  const duplicateRow = useDuplicateRowDispatch();
  const fields = useDatabaseFields();
  const getCellsData = useCallback(
    () => getGridGroupCellsData(fields, groupFieldId, groupId),
    [fields, groupFieldId, groupId]
  );

  const onAddRowBelow = useCallback(async () => {
    if (!rowOrders) {
      throw new Error('No rows');
    }

    setAddBelowLoading(true);

    try {
      await onNewRow({ beforeRowId: rowId, cellsData: getCellsData() });
    } catch (e) {
      console.error(e);
    } finally {
      setAddBelowLoading(false);
    }
  }, [getCellsData, onNewRow, rowId, rowOrders]);

  const onAddRowAbove = useCallback(async () => {
    if (!rowOrders) {
      throw new Error('No rows');
    }

    setAddAboveLoading(true);
    const index = rowOrders.findIndex((row) => row.id === rowId);
    const beforeRowId = index > 0 ? rowOrders[index - 1].id : undefined;

    try {
      await onNewRow({ beforeRowId, cellsData: getCellsData() });
    } catch (e) {
      console.error(e);
    } finally {
      setAddAboveLoading(false);
    }
  }, [getCellsData, onNewRow, rowId, rowOrders]);

  const onDuplicateRow = useCallback(async () => {
    setDuplicateLoading(true);

    try {
      await duplicateRow(rowId);
    } catch (e) {
      console.error(e);
    } finally {
      setDuplicateLoading(false);
    }
  }, [duplicateRow, rowId]);

  return {
    onAddRowBelow,
    onDuplicateRow,
    onAddRowAbove,
    addAboveLoading,
    addBelowLoading,
    duplicateLoading,
  };
}
