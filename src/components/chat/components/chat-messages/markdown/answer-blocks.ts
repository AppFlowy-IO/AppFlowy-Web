import { EditorData, EditorNode, NodeType } from '@appflowyinc/editor';

import { BlockType } from '@/application/types';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { parsedBlockToTextNodes } from '@/components/editor/parsers/parsed-block-to-slate';
import type { ParsedBlock } from '@/components/editor/parsers/types';

/**
 * Chat answers go through the document editor's Markdown pipeline, so TeX math,
 * fenced code, tables and lists parse as they do when pasted into a page. Models
 * write `\(...\)` for inline math, so that form stays inline here.
 */
export function parseAnswerBlocks(markdown: string): ParsedBlock[] {
  try {
    return parseMarkdown(markdown, { inlineParentheses: true });
  } catch (error) {
    console.error('Failed to parse answer markdown', error);
    return [{ type: BlockType.Paragraph, data: {}, text: markdown, formats: [], children: [] }];
  }
}

/** Blocks whose content lives in `data` or in child blocks rather than in a text delta. */
const TEXTLESS_BLOCKS = new Set<BlockType>([
  BlockType.DividerBlock,
  BlockType.EquationBlock,
  BlockType.ImageBlock,
  BlockType.SimpleTableBlock,
  BlockType.SimpleTableRowBlock,
  BlockType.SimpleTableCellBlock,
]);

/**
 * The parsed answer in the shape copy and "Add to page" send to documents: AppFlowy
 * block types with a delta per text block, so equations and code languages survive
 * the trip into a page.
 */
export function answerBlocksToEditorData(blocks: ParsedBlock[]): EditorData {
  return blocks.map(toEditorNode);
}

function toEditorNode(block: ParsedBlock): EditorNode {
  const node: EditorNode = {
    // Document block types are a superset of the editor package's node types; the
    // consumers only forward the type string to the page endpoints.
    type: block.type as unknown as NodeType,
    data: { ...block.data },
    children: block.children.map(toEditorNode),
  };

  if (!TEXTLESS_BLOCKS.has(block.type)) {
    node.delta = parsedBlockToTextNodes(block).map(({ text, ...attributes }) =>
      Object.keys(attributes).length > 0 ? { insert: text, attributes } : { insert: text }
    );
  }

  return node;
}
