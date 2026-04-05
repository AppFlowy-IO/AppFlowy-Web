/**
 * Yjs-level table structure operations for SimpleTable.
 *
 * All operations run inside Yjs transactions for atomicity and proper undo/redo.
 */

import * as Y from 'yjs';

import { BlockType, YBlock, YjsEditorKey, YBlocks, YChildrenMap, YMeta } from '@/application/types';
import { DEFAULT_COLUMN_WIDTH } from '@/components/editor/components/blocks/simple-table/const';

import { YjsEditor } from '../plugins/withYjs';
import { remapColumnAttributes, remapRowAttributes } from './simple-table-attributes';
import {
  copyBlockText,
  createBlock,
  dataStringTOJson,
  deleteBlock,
  executeOperations,
  generateBlockId,
  getBlock,
  getChildrenArray,
  getDocument,
  updateBlockParent,
} from './yjs';

function getSharedRoot(editor: YjsEditor) {
  return editor.sharedRoot;
}

function getTableData(tableBlock: YBlock): Record<string, unknown> {
  return dataStringTOJson(tableBlock.get(YjsEditorKey.block_data)) as Record<string, unknown>;
}

function setTableData(tableBlock: YBlock, data: Record<string, unknown>) {
  tableBlock.set(YjsEditorKey.block_data, JSON.stringify(data));
}

function getRowCount(sharedRoot: ReturnType<typeof getSharedRoot>, tableBlock: YBlock): number {
  const children = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

  return children ? children.length : 0;
}

function getColumnCount(sharedRoot: ReturnType<typeof getSharedRoot>, tableBlock: YBlock): number {
  const children = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

  if (!children || children.length === 0) return 0;

  const firstRowId = children.get(0);
  const firstRow = getBlock(firstRowId, sharedRoot);

  if (!firstRow) return 0;

  const rowChildren = getChildrenArray(firstRow.get(YjsEditorKey.block_children), sharedRoot);

  return rowChildren ? rowChildren.length : 0;
}

/**
 * Create a pure container block WITHOUT a text node.
 * Used for SimpleTableBlock and SimpleTableRowBlock which are structural containers
 * and should NOT have their own text nodes (unlike paragraph/heading blocks).
 * Having a text node on a row block creates an extra Slate child at index 0,
 * which shifts cell indices and breaks column width/alignment lookups.
 */
function createContainerBlock(sharedRoot: ReturnType<typeof getSharedRoot>, ty: BlockType, data: object = {}): YBlock {
  const block = new Y.Map();
  const id = generateBlockId();

  block.set(YjsEditorKey.block_id, id);
  block.set(YjsEditorKey.block_type, ty);
  block.set(YjsEditorKey.block_children, id);
  block.set(YjsEditorKey.block_data, JSON.stringify(data));

  const document = getDocument(sharedRoot);
  const blocks = document.get(YjsEditorKey.blocks) as YBlocks;

  blocks.set(id, block);

  const meta = document.get(YjsEditorKey.meta) as YMeta;
  const childrenMap = meta.get(YjsEditorKey.children_map) as YChildrenMap;

  childrenMap.set(id, new Y.Array());

  return block as YBlock;
}

const TABLE_CONTAINER_TYPES = [BlockType.SimpleTableBlock, BlockType.SimpleTableRowBlock, BlockType.SimpleTableCellBlock];

/**
 * Deep copy a table block, using createContainerBlock for table/row/cell blocks
 * to avoid creating unwanted text nodes that shift child indices.
 * Content blocks (paragraphs, etc.) inside cells are copied normally with text nodes.
 */
function deepCopyTableBlock(sharedRoot: ReturnType<typeof getSharedRoot>, sourceBlock: YBlock): string | null {
  try {
    const blockType = sourceBlock.get(YjsEditorKey.block_type);
    const data = dataStringTOJson(sourceBlock.get(YjsEditorKey.block_data));

    // Use container block (no text) for table structure, normal createBlock for content
    const newBlock = TABLE_CONTAINER_TYPES.includes(blockType)
      ? createContainerBlock(sharedRoot, blockType, data)
      : createBlock(sharedRoot, { ty: blockType, data });

    // Copy text content only for non-container blocks
    if (!TABLE_CONTAINER_TYPES.includes(blockType)) {
      copyBlockText(sharedRoot, sourceBlock, newBlock);
    }

    // Recursively copy children
    const sourceChildren = getChildrenArray(sourceBlock.get(YjsEditorKey.block_children), sharedRoot);
    const targetChildren = getChildrenArray(newBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (sourceChildren && targetChildren) {
      for (let i = 0; i < sourceChildren.length; i++) {
        const childId = sourceChildren.get(i);
        const childBlock = getBlock(childId, sharedRoot);

        if (!childBlock) continue;

        const newChildId = deepCopyTableBlock(sharedRoot, childBlock);

        if (!newChildId) continue;

        const newChild = getBlock(newChildId, sharedRoot);

        if (!newChild) continue;

        updateBlockParent(sharedRoot, newChild, newBlock, i);
      }
    }

    return newBlock.get(YjsEditorKey.block_id);
  } catch (error) {
    console.error('Error in deepCopyTableBlock:', error);
    return null;
  }
}

/**
 * Create an empty cell block with a paragraph child.
 * The cell itself is a container (no text node).
 * The paragraph inside the cell HAS a text node for content editing.
 */
function createEmptyCell(sharedRoot: ReturnType<typeof getSharedRoot>): YBlock {
  const cell = createContainerBlock(sharedRoot, BlockType.SimpleTableCellBlock);

  const paragraph = createBlock(sharedRoot, {
    ty: BlockType.Paragraph,
    data: {},
  });

  updateBlockParent(sharedRoot, paragraph, cell, 0);

  return cell;
}

/**
 * Create a new row with the given number of empty cells.
 * The row is a container (no text node) — only cell children.
 */
function createEmptyRow(sharedRoot: ReturnType<typeof getSharedRoot>, colCount: number): YBlock {
  const row = createContainerBlock(sharedRoot, BlockType.SimpleTableRowBlock);

  for (let i = 0; i < colCount; i++) {
    const cell = createEmptyCell(sharedRoot);

    updateBlockParent(sharedRoot, cell, row, i);
  }

  return row;
}

// ============================================================================
// Row Operations
// ============================================================================

/**
 * Append a new row at the end of the table.
 */
export function addRowToTable(editor: YjsEditor, tableBlockId: string) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const colCount = getColumnCount(sharedRoot, tableBlock);
    const rowCount = getRowCount(sharedRoot, tableBlock);
    const newRow = createEmptyRow(sharedRoot, colCount);

    updateBlockParent(sharedRoot, newRow, tableBlock, rowCount);
  });

  executeOperations(sharedRoot, operations, 'addRowToTable');
}

/**
 * Insert a row at a specific index.
 */
export function insertRowAtIndex(editor: YjsEditor, tableBlockId: string, rowIndex: number) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const colCount = getColumnCount(sharedRoot, tableBlock);
    const newRow = createEmptyRow(sharedRoot, colCount);

    updateBlockParent(sharedRoot, newRow, tableBlock, rowIndex);

    // Remap row attributes
    const data = getTableData(tableBlock);
    const newData = remapRowAttributes(data, 'insert', rowIndex);

    setTableData(tableBlock, newData);
  });

  executeOperations(sharedRoot, operations, 'insertRowAtIndex');
}

/**
 * Delete a row at a specific index. Guards against deleting the last row.
 */
export function deleteRow(editor: YjsEditor, tableBlockId: string, rowIndex: number) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const rowCount = getRowCount(sharedRoot, tableBlock);

    if (rowCount <= 1) return; // Don't delete the last row

    const children = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!children || rowIndex >= children.length) return;

    const rowId = children.get(rowIndex);

    deleteBlock(sharedRoot, rowId);

    // Remap row attributes
    const data = getTableData(tableBlock);
    const newData = remapRowAttributes(data, 'delete', rowIndex);

    setTableData(tableBlock, newData);
  });

  executeOperations(sharedRoot, operations, 'deleteRow');
}

/**
 * Duplicate a row at a specific index.
 */
export function duplicateRow(editor: YjsEditor, tableBlockId: string, rowIndex: number) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const children = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!children || rowIndex >= children.length) return;

    const sourceRowId = children.get(rowIndex);
    const sourceRow = getBlock(sourceRowId, sharedRoot);

    if (!sourceRow) return;

    const newRowId = deepCopyTableBlock(sharedRoot, sourceRow);

    if (!newRowId) return;

    const newRow = getBlock(newRowId, sharedRoot);

    if (!newRow) return;

    updateBlockParent(sharedRoot, newRow, tableBlock, rowIndex + 1);

    // Remap row attributes
    const data = getTableData(tableBlock);
    const newData = remapRowAttributes(data, 'duplicate', rowIndex);

    setTableData(tableBlock, newData);
  });

  executeOperations(sharedRoot, operations, 'duplicateRow');
}

// ============================================================================
// Column Operations
// ============================================================================

/**
 * Append a new column at the end of the table.
 * Sets the new column's width to match existing columns (uses first column's width or DEFAULT_COLUMN_WIDTH).
 */
export function addColumnToTable(editor: YjsEditor, tableBlockId: string) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const colCount = getColumnCount(sharedRoot, tableBlock);
    const rowChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren) return;

    for (let i = 0; i < rowChildren.length; i++) {
      const rowId = rowChildren.get(i);
      const row = getBlock(rowId, sharedRoot);

      if (!row) continue;

      const cellCount = getChildrenArray(row.get(YjsEditorKey.block_children), sharedRoot)?.length ?? 0;
      const cell = createEmptyCell(sharedRoot);

      updateBlockParent(sharedRoot, cell, row, cellCount);
    }

    // Set the new column's width to match existing columns
    const data = getTableData(tableBlock);
    const columnWidths = (data.column_widths || {}) as Record<string, number>;
    // Use the first column's width as reference, or DEFAULT_COLUMN_WIDTH
    const refWidth = columnWidths['0'] || DEFAULT_COLUMN_WIDTH;

    columnWidths[String(colCount)] = refWidth;
    data.column_widths = columnWidths;
    setTableData(tableBlock, data);
  });

  executeOperations(sharedRoot, operations, 'addColumnToTable');
}

/**
 * Insert a column at a specific index.
 */
export function insertColumnAtIndex(editor: YjsEditor, tableBlockId: string, colIndex: number) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const rowChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren) return;

    for (let i = 0; i < rowChildren.length; i++) {
      const rowId = rowChildren.get(i);
      const row = getBlock(rowId, sharedRoot);

      if (!row) continue;

      const cell = createEmptyCell(sharedRoot);

      updateBlockParent(sharedRoot, cell, row, colIndex);
    }

    // Remap column attributes
    const data = getTableData(tableBlock);
    const newData = remapColumnAttributes(data, 'insert', colIndex);

    // Set new column's width to match existing pattern
    const columnWidths = (newData.column_widths || {}) as Record<string, number>;
    const refWidth = columnWidths[String(colIndex > 0 ? colIndex - 1 : colIndex + 1)] || DEFAULT_COLUMN_WIDTH;

    columnWidths[String(colIndex)] = refWidth;
    newData.column_widths = columnWidths;

    setTableData(tableBlock, newData);
  });

  executeOperations(sharedRoot, operations, 'insertColumnAtIndex');
}

/**
 * Delete a column at a specific index. Guards against deleting the last column.
 */
export function deleteColumn(editor: YjsEditor, tableBlockId: string, colIndex: number) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const colCount = getColumnCount(sharedRoot, tableBlock);

    if (colCount <= 1) return; // Don't delete the last column

    const rowChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren) return;

    for (let i = 0; i < rowChildren.length; i++) {
      const rowId = rowChildren.get(i);
      const row = getBlock(rowId, sharedRoot);

      if (!row) continue;

      const cellChildren = getChildrenArray(row.get(YjsEditorKey.block_children), sharedRoot);

      if (!cellChildren || colIndex >= cellChildren.length) continue;

      const cellId = cellChildren.get(colIndex);

      deleteBlock(sharedRoot, cellId);
    }

    // Remap column attributes
    const data = getTableData(tableBlock);
    const newData = remapColumnAttributes(data, 'delete', colIndex);

    setTableData(tableBlock, newData);
  });

  executeOperations(sharedRoot, operations, 'deleteColumn');
}

/**
 * Duplicate a column at a specific index.
 */
export function duplicateColumn(editor: YjsEditor, tableBlockId: string, colIndex: number) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const rowChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren) return;

    for (let i = 0; i < rowChildren.length; i++) {
      const rowId = rowChildren.get(i);
      const row = getBlock(rowId, sharedRoot);

      if (!row) continue;

      const cellChildren = getChildrenArray(row.get(YjsEditorKey.block_children), sharedRoot);

      if (!cellChildren || colIndex >= cellChildren.length) continue;

      const sourceCellId = cellChildren.get(colIndex);
      const sourceCell = getBlock(sourceCellId, sharedRoot);

      if (!sourceCell) continue;

      const newCellId = deepCopyTableBlock(sharedRoot, sourceCell);

      if (!newCellId) continue;

      const newCell = getBlock(newCellId, sharedRoot);

      if (!newCell) continue;

      updateBlockParent(sharedRoot, newCell, row, colIndex + 1);
    }

    // Remap column attributes
    const data = getTableData(tableBlock);
    const newData = remapColumnAttributes(data, 'duplicate', colIndex);

    setTableData(tableBlock, newData);
  });

  executeOperations(sharedRoot, operations, 'duplicateColumn');
}

// ============================================================================
// Combined Operations
// ============================================================================

/**
 * Add both a row and a column.
 */
export function addRowAndColumnToTable(editor: YjsEditor, tableBlockId: string) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    // First add column to all existing rows
    const rowChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren) return;

    for (let i = 0; i < rowChildren.length; i++) {
      const rowId = rowChildren.get(i);
      const row = getBlock(rowId, sharedRoot);

      if (!row) continue;

      const cellCount = getChildrenArray(row.get(YjsEditorKey.block_children), sharedRoot)?.length ?? 0;
      const cell = createEmptyCell(sharedRoot);

      updateBlockParent(sharedRoot, cell, row, cellCount);
    }

    // Then add new row (with the new column count)
    const colCount = getColumnCount(sharedRoot, tableBlock);
    const rowCount = getRowCount(sharedRoot, tableBlock);
    const newRow = createEmptyRow(sharedRoot, colCount);

    updateBlockParent(sharedRoot, newRow, tableBlock, rowCount);
  });

  executeOperations(sharedRoot, operations, 'addRowAndColumnToTable');
}

// ============================================================================
// Content Operations
// ============================================================================

/**
 * Clear all content in cells of a specific row.
 */
export function clearRowContent(editor: YjsEditor, tableBlockId: string, rowIndex: number) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const rowChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren || rowIndex >= rowChildren.length) return;

    const rowId = rowChildren.get(rowIndex);
    const row = getBlock(rowId, sharedRoot);

    if (!row) return;

    const cellChildren = getChildrenArray(row.get(YjsEditorKey.block_children), sharedRoot);

    if (!cellChildren) return;

    // Delete all cells and replace with empty ones
    const cellIds = cellChildren.toArray();

    for (const cellId of cellIds) {
      deleteBlock(sharedRoot, cellId);
    }

    for (let i = 0; i < cellIds.length; i++) {
      const cell = createEmptyCell(sharedRoot);

      updateBlockParent(sharedRoot, cell, row, i);
    }
  });

  executeOperations(sharedRoot, operations, 'clearRowContent');
}

/**
 * Clear all content in cells of a specific column.
 */
export function clearColumnContent(editor: YjsEditor, tableBlockId: string, colIndex: number) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const rowChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren) return;

    for (let i = 0; i < rowChildren.length; i++) {
      const rowId = rowChildren.get(i);
      const row = getBlock(rowId, sharedRoot);

      if (!row) continue;

      const cellChildren = getChildrenArray(row.get(YjsEditorKey.block_children), sharedRoot);

      if (!cellChildren || colIndex >= cellChildren.length) continue;

      const cellId = cellChildren.get(colIndex);

      deleteBlock(sharedRoot, cellId);

      const cell = createEmptyCell(sharedRoot);

      updateBlockParent(sharedRoot, cell, row, colIndex);
    }
  });

  executeOperations(sharedRoot, operations, 'clearColumnContent');
}

// ============================================================================
// Reorder Operations
// ============================================================================

/**
 * Reorder a row from one index to another.
 */
export function reorderRow(editor: YjsEditor, tableBlockId: string, fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;

  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const rowChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren || fromIndex >= rowChildren.length || toIndex >= rowChildren.length) return;

    const sourceRowId = rowChildren.get(fromIndex);
    const sourceRow = getBlock(sourceRowId, sharedRoot);

    if (!sourceRow) return;

    // Deep copy, delete original, insert copy at target
    const newRowId = deepCopyTableBlock(sharedRoot, sourceRow);

    if (!newRowId) return;

    const newRow = getBlock(newRowId, sharedRoot);

    if (!newRow) return;

    deleteBlock(sharedRoot, sourceRowId);

    // Adjust toIndex since we deleted a row
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;

    updateBlockParent(sharedRoot, newRow, tableBlock, adjustedToIndex);

    // Remap row attributes
    const data = getTableData(tableBlock);
    const newData = remapRowAttributes(data, 'reorder', fromIndex, toIndex);

    setTableData(tableBlock, newData);
  });

  executeOperations(sharedRoot, operations, 'reorderRow');
}

/**
 * Reorder a column from one index to another.
 */
export function reorderColumn(editor: YjsEditor, tableBlockId: string, fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return;

  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const rowChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren) return;

    for (let i = 0; i < rowChildren.length; i++) {
      const rowId = rowChildren.get(i);
      const row = getBlock(rowId, sharedRoot);

      if (!row) continue;

      const cellChildren = getChildrenArray(row.get(YjsEditorKey.block_children), sharedRoot);

      if (!cellChildren || fromIndex >= cellChildren.length) continue;

      const sourceCellId = cellChildren.get(fromIndex);
      const sourceCell = getBlock(sourceCellId, sharedRoot);

      if (!sourceCell) continue;

      const newCellId = deepCopyTableBlock(sharedRoot, sourceCell);

      if (!newCellId) continue;

      const newCell = getBlock(newCellId, sharedRoot);

      if (!newCell) continue;

      deleteBlock(sharedRoot, sourceCellId);

      const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;

      updateBlockParent(sharedRoot, newCell, row, adjustedToIndex);
    }

    // Remap column attributes
    const data = getTableData(tableBlock);
    const newData = remapColumnAttributes(data, 'reorder', fromIndex, toIndex);

    setTableData(tableBlock, newData);
  });

  executeOperations(sharedRoot, operations, 'reorderColumn');
}

// ============================================================================
// Table Style Operations
// ============================================================================

/**
 * Update the table's block data (column widths, colors, alignment, headers, etc.).
 */
export function updateTableData(editor: YjsEditor, tableBlockId: string, updates: Record<string, unknown>) {
  const sharedRoot = getSharedRoot(editor);
  const operations: (() => void)[] = [];

  operations.push(() => {
    const tableBlock = getBlock(tableBlockId, sharedRoot);

    if (!tableBlock) return;

    const data = getTableData(tableBlock);
    const newData = { ...data, ...updates };

    setTableData(tableBlock, newData);
  });

  executeOperations(sharedRoot, operations, 'updateTableData');
}

// ============================================================================
// Table Creation
// ============================================================================

/**
 * Create a new SimpleTable with given dimensions.
 * Returns the new table block's ID.
 */
export function createSimpleTable(
  editor: YjsEditor,
  parentBlockId: string,
  rows: number,
  cols: number,
  insertIndex?: number
): string | undefined {
  const sharedRoot = getSharedRoot(editor);
  let tableId: string | undefined;
  const operations: (() => void)[] = [];

  operations.push(() => {
    const parentBlock = getBlock(parentBlockId, sharedRoot);

    if (!parentBlock) return;

    const table = createContainerBlock(sharedRoot, BlockType.SimpleTableBlock);

    tableId = table.get(YjsEditorKey.block_id);

    for (let r = 0; r < rows; r++) {
      const row = createEmptyRow(sharedRoot, cols);

      updateBlockParent(sharedRoot, row, table, r);
    }

    const index = insertIndex ?? getChildrenArray(parentBlock.get(YjsEditorKey.block_children), sharedRoot)?.length ?? 0;

    updateBlockParent(sharedRoot, table, parentBlock, index);
  });

  executeOperations(sharedRoot, operations, 'createSimpleTable');

  return tableId;
}
