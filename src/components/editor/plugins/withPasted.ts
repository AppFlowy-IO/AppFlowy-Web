import { BasePoint, Element, Text, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import isURL from 'validator/lib/isURL';

import { YjsEditor } from '@/application/slate-yjs';
import { SOFT_BREAK_TYPES } from '@/application/slate-yjs/command/const';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { getBlockEntry, getSharedRoot, getParentSimpleTableCellBlockId, isInsideSimpleTableCell } from '@/application/slate-yjs/utils/editor';
import { assertDocExists, getBlock, getChildrenArray, getText } from '@/application/slate-yjs/utils/yjs';
import { BlockType, LinkPreviewBlockData, MentionType, VideoBlockData, VideoType, YjsEditorKey } from '@/application/types';
import { parseHTML } from '@/components/editor/parsers/html-parser';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { parseTSVTable } from '@/components/editor/parsers/table-parser';
import { ParsedBlock } from '@/components/editor/parsers/types';
import { detectMarkdown, detectTSV } from '@/components/editor/utils/markdown-detector';
import { processUrl } from '@/utils/url';
import { isValidVideoUrl, videoTypeData } from '@/utils/video-url';

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
    // Code blocks (and other soft-break types) accept only plain text.
    // Insert directly so the content goes inside the block, not below it.
    const entry = getBlockEntry(editor as YjsEditor);

    if (entry) {
      const [node] = entry;

      if (SOFT_BREAK_TYPES.includes(node.type as BlockType)) {
        const text = data.getData('text/plain');

        if (text) {
          editor.insertText(text);
          return true;
        }
      }
    }

    const html = data.getData('text/html');
    const text = data.getData('text/plain');

    // Priority 0: If pasting tabular content (TSV/multi-cell) inside a table cell,
    // fill adjacent cells instead of inserting as blocks
    if (entry) {
      const blockId = (entry[0] as { blockId?: string }).blockId;

      if (blockId && isInsideSimpleTableCell(editor as YjsEditor, blockId)) {
        const plainText = text?.trim();

        // Check for tab-separated content (copied table cells / spreadsheet data)
        if (plainText && plainText.includes('\t')) {
          return handlePasteIntoTableCells(editor as YjsEditor, blockId, plainText);
        }

        // Check for HTML table content — extract cell texts and fill adjacent cells
        if (html && (html.includes('<table') || html.includes('<tr'))) {
          const cellTexts = extractCellTextsFromHTML(html);

          if (cellTexts.length > 0) {
            const tsvText = cellTexts.map(row => row.join('\t')).join('\n');

            return handlePasteIntoTableCells(editor as YjsEditor, blockId, tsvText);
          }
        }
      }
    }

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
 * Extracts cell text values from an HTML table fragment.
 * Returns a 2D array of strings (rows × columns).
 */
function extractCellTextsFromHTML(html: string): string[][] {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tr');

    if (rows.length === 0) return [];

    const result: string[][] = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll('td, th');
      const rowTexts: string[] = [];

      cells.forEach(cell => {
        rowTexts.push(cell.textContent?.trim() ?? '');
      });

      if (rowTexts.length > 0) {
        result.push(rowTexts);
      }
    });

    return result;
  } catch {
    return [];
  }
}

/**
 * Handles pasting tab-separated content into table cells.
 * Distributes each tab-separated value into adjacent cells of the same row.
 */
function handlePasteIntoTableCells(editor: YjsEditor, blockId: string, text: string): boolean {
  try {
    const sharedRoot = getSharedRoot(editor);

    // Find which cell we're in
    const cellBlockId = getParentSimpleTableCellBlockId(editor, blockId);

    if (!cellBlockId) return false;

    const cellBlock = getBlock(cellBlockId, sharedRoot);

    if (!cellBlock) return false;

    // Find the row
    const rowId = cellBlock.get(YjsEditorKey.block_parent);
    const rowBlock = getBlock(rowId, sharedRoot);

    if (!rowBlock) return false;

    const rowChildren = getChildrenArray(rowBlock.get(YjsEditorKey.block_children), sharedRoot);

    if (!rowChildren) return false;

    // Find current cell's index in the row
    const cellIds = rowChildren.toArray();
    const cellIndex = cellIds.indexOf(cellBlockId);

    if (cellIndex === -1) return false;

    // Parse TSV: split by tabs for columns, newlines for rows
    const rows = text.split('\n').filter(line => line.length > 0);

    if (rows.length === 0) return false;

    // For each row of pasted data
    const doc = assertDocExists(sharedRoot);

    doc.transact(() => {
      for (let rowOffset = 0; rowOffset < rows.length; rowOffset++) {
        const values = rows[rowOffset].split('\t');

        // Find the target row (current row + offset)
        const tableId = rowBlock.get(YjsEditorKey.block_parent);
        const tableBlock = getBlock(tableId, sharedRoot);

        if (!tableBlock) continue;

        const tableChildren = getChildrenArray(tableBlock.get(YjsEditorKey.block_children), sharedRoot);

        if (!tableChildren) continue;

        const rowIds = tableChildren.toArray();
        const currentRowIndex = rowIds.indexOf(rowId);
        const targetRowIndex = currentRowIndex + rowOffset;

        if (targetRowIndex >= rowIds.length) continue;

        const targetRowBlock = getBlock(rowIds[targetRowIndex], sharedRoot);

        if (!targetRowBlock) continue;

        const targetRowCells = getChildrenArray(targetRowBlock.get(YjsEditorKey.block_children), sharedRoot);

        if (!targetRowCells) continue;

        // Fill each value into the corresponding cell
        for (let colOffset = 0; colOffset < values.length; colOffset++) {
          const targetCellIndex = cellIndex + colOffset;

          if (targetCellIndex >= targetRowCells.length) continue;

          const targetCellId = targetRowCells.get(targetCellIndex);
          const targetCell = getBlock(targetCellId, sharedRoot);

          if (!targetCell) continue;

          // Get the first paragraph in the cell
          const cellChildren = getChildrenArray(targetCell.get(YjsEditorKey.block_children), sharedRoot);

          if (!cellChildren || cellChildren.length === 0) continue;

          const paragraphId = cellChildren.get(0);
          const paragraph = getBlock(paragraphId, sharedRoot);

          if (!paragraph) continue;

          const textId = paragraph.get(YjsEditorKey.block_external_id);

          if (!textId) continue;

          const yText = getText(textId, sharedRoot);

          if (!yText) continue;

          // Only fill if it's the first cell (where cursor is) and first row — insert text there
          // For other cells, clear and set the value
          if (rowOffset === 0 && colOffset === 0) {
            // First cell: insert at cursor position (handled by Slate default)
            continue;
          }

          // Clear existing text and insert new value
          if (yText.length > 0) {
            yText.delete(0, yText.length);
          }

          yText.insert(0, values[colOffset].trim());
        }
      }
    });

    // For the first cell (cursor position), insert text normally via Slate
    const firstRowValues = rows[0].split('\t');

    if (firstRowValues.length > 0) {
      editor.insertText(firstRowValues[0].trim());
    }

    return true;
  } catch (error) {
    console.error('Error pasting into table cells:', error);
    return false;
  }
}

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
  const isVideoUrl = isValidVideoUrl(url);

  if (isVideoUrl) {
    return insertBlock(editor, {
      type: BlockType.VideoBlock,
      data: { url: processUrl(url) || url, ...videoTypeData(VideoType.External) } as VideoBlockData,
    });
  }

  // Default: Link preview
  return insertBlock(editor, {
    type: BlockType.LinkPreview,
    data: { url } as LinkPreviewBlockData,
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
 * Helper to insert a single block (for URL handlers).
 *
 * Writes directly to Yjs via slateContentInsertToYData rather than going
 * through Transforms.insertNodes — Slate's applyInsertNode binding short-
 * circuits for non-text nodes (see applyToYjs.ts), so embed blocks like
 * LinkPreview/VideoBlock would render in Slate's local state but never
 * persist to the Y.Doc. The block was lost as soon as the editor unmounted
 * (e.g. closing a database row card right after pasting a URL).
 */
function insertBlock(editor: ReactEditor, block: { type: BlockType; data: object }): boolean {
  const point = editor.selection?.anchor;

  if (!point) return false;

  try {
    const entry = getBlockEntry(editor as YjsEditor, point);

    if (!entry) return false;

    const [node] = entry;
    const blockId = (node as { blockId?: string }).blockId;

    if (!blockId) return false;

    const sharedRoot = getSharedRoot(editor as YjsEditor);
    const currentBlock = getBlock(blockId, sharedRoot);
    const parentId = currentBlock.get(YjsEditorKey.block_parent);
    const parent = getBlock(parentId, sharedRoot);
    const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);
    const index = parentChildren.toArray().findIndex((id) => id === blockId);
    const doc = assertDocExists(sharedRoot);

    // slateContentInsertToYData expects Slate Element shape; the data
    // payload becomes the Yjs block's `data` field as-is.
    const slateNode: Element = {
      type: block.type,
      data: block.data,
      children: [{ text: '' }],
    } as unknown as Element;

    doc.transact(() => {
      slateContentInsertToYData(parentId, index + 1, [slateNode], doc);
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
/**
 * Block types that should not be nested inside table cells.
 * When pasting these inside a cell, they are inserted after the parent table instead.
 */
const TABLE_BLOCK_TYPES = [BlockType.SimpleTableBlock, BlockType.SimpleTableRowBlock, BlockType.SimpleTableCellBlock];

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

    // Check if we're pasting inside a table cell
    const insideTable = isInsideSimpleTableCell(editor as YjsEditor, blockId);

    if (insideTable) {
      // Split blocks: text-like blocks go inside the cell, table blocks go after the parent table
      const cellBlocks = blocks.filter(b => !TABLE_BLOCK_TYPES.includes(b.type));
      const tableBlocks = blocks.filter(b => TABLE_BLOCK_TYPES.includes(b.type));

      // Insert text blocks inside the cell
      if (cellBlocks.length > 0) {
        const parent = getBlock(block.get(YjsEditorKey.block_parent), sharedRoot);
        const parentChildren = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);
        const index = parentChildren.toArray().findIndex((id) => id === blockId);
        const doc = assertDocExists(sharedRoot);
        const slateNodes = cellBlocks.map(parsedBlockToSlateElement);

        doc.transact(() => {
          slateContentInsertToYData(block.get(YjsEditorKey.block_parent), index + 1, slateNodes, doc);
        });
      }

      // Insert table blocks after the parent SimpleTable
      if (tableBlocks.length > 0) {
        // Walk up to find the SimpleTableBlock ancestor
        let currentId: string | undefined = blockId;
        let tableAncestorId: string | undefined;

        while (currentId) {
          const currentBlock = getBlock(currentId, sharedRoot);

          if (!currentBlock) break;

          if (currentBlock.get(YjsEditorKey.block_type) === BlockType.SimpleTableBlock) {
            tableAncestorId = currentId;
            break;
          }

          currentId = currentBlock.get(YjsEditorKey.block_parent);
        }

        if (tableAncestorId) {
          const tableBlock = getBlock(tableAncestorId, sharedRoot);
          const tableParent = getBlock(tableBlock.get(YjsEditorKey.block_parent), sharedRoot);
          const tableParentChildren = getChildrenArray(tableParent.get(YjsEditorKey.block_children), sharedRoot);
          const tableIndex = tableParentChildren.toArray().findIndex((id) => id === tableAncestorId);
          const doc = assertDocExists(sharedRoot);
          const slateNodes = tableBlocks.map(parsedBlockToSlateElement);

          doc.transact(() => {
            slateContentInsertToYData(tableBlock.get(YjsEditorKey.block_parent), tableIndex + 1, slateNodes, doc);
          });
        }
      }

      return true;
    }

    // Normal paste (not inside table cell)
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
