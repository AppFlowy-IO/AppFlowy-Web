import rehypeParse from 'rehype-parse';
import { unified } from 'unified';

import { elementToBlock } from './block-converters';
import { sanitizeHTML } from './sanitize';
import { HTMLParseOptions, ParsedBlock } from './types';

import type { Element as HastElement, Root as HastRoot } from 'hast';

/**
 * Parses HTML string into structured blocks using AST-based parsing
 * @param html Raw HTML string
 * @param options Parsing options
 * @returns Array of parsed blocks
 *
 * @example
 * ```typescript
 * const html = '<h1>Title</h1><p>Paragraph with <strong>bold</strong> text</p>';
 * const blocks = parseHTML(html);
 * // Returns:
 * // [
 * //   { type: 'heading', data: { level: 1 }, text: 'Title', ... },
 * //   { type: 'paragraph', text: 'Paragraph with bold text', formats: [...], ... }
 * // ]
 * ```
 */
export function parseHTML(html: string, options: HTMLParseOptions = {}): ParsedBlock[] {
  if (!html || html.trim().length === 0) {
    return [];
  }

  try {
    // Step 1: Sanitize HTML to remove malicious content
    const safeHTML = sanitizeHTML(html);

    if (!safeHTML) {
      return [];
    }

    // Step 2: Parse HTML to HAST (HTML AST)
    const tree = deserializeHTMLToAST(safeHTML);

    // Step 3: Convert HAST to ParsedBlocks
    const blocks = convertASTToAppFlowyBlocks(tree.children as HastElement[], options);

    return blocks;
  } catch (error) {
    console.error('Error parsing HTML:', error);
    return [];
  }
}

/**
 * Deserializes HTML string into structured AST representation
 * @param html HTML string
 * @returns HAST root node
 */
function deserializeHTMLToAST(html: string): HastRoot {
  const processor = unified().use(rehypeParse, {
    fragment: true, // Parse as HTML fragment (not full document)
  });

  return processor.parse(html);
}

/**
 * Converts HTML AST nodes to AppFlowy block structures
 * @param nodes Array of HAST nodes
 * @param options Parse options
 * @param depth Current depth (for max depth limiting)
 * @returns Array of parsed blocks
 */
function convertASTToAppFlowyBlocks(nodes: HastElement[], options: HTMLParseOptions, depth = 0): ParsedBlock[] {
  const maxDepth = options.maxDepth || 20;

  if (depth > maxDepth) {
    console.warn('Max nesting depth exceeded');
    return [];
  }

  const blocks: ParsedBlock[] = [];

  for (const node of nodes) {
    if (node.type !== 'element') continue;

    const block = elementToBlock(node);

    if (block) {
      // Handle array of blocks (e.g. flattened lists)
      if (Array.isArray(block)) {
        // Recursively process nested structures if needed (though flattened blocks are usually leaves)
        blocks.push(...block);
      } else {
        // For blocks with children (like lists that weren't flattened), recursively process
        // Note: parseList now returns array, so this branch is less common for lists
        if (block.children.length > 0) {
          // Children already processed in block converter for some types
          blocks.push(block);
        } else {
          blocks.push(block);
        }
      }
    } else {
      // If element couldn't be converted, try processing its children
      if (node.children && node.children.length > 0) {
        const childBlocks = convertASTToAppFlowyBlocks(node.children as HastElement[], options, depth + 1);

        blocks.push(...childBlocks);
      }
    }
  }

  return blocks;
}

/**
 * Checks if HTML content contains only images
 * Useful for special handling of image-only pastes
 * @param html HTML string
 * @returns True if content is image-only
 */
export function isImageOnlyHTML(html: string): boolean {
  const safeHTML = sanitizeHTML(html);
  const tree = deserializeHTMLToAST(safeHTML);

  const elements = tree.children.filter((node) => node.type === 'element') as HastElement[];

  if (elements.length === 0) return false;

  // Check if all elements are images
  return elements.every((el) => el.tagName === 'img');
}

/**
 * Extracts all image URLs from HTML
 * @param html HTML string
 * @returns Array of image URLs
 */
export function extractImageURLs(html: string): string[] {
  const safeHTML = sanitizeHTML(html);
  const tree = deserializeHTMLToAST(safeHTML);

  const urls: string[] = [];

  function walk(nodes: (HastElement | { type: string })[]) {
    for (const node of nodes) {
      if (node.type === 'element') {
        const elem = node as HastElement;

        if (elem.tagName === 'img') {
          const src = elem.properties?.src as string;

          if (src) {
            urls.push(src);
          }
        }

        if (elem.children) {
          walk(elem.children as HastElement[]);
        }
      }
    }
  }

  walk(tree.children as HastElement[]);

  return urls;
}
