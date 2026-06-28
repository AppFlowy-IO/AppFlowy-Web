import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Row, useDatabaseContext } from '@/application/database-yjs';
import {
  EMBEDDED_GRID_INITIAL_ROW_LIMIT,
  EMBEDDED_GRID_LOAD_MORE_INCREMENT,
  RenderRow,
  useRenderRows,
} from '@/components/database/components/grid/grid-row';
import { GridContext } from '@/components/database/grid/useGridContext';
import { useDatabaseRowHistoryHotkeys } from '@/components/database/hooks/useDatabaseRowHistoryHotkeys';

export const GridProvider = ({ children, rowOrders }: { children: React.ReactNode; rowOrders?: Row[] }) => {
  const [hoverRowId, setHoverRowId] = useState<string | undefined>();
  const [activePropertyId, setActivePropertyId] = useState<string | undefined>();
  const { isDocumentBlock, activeViewId, readOnly } = useDatabaseContext();
  const [visibleRowLimit, setVisibleRowLimit] = useState(EMBEDDED_GRID_INITIAL_ROW_LIMIT);
  const embeddedVisibleRowLimit = isDocumentBlock ? visibleRowLimit : undefined;
  const {
    rows: initialRows,
    remainingRowCount,
    lastVisibleRowId,
  } = useRenderRows(rowOrders, {
    visibleRowLimit: embeddedVisibleRowLimit,
  });
  const [rows, setRows] = useState<RenderRow[]>(initialRows);
  const [resizeRows, setResizeRows] = useState<Map<string, number>>(new Map());

  const isWheelingRef = useRef(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleRowLimit(EMBEDDED_GRID_INITIAL_ROW_LIMIT);
  }, [activeViewId, isDocumentBlock]);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    const onWheel = () => {
      timeoutId && clearTimeout(timeoutId);
      isWheelingRef.current = true;
      setHoverRowId(undefined);

      timeoutId = setTimeout(() => {
        isWheelingRef.current = false;
      }, 300);
    };

    window.addEventListener('wheel', onWheel);

    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  const handleHoverRowStart = useCallback((rowId?: string) => {
    if (isWheelingRef.current) {
      return;
    }

    setHoverRowId(rowId);
  }, []);
  const [activeCell, setActiveCell] = useState<{ rowId: string; fieldId: string } | undefined>(undefined);
  const [hasGridFocus, setHasGridFocus] = useState(false);

  const handleSetActiveCell = useCallback((nextActiveCell?: { rowId: string; fieldId: string }) => {
    setActiveCell(nextActiveCell);

    if (nextActiveCell) {
      setHasGridFocus(true);
    }
  }, []);

  useEffect(() => {
    setActiveCell(undefined);
    setHasGridFocus(false);
  }, [activeViewId]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      setHasGridFocus(Boolean(ref.current && target instanceof Node && ref.current.contains(target)));
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

  useDatabaseRowHistoryHotkeys(undefined, {
    enabled: hasGridFocus && !readOnly,
    ignoreInput: false,
    useLatest: true,
  });

  const onResizeRow = useCallback(({ rowId, maxCellHeight }: { rowId: string; maxCellHeight: number }) => {
    setResizeRows((prev) => {
      const newMap = new Map(prev);

      newMap.set(rowId, maxCellHeight);

      return newMap;
    });
  }, []);

  const onResizeRowEnd = useCallback((id: string) => {
    setResizeRows((prev) => {
      const newMap = new Map(prev);

      newMap.delete(id);
      return newMap;
    });
  }, []);

  const loadMoreRows = useCallback(() => {
    setVisibleRowLimit((prev) => prev + EMBEDDED_GRID_LOAD_MORE_INCREMENT);
  }, []);

  const revealCreatedRow = useCallback(() => {
    if (!isDocumentBlock) return;

    setVisibleRowLimit((prev) => prev + 1);
  }, [isDocumentBlock]);

  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const contextValue = useMemo(
    () => ({
      hoverRowId,
      setHoverRowId: handleHoverRowStart,
      rows,
      setRows,
      activePropertyId,
      setActivePropertyId,
      activeCell,
      setActiveCell: handleSetActiveCell,
      resizeRows,
      setResizeRow: onResizeRow,
      onResizeRowEnd,
      remainingRowCount,
      lastVisibleRowId,
      loadMoreRows,
      revealCreatedRow,
      showStickyHeader,
      setShowStickyHeader,
    }),
    [
      hoverRowId,
      handleHoverRowStart,
      rows,
      activePropertyId,
      activeCell,
      handleSetActiveCell,
      resizeRows,
      onResizeRow,
      onResizeRowEnd,
      remainingRowCount,
      lastVisibleRowId,
      loadMoreRows,
      revealCreatedRow,
      showStickyHeader,
    ]
  );

  return (
    <GridContext.Provider value={contextValue}>
      <div ref={ref} className={'flex min-h-0 flex-1 flex-col'}>
        {children}
      </div>
    </GridContext.Provider>
  );
};
