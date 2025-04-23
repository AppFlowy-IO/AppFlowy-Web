import { RenderRow, useRenderRows } from '@/components/database/components/grid/grid-row';
import { GridContext } from '@/components/database/grid/useGridContext';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export const GridProvider = ({ children }: {
  children: React.ReactNode;
}) => {
  const [hoverRowId, setHoverRowId] = useState<string | undefined>();
  const [activePropertyId, setActivePropertyId] = useState<string | undefined>();
  const { rows: initialRows } = useRenderRows();
  const [rows, setRows] = useState<RenderRow[]>(initialRows);
  const [showStickyHeader, setShowStickyHeader] = useState(false);

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

  return <GridContext.Provider
    value={{
      hoverRowId,
      setHoverRowId: handleHoverRowStart,
      rows,
      setRows,
      activePropertyId,
      setActivePropertyId,
      showStickyHeader,
      setShowStickyHeader,
    }}
  >
    <div
      ref={ref}
      className={'flex-1'}
    >
      {children}
    </div>
  </GridContext.Provider>;
};