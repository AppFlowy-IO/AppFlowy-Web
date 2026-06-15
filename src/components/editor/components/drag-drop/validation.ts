import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { getBlock, getPageId } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YBlock, YjsEditorKey, YSharedRoot } from '@/application/types';

/**
 * Check if a block can be dragged
 */
export function canDragBlock(editor: YjsEditor, blockId: string): boolean {
  if (!blockId || !editor.sharedRoot) return false;

  try {
    const pageId = getPageId(editor.sharedRoot);

    // Can't drag the root page block
    if (blockId === pageId) return false;

    // Find the block in Slate
    const entry = findSlateEntryByBlockId(editor, blockId);

    if (!entry) return false;

    const [node] = entry;
    const blockType = node.type as BlockType;

    // Can't drag table cells or table rows
    if ([
      BlockType.TableCell,
      BlockType.SimpleTableRowBlock,
      BlockType.SimpleTableCellBlock,
    ].includes(blockType)) {
      return false;
    }

    return true;
  } catch (error) {
    console.warn('Error checking if block is draggable:', error);
    return false;
  }
}

/**
 * Check if dropping sourceBlock onto targetBlock would create a circular reference
 */
export function wouldCreateCircularReference(
  sourceBlock: YBlock,
  targetBlock: YBlock,
  sharedRoot: YSharedRoot
): boolean {
  const sourceBlockId = sourceBlock.get(YjsEditorKey.block_id);

  // Walk up the tree from target to see if we hit source
  let currentBlock = targetBlock;

  while (currentBlock) {
    const currentId = currentBlock.get(YjsEditorKey.block_id);

    if (currentId === sourceBlockId) {
      return true;
    }

    const parentId = currentBlock.get(YjsEditorKey.block_parent);

    if (!parentId) break;

    try {
      currentBlock = getBlock(parentId, sharedRoot);
    } catch {
      break;
    }
  }

  return false;
}

/**
 * Validate if a drop operation is allowed
 */
export function canDropBlock({
  editor,
  sourceBlockId,
  targetBlockId,
}: {
  editor: YjsEditor;
  sourceBlockId: string;
  targetBlockId: string;
}): boolean {
  if (sourceBlockId === targetBlockId) return false;
  if (!editor.sharedRoot) return false;

  const sourceBlock = getBlock(sourceBlockId, editor.sharedRoot);
  const targetBlock = getBlock(targetBlockId, editor.sharedRoot);

  if (!sourceBlock || !targetBlock) return false;

  return !wouldCreateCircularReference(sourceBlock, targetBlock, editor.sharedRoot);
}
