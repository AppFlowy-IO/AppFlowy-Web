import { Editor, Element as SlateElement, Operation, Point, Range, Text } from 'slate';

import { Log } from '@/utils/log';

/**
 * Transform selection/cursor position through Slate operations
 * @param editor - Slate editor instance
 * @param originalSelection - Selection before operations
 * @param operations - Function containing operations to execute
 * @returns Transformed selection after operations, null if failed
 */
export function transformSelectionWithOperations(
  editor: Editor,
  originalSelection: Range | null,
  operations: () => void
): Range | null {
  // Early return if no selection to transform
  if (!originalSelection) {
    Editor.withoutNormalizing(editor, operations);
    return null;
  }

  // Save original selection state
  const savedSelection = { ...originalSelection };

  // Intercept and record all operations
  const appliedOps: Operation[] = [];
  const originalApply = editor.apply;

  editor.apply = (op: Operation) => {
    appliedOps.push(op);
    originalApply.call(editor, op);
  };

  try {
    // Execute operations without normalization for consistency
    Editor.withoutNormalizing(editor, operations);

    // Transform selection through each operation sequentially
    let transformedSelection: Range = savedSelection;

    for (const op of appliedOps) {
      const newAnchor = Point.transform(transformedSelection.anchor, op);
      const newFocus = Point.transform(transformedSelection.focus, op);

      if (newAnchor && newFocus) {
        transformedSelection = { anchor: newAnchor, focus: newFocus };
      } else {
        // Transformation failed, return null
        return null;
      }
    }

    // Validate transformed selection
    if (isValidSelection(editor, transformedSelection)) {
      return transformedSelection;
    }

    return null;
  } catch (error) {
    console.error('Selection transform failed:', error);
    return null;
  } finally {
    // Restore original apply method
    editor.apply = originalApply;
  }
}

/**
 * Validate if selection is valid in current editor state
 */
export function isValidSelection(editor: Editor, selection: Range): boolean {
  try {
    // Check if paths exist in current document
    if (!Editor.hasPath(editor, selection.anchor.path) || !Editor.hasPath(editor, selection.focus.path)) {
      return false;
    }

    // Check if offsets are within valid range
    const anchorText = Editor.string(editor, selection.anchor.path);
    const focusText = Editor.string(editor, selection.focus.path);

    return (
      selection.anchor.offset >= 0 &&
      selection.anchor.offset <= anchorText.length &&
      selection.focus.offset >= 0 &&
      selection.focus.offset <= focusText.length
    );
  } catch (error) {
    return false;
  }
}

/**
 * Find the nearest valid selection when the original selection cannot be transformed
 * @param editor - Slate editor instance
 * @param originalSelection - The original selection (may be null or invalid)
 * @returns A valid selection range, or null if no valid position can be found
 */
export function findNearestValidSelection(editor: Editor, originalSelection: Range | null): Range | null {
  try {
    Log.debug('🎯 Finding nearest valid selection for:', originalSelection);

    // Strategy 1: Try to fix the original selection if it exists
    if (originalSelection) {
      const fixedSelection = tryFixSelection(editor, originalSelection);

      if (fixedSelection) {
        Log.debug('✅ Fixed original selection:', fixedSelection);
        return fixedSelection;
      }
    }

    // Strategy 2: Find nearest valid text node
    if (originalSelection) {
      const nearestSelection = findNearestTextNode(editor, originalSelection.anchor.path);

      if (nearestSelection) {
        Log.debug('✅ Found nearest text node selection:', nearestSelection);
        return nearestSelection;
      }
    }

    // Strategy 3: Fall back to document start
    const startSelection = findDocumentStart(editor);

    if (startSelection) {
      Log.debug('✅ Using document start selection:', startSelection);
      return startSelection;
    }

    // Strategy 4: Fall back to document end
    const endSelection = findDocumentEnd(editor);

    if (endSelection) {
      Log.debug('✅ Using document end selection:', endSelection);
      return endSelection;
    }

    console.warn('⚠️ No valid selection found');
    return null;
  } catch (error) {
    console.error('❌ Error finding nearest valid selection:', error);
    return null;
  }
}

/**
 * Try to fix an invalid selection by adjusting offsets
 */
function tryFixSelection(editor: Editor, selection: Range): Range | null {
  try {
    const { anchor, focus } = selection;

    // Try to fix anchor path
    const fixedAnchor = tryFixPoint(editor, anchor);
    const fixedFocus = tryFixPoint(editor, focus);

    if (fixedAnchor && fixedFocus) {
      const fixedSelection = { anchor: fixedAnchor, focus: fixedFocus };

      if (isValidSelection(editor, fixedSelection)) {
        return fixedSelection;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Try to fix a point by adjusting path and offset
 */
function tryFixPoint(editor: Editor, point: Point): Point | null {
  try {
    // If path exists, try to fix offset
    if (Editor.hasPath(editor, point.path)) {
      const text = Editor.string(editor, point.path);
      const clampedOffset = Math.max(0, Math.min(point.offset, text.length));

      return { path: point.path, offset: clampedOffset };
    }

    // If path doesn't exist, try to find nearest valid path
    const nearestPath = findNearestValidPath(editor, point.path);

    if (nearestPath) {
      const text = Editor.string(editor, nearestPath);

      return { path: nearestPath, offset: Math.min(point.offset, text.length) };
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Find the nearest valid path to the given path
 */
function findNearestValidPath(editor: Editor, targetPath: number[]): number[] | null {
  // Try progressively shorter paths (going up the tree)
  for (let i = targetPath.length - 1; i >= 0; i--) {
    const parentPath = targetPath.slice(0, i);

    if (Editor.hasPath(editor, parentPath)) {
      // Found a valid parent, try to find a valid child
      const [node] = Editor.node(editor, parentPath);

      if (Editor.isEditor(node)) {
        // Find first valid child path
        if (node.children.length > 0) {
          return [...parentPath, 0];
        }
      } else if (SlateElement.isElement(node)) {
        // Find first text node in this element
        const firstTextPath = findFirstTextPath(editor, parentPath);

        if (firstTextPath) {
          return firstTextPath;
        }
      }
    }
  }

  return null;
}

/**
 * Find nearest text node to the given path
 */
function findNearestTextNode(editor: Editor, _targetPath: number[]): Range | null {
  try {
    // Try to find text nodes near the target path
    for (const [_node, path] of Editor.nodes(editor, { at: [], match: (n) => Text.isText(n) })) {
      const point = { path, offset: 0 };

      return { anchor: point, focus: point };
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Find the first valid text path in an element
 */
function findFirstTextPath(editor: Editor, elementPath: number[]): number[] | null {
  try {
    for (const [_node, path] of Editor.nodes(editor, {
      at: elementPath,
      match: (n) => Text.isText(n),
    })) {
      return path;
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Find a selection at the start of the document
 */
function findDocumentStart(editor: Editor): Range | null {
  try {
    const firstTextEntry = Editor.nodes(editor, {
      at: [],
      match: (n) => Text.isText(n),
    }).next();

    if (!firstTextEntry.done) {
      const [, path] = firstTextEntry.value;
      const point = { path, offset: 0 };

      return { anchor: point, focus: point };
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Find a selection at the end of the document
 */
function findDocumentEnd(editor: Editor): Range | null {
  try {
    let lastTextEntry: { node: Text; path: number[] } | null = null;

    for (const [node, path] of Editor.nodes(editor, {
      at: [],
      match: (n) => Text.isText(n),
    })) {
      lastTextEntry = { node: node as Text, path };
    }

    if (lastTextEntry) {
      const text = Editor.string(editor, lastTextEntry.path);
      const point = { path: lastTextEntry.path, offset: text.length };

      return { anchor: point, focus: point };
    }

    return null;
  } catch (error) {
    return null;
  }
}
