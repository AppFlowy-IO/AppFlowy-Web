import React, { useCallback, useRef, useState } from 'react';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';

import { MIN_WIDTH, RESIZE_HANDLE_WIDTH } from './const';
import { useSimpleTableContext } from './SimpleTableContext';

interface SimpleTableColumnResizerProps {
  colIndex: number;
  initialWidth: number;
}

/**
 * Column resize handle — positioned on the right edge of each cell.
 * Uses DOM manipulation for smooth visual feedback during drag,
 * then persists final width to Yjs on drag end.
 */
export function SimpleTableColumnResizer({ colIndex, initialWidth }: SimpleTableColumnResizerProps) {
  const context = useSimpleTableContext();
  const editor = useSlateStatic() as YjsEditor;
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const originalWidthRef = useRef(initialWidth);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    startXRef.current = e.clientX;
    originalWidthRef.current = initialWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startXRef.current;
      const newWidth = Math.max(MIN_WIDTH, originalWidthRef.current + deltaX);

      // Update the <col> elements directly via DOM for smooth visual feedback
      const table = (moveEvent.target as HTMLElement)?.closest?.('.simple-table')?.querySelector('table');

      if (table) {
        const cols = table.querySelectorAll('col');

        if (cols[colIndex]) {
          cols[colIndex].style.width = `${newWidth}px`;
        }
      }

      // Also update the td widths
      const tds = table?.querySelectorAll(`td[data-cell-index="${colIndex}"]`);

      tds?.forEach((td) => {
        (td as HTMLElement).style.width = `${newWidth}px`;
        (td as HTMLElement).style.minWidth = `${newWidth}px`;
      });
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setIsDragging(false);

      const deltaX = upEvent.clientX - startXRef.current;
      const newWidth = Math.max(MIN_WIDTH, originalWidthRef.current + deltaX);

      if (!context) return;

      // Persist to Yjs
      const existingWidths = context.tableNode.data.column_widths || {};

      CustomEditor.updateTableData(editor, context.tableNode.blockId, {
        column_widths: {
          ...existingWidths,
          [colIndex]: newWidth,
        },
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [colIndex, initialWidth, context, editor]);

  if (!context || context.readOnly) return null;

  return (
    <div
      contentEditable={false}
      className={`simple-table-col-resize-handle ${isDragging ? 'dragging' : ''}`}
      style={{
        width: `${RESIZE_HANDLE_WIDTH}px`,
      }}
      onMouseDown={handleMouseDown}
    />
  );
}
