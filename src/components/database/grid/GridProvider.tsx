import { GridContext } from '@/components/database/grid/useGridContext';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export const GridProvider = ({ children }: {
  children: React.ReactNode;
}) => {
  const [hoverRowId, setHoverRowId] = useState<string | undefined>();

  const isWheelingRef = useRef(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    const onWheel = () => {
      clearTimeout(timeoutId);
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