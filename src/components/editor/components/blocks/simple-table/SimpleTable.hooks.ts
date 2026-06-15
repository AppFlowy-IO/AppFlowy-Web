import { useEffect, useRef, useState } from 'react';
import { Editor, Element, Path, Range } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { SimpleTableNode } from '@/components/editor/editor.type';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

import {
  handleArrowDown,
  handleArrowLeft,
  handleArrowRight,
  handleArrowUp,
  handleShiftTab,
  handleTab,
} from './SimpleTable.keyboard';

export function useSimpleTable(node: SimpleTableNode) {
  const editor = useSlateStatic();
  const [inCurrentTable, setInCurrentTable] = useState(false);
  const [isIntersection, setIsIntersection] = useState(false);
  const prevHighlightRef = useRef<Map<string, CellHighlightInfo>>(new Map());

  useEffect(() => {
    const { onChange } = editor;

    editor.onChange = () => {
      onChange();
      const { selection } = editor;

      if (!selection) {
        clearCellHighlights(prevHighlightRef.current);
        prevHighlightRef.current = new Map();
        return;
      }

      let tablePath: Path;

      try {
        tablePath = ReactEditor.findPath(editor, node);
      } catch {
        return;
      }

      const [start, end] = Editor.edges(editor, selection);
      const isAncestor = Path.isAncestor(tablePath, end.path) && Path.isAncestor(tablePath, start.path);
      const isIntersecting = !isAncestor && Range.intersection(selection, Editor.range(editor, tablePath));

      setIsIntersection(!!isIntersecting);
      setInCurrentTable(isAncestor);

      // Highlight selected cells
      if (isAncestor) {
        const selectedCells = getSelectedCellHighlights(editor, selection, tablePath);

        updateCellHighlights(prevHighlightRef.current, selectedCells);
        prevHighlightRef.current = selectedCells;
      } else {
        clearCellHighlights(prevHighlightRef.current);
        prevHighlightRef.current = new Map();
      }
    };

    return () => {
      editor.onChange = onChange;
      clearCellHighlights(prevHighlightRef.current);
    };
  }, [editor, node]);

  useEffect(() => {
    const editorDom = ReactEditor.toDOMNode(editor, editor);

    const handleKeydown = (event: KeyboardEvent) => {
      if (!inCurrentTable) return;

      switch (true) {
        case createHotkey(HOT_KEY_NAME.UP)(event): {
          if (handleArrowUp(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.DOWN)(event): {
          if (handleArrowDown(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.LEFT)(event): {
          if (handleArrowLeft(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.RIGHT)(event): {
          if (handleArrowRight(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.INDENT_BLOCK)(event): {
          if (handleTab(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }

        case createHotkey(HOT_KEY_NAME.OUTDENT_BLOCK)(event): {
          if (handleShiftTab(editor)) {
            event.stopPropagation();
            event.preventDefault();
          }

          break;
        }
      }
    };

    editorDom.addEventListener('keydown', handleKeydown);

    return () => {
      editorDom.removeEventListener('keydown', handleKeydown);
    };
  }, [editor, inCurrentTable]);

  return {
    isIntersection,
  };
}

interface CellHighlightInfo {
  blockId: string;
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Get the blockIds of all cells that the current selection covers,
 * with edge flags for drawing the merged rectangle border.
 */
function getSelectedCellHighlights(editor: Editor, selection: Range, tablePath: Path): Map<string, CellHighlightInfo> {
  const highlights = new Map<string, CellHighlightInfo>();

  try {
    const [start, end] = Editor.edges(editor, selection);
    const tablePathLen = tablePath.length;

    if (start.path.length <= tablePathLen + 1 || end.path.length <= tablePathLen + 1) {
      return highlights;
    }

    const startRow = start.path[tablePathLen];
    const startCol = start.path[tablePathLen + 1];
    const endRow = end.path[tablePathLen];
    const endCol = end.path[tablePathLen + 1];

    if (startRow === undefined || startCol === undefined ||
        endRow === undefined || endCol === undefined) {
      return highlights;
    }

    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);

    const tableNode = Editor.node(editor, tablePath)[0] as Element;

    for (let r = minRow; r <= maxRow; r++) {
      const row = (tableNode.children as Element[])[r];

      if (!row) continue;

      for (let c = minCol; c <= maxCol; c++) {
        const cell = (row.children as Element[])[c];

        if (!cell) continue;

        const blockId = (cell as Element & { blockId?: string }).blockId;

        if (blockId) {
          highlights.set(blockId, {
            blockId,
            top: r === minRow,
            bottom: r === maxRow,
            left: c === minCol,
            right: c === maxCol,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  return highlights;
}

const HIGHLIGHT_CLASSES = ['simple-table-cell-selected', 'sel-top', 'sel-bottom', 'sel-left', 'sel-right'];

/**
 * Apply/remove highlight CSS classes on table cells based on selection changes.
 * Uses directional classes (sel-top/bottom/left/right) to draw a merged rectangle border.
 */
function updateCellHighlights(prev: Map<string, CellHighlightInfo>, current: Map<string, CellHighlightInfo>) {
  // Remove highlight from cells no longer selected
  for (const [id] of prev) {
    if (!current.has(id)) {
      const el = document.querySelector(`td[data-block-cell="${id}"]`);

      if (el) el.classList.remove(...HIGHLIGHT_CLASSES);
    }
  }

  // Add/update highlight on selected cells
  for (const [id, info] of current) {
    const el = document.querySelector(`td[data-block-cell="${id}"]`);

    if (!el) continue;

    el.classList.add('simple-table-cell-selected');
    el.classList.toggle('sel-top', info.top);
    el.classList.toggle('sel-bottom', info.bottom);
    el.classList.toggle('sel-left', info.left);
    el.classList.toggle('sel-right', info.right);
  }
}

/**
 * Remove all cell highlights.
 */
function clearCellHighlights(prev: Map<string, CellHighlightInfo>) {
  for (const [id] of prev) {
    const el = document.querySelector(`td[data-block-cell="${id}"]`);

    if (el) el.classList.remove(...HIGHLIGHT_CLASSES);
  }
}
