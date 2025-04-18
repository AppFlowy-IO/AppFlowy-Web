import { useDatabaseViewId } from '@/application/database-yjs';
import { useGridContext } from '@/components/database/grid/useGridContext';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

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