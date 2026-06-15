import { InlineFormat } from './types';

import type { InlineCode, Link, Text as MdastText } from 'mdast';

/**
 * Extracts plain text from MDAST node
 */
export function extractTextFromMDAST(node: unknown): string {
  if (!node || typeof node !== 'object') return '';

  const n = node as { type: string; value?: string; children?: unknown[] };

  if (n.type === 'text') {
    return (n as MdastText).value;
  }

  if (n.type === 'inlineCode') {
    return (n as InlineCode).value;
  }

  if (n.children) {
    return n.children.map(extractTextFromMDAST).join('');
  }

  return '';
}

/**
 * Extracts inline formatting from MDAST node
 */
export function extractInlineFormatsFromMDAST(node: unknown, baseOffset = 0): InlineFormat[] {
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
