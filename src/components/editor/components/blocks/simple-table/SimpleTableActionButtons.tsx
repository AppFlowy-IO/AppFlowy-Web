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

interface TableLayout {
  // Scroll container (visible area) position relative to root wrapper
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;  // visible width
  scrollHeight: number; // visible height (= table height since overflow-y is visible)
  // Table actual dimensions
  tableHeight: number;
}

/**
 * Renders add row/column/corner buttons.
 * Positioned relative to the root-wrapper, using the scroll container's
 * visible area for horizontal positioning (so buttons stay visible).
 */
export function SimpleTableActionButtons() {
  const context = useSimpleTableContext();
  const editor = useSlateStatic() as YjsEditor;
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<TableLayout | null>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const rootWrapper = container.closest('.simple-table-root-wrapper');

    if (!rootWrapper) return;

    const updateLayout = () => {
      const scrollContainer = rootWrapper.querySelector('.simple-table-scroll-container');
      const table = rootWrapper.querySelector('table');

      if (!scrollContainer || !table) return;

      const rootRect = rootWrapper.getBoundingClientRect();
      const scrollRect = scrollContainer.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();

      setLayout({
        scrollLeft: scrollRect.left - rootRect.left,
        scrollTop: scrollRect.top - rootRect.top,
        scrollWidth: scrollRect.width,
        scrollHeight: scrollRect.height,
        tableHeight: tableRect.height,
      });
    };

    updateLayout();

    const observer = new MutationObserver(() => {
      requestAnimationFrame(updateLayout);
    });

    observer.observe(rootWrapper, { childList: true, subtree: true, attributes: true });

    const resizeObserver = new ResizeObserver(updateLayout);

    resizeObserver.observe(rootWrapper);
    const scrollContainer = rootWrapper.querySelector('.simple-table-scroll-container');

    if (scrollContainer) resizeObserver.observe(scrollContainer);

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

  const scrollToRight = useCallback(() => {
    const container = containerRef.current;
    const scrollContainer = container?.closest('.simple-table-root-wrapper')?.querySelector('.simple-table-scroll-container');

    if (scrollContainer) {
      requestAnimationFrame(() => {
        scrollContainer.scrollTo({ left: scrollContainer.scrollWidth, behavior: 'smooth' });
      });
    }
  }, []);

  const handleAddCol = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!context) return;
    CustomEditor.addTableColumn(editor, context.tableNode.blockId);
    scrollToRight();
  }, [editor, context, scrollToRight]);

  const handleAddBoth = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!context) return;
    CustomEditor.addTableRowAndColumn(editor, context.tableNode.blockId);
    scrollToRight();
  }, [editor, context, scrollToRight]);

  if (!context || context.readOnly) return null;

  return (
    <div ref={containerRef} className="simple-table-action-buttons-container" contentEditable={false}>
      {layout && (
        <>
          {/* Add Row — horizontal bar below table, spans visible width */}
          <div
            className="simple-table-add-row-btn"
            onClick={handleAddRow}
            title="Click to add a new row"
            style={{
              left: layout.scrollLeft,
              width: layout.scrollWidth - 8,
              top: layout.scrollTop + layout.tableHeight,
            }}
          >
            <PlusIcon className="text-text-caption" />
          </div>

          {/* Add Column — vertical bar at right of visible area */}
          <div
            className="simple-table-add-col-btn"
            onClick={handleAddCol}
            title="Click to add a new column"
            style={{
              left: layout.scrollLeft + layout.scrollWidth,
              top: layout.scrollTop,
              height: layout.tableHeight - 8,
            }}
          >
            <PlusIcon className="text-text-caption" />
          </div>

          {/* Add Corner — bottom-right of visible area */}
          <div
            className="simple-table-add-corner-btn"
            onClick={handleAddBoth}
            title="Click to add a new row and column"
            style={{
              left: layout.scrollLeft + layout.scrollWidth,
              top: layout.scrollTop + layout.tableHeight,
            }}
          >
            <PlusIcon className="text-text-caption" />
          </div>
        </>
      )}
    </div>
  );
}
