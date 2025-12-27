import React, { useCallback, useEffect, useRef, useState } from 'react';

import { RenderRow, useRenderRows } from '@/components/database/components/grid/grid-row';
import { GridContext } from '@/components/database/grid/useGridContext';

export const GridProvider = ({ children }: { children: React.ReactNode }) => {
  const [hoverRowId, setHoverRowId] = useState<string | undefined>();
  const [activePropertyId, setActivePropertyId] = useState<string | undefined>();
  const { rows: initialRows } = useRenderRows();
  const [rows, setRows] = useState<RenderRow[]>(initialRows);
  const [resizeRows, setResizeRows] = useState<Map<string, number>>(new Map());

  const isWheelingRef = useRef(false);
  const ref = useRef<HTMLDivElement | null>(null);

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

  const [showStickyHeader, setShowStickyHeader] = useState(false);

  return (
    <GridContext.Provider
      value={{
        hoverRowId,
        setHoverRowId: handleHoverRowStart,
        rows,
        setRows,
        activePropertyId,
        setActivePropertyId,

        activeCell,
        setActiveCell,
        resizeRows,
        setResizeRow: onResizeRow,
        onResizeRowEnd,
        showStickyHeader,
        setShowStickyHeader,
      }}
    >
      <div ref={ref} className={'flex-1'}>
        {children}
      </div>
    </GridContext.Provider>
  );
};
