import { useEffect, useRef, useState } from 'react';

import { useSimpleTableContext } from './SimpleTableContext';
import { ColumnActionTrigger, RowActionTrigger } from './SimpleTableContextMenu';

interface ElementBounds {
  top: number;
  height: number;
  left: number;
  width: number;
}

interface TriggerPosition {
  viewport: ElementBounds | null;
  table: ElementBounds | null;
  row: ElementBounds | null;
  col: ElementBounds | null;
}

function sameBounds(a: ElementBounds | null, b: ElementBounds | null) {
  return a === b || Boolean(a && b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
}

/**
 * Renders row/column action trigger buttons at the root-wrapper level
 * (outside TableContainer to avoid overflow clipping).
 * Buttons are positioned ON the table border lines, straddling the edge.
 *
 * Uses the table element's bounding rect relative to the root wrapper
 * to correctly position triggers even when the table is horizontally scrolled.
 * Selection rectangles share those coordinates but are clipped separately,
 * so the menu buttons can straddle the table's edges.
 */
export function SimpleTableActionOverlay() {
  const context = useSimpleTableContext();
  const [pos, setPos] = useState<TriggerPosition>({ viewport: null, table: null, row: null, col: null });
  const overlayRef = useRef<HTMLDivElement>(null);

  const hoveringCell = context?.hoveringCell;
  const hoveringRow = hoveringCell?.row;
  const hoveringColumn = hoveringCell?.col;
  const readOnly = context?.readOnly ?? true;
  const tableBlockId = context?.tableNode.blockId;

  useEffect(() => {
    if (!tableBlockId) {
      setPos({ viewport: null, table: null, row: null, col: null });
      return;
    }

    const overlay = overlayRef.current;

    if (!overlay) return;

    const rootWrapper = overlay.parentElement;

    if (!rootWrapper) return;

    const tableEl = rootWrapper.querySelector('table');
    const scrollContainer = rootWrapper.querySelector('.simple-table-scroll-container');

    if (!tableEl || !scrollContainer) return;
    let positionFrame: number | null = null;

    const updatePosition = () => {
      const rootRect = rootWrapper.getBoundingClientRect();
      const tableRect = tableEl.getBoundingClientRect();
      const viewportRect = scrollContainer.getBoundingClientRect();
      // Find the hovered row
      const rowEl = hoveringRow === undefined ? null : tableEl.querySelector(`tr[data-row-index="${hoveringRow}"]`);
      // Find a cell in the hovered column
      const colEl = hoveringColumn === undefined ? null : tableEl.querySelector(`td[data-cell-index="${hoveringColumn}"]`);

      const newPos: TriggerPosition = {
        viewport: {
          top: viewportRect.top - rootRect.top,
          height: viewportRect.height,
          left: viewportRect.left - rootRect.left,
          width: viewportRect.width,
        },
        table: {
          top: tableRect.top - rootRect.top,
          height: tableRect.height,
          left: tableRect.left - rootRect.left,
          width: tableRect.width,
        },
        row: null,
        col: null,
      };

      if (rowEl) {
        const rowRect = rowEl.getBoundingClientRect();

        newPos.row = {
          top: rowRect.top - rootRect.top,
          height: rowRect.height,
          // The row selection follows the full table; its button is anchored
          // separately to the visible viewport edge.
          left: tableRect.left - rootRect.left,
          width: tableRect.width,
        };
      }

      if (colEl) {
        const colRect = colEl.getBoundingClientRect();

        newPos.col = {
          left: colRect.left - rootRect.left,
          width: colRect.width,
          // Use the TABLE's top edge
          top: tableRect.top - rootRect.top,
          height: tableRect.height,
        };
      }

      setPos((previous) => sameBounds(previous.viewport, newPos.viewport) && sameBounds(previous.table, newPos.table) &&
        sameBounds(previous.row, newPos.row) && sameBounds(previous.col, newPos.col) ? previous : newPos);
    };

    const schedulePosition = () => {
      if (positionFrame !== null) return;
      positionFrame = requestAnimationFrame(() => {
        positionFrame = null;
        updatePosition();
      });
    };

    updatePosition();
    const observer = new ResizeObserver(schedulePosition);

    observer.observe(tableEl);
    observer.observe(scrollContainer);
    scrollContainer.addEventListener('scroll', schedulePosition, { passive: true });
    return () => {
      observer.disconnect();
      scrollContainer.removeEventListener('scroll', schedulePosition);
      if (positionFrame !== null) cancelAnimationFrame(positionFrame);
    };
  }, [hoveringRow, hoveringColumn, tableBlockId]);

  if (!context) return null;
  const viewportLeft = pos.viewport?.left ?? 0;
  const viewportRight = viewportLeft + (pos.viewport?.width ?? 0);
  const columnLeft = Math.min(viewportRight, Math.max(viewportLeft, pos.col?.left ?? 0));
  const columnRight = Math.min(viewportRight, Math.max(viewportLeft, (pos.col?.left ?? 0) + (pos.col?.width ?? 0)));
  const visibleColumnWidth = Math.max(0, columnRight - columnLeft);
  const hasHorizontalOverflow = pos.table && pos.viewport && pos.table.width > pos.viewport.width;

  return (
    <div ref={overlayRef} className="simple-table-action-overlay" contentEditable={false}>
      <div className={`simple-table-selection-viewport ${hasHorizontalOverflow ? 'clipped' : ''}`} aria-hidden="true">
        <div className="simple-table-selection-layer">
          {pos.table && <div className="simple-table-block-selection" style={pos.table} />}
          {!readOnly && pos.row && hoveringCell && (
            <div className="simple-table-menu-selection row" style={pos.row} />
          )}
          {!readOnly && pos.col && hoveringCell && (
            <div className="simple-table-menu-selection column" style={pos.col} />
          )}
        </div>
      </div>
      {!readOnly && pos.row && hoveringCell && (
        <div
          className="simple-table-row-trigger-container"
          style={{
            top: pos.row.top,
            height: pos.row.height,
            left: viewportLeft,
          }}
        >
          <RowActionTrigger rowIndex={hoveringCell.row} />
        </div>
      )}
      {!readOnly && pos.col && hoveringCell && (
        <div
          className="simple-table-col-trigger-container"
          style={{
            left: columnLeft,
            width: visibleColumnWidth,
            top: pos.col.top,
            visibility: visibleColumnWidth > 0 ? 'visible' : 'hidden',
          }}
        >
          <ColumnActionTrigger colIndex={hoveringCell.col} />
        </div>
      )}
    </div>
  );
}
