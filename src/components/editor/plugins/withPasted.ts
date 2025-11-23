import { BasePoint, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import isURL from 'validator/lib/isURL';

import { BlockType, LinkPreviewBlockData, MentionType, VideoBlockData } from '@/application/types';
import { parseHTML } from '@/components/editor/parsers/html-parser';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { detectMarkdown } from '@/components/editor/utils/markdown-detector';
import { analyzePasteContext } from '@/components/editor/utils/paste-context';
import { smartPaste } from '@/components/editor/utils/paste-merger';
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

    // Analyze paste context
    const context = analyzePasteContext(editor);

    if (!context) return false;

    // Execute smart paste
    return smartPaste(editor, blocks, context);
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

  // Plain multi-line text: Create paragraphs
  return handleMultiLinePlainText(editor, lines);
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

    // Analyze paste context
    const context = analyzePasteContext(editor);

    if (!context) return false;

    // Execute smart paste
    return smartPaste(editor, blocks, context);
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

  const context = analyzePasteContext(editor);

  if (!context) return false;

  return smartPaste(editor, blocks, context);
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
