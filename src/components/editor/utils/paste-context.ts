import { Range } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';

import { PasteContext } from '../parsers/types';

/**
 * Analyzes the current editor state to determine paste context
 * @param editor Slate editor instance
 * @returns Paste context information
 */
export function analyzePasteContext(editor: ReactEditor): PasteContext | null {
  const { selection } = editor;

  if (!selection) {
    return null;
  }

  try {
    const entry = getBlockEntry(editor as unknown as YjsEditor, selection.anchor);

    if (!entry) {
      return null;
    }

    const [node] = entry;
    const blockId = (node as { blockId?: string }).blockId || '';
    const blockType = (node.type as BlockType) || BlockType.Paragraph;

    // Check if block is empty
    const text = CustomEditor.getBlockTextContent(node);
    const isEmptyBlock = text.trim() === '';

    // Determine cursor position
    let cursorPosition: 'start' | 'middle' | 'end' = 'middle';

    if (selection && Range.isCollapsed(selection)) {
      if (selection.anchor.offset === 0) {
        cursorPosition = 'start';
      } else if (text && selection.anchor.offset >= text.length) {
        cursorPosition = 'end';
      }
    }

    // Determine if merge is possible
    const canMerge = canMergeIntoBlock(blockType);

    return {
      isEmptyBlock,
      blockType,
      canMerge,
      cursorPosition,
      blockId,
    };
  } catch (error) {
    console.error('Error analyzing paste context:', error);
    return null;
  }
}

/**
 * Determines if content can be merged inline into a block type
 * @param blockType Block type to check
 * @returns True if inline merge is allowed
 */
function canMergeIntoBlock(blockType: BlockType): boolean {
  // Text blocks that support inline merging
  const mergeable = [
    BlockType.Paragraph,
    BlockType.HeadingBlock,
    BlockType.QuoteBlock,
    BlockType.BulletedListBlock,
    BlockType.NumberedListBlock,
    BlockType.TodoListBlock,
    BlockType.CalloutBlock,
  ];

  return mergeable.includes(blockType);
}

/**
 * Checks if pasting should replace the current block entirely
 * @param context Paste context
 * @param pasteBlockCount Number of blocks being pasted
 * @returns True if should replace block
 */
export function shouldReplaceBlock(context: PasteContext, pasteBlockCount: number): boolean {
  return context.isEmptyBlock && pasteBlockCount > 0;
}

/**
 * Checks if pasting should merge inline (single line into existing text)
 * @param context Paste context
 * @param pasteBlockCount Number of blocks being pasted
 * @returns True if should merge inline
 */
export function shouldMergeInline(context: PasteContext, pasteBlockCount: number): boolean {
  return !context.isEmptyBlock && context.canMerge && pasteBlockCount === 1;
}

/**
 * Checks if pasting should merge first block and append rest
 * @param context Paste context
 * @param pasteBlockCount Number of blocks being pasted
 * @returns True if should use merge-append strategy
 */
export function shouldMergeAndAppend(context: PasteContext, pasteBlockCount: number): boolean {
  return !context.isEmptyBlock && context.canMerge && pasteBlockCount > 1;
}
