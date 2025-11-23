import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { BlockData, BlockType } from '@/application/types';

import { parseMarkdownTable } from './table-parser';
import { InlineFormat, MarkdownParseOptions, ParsedBlock } from './types';

import type {
  BlockContent,
  Code,
  Heading,
  InlineCode,
  Link,
  List,
  ListItem,
  Root as MdastRoot,
  Text as MdastText,
  Paragraph,
} from 'mdast';

/**
 * Parses Markdown string into structured blocks
 * @param markdown Markdown string
 * @param options Parsing options
 * @returns Array of parsed blocks
 *
 * @example
 * ```typescript
 * const md = '# Hello\n\nThis is **bold** text';
 * const blocks = parseMarkdown(md);
 * ```
 */
export function parseMarkdown(markdown: string, options: MarkdownParseOptions = {}): ParsedBlock[] {
  if (!markdown || markdown.trim().length === 0) {
    return [];
  }

  // Pre-process: Replace • with - to support bullet character as list marker
  // We consume following whitespace (including newlines) to ensure text is on the same line
  const normalizedMarkdown = markdown.replace(/^[ \t]*•\s*/gm, '- ');

  const {
    gfm = true,
  } = options;

  try {
    // Step 1: Parse Markdown to MDAST
    let processor = unified().use(remarkParse);

    if (gfm) {
      processor = processor.use(remarkGfm) as typeof processor;
    }

    const tree = processor.parse(normalizedMarkdown);
    const ast = processor.runSync(tree) as MdastRoot;

    // Step 2: Convert MDAST to ParsedBlocks
    const blocks = convertMarkdownASTToAppFlowyBlocks(ast.children as BlockContent[]);

    return blocks;
  } catch (error) {
    console.error('Error parsing Markdown:', error);
    return [];
  }
}

/**
 * Converts Markdown AST nodes to AppFlowy block structures
 */
function convertMarkdownASTToAppFlowyBlocks(nodes: BlockContent[]): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  for (const node of nodes) {
    const block = convertMarkdownNode(node);

    if (block) {
      if (Array.isArray(block)) {
        blocks.push(...block);
      } else {
        blocks.push(block);
      }
    }
  }

  return blocks;
}

/**
 * Converts a single Markdown AST node to AppFlowy ParsedBlock
 */
function convertMarkdownNode(node: BlockContent): ParsedBlock | ParsedBlock[] | null {
  switch (node.type) {
    case 'heading':
      return buildHeadingBlock(node);

    case 'paragraph':
      return buildParagraphBlock(node);

    case 'list':
      return buildListBlock(node);

    case 'code':
      return buildCodeBlock(node);

    case 'blockquote':
      return {
        type: BlockType.QuoteBlock,
        data: {},
        text: extractText(node),
        formats: extractFormats(node),
        children: [],
      };

    case 'thematicBreak':
      return {
        type: BlockType.DividerBlock,
        data: {},
        text: '',
        formats: [],
        children: [],
      };

    case 'table':
      return parseMarkdownTable(node as unknown as import('mdast').Table);

    default:
      return null;
  }
}

/**
 * Builds AppFlowy heading block from Markdown heading node
 */
function buildHeadingBlock(node: Heading): ParsedBlock {
  return {
    type: BlockType.HeadingBlock,
    data: { level: node.depth } as BlockData,
    text: extractText(node),
    formats: extractFormats(node),
    children: [],
  };
}

/**
 * Builds AppFlowy paragraph block from Markdown paragraph node
 */
function buildParagraphBlock(node: Paragraph): ParsedBlock {
  const text = extractText(node);

  // Check for special patterns
  if (text === '---' || text === '***' || text === '___') {
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
    formats: extractFormats(node),
    children: [],
  };
}

/**
 * Builds AppFlowy list block from Markdown list node
 */
function buildListBlock(node: List): ParsedBlock[] {
  const isOrdered = node.ordered || false;
  const type = isOrdered ? BlockType.NumberedListBlock : BlockType.BulletedListBlock;

  const children: ParsedBlock[] = [];

  node.children.forEach((item: ListItem, index: number) => {
    // Check if it's a task list item
    const isTask = item.checked !== null && item.checked !== undefined;

    if (isTask) {
      children.push({
        type: BlockType.TodoListBlock,
        data: { checked: item.checked === true } as BlockData,
        text: extractText(item),
        formats: extractFormats(item),
        children: [],
      });
    } else {
      children.push({
        type,
        data: (isOrdered ? { number: index + 1 } : {}) as BlockData,
        text: extractText(item),
        formats: extractFormats(item),
        children: [],
      });
    }
  });

  // Return array of flattened list items
  return children;
}

/**
 * Builds AppFlowy code block from Markdown code node
 */
function buildCodeBlock(node: Code): ParsedBlock {
  return {
    type: BlockType.CodeBlock,
    data: { language: node.lang || 'plaintext' } as BlockData,
    text: node.value,
    formats: [], // No inline formatting in code blocks
    children: [],
  };
}

/**
 * Extracts plain text from MDAST node
 */
export function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';

  const n = node as { type: string; value?: string; children?: unknown[] };

  if (n.type === 'text') {
    return (n as MdastText).value;
  }

  if (n.type === 'inlineCode') {
    return (n as InlineCode).value;
  }

  if (n.children) {
    return n.children.map(extractText).join('');
  }

  return '';
}

/**
 * Extracts inline formatting from MDAST node
 */
export function extractFormats(node: unknown, baseOffset = 0): InlineFormat[] {
  const formats: InlineFormat[] = [];

  let currentOffset = baseOffset;

  function walk(n: unknown, parentTypes: Set<InlineFormat['type']> = new Set()): string {
    if (!n || typeof n !== 'object') return '';

    const obj = n as {
      type: string;
      value?: string;
      children?: unknown[];
      url?: string;
    };

    // Text node
    if (obj.type === 'text') {
      const text = (obj as MdastText).value;
      const textLength = text.length;

      // Apply all parent formats
      parentTypes.forEach((formatType) => {
        formats.push({
          start: currentOffset,
          end: currentOffset + textLength,
          type: formatType,
        });
      });

      currentOffset += textLength;
      return text;
    }

    // Inline code
    if (obj.type === 'inlineCode') {
      const text = (obj as InlineCode).value;
      const startOffset = currentOffset;

      currentOffset += text.length;

      formats.push({
        start: startOffset,
        end: currentOffset,
        type: 'code',
      });

      return text;
    }

    // Formatting nodes
    const newTypes = new Set(parentTypes);

    switch (obj.type) {
      case 'strong':
        newTypes.add('bold');
        break;

      case 'emphasis':
        newTypes.add('italic');
        break;

      case 'delete':
        newTypes.add('strikethrough');
        break;

      case 'link': {
        const linkNode = obj as Link;
        const startOffset = currentOffset;
        const text = (obj.children || []).map((child) => walk(child, newTypes)).join('');

        formats.push({
          start: startOffset,
          end: currentOffset,
          type: 'link',
          data: { href: linkNode.url },
        });

        return text;
      }
    }

    // Process children
    if (obj.children) {
      return obj.children.map((child) => walk(child, newTypes)).join('');
    }

    return '';
  }

  walk(node);

  return formats;
}
