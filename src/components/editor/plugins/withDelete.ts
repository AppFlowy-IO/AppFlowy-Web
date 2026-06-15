import { EditorFragmentDeletionOptions, Range, TextUnit } from 'slate';
import { TextDeleteOptions } from 'slate/dist/interfaces/transforms/text';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { isEmbedBlockTypes } from '@/application/slate-yjs/command/const';
import {
  getBlockEntry,
  isAtBlockEnd,
  isAtBlockStart,
  isEntireDocumentSelected,
} from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';

export function withDelete(editor: ReactEditor) {
  const { deleteForward, deleteBackward, delete: deleteText, deleteFragment: originalDeleteFragment } = editor;

  editor.delete = (options?: TextDeleteOptions) => {
    const { selection } = editor;

    if (!selection) return;

    const entry = getBlockEntry(editor as YjsEditor);

    if (!entry) return;

    const [node] = entry;

    if (!node) return;

    if (Range.isCollapsed(selection)) {
      if (isEmbedBlockTypes(node.type as BlockType) && node.blockId) {
        CustomEditor.deleteBlock(editor as YjsEditor, node.blockId);
        return;
      }

      deleteText(options);
      return;
    }

    const [start, end] = Range.edges(selection);
    const startBlock = getBlockEntry(editor as YjsEditor, start);
    const endBlock = getBlockEntry(editor as YjsEditor, end);

    if (!startBlock || !endBlock) return;

    const [startNode] = startBlock;
    const [endNode] = endBlock;

    if (startNode.blockId === endNode.blockId) {
      deleteText(options);
      return;
    }

    CustomEditor.deleteBlockBackward(editor as YjsEditor, selection);
  };

  editor.deleteFragment = (options?: EditorFragmentDeletionOptions) => {
    const deleteEntireDocument = isEntireDocumentSelected(editor as YjsEditor);

    if (deleteEntireDocument) {
      CustomEditor.deleteEntireDocument(editor as YjsEditor);
      return;
    }

    const { selection } = editor;

    if (!selection) return;

    // Check if selection is within a single block
    const [start, end] = Range.edges(selection);
    const startBlock = getBlockEntry(editor as YjsEditor, start);
    const endBlock = getBlockEntry(editor as YjsEditor, end);

    if (!startBlock || !endBlock) {
      // Fallback to default behavior if we can't get block entries
      originalDeleteFragment(options);
      return;
    }

    const [startNode] = startBlock;
    const [endNode] = endBlock;

    // If selection is within the same block, use default Slate deletion
    if (startNode.blockId === endNode.blockId) {
      originalDeleteFragment(options);
      return;
    }

    // Only use custom block deletion for cross-block selections
    if (options?.direction === 'backward') {
      CustomEditor.deleteBlockBackward(editor as YjsEditor, selection);
    } else {
      CustomEditor.deleteBlockForward(editor as YjsEditor, selection);
    }
  };

  // Handle `delete` key press
  editor.deleteForward = (unit: TextUnit) => {
    const { selection } = editor;

    if (!selection) {
      return;
    }

    // For collapsed selections, check if we're at block boundary
    if (Range.isCollapsed(selection)) {
      const shouldUseDefaultBehavior = !isAtBlockEnd(editor, selection.anchor);

      if (shouldUseDefaultBehavior) {
        deleteForward(unit);
        return;
      }

      // At block end, check next block
      const after = editor.after(editor.end(selection), { unit: 'block' });

      if (!after) {
        return;
      }

      const nextBlock = getBlockEntry(editor as YjsEditor, after)?.[0];

      if (!nextBlock) return;

      if (isEmbedBlockTypes(nextBlock.type as BlockType) && nextBlock.blockId) {
        CustomEditor.deleteBlock(editor as YjsEditor, nextBlock.blockId);
        return;
      }

      CustomEditor.deleteBlockForward(editor as YjsEditor, selection);
      return;
    }

    // For range selections, check if selection spans multiple blocks
    const [start, end] = Range.edges(selection);
    const startBlock = getBlockEntry(editor as YjsEditor, start);
    const endBlock = getBlockEntry(editor as YjsEditor, end);

    if (!startBlock || !endBlock) {
      // Fallback to default behavior if we can't get block entries
      deleteForward(unit);
      return;
    }

    const [startNode] = startBlock;
    const [endNode] = endBlock;

    // If selection is within the same block, use default Slate deletion
    if (startNode.blockId === endNode.blockId) {
      deleteForward(unit);
      return;
    }

    // Only use custom block deletion for cross-block selections
    CustomEditor.deleteBlockForward(editor as YjsEditor, selection);
  };

  // Handle `backspace` key press
  editor.deleteBackward = (unit: TextUnit) => {
    const { selection } = editor;

    if (!selection) {
      return;
    }

    // For collapsed selections, check if we're at block boundary
    if (Range.isCollapsed(selection)) {
      const shouldUseDefaultBehavior = !isAtBlockStart(editor, selection.anchor);

      if (shouldUseDefaultBehavior) {
        deleteBackward(unit);
        return;
      }

      // At block start, use custom block backward deletion
      CustomEditor.deleteBlockBackward(editor as YjsEditor, selection);
      return;
    }

    // For range selections, check if selection spans multiple blocks
    const [start, end] = Range.edges(selection);
    const startBlock = getBlockEntry(editor as YjsEditor, start);
    const endBlock = getBlockEntry(editor as YjsEditor, end);

    if (!startBlock || !endBlock) {
      // Fallback to default behavior if we can't get block entries
      deleteBackward(unit);
      return;
    }

    const [startNode] = startBlock;
    const [endNode] = endBlock;

    // If selection is within the same block, use default Slate deletion
    if (startNode.blockId === endNode.blockId) {
      deleteBackward(unit);
      return;
    }

    // Only use custom block deletion for cross-block selections
    CustomEditor.deleteBlockBackward(editor as YjsEditor, selection);
  };

  return editor;
}
