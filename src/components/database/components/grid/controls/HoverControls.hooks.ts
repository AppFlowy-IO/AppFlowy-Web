import { useDatabaseViewId } from '@/application/database-yjs';
import { useLayoutEffect, useRef } from 'react';

export function useHoverControlsDisplay (rowId: string) {
  const ref = useRef<HTMLDivElement>(null);

  const viewId = useDatabaseViewId();

  useLayoutEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    const rowEl = document.querySelector(`[data-row-id="${rowId}"]`);

    const onMouseMove = () => {
      el.style.opacity = '1';
      el.setAttribute('data-row-id', rowId || '');
      el.style.pointerEvents = 'auto';
    };

    const onMouseLeave = () => {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    };

    onMouseLeave();
    rowEl?.addEventListener('mousemove', onMouseMove);
    rowEl?.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('wheel', onMouseLeave);
    return () => {
      rowEl?.removeEventListener('mousemove', onMouseMove);
      rowEl?.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('wheel', onMouseLeave);
    };
  }, [rowId, viewId]);

  return {
    ref,
  };
}