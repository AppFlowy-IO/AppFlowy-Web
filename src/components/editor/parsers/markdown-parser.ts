import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { BlockData, BlockType } from '@/application/types';

import { extractInlineFormatsFromMDAST, extractTextFromMDAST } from './mdast-utils';
import { parseMarkdownTable } from './table-parser';
import { MarkdownParseOptions, ParsedBlock } from './types';

import type {
  BlockContent,
  Code,
  Heading,
  List,
  ListItem,
  Root as MdastRoot,
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
  // Support various bullet characters: • (Bullet), ◦ (White Bullet), ▪ (Black Small Square), ⁃ (Hyphen Bullet), – (En Dash), — (Em Dash)
  const normalizedMarkdown = markdown.replace(/^[ \t]*[•◦▪⁃–—]\s*/gm, '- ');

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
        text: extractTextFromMDAST(node),
        formats: extractInlineFormatsFromMDAST(node),
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
    text: extractTextFromMDAST(node),
    formats: extractInlineFormatsFromMDAST(node),
    children: [],
  };
}

/**
 * Builds AppFlowy paragraph block from Markdown paragraph node
 */
function buildParagraphBlock(node: Paragraph): ParsedBlock {
  const text = extractTextFromMDAST(node);

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
    formats: extractInlineFormatsFromMDAST(node),
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
        text: extractTextFromMDAST(item),
        formats: extractInlineFormatsFromMDAST(item),
        children: [],
      });
    } else {
      children.push({
        type,
        data: (isOrdered ? { number: index + 1 } : {}) as BlockData,
        text: extractTextFromMDAST(item),
        formats: extractInlineFormatsFromMDAST(item),
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
