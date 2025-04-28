import { useDatabaseViewId, useRowOrdersSelector } from '@/application/database-yjs';
import { useDuplicateRowDispatch, useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { useGridContext } from '@/components/database/grid/useGridContext';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useHoverControlsDisplay (rowId: string) {
  const ref = useRef<HTMLDivElement>(null);
  const {
    hoverRowId,
  } = useGridContext();
  const viewId = useDatabaseViewId();

  const isHover = rowId === hoverRowId;

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

  useLayoutEffect(() => {
    window.addEventListener('wheel', handleMouseLeave);
    return () => {
      window.removeEventListener('wheel', handleMouseLeave);
    };
  }, [handleMouseLeave, isHover, viewId]);

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

export function useHoverControlsActions (rowId: string) {
  const [addBelowLoading, setAddBelowLoading] = useState<boolean>(false);
  const [addAboveLoading, setAddAboveLoading] = useState<boolean>(false);
  const [duplicateLoading, setDuplicateLoading] = useState<boolean>(false);
  const rows = useRowOrdersSelector();
  const onNewRow = useNewRowDispatch();
  const duplicateRow = useDuplicateRowDispatch();

  const onAddRowBelow = useCallback(async () => {
    if (!rows) {
      throw new Error('No rows');
    }

    setAddBelowLoading(true);
    const index = rows.findIndex((row) => row.id === rowId);

    try {
      await onNewRow(index + 1);
    } catch (e) {
      console.error(e);
    } finally {
      setAddBelowLoading(false);
    }
  }, [onNewRow, rowId, rows]);

  const onAddRowAbove = useCallback(async () => {
    if (!rows) {
      throw new Error('No rows');
    }

    setAddAboveLoading(true);
    const index = rows.findIndex((row) => row.id === rowId);

    try {
      await onNewRow(index);
    } catch (e) {
      console.error(e);
    } finally {
      setAddAboveLoading(false);
    }
  }, [onNewRow, rowId, rows]);

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