import { BasePoint, Element, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import isURL from 'validator/lib/isURL';

import { YjsEditor } from '@/application/slate-yjs';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { getBlockEntry, getSharedRoot } from '@/application/slate-yjs/utils/editor';
import { assertDocExists, getBlock, getChildrenArray } from '@/application/slate-yjs/utils/yjs';
import { BlockType, LinkPreviewBlockData, MentionType, VideoBlockData, YjsEditorKey } from '@/application/types';
import { parseHTML } from '@/components/editor/parsers/html-parser';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { parseTSVTable } from '@/components/editor/parsers/table-parser';
import { ParsedBlock } from '@/components/editor/parsers/types';
import { detectMarkdown, detectTSV } from '@/components/editor/utils/markdown-detector';
import { processUrl } from '@/utils/url';

/**
 * Enhances Slate editor with improved paste handling
 * Features:
 * - AST-based HTML parsing (reliable, secure)
 * - Markdown detection and parsing
 * - Smart merge logic (context-aware)
 * - URL detection (links, videos, page refs)
 * - Table support
 */
export const withPasted = (editor: ReactEditor) => {
  /**
   * Main paste handler - processes clipboard data
   */
  editor.insertTextData = (data: DataTransfer) => {
    const html = data.getData('text/html');
    const text = data.getData('text/plain');

    // Priority 1: HTML (if available)
    if (html && html.trim().length > 0) {
      console.log('[AppFlowy] Handling HTML paste', html);
      return handleHTMLPaste(editor, html, text);
    }

    // Priority 2: Plain text
    if (text && text.trim().length > 0) {
      console.log('[AppFlowy] Handling Plain Text paste', text);
      return handlePlainTextPaste(editor, text);
    }

    return false;
  };

  return editor;
};

/**
 * Handles HTML paste using AST-based parsing
 */
function handleHTMLPaste(editor: ReactEditor, html: string, fallbackText?: string): boolean {
  try {
    // Parse HTML to structured blocks
    const blocks = parseHTML(html);

    console.log('[AppFlowy] Parsed HTML blocks:', JSON.stringify(blocks, null, 2));

    if (blocks.length === 0) {
      // If HTML parsing fails, fallback to plain text
      if (fallbackText) {
        return handlePlainTextPaste(editor, fallbackText);
      }

      return false;
    }

    // Insert blocks through YJS
    return insertParsedBlocks(editor, blocks);
  } catch (error) {
    console.error('Error handling HTML paste:', error);
    return false;
  }
}

/**
 * Handles plain text paste with URL detection and Markdown support
 */
function handlePlainTextPaste(editor: ReactEditor, text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/);
  const lineLength = lines.filter(Boolean).length;

  // Special case: Single line
  if (lineLength === 1) {
    const isUrl = !!processUrl(text);

    if (isUrl) {
      return handleURLPaste(editor, text);
    }

    // Check if it's Markdown (even for single line)
    if (detectMarkdown(text)) {
      return handleMarkdownPaste(editor, text);
    }

    // If not URL and not Markdown, insert as plain text
    const point = editor.selection?.anchor as BasePoint;

    if (point) {
      Transforms.insertNodes(editor, { text }, { at: point, select: true, voids: false });
      return true;
    }

    return false;
  }

  // Multi-line text: Check if it's Markdown
  if (detectMarkdown(text)) {
    return handleMarkdownPaste(editor, text);
  }

  // Check for TSV
  if (detectTSV(text)) {
    return handleTSVPaste(editor, text);
  }

  // Plain multi-line text: Create paragraphs
  return handleMultiLinePlainText(editor, lines);
}

/**
 * Handles TSV paste
 */
function handleTSVPaste(editor: ReactEditor, tsv: string): boolean {
  try {
    const block = parseTSVTable(tsv);

    if (!block) {
      return false;
    }

    return insertParsedBlocks(editor, [block]);
  } catch (error) {
    console.error('Error handling TSV paste:', error);
    return false;
  }
}

/**
 * Handles Markdown paste
 */
function handleMarkdownPaste(editor: ReactEditor, markdown: string): boolean {
  try {
    // Parse Markdown to structured blocks
    const blocks = parseMarkdown(markdown);

    if (blocks.length === 0) {
      return false;
    }

    // Insert blocks directly
    return insertParsedBlocks(editor, blocks);
  } catch (error) {
    console.error('Error handling Markdown paste:', error);
    return false;
  }
}

/**
 * Handles URL paste (link previews, videos, page references)
 */
function handleURLPaste(editor: ReactEditor, url: string): boolean {
  // Check for AppFlowy internal links
  const isAppFlowyLinkUrl = isURL(url, {
    host_whitelist: [window.location.hostname],
  });

  if (isAppFlowyLinkUrl) {
    const urlObj = new URL(url);
    const blockId = urlObj.searchParams.get('blockId');

    if (blockId) {
      const pageId = urlObj.pathname.split('/').pop();
      const point = editor.selection?.anchor as BasePoint;

      if (point) {
        Transforms.insertNodes(
          editor,
          {
            text: '@',
            mention: {
              type: MentionType.PageRef,
              page_id: pageId,
              block_id: blockId,
            },
          },
          { at: point, select: true, voids: false }
        );

        return true;
      }
    }
  }

  // Check for video URLs
  const isVideoUrl = isURL(url, {
    host_whitelist: ['youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com'],
  });

  if (isVideoUrl) {
    return insertBlock(editor, {
      type: BlockType.VideoBlock,
      data: { url } as VideoBlockData,
      children: [{ text: '' }],
    });
  }

  // Default: Link preview
  return insertBlock(editor, {
    type: BlockType.LinkPreview,
    data: { url } as LinkPreviewBlockData,
    children: [{ text: '' }],
  });
}

/**
 * Handles multi-line plain text (no Markdown)
 */
function handleMultiLinePlainText(editor: ReactEditor, lines: string[]): boolean {
  const blocks = lines
    .filter(Boolean)
    .map((line) => ({
      type: BlockType.Paragraph,
      data: {},
      text: line,
      formats: [],
      children: [],
    }));

  return insertParsedBlocks(editor, blocks);
}

/**
 * Helper to insert a single block (for URL handlers)
 */
function insertBlock(editor: ReactEditor, block: unknown): boolean {
  const point = editor.selection?.anchor as BasePoint;

  if (!point) return false;

  try {
    Transforms.insertNodes(editor, block as import('slate').Node, {
      at: point,
      select: true,
    });

    return true;
  } catch (error) {
    console.error('Error inserting block:', error);
    return false;
  }
}

/**
 * Converts ParsedBlock to Slate Element with proper text wrapper
 */
function parsedBlockToSlateElement(block: ParsedBlock): Element {
  const { type, data, children } = block;

  // Convert text + formats to Slate text nodes
  const textNodes = parsedBlockToTextNodes(block);

  // Create children - text wrapper + any nested blocks
  const slateChildren: (Element | Text)[] = [
    { type: YjsEditorKey.text, children: textNodes } as Element,
    ...children.map(parsedBlockToSlateElement),
  ];

  return {
    type,
    data,
    children: slateChildren,
  } as Element;
}

/**
 * Converts ParsedBlock text to Slate text nodes with formats
 */
function parsedBlockToTextNodes(block: ParsedBlock): Text[] {
  const { text, formats } = block;

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
 * Inserts parsed blocks into the editor using YJS
 */
function insertParsedBlocks(editor: ReactEditor, blocks: ParsedBlock[]): boolean {
  if (blocks.length === 0) return false;

  try {
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

    // Convert parsed blocks to Slate elements with proper text wrapper
    const slateNodes = blocks.map(parsedBlockToSlateElement);

    // Insert into YJS document
    doc.transact(() => {
      slateContentInsertToYData(block.get(YjsEditorKey.block_parent), index + 1, slateNodes, doc);
    });

    return true;
  } catch (error) {
    console.error('Error inserting parsed blocks:', error);
    return false;
  }
}
