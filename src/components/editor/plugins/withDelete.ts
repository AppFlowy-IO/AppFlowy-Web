import { Editor, EditorFragmentDeletionOptions, Element, Path, Range, TextUnit } from 'slate';
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

// AI Meeting container block types that should not be deleted or merged
const AI_MEETING_CONTAINER_TYPES = [
  BlockType.AIMeetingSummary,
  BlockType.AIMeetingNotes,
  BlockType.AIMeetingTranscription,
];

/**
 * Check if the block at the given path is the first child of an AI Meeting container.
 * This is used to prevent merging blocks outside the container boundary.
 */
function isFirstChildOfAIMeetingContainer(editor: ReactEditor, path: Path): boolean {
  try {
    // Find the block entry for the current path
    const blockEntry = getBlockEntry(editor as YjsEditor, { path, offset: 0 });

    if (!blockEntry) return false;

    const [, blockPath] = blockEntry;

    // Check each ancestor to find an AI Meeting container
    for (let i = blockPath.length - 1; i >= 0; i--) {
      const ancestorPath = blockPath.slice(0, i);

      if (ancestorPath.length === 0) continue;

      try {
        const [ancestorNode] = Editor.node(editor, ancestorPath);

        if (Element.isElement(ancestorNode) && AI_MEETING_CONTAINER_TYPES.includes(ancestorNode.type as BlockType)) {
          // Found an AI Meeting container - check if the block is the first child
          // The block's path relative to the container should start with 0
          const relativeIndex = blockPath[ancestorPath.length];

          return relativeIndex === 0;
        }
      } catch {
        continue;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check if the block at the given path is the last child of an AI Meeting container.
 * This is used to prevent merging blocks outside the container boundary.
 */
function isLastChildOfAIMeetingContainer(editor: ReactEditor, path: Path): boolean {
  try {
    // Find the block entry for the current path
    const blockEntry = getBlockEntry(editor as YjsEditor, { path, offset: 0 });

    if (!blockEntry) return false;

    const [, blockPath] = blockEntry;

    // Check each ancestor to find an AI Meeting container
    for (let i = blockPath.length - 1; i >= 0; i--) {
      const ancestorPath = blockPath.slice(0, i);

      if (ancestorPath.length === 0) continue;

      try {
        const [ancestorNode] = Editor.node(editor, ancestorPath);

        if (Element.isElement(ancestorNode) && AI_MEETING_CONTAINER_TYPES.includes(ancestorNode.type as BlockType)) {
          // Found an AI Meeting container - check if the block is the last child
          const containerChildren = ancestorNode.children || [];
          const relativeIndex = blockPath[ancestorPath.length];

          return relativeIndex === containerChildren.length - 1;
        }
      } catch {
        continue;
      }
    }

    return false;
  } catch {
    return false;
  }
}

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

      // At block end - check if we're at the last child of an AI Meeting container
      // If so, prevent merging with blocks outside the container
      if (isLastChildOfAIMeetingContainer(editor, selection.anchor.path)) {
        // Don't merge blocks at the boundary of AI Meeting containers
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

      // At block start - check if we're at the first child of an AI Meeting container
      // If so, prevent merging with blocks outside the container
      if (isFirstChildOfAIMeetingContainer(editor, selection.anchor.path)) {
        // Don't merge blocks at the boundary of AI Meeting containers
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
