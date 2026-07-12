import { BlockData, BlockType, HeadingBlockData, ImageBlockData, ImageType } from '@/application/types';

import { extractInlineFormatsFromHAST, extractTextFromHAST } from './inline-converters';
import { parseHTMLTable } from './table-parser';
import { ParsedBlock } from './types';

import type { Element as HastElement } from 'hast';

type ActiveInlineFormat = Pick<ParsedBlock['formats'][number], 'type' | 'data'>;

type ParagraphSegment = {
  text: string;
  formats: ParsedBlock['formats'];
};

const PARAGRAPH_BOUNDARY_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

function parseInlineStyle(style: string): Record<string, string> {
  const styles: Record<string, string> = {};

  style.split(';').forEach((part) => {
    const [key, value] = part.split(':');

    if (key && value) {
      styles[key.trim().toLowerCase()] = value.trim().toLowerCase();
    }
  });

  return styles;
}

function addActiveFormat(formats: ActiveInlineFormat[], format: ActiveInlineFormat) {
  const exists = formats.some((item) => {
    return item.type === format.type && JSON.stringify(item.data ?? {}) === JSON.stringify(format.data ?? {});
  });

  if (!exists) {
    formats.push(format);
  }
}

function getElementFormats(node: HastElement, activeFormats: ActiveInlineFormat[]): ActiveInlineFormat[] {
  const formats = [...activeFormats];
  const style = node.properties?.style as string | undefined;

  if (style) {
    const styles = parseInlineStyle(style);
    const weight = styles['font-weight'];

    if (weight && (weight === 'bold' || weight === 'bolder' || parseInt(weight) >= 700)) {
      addActiveFormat(formats, { type: 'bold' });
    }

    if (styles['font-style'] === 'italic' || styles['font-style'] === 'oblique') {
      addActiveFormat(formats, { type: 'italic' });
    }

    const decoration = styles['text-decoration'];

    if (decoration?.includes('underline')) {
      addActiveFormat(formats, { type: 'underline' });
    }

    if (decoration?.includes('line-through')) {
      addActiveFormat(formats, { type: 'strikethrough' });
    }

    if (styles.color) {
      addActiveFormat(formats, { type: 'color', data: { color: styles.color } });
    }

    if (styles['background-color']) {
      addActiveFormat(formats, { type: 'bgColor', data: { bgColor: styles['background-color'] } });
    }
  }

  switch (node.tagName) {
    case 'strong':
    case 'b':
      addActiveFormat(formats, { type: 'bold' });
      break;
    case 'em':
    case 'i':
      addActiveFormat(formats, { type: 'italic' });
      break;
    case 'u':
      addActiveFormat(formats, { type: 'underline' });
      break;
    case 's':
    case 'strike':
    case 'del':
      addActiveFormat(formats, { type: 'strikethrough' });
      break;
    case 'code':
      addActiveFormat(formats, { type: 'code' });
      break;
    case 'a': {
      const href = node.properties?.href as string | undefined;

      if (href) {
        addActiveFormat(formats, { type: 'link', data: { href } });
      }

      break;
    }
  }

  return formats;
}

function removeInvisiblePasteMarkers(text: string): string {
  return text.replace(/\uFEFF/g, '');
}

function extractParagraphSegments(node: HastElement): ParagraphSegment[] {
  const segments: ParagraphSegment[] = [];
  let current: ParagraphSegment = { text: '', formats: [] };

  const pushSegment = () => {
    if (current.text.trim().length > 0) {
      segments.push(current);
    }

    current = { text: '', formats: [] };
  };

  const appendText = (value: string, activeFormats: ActiveInlineFormat[]) => {
    const text = removeInvisiblePasteMarkers(value);

    if (text.length === 0) return;

    const start = current.text.length;
    const end = start + text.length;

    current.text += text;

    activeFormats.forEach((format) => {
      current.formats.push({
        start,
        end,
        type: format.type,
        data: format.data,
      });
    });
  };

  const walkNode = (
    child: HastElement | { type: string; value?: string },
    activeFormats: ActiveInlineFormat[],
    isRoot = false
  ) => {
    if (child.type === 'text') {
      appendText(child.value ?? '', activeFormats);
      return;
    }

    if (child.type !== 'element') return;

    const element = child as HastElement;

    if (element.tagName === 'br') {
      pushSegment();
      return;
    }

    const isNestedBoundary = !isRoot && PARAGRAPH_BOUNDARY_TAGS.has(element.tagName);

    if (isNestedBoundary) {
      pushSegment();
    }

    const nextFormats = getElementFormats(element, activeFormats);

    element.children.forEach((nestedChild) => {
      walkNode(nestedChild as HastElement | { type: string; value?: string }, nextFormats);
    });

    if (isNestedBoundary) {
      pushSegment();
    }
  };

  walkNode(node, [], true);
  pushSegment();

  return segments;
}

function buildParagraphBlock(text: string, formats: ParsedBlock['formats']): ParsedBlock {
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
    formats,
    children: [],
  };
}

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
  const level = Number.parseInt(node.tagName[1]) as 1 | 2 | 3 | 4 | 5 | 6;

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
export function parseParagraph(node: HastElement): ParsedBlock | ParsedBlock[] {
  const segments = extractParagraphSegments(node);

  if (segments.length > 1) {
    return segments.map((segment) => buildParagraphBlock(segment.text, segment.formats));
  }

  if (segments.length === 1) {
    return buildParagraphBlock(segments[0].text, segments[0].formats);
  }

  const text = removeInvisiblePasteMarkers(extractTextFromHAST(node));

  return buildParagraphBlock(text, extractInlineFormatsFromHAST(node));
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
    return child.type === 'element' && child.tagName === 'code';
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
          return c.type === 'element' && c.tagName === 'input';
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
