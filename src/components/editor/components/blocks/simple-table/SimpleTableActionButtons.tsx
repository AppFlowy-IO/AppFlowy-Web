import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';

import { useSimpleTableContext } from './SimpleTableContext';

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={className}>
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Renders add row/column/corner buttons positioned dynamically
 * based on the actual table element's dimensions.
 * This is necessary because TableContainer may change the table's
 * position/width independently of the root wrapper.
 */
export function SimpleTableActionButtons() {
  const context = useSimpleTableContext();
  const editor = useSlateStatic() as YjsEditor;
  const containerRef = useRef<HTMLDivElement>(null);
  const [tableRect, setTableRect] = useState<{ width: number; height: number; offsetLeft: number; offsetTop: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const rootWrapper = container.parentElement;

    if (!rootWrapper) return;

    const updateRect = () => {
      const table = rootWrapper.querySelector('table');

      if (!table) return;

      const rootRect = rootWrapper.getBoundingClientRect();
      const tRect = table.getBoundingClientRect();

      setTableRect({
        width: tRect.width,
        height: tRect.height,
        offsetLeft: tRect.left - rootRect.left,
        offsetTop: tRect.top - rootRect.top,
      });
    };

    updateRect();

    const observer = new MutationObserver(updateRect);

    observer.observe(rootWrapper, { childList: true, subtree: true, attributes: true });

    const resizeObserver = new ResizeObserver(updateRect);
    const table = rootWrapper.querySelector('table');

    if (table) resizeObserver.observe(table);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [context?.tableNode]);

  const handleAddRow = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!context) return;
    CustomEditor.addTableRow(editor, context.tableNode.blockId);
  }, [editor, context]);

  const handleAddCol = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!context) return;
    CustomEditor.addTableColumn(editor, context.tableNode.blockId);
  }, [editor, context]);

  const handleAddBoth = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!context) return;
    CustomEditor.addTableRowAndColumn(editor, context.tableNode.blockId);
  }, [editor, context]);

  if (!context || context.readOnly) return null;

  return (
    <div ref={containerRef} className="simple-table-action-buttons-container" contentEditable={false}>
      {tableRect && (
        <>
          {/* Add Row — horizontal bar at bottom of table */}
          <div
            className="simple-table-add-row-btn"
            onClick={handleAddRow}
            title="Click to add a new row"
            style={{
              left: tableRect.offsetLeft,
              width: tableRect.width - 22, // leave room for corner
              top: tableRect.offsetTop + tableRect.height + 2,
            }}
          >
            <PlusIcon className="text-text-caption" />
          </div>

          {/* Add Column — vertical bar at right of table */}
          <div
            className="simple-table-add-col-btn"
            onClick={handleAddCol}
            title="Click to add a new column"
            style={{
              left: tableRect.offsetLeft + tableRect.width + 2,
              top: tableRect.offsetTop,
              height: tableRect.height - 22, // leave room for corner
            }}
          >
            <PlusIcon className="text-text-caption" />
          </div>

          {/* Add Corner — small square at bottom-right */}
          <div
            className="simple-table-add-corner-btn"
            onClick={handleAddBoth}
            title="Click to add a new row and column"
            style={{
              left: tableRect.offsetLeft + tableRect.width + 2,
              top: tableRect.offsetTop + tableRect.height + 2,
            }}
          >
            <PlusIcon className="text-text-caption" />
          </div>
        </>
      )}
    </div>
  );
}
