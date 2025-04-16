import { useResizeColumnWidthDispatch } from '@/application/database-yjs/dispatch';
import { useCallback, useRef, useState } from 'react';
import { RenderColumn } from '@/components/database/components/grid/grid-column';

const MIN_COLUMN_WIDTH = 150;

export function useColumnResize (
  columns: RenderColumn[],
) {
  const [isResizing, setIsResizing] = useState(false);

  const resizeColumn = useResizeColumnWidthDispatch();
  const dragStateRef = useRef<{
    fieldId: string;
    initialWidth: number;
    currentDelta: number;
    element: HTMLElement | null;
  } | null>(null);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    const dragState = dragStateRef.current;

    if (!dragState) return;

    const { movementX } = e;

    dragState.currentDelta += movementX;

    const newWidth = Math.max(MIN_COLUMN_WIDTH, dragState.initialWidth + dragState.currentDelta);

    const headerCell = dragState.element?.closest('[data-column-id]');

    if (!headerCell) return;

    (headerCell as HTMLElement).style.width = `${newWidth}px`;

  }, []);

  const handleResizeEnd = useCallback(() => {
    const dragState = dragStateRef.current;

    if (!dragState) return;

    const finalWidth = Math.max(MIN_COLUMN_WIDTH, dragState.initialWidth + dragState.currentDelta);

    resizeColumn(dragState.fieldId, finalWidth);
    setIsResizing(false);

    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);

    document.body.style.cursor = '';
    document.body.classList.remove('resize-active');

    const headerCell = dragState.element?.closest('[data-column-id]');

    if (headerCell) {
      headerCell.classList.remove('resizing');
    }

    dragStateRef.current = null;
  }, [handleResizeMove, resizeColumn]);

  const handleResizeStart = useCallback((fieldId: string, element: HTMLElement) => {
    const column = columns.find(col => col.fieldId === fieldId);

    if (!column) return;

    dragStateRef.current = {
      fieldId,
      initialWidth: column.width,
      currentDelta: 0,
      element,
    };

    setIsResizing(true);

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    document.body.style.cursor = 'col-resize';
    document.body.classList.add('resize-active');

    const headerCell = element.closest('[data-column-id]');

    if (headerCell) {
      headerCell.classList.add('resizing');
    }
  }, [columns, handleResizeMove, handleResizeEnd]);

  return {
    columns,
    isResizing,
    handleResizeStart,
    getColumnById: useCallback(
      (id: string) => columns.find(col => col.fieldId === id),
      [columns],
    ),
  };
}