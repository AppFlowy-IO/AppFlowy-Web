import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { BlockData, BlockType, ImageBlockData, ImageType, MathEquationBlockData } from '@/application/types';
import { normalizeMathMarkdown } from '@/components/editor/utils/math-markdown';

import { extractInlineFormatsFromMDAST, extractTextFromMDAST } from './mdast-utils';
import { parseMarkdownTable } from './table-parser';
import { MarkdownParseOptions, ParsedBlock } from './types';

import type {
  BlockContent,
  Code,
  DefinitionContent,
  Heading,
  Image,
  List,
  ListItem,
  Root as MdastRoot,
  Paragraph,
  PhrasingContent,
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

  const { gfm = true, inlineParentheses = false } = options;

  try {
    // Step 1: Parse Markdown to MDAST
    let processor = unified().use(remarkParse).use(remarkMath);

    if (gfm) {
      processor = processor.use(remarkGfm) as typeof processor;
    }

    const initialTree = processor.parse(normalizedMarkdown);
    const mathMarkdown = normalizeMathMarkdown(normalizedMarkdown, initialTree, { inlineParentheses });
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
 * Builds AppFlowy paragraph block(s) from a Markdown paragraph node. An image on
 * a line of its own becomes an image block, as it does when pasted as HTML, also
 * when that line follows a soft break inside the paragraph.
 */
function buildParagraphBlock(node: Paragraph): ParsedBlock | ParsedBlock[] {
  const segments = splitParagraphAtImages(node);

  if (segments.length === 1 && segments[0].type === 'text') return buildTextParagraph(node);

  return segments.map((segment) =>
    segment.type === 'image'
      ? {
          type: BlockType.ImageBlock,
          data: { url: segment.image.url, image_type: ImageType.External } as ImageBlockData,
          text: '',
          formats: [],
          children: [],
        }
      : buildTextParagraph({ type: 'paragraph', children: segment.children })
  );
}

type ParagraphSegment = { type: 'image'; image: Image } | { type: 'text'; children: PhrasingContent[] };

/**
 * Splits inline content at images that occupy a whole line: the paragraph's only
 * content, or content separated from the rest by a line break. An image inside a
 * sentence stays where it is.
 */
function splitParagraphAtImages(node: Paragraph): ParagraphSegment[] {
  const children = node.children;
  const segments: ParagraphSegment[] = [];
  let pending: PhrasingContent[] = [];
  const flush = () => {
    const content = trimLineEdges(pending);

    if (content.some((child) => !(child.type === 'text' && !child.value.trim()))) {
      segments.push({ type: 'text', children: content });
    }

    pending = [];
  };

  children.forEach((child, index) => {
    if (child.type === 'image' && startsLine(children[index - 1]) && endsLine(children[index + 1])) {
      flush();
      segments.push({ type: 'image', image: child });
    } else {
      pending.push(child);
    }
  });
  flush();

  return segments.length ? segments : [{ type: 'text', children }];
}

/** The node before an image leaves it at a line start: nothing, a hard break, or text ending a line. */
function startsLine(before: PhrasingContent | undefined): boolean {
  if (!before || before.type === 'break') return true;

  return before.type === 'text' && /\n\s*$/.test(before.value);
}

/** The node after an image ends its line: nothing, a hard break, or text starting a new line. */
function endsLine(after: PhrasingContent | undefined): boolean {
  if (!after || after.type === 'break') return true;

  return after.type === 'text' && /^\s*\n/.test(after.value);
}

/** Drops the line breaks that separated a segment from a neighbouring image. */
function trimLineEdges(nodes: PhrasingContent[]): PhrasingContent[] {
  const content = [...nodes];
  const trim = (index: number, pattern: RegExp) => {
    const node = content[index];

    if (node?.type === 'text') content[index] = { ...node, value: node.value.replace(pattern, '') };
  };

  trim(0, /^\s*\n/);
  trim(content.length - 1, /\n\s*$/);

  return content;
}

function buildTextParagraph(node: Paragraph): ParsedBlock {
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
      // An image has no text but still holds the paragraph.
      if (
        pending.length &&
        (extractTextFromMDAST({ children: pending }).trim() || pending.some((inline) => inline.type === 'image'))
      )
        result.push({ type: 'paragraph', children: pending });
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
