
import { BlockData, BlockType, HeadingBlockData, ImageBlockData, ImageType } from '@/application/types';

import { extractInlineFormatsFromHAST, extractTextFromHAST } from './inline-converters';
import { parseHTMLTable } from './table-parser';
import { ParsedBlock } from './types';

import type { Element as HastElement } from 'hast';

/**
 * Checks if a HAST element represents a heading
 */
export function isHeading(tagName: string): boolean {
  return /^h[1-6]$/.test(tagName);
}

/**
 * Checks if a HAST element represents a list
 */
export function isList(tagName: string): boolean {
  return tagName === 'ul' || tagName === 'ol';
}

/**
 * Checks if a HAST element represents a blockquote
 */
export function isBlockquote(tagName: string): boolean {
  return tagName === 'blockquote';
}

/**
 * Checks if a HAST element represents a code block
 */
export function isCodeBlock(tagName: string): boolean {
  return tagName === 'pre';
}

/**
 * Checks if a HAST element represents a table
 */
export function isTable(tagName: string): boolean {
  return tagName === 'table';
}

/**
 * Checks if a HAST element represents a paragraph
 */
export function isParagraph(tagName: string): boolean {
  return tagName === 'p' || tagName === 'div';
}

/**
 * Converts a heading element to ParsedBlock
 */
export function parseHeading(node: HastElement): ParsedBlock {
  const level = parseInt(node.tagName[1]) as 1 | 2 | 3 | 4 | 5 | 6;

  return {
    type: BlockType.HeadingBlock,
    data: { level } as HeadingBlockData,
    text: extractTextFromHAST(node),
    formats: extractInlineFormatsFromHAST(node),
    children: [],
  };
}

/**
 * Converts a paragraph element to ParsedBlock
 */
export function parseParagraph(node: HastElement): ParsedBlock {
  const text = extractTextFromHAST(node);

  // Check for special markdown-like patterns
  if (text === '---') {
    return {
      type: BlockType.DividerBlock,
      data: {},
      text: '',
      formats: [],
      children: [],
    };
  }

  return {
    type: BlockType.Paragraph,
    data: {},
    text,
    formats: extractInlineFormatsFromHAST(node),
    children: [],
  };
}

/**
 * Converts a blockquote element to ParsedBlock
 */
export function parseBlockquote(node: HastElement): ParsedBlock {
  return {
    type: BlockType.QuoteBlock,
    data: {},
    text: extractTextFromHAST(node),
    formats: extractInlineFormatsFromHAST(node),
    children: [],
  };
}

/**
 * Converts a code block (pre > code) to ParsedBlock
 * Returns null if no code element is found inside pre
 */
export function parseCodeBlock(node: HastElement): ParsedBlock | null {
  // Look for code element inside pre
  const codeElement = node.children.find((child) => {
    return child.type === 'element' && (child).tagName === 'code';
  }) as HastElement | undefined;

  // Only treat as code block if there's a code element
  if (!codeElement) {
    return null;
  }

  const text = extractTextFromHAST(codeElement);

  // Try to extract language from class name
  let language = 'plaintext';
  const className = codeElement.properties?.className;

  if (Array.isArray(className)) {
    const langClass = className.find((c) => typeof c === 'string' && c.startsWith('language-'));

    if (langClass && typeof langClass === 'string') {
      language = langClass.replace('language-', '');
    }
  }

  return {
    type: BlockType.CodeBlock,
    data: { language } as BlockData,
    text,
    formats: [], // No inline formatting in code blocks
    children: [],
  };
}

/**
 * Converts a list element to ParsedBlock with children
 */
export function parseList(node: HastElement): ParsedBlock[] {
  const isOrdered = node.tagName === 'ol';
  const type = isOrdered ? BlockType.NumberedListBlock : BlockType.BulletedListBlock;

  const children: ParsedBlock[] = [];

  // Process list items
  node.children.forEach((child) => {
    if (child.type === 'element') {
      const elem = child;

      if (elem.tagName === 'li') {
        // Check for checkbox (todo list)
        const input = elem.children.find((c) => {
          return c.type === 'element' && (c).tagName === 'input';
        }) as HastElement | undefined;

        if (input && input.properties?.type === 'checkbox') {
          // Todo list item
          const checked = input.properties.checked === true;

          children.push({
            type: BlockType.TodoListBlock,
            data: { checked } as BlockData,
            text: extractTextFromHAST(elem).trim(),
            formats: extractInlineFormatsFromHAST(elem),
            children: [],
          });
        } else {
          // Regular list item
          children.push({
            type,
            data: (isOrdered ? { number: children.length + 1 } : {}) as BlockData,
            text: extractTextFromHAST(elem).trim(),
            formats: extractInlineFormatsFromHAST(elem),
            children: [],
          });
        }
      }
    }
  });

  // Return array of list item blocks directly (flattened structure)
  return children;
}

/**
 * Converts an image element to ParsedBlock
 */
export function parseImage(node: HastElement): ParsedBlock {
  const src = (node.properties?.src as string) || '';
  const alt = (node.properties?.alt as string) || '';

  return {
    type: BlockType.ImageBlock,
    data: {
      url: src,
      image_type: ImageType.External,
      alt,
    } as ImageBlockData,
    text: '',
    formats: [],
    children: [],
  };
}

/**
 * Converts any HAST element to ParsedBlock
 */
export function elementToBlock(node: HastElement): ParsedBlock | ParsedBlock[] | null {
  const tag = node.tagName;

  if (isHeading(tag)) return parseHeading(node);
  if (isBlockquote(tag)) return parseBlockquote(node);
  if (isCodeBlock(tag)) return parseCodeBlock(node);
  if (isList(tag)) return parseList(node);
  if (isTable(tag)) return parseHTMLTable(node);
  if (tag === 'img') return parseImage(node);
  if (tag === 'hr') {
    return {
      type: BlockType.DividerBlock,
      data: {},
      text: '',
      formats: [],
      children: [],
    };
  }

  if (isParagraph(tag)) return parseParagraph(node);

  // Default to paragraph for unknown block elements
  if (node.children && node.children.length > 0) {
    return parseParagraph(node);
  }

  return null;
}
