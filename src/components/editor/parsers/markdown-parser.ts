import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { BlockData, BlockType, MathEquationBlockData } from '@/application/types';
import { normalizeMathMarkdown } from '@/components/editor/utils/math-markdown';

import { extractInlineFormatsFromMDAST, extractTextFromMDAST } from './mdast-utils';
import { parseMarkdownTable } from './table-parser';
import { MarkdownParseOptions, ParsedBlock } from './types';

import type {
  BlockContent,
  Code,
  DefinitionContent,
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

  // Normalize pasted Unicode bullets while retaining their nesting. A tab is
  // one list level (two spaces), so a leading tab does not turn the list into
  // an indented code block. Keep newlines intact for empty list items.
  const normalizedMarkdown = markdown.replace(
    /^([ \t]*)[•◦▪⁃–—][ \t]*/gm,
    (_, indentation: string) => `${indentation.replace(/\t/g, '  ')}- `
  );

  const {
    gfm = true,
  } = options;

  try {
    // Step 1: Parse Markdown to MDAST
    let processor = unified().use(remarkParse).use(remarkMath);

    if (gfm) {
      processor = processor.use(remarkGfm) as typeof processor;
    }

    const initialTree = processor.parse(normalizedMarkdown);
    const mathMarkdown = normalizeMathMarkdown(normalizedMarkdown, initialTree);
    const tree = mathMarkdown === normalizedMarkdown ? initialTree : processor.parse(mathMarkdown);
    const ast = processor.runSync(tree) as MdastRoot;

    // Desktop treats same-line $$...$$ as display math too. Split paragraphs
    // using parser positions so escaped dollars and code remain untouched.
    expandDisplayMath(ast, mathMarkdown);

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
function convertMarkdownASTToAppFlowyBlocks(nodes: Array<BlockContent | DefinitionContent>): ParsedBlock[] {
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
function convertMarkdownNode(node: BlockContent | DefinitionContent): ParsedBlock | ParsedBlock[] | null {
  switch (node.type) {
    case 'math':
      return { type: BlockType.EquationBlock, data: { formula: node.value.trim() } as MathEquationBlockData, text: '', formats: [], children: [] };
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
    const isTask = item.checked !== null && item.checked !== undefined;
    const firstChild = item.children[0];
    const paragraph = firstChild?.type === 'paragraph' ? firstChild : undefined;

    // Nested lists and additional paragraphs are child blocks, not part of
    // the item's own text. Joining them loses bullets and formatting offsets.
    children.push({
      type: isTask ? BlockType.TodoListBlock : type,
      data: (isTask ? { checked: item.checked === true } : isOrdered ? { number: (node.start ?? 1) + index } : {}) as BlockData,
      text: paragraph ? extractTextFromMDAST(paragraph) : '',
      formats: paragraph ? extractInlineFormatsFromMDAST(paragraph) : [],
      children: convertMarkdownASTToAppFlowyBlocks(paragraph ? item.children.slice(1) : item.children),
    });
  });

  // Siblings remain separate blocks while nested items retain their hierarchy.
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

function expandDisplayMath(node: { children?: unknown[] }, source: string) {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    const item = child as Paragraph;

    if (item.type !== 'paragraph') {
      expandDisplayMath(item, source);
      return [item];
    }

    const result: BlockContent[] = [];
    let pending: Paragraph['children'] = [];
    const flush = () => {
      if (pending.length && extractTextFromMDAST({ children: pending }).trim()) result.push({ type: 'paragraph', children: pending });
      pending = [];
    };

    for (const inline of item.children) {
      const offset = inline.position?.start.offset;

      if (inline.type === 'inlineMath' && offset !== undefined && source.slice(offset, offset + 2) === '$$') {
        flush();
        // remark's inline math normalizes newlines to spaces. A same-paragraph
        // display equation must retain them for Flutter's multiline syntax.
        const raw = source.slice(offset, inline.position?.end.offset);

        result.push({ type: 'math', value: raw.replace(/^\$+|\$+$/g, '').trim() });
      } else pending.push(inline);
    }

    flush();
    return result;
  });
}
