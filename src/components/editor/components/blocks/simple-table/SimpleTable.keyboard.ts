import { Editor, Element, Node, NodeEntry, Path, Range, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import { BlockType } from '@/application/types';

/**
 * Find the SimpleTableCellBlock ancestor of the current selection.
 * Returns [cellNode, cellPath] or null if not inside a table cell.
 */
export function findTableCell(editor: Editor): NodeEntry<Element> | null {
  const { selection } = editor;

  if (!selection) return null;

  const cellEntry = Editor.above(editor, {
    at: selection,
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.SimpleTableCellBlock,
  });

  return (cellEntry as NodeEntry<Element>) ?? null;
}

/**
 * Find the SimpleTableBlock ancestor of the current selection.
 */
export function findTable(editor: Editor): NodeEntry<Element> | null {
  const { selection } = editor;

  if (!selection) return null;

  const tableEntry = Editor.above(editor, {
    at: selection,
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.SimpleTableBlock,
  });

  return (tableEntry as NodeEntry<Element>) ?? null;
}

/**
 * Find the SimpleTableRowBlock ancestor of the current selection.
 */
export function findTableRow(editor: Editor): NodeEntry<Element> | null {
  const { selection } = editor;

  if (!selection) return null;

  const rowEntry = Editor.above(editor, {
    at: selection,
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.SimpleTableRowBlock,
  });

  return (rowEntry as NodeEntry<Element>) ?? null;
}

/**
 * Get the cell's row and column indices within its parent table.
 */
export function getCellPosition(editor: Editor, cellEntry: NodeEntry<Element>): { rowIndex: number; colIndex: number } | null {
  const [, cellPath] = cellEntry;

  const rowEntry = Editor.above(editor, {
    at: cellPath,
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.SimpleTableRowBlock,
  });

  if (!rowEntry) return null;

  const [, rowPath] = rowEntry as NodeEntry<Element>;

  const tableEntry = Editor.above(editor, {
    at: rowPath,
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.SimpleTableBlock,
  });

  if (!tableEntry) return null;

  const colIndex = cellPath[cellPath.length - 1];
  const rowIndex = rowPath[rowPath.length - 1];

  return { rowIndex, colIndex };
}

/**
 * Get a specific cell at (rowIndex, colIndex) in the table.
 */
export function getCellAt(editor: Editor, tableEntry: NodeEntry<Element>, rowIndex: number, colIndex: number): NodeEntry<Element> | null {
  const [tableNode, tablePath] = tableEntry;
  const rows = tableNode.children as Element[];

  if (rowIndex < 0 || rowIndex >= rows.length) return null;

  const row = rows[rowIndex];
  const cells = row.children as Element[];

  if (colIndex < 0 || colIndex >= cells.length) return null;

  const cellPath = [...tablePath, rowIndex, colIndex];

  try {
    const node = Node.get(editor, cellPath);

    if (Element.isElement(node) && node.type === BlockType.SimpleTableCellBlock) {
      return [node, cellPath];
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Move cursor to the start of a cell's content.
 */
export function focusCellStart(editor: Editor, cellEntry: NodeEntry<Element>) {
  const [, cellPath] = cellEntry;

  try {
    const point = Editor.start(editor, cellPath);

    Transforms.select(editor, point);
    ReactEditor.focus(editor as ReactEditor);
  } catch {
    // cell may be empty
  }
}

/**
 * Move cursor to the end of a cell's content.
 */
export function focusCellEnd(editor: Editor, cellEntry: NodeEntry<Element>) {
  const [, cellPath] = cellEntry;

  try {
    const point = Editor.end(editor, cellPath);

    Transforms.select(editor, point);
    ReactEditor.focus(editor as ReactEditor);
  } catch {
    // cell may be empty
  }
}

/**
 * Handle Tab key: move to next cell (left-to-right, top-to-bottom).
 * Returns true if handled.
 */
export function handleTab(editor: Editor): boolean {
  const cellEntry = findTableCell(editor);

  if (!cellEntry) return false;

  const tableEntry = findTable(editor);

  if (!tableEntry) return false;

  const pos = getCellPosition(editor, cellEntry);

  if (!pos) return false;

  const [tableNode] = tableEntry;
  const rows = tableNode.children as Element[];
  const colCount = rows[0] ? (rows[0].children as Element[]).length : 0;

  let nextRow = pos.rowIndex;
  let nextCol = pos.colIndex + 1;

  if (nextCol >= colCount) {
    nextCol = 0;
    nextRow += 1;
  }

  if (nextRow >= rows.length) {
    // At last cell — don't add row for now, just stay
    return true;
  }

  const nextCell = getCellAt(editor, tableEntry, nextRow, nextCol);

  if (nextCell) {
    focusCellStart(editor, nextCell);
  }

  return true;
}

/**
 * Handle Shift+Tab: move to previous cell.
 * Returns true if handled.
 */
export function handleShiftTab(editor: Editor): boolean {
  const cellEntry = findTableCell(editor);

  if (!cellEntry) return false;

  const tableEntry = findTable(editor);

  if (!tableEntry) return false;

  const pos = getCellPosition(editor, cellEntry);

  if (!pos) return false;

  const [tableNode] = tableEntry;
  const rows = tableNode.children as Element[];
  const colCount = rows[0] ? (rows[0].children as Element[]).length : 0;

  let prevRow = pos.rowIndex;
  let prevCol = pos.colIndex - 1;

  if (prevCol < 0) {
    prevCol = colCount - 1;
    prevRow -= 1;
  }

  if (prevRow < 0) {
    // At first cell — no-op
    return true;
  }

  const prevCell = getCellAt(editor, tableEntry, prevRow, prevCol);

  if (prevCell) {
    focusCellEnd(editor, prevCell);
  }

  return true;
}

/**
 * Check if the cursor is at the very start of a cell's content.
 */
function isCursorAtCellStart(editor: Editor, cellEntry: NodeEntry<Element>): boolean {
  const { selection } = editor;

  if (!selection || !Range.isCollapsed(selection)) return false;

  const [, cellPath] = cellEntry;

  try {
    const cellStart = Editor.start(editor, cellPath);

    return Editor.isStart(editor, selection.anchor, cellPath) ||
      (Path.equals(selection.anchor.path, cellStart.path) && selection.anchor.offset === 0);
  } catch {
    return false;
  }
}

/**
 * Check if the cursor is at the very end of a cell's content.
 */
function isCursorAtCellEnd(editor: Editor, cellEntry: NodeEntry<Element>): boolean {
  const { selection } = editor;

  if (!selection || !Range.isCollapsed(selection)) return false;

  const [, cellPath] = cellEntry;

  try {
    return Editor.isEnd(editor, selection.anchor, cellPath);
  } catch {
    return false;
  }
}

/**
 * Handle Arrow Up at the top of a cell: move to same column in previous row.
 * Returns true if handled.
 */
export function handleArrowUp(editor: Editor): boolean {
  const cellEntry = findTableCell(editor);

  if (!cellEntry) return false;

  const { selection } = editor;

  if (!selection || !Range.isCollapsed(selection)) return false;

  // Only intercept if cursor is on the first block of the cell.
  // Check if we're on the first block/line of the cell
  const blockEntry = Editor.above(editor, {
    at: selection,
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.blockId !== undefined,
  });

  if (!blockEntry) return false;

  const [, blockPath] = blockEntry;

  // If this block is not the first child of the cell, let default behavior handle it
  if (blockPath[blockPath.length - 1] !== 0) return false;

  // We're in the first block of the cell — navigate to cell above
  const tableEntry = findTable(editor);

  if (!tableEntry) return false;

  const pos = getCellPosition(editor, cellEntry);

  if (!pos) return false;

  if (pos.rowIndex === 0) {
    // First row — let default behavior handle (move above table)
    return false;
  }

  const aboveCell = getCellAt(editor, tableEntry, pos.rowIndex - 1, pos.colIndex);

  if (aboveCell) {
    focusCellEnd(editor, aboveCell);
    return true;
  }

  return false;
}

/**
 * Handle Arrow Down at the bottom of a cell: move to same column in next row.
 * Returns true if handled.
 */
export function handleArrowDown(editor: Editor): boolean {
  const cellEntry = findTableCell(editor);

  if (!cellEntry) return false;

  const { selection } = editor;

  if (!selection || !Range.isCollapsed(selection)) return false;

  const [cellNode] = cellEntry;

  // Check if we're in the last block of the cell
  const blockEntry = Editor.above(editor, {
    at: selection,
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.blockId !== undefined,
  });

  if (!blockEntry) return false;

  const [, blockPath] = blockEntry;
  const cellChildren = cellNode.children as Element[];
  const lastChildIndex = cellChildren.length - 1;

  // If this block is not the last child of the cell, let default behavior handle it
  if (blockPath[blockPath.length - 1] !== lastChildIndex) return false;

  // We're in the last block of the cell — navigate to cell below
  const tableEntry = findTable(editor);

  if (!tableEntry) return false;

  const pos = getCellPosition(editor, cellEntry);

  if (!pos) return false;

  const [tableNode] = tableEntry;
  const rows = tableNode.children as Element[];

  if (pos.rowIndex >= rows.length - 1) {
    // Last row — let default behavior handle (move below table)
    return false;
  }

  const belowCell = getCellAt(editor, tableEntry, pos.rowIndex + 1, pos.colIndex);

  if (belowCell) {
    focusCellStart(editor, belowCell);
    return true;
  }

  return false;
}

/**
 * Handle Arrow Left at the start of a cell: move to end of previous cell.
 * Returns true if handled.
 */
export function handleArrowLeft(editor: Editor): boolean {
  const cellEntry = findTableCell(editor);

  if (!cellEntry) return false;

  if (!isCursorAtCellStart(editor, cellEntry)) return false;

  const tableEntry = findTable(editor);

  if (!tableEntry) return false;

  const pos = getCellPosition(editor, cellEntry);

  if (!pos) return false;

  const [tableNode] = tableEntry;
  const rows = tableNode.children as Element[];
  const colCount = rows[0] ? (rows[0].children as Element[]).length : 0;

  let prevRow = pos.rowIndex;
  let prevCol = pos.colIndex - 1;

  if (prevCol < 0) {
    prevCol = colCount - 1;
    prevRow -= 1;
  }

  if (prevRow < 0) {
    // Before first cell — let default handle (move before table)
    return false;
  }

  const prevCell = getCellAt(editor, tableEntry, prevRow, prevCol);

  if (prevCell) {
    focusCellEnd(editor, prevCell);
    return true;
  }

  return false;
}

/**
 * Handle Arrow Right at the end of a cell: move to start of next cell.
 * Returns true if handled.
 */
export function handleArrowRight(editor: Editor): boolean {
  const cellEntry = findTableCell(editor);

  if (!cellEntry) return false;

  if (!isCursorAtCellEnd(editor, cellEntry)) return false;

  const tableEntry = findTable(editor);

  if (!tableEntry) return false;

  const pos = getCellPosition(editor, cellEntry);

  if (!pos) return false;

  const [tableNode] = tableEntry;
  const rows = tableNode.children as Element[];
  const colCount = rows[0] ? (rows[0].children as Element[]).length : 0;

  let nextRow = pos.rowIndex;
  let nextCol = pos.colIndex + 1;

  if (nextCol >= colCount) {
    nextCol = 0;
    nextRow += 1;
  }

  if (nextRow >= rows.length) {
    // After last cell — let default handle (move after table)
    return false;
  }

  const nextCell = getCellAt(editor, tableEntry, nextRow, nextCol);

  if (nextCell) {
    focusCellStart(editor, nextCell);
    return true;
  }

  return false;
}

/**
 * Check if the current selection is inside a SimpleTable cell.
 */
export function isInSimpleTable(editor: Editor): boolean {
  return findTableCell(editor) !== null;
}
