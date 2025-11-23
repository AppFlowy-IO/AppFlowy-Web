import { Element, Node, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import {
  beforePasted,
  findSlateEntryByBlockId,
  getBlockEntry,
  getSharedRoot,
} from '@/application/slate-yjs/utils/editor';
import { assertDocExists, deleteBlock, getBlock, getChildrenArray } from '@/application/slate-yjs/utils/yjs';
import { YjsEditorKey, BlockType } from '@/application/types';

import { PasteContext, ParsedBlock } from '../parsers/types';

import { shouldMergeAndAppend, shouldMergeInline, shouldReplaceBlock } from './paste-context';


/**
 * Converts ParsedBlocks to Slate nodes for insertion
 * @param blocks Parsed blocks from HTML/Markdown
 * @returns Slate nodes ready for insertion
 */
export function parsedBlocksToSlateNodes(blocks: ParsedBlock[]): Node[] {
  return blocks.map(parsedBlockToSlateNode);
}

/**
 * Converts a single ParsedBlock to a Slate node
 */
function parsedBlockToSlateNode(block: ParsedBlock): Element {
  // Convert inline formats to Slate text nodes with attributes
  const textNodes = block.text.length > 0 ? textWithFormatsToSlateNodes(block.text, block.formats) : [{ text: '' }];

  // Create block with children
  const slateBlock: Element = {
    type: block.type,
    data: block.data,
    children:
      block.children.length > 0
        ? block.children.map(parsedBlockToSlateNode)
        : [
            {
              type: 'text',
              children: textNodes,
            } as Element,
          ],
  } as Element;

  return slateBlock;
}

/**
 * Converts text with format spans to Slate text nodes
 */
function textWithFormatsToSlateNodes(text: string, formats: ParsedBlock['formats']): Text[] {
  if (formats.length === 0) {
    return [{ text }];
  }

  // Create segments based on format boundaries
  const boundaries = new Set<number>([0, text.length]);

  formats.forEach((format) => {
    boundaries.add(format.start);
    boundaries.add(format.end);
  });

  const positions = Array.from(boundaries).sort((a, b) => a - b);
  const nodes: Text[] = [];

  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i];
    const end = positions[i + 1];
    const segment = text.slice(start, end);

    if (segment.length === 0) continue;

    // Find all formats that apply to this segment
    const activeFormats = formats.filter((format) => format.start <= start && format.end >= end);

    // Build attributes object
    const attributes: Record<string, unknown> = {};

    activeFormats.forEach((format) => {
      switch (format.type) {
        case 'bold':
          attributes.bold = true;
          break;
        case 'italic':
          attributes.italic = true;
          break;
        case 'underline':
          attributes.underline = true;
          break;
        case 'strikethrough':
          attributes.strikethrough = true;
          break;
        case 'code':
          attributes.code = true;
          break;
        case 'link':
          attributes.href = format.data?.href;
          break;
        case 'color':
          attributes.font_color = format.data?.color;
          break;
        case 'bgColor':
          attributes.bg_color = format.data?.bgColor;
          break;
      }
    });

    nodes.push({ text: segment, ...attributes } as Text);
  }

  return nodes;
}

/**
 * Performs smart paste based on context
 * @param editor Slate editor
 * @param blocks Parsed blocks to paste
 * @param context Paste context
 * @returns True if paste was successful
 */
export function smartPaste(
  editor: ReactEditor,
  blocks: ParsedBlock[],
  context: PasteContext
): boolean {
  if (!beforePasted(editor)) return false;
  if (blocks.length === 0) return false;

  try {
    // Strategy 1: Replace empty block
    if (shouldReplaceBlock(context, blocks.length)) {
      return replaceBlockPaste(editor, blocks);
    }

    // Strategy 2: Merge single block inline
    if (shouldMergeInline(context, blocks.length)) {
      const firstBlock = blocks[0];

      // Only merge if types match or pasting paragraph
      if (firstBlock.type === BlockType.Paragraph || firstBlock.type === context.blockType) {
        return inlineMergePaste(editor, firstBlock);
      }
    }

    // Strategy 3: Merge first block and append rest
    if (shouldMergeAndAppend(context, blocks.length)) {
      const firstBlock = blocks[0];

      // Only merge if types match or pasting paragraph
      if (firstBlock.type === BlockType.Paragraph || firstBlock.type === context.blockType) {
        return mergeAndAppendPaste(editor, blocks);
      }
    }

    // Strategy 4: Insert as new blocks (default)
    return appendBlocksPaste(editor, blocks);
  } catch (error) {
    console.error('Error during smart paste:', error);
    return false;
  }
}

/**
 * Strategy 1: Replace the current empty block with pasted content
 */
function replaceBlockPaste(editor: ReactEditor, blocks: ParsedBlock[]): boolean {
  const slateNodes = parsedBlocksToSlateNodes(blocks);
  const point = editor.selection?.anchor;

  if (!point) return false;

  const entry = getBlockEntry(editor as YjsEditor, point);

  if (!entry) return false;

  const [node] = entry;
  const blockId = (node as { blockId?: string }).blockId;

  if (!blockId) return false;

  const sharedRoot = getSharedRoot(editor as YjsEditor);
  const block = getBlock(blockId, sharedRoot);
  const parent = getBlock(block.get(YjsEditorKey.block_parent), sharedRoot);
  const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);
  const index = parentChildren.toArray().findIndex((id) => id === blockId);
  const doc = assertDocExists(sharedRoot);

  let lastBlockId = blockId;

  doc.transact(() => {
    const newBlockIds = slateContentInsertToYData(block.get(YjsEditorKey.block_parent), index, slateNodes, doc);

    lastBlockId = newBlockIds[newBlockIds.length - 1];
    deleteBlock(sharedRoot, blockId); // Remove the empty block
  });

  // Focus last inserted block
  focusBlock(editor as YjsEditor, lastBlockId);

  return true;
}

/**
 * Strategy 2: Merge single block inline at cursor
 */
function inlineMergePaste(editor: ReactEditor, block: ParsedBlock): boolean {
  const textNodes = textWithFormatsToSlateNodes(block.text, block.formats);

  // Insert text nodes at current selection
  Transforms.insertNodes(editor, textNodes, {
    at: editor.selection || undefined,
    select: true,
  });

  return true;
}

/**
 * Strategy 3: Merge first block, append rest as new blocks
 */
function mergeAndAppendPaste(editor: ReactEditor, blocks: ParsedBlock[]): boolean {
  if (blocks.length === 0) return false;

  // Merge first block inline
  const firstBlock = blocks[0];
  const textNodes = textWithFormatsToSlateNodes(firstBlock.text, firstBlock.formats);

  Transforms.insertNodes(editor, textNodes, {
    at: editor.selection || undefined,
    select: false,
  });

  // If there are more blocks, split and insert them
  if (blocks.length > 1) {
    const remainingBlocks = blocks.slice(1);

    // Split current block at cursor
    Transforms.splitNodes(editor);

    // Insert remaining blocks
    return appendBlocksPaste(editor, remainingBlocks);
  }

  return true;
}

/**
 * Strategy 4: Append blocks as new blocks (default)
 */
function appendBlocksPaste(editor: ReactEditor, blocks: ParsedBlock[]): boolean {
  const slateNodes = parsedBlocksToSlateNodes(blocks);
  const point = editor.selection?.anchor;

  if (!point) return false;

  const entry = getBlockEntry(editor as YjsEditor, point);

  if (!entry) return false;

  const [node] = entry;
  const blockId = (node as { blockId?: string }).blockId;

  if (!blockId) return false;

  const sharedRoot = getSharedRoot(editor as YjsEditor);
  const block = getBlock(blockId, sharedRoot);
  const parent = getBlock(block.get(YjsEditorKey.block_parent), sharedRoot);
  const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);
  const index = parentChildren.toArray().findIndex((id) => id === blockId);
  const doc = assertDocExists(sharedRoot);

  let lastBlockId = blockId;

  doc.transact(() => {
    const newBlockIds = slateContentInsertToYData(
      block.get(YjsEditorKey.block_parent),
      index + 1,
      slateNodes,
      doc
    );

    lastBlockId = newBlockIds[newBlockIds.length - 1];
  });

  // Focus last inserted block
  focusBlock(editor as YjsEditor, lastBlockId);

  return true;
}

/**
 * Focuses a block by its ID
 */
function focusBlock(editor: YjsEditor, blockId: string): void {
  setTimeout(() => {
    try {
      const entry = findSlateEntryByBlockId(editor, blockId);

      if (!entry) return;

      const [, path] = entry;
      const point = editor.end(path);

      editor.select(point);
    } catch (e) {
      console.error('Error focusing block:', e);
    }
  }, 50);
}
