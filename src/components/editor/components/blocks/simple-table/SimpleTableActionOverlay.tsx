import { useEffect, useRef, useState } from 'react';

import { ColumnActionTrigger, RowActionTrigger } from './SimpleTableContextMenu';
import { useSimpleTableContext } from './SimpleTableContext';

interface TriggerPosition {
  row: { top: number; height: number; left: number } | null;
  col: { left: number; width: number; top: number } | null;
}

/**
 * Renders row/column action trigger buttons at the root-wrapper level
 * (outside TableContainer to avoid overflow clipping).
 * Buttons are positioned ON the table border lines, straddling the edge.
 *
 * Uses the table element's bounding rect relative to the root wrapper
 * to correctly position triggers even when the table is horizontally scrolled.
 */
export function SimpleTableActionOverlay() {
  const context = useSimpleTableContext();
  const [pos, setPos] = useState<TriggerPosition>({ row: null, col: null });
  const overlayRef = useRef<HTMLDivElement>(null);

  const hoveringCell = context?.hoveringCell;
  const readOnly = context?.readOnly ?? true;
  const tableBlockId = context?.tableNode.blockId;

  useEffect(() => {
    if (!hoveringCell || !tableBlockId) {
      setPos({ row: null, col: null });
      return;
    }

    const overlay = overlayRef.current;

    if (!overlay) return;

    const rootWrapper = overlay.parentElement;

    if (!rootWrapper) return;

    const rootRect = rootWrapper.getBoundingClientRect();
    const tableEl = rootWrapper.querySelector('table');

    if (!tableEl) return;

    const tableRect = tableEl.getBoundingClientRect();

    // Find the hovered row
    const rowEl = tableEl.querySelector(`tr[data-row-index="${hoveringCell.row}"]`);
    // Find a cell in the hovered column
    const colEl = tableEl.querySelector(`td[data-cell-index="${hoveringCell.col}"]`);

    const newPos: TriggerPosition = { row: null, col: null };

    if (rowEl) {
      const rowRect = rowEl.getBoundingClientRect();

      newPos.row = {
        top: rowRect.top - rootRect.top,
        height: rowRect.height,
        // Use the TABLE's left edge (not cell's), so the row trigger
        // stays at the table border even when horizontally scrolled
        left: tableRect.left - rootRect.left,
      };
    }

    if (colEl) {
      const colRect = colEl.getBoundingClientRect();

      newPos.col = {
        left: colRect.left - rootRect.left,
        width: colRect.width,
        // Use the TABLE's top edge
        top: tableRect.top - rootRect.top,
      };
    }

    setPos(newPos);
  }, [hoveringCell, tableBlockId]);

  if (readOnly || !context) return null;

  return (
    <div ref={overlayRef} className="simple-table-action-overlay" contentEditable={false}>
      {pos.row && hoveringCell && (
        <div
          className="simple-table-row-trigger-container"
          style={{
            top: pos.row.top,
            height: pos.row.height,
            left: pos.row.left,
          }}
        >
          <RowActionTrigger rowIndex={hoveringCell.row} />
        </div>
      )}
      {pos.col && hoveringCell && (
        <div
          className="simple-table-col-trigger-container"
          style={{
            left: pos.col.left,
            width: pos.col.width,
            top: pos.col.top,
          }}
        >
          <ColumnActionTrigger colIndex={hoveringCell.col} />
        </div>
      )}
    </div>
  );
}
