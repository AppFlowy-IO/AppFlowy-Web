
import { InlineFormat } from './types';

import type { Element as HastElement, Text as HastText } from 'hast';

/**
 * Helper to parse inline style string into object
 */
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

/**
 * Extracts inline formatting information from HAST (HTML AST) nodes
 * @param node HAST element node
 * @param baseOffset Offset to add to all positions (for nested elements)
 * @returns Array of inline format specifications
 */
export function extractInlineFormatsFromHAST(node: HastElement, baseOffset = 0): InlineFormat[] {
  const formats: InlineFormat[] = [];
  let currentOffset = baseOffset;

  /**
   * Recursively walk the HAST tree and collect formatting information
   */
  function walkNode(n: HastElement | HastText, parentFormats: Set<InlineFormat['type']> = new Set()): string {
    // Text node - apply accumulated formats
    if (n.type === 'text') {
      const textLength = n.value.length;

      // Create format spans for each active format
      parentFormats.forEach((formatType) => {
        formats.push({
          start: currentOffset,
          end: currentOffset + textLength,
          type: formatType,
        });
      });

      currentOffset += textLength;
      return n.value;
    }

    // Element node - add formatting and recurse
    if (n.type === 'element') {
      const elem = n;
      const newFormats = new Set(parentFormats);

      // Check inline styles for formatting
      const style = elem.properties?.style as string;

      if (style) {
        const styles = parseInlineStyle(style);

        // Font Weight (Bold)
        if (styles['font-weight']) {
          const weight = styles['font-weight'];

          if (weight === 'bold' || weight === 'bolder' || parseInt(weight) >= 700) {
            newFormats.add('bold');
          }
        }

        // Font Style (Italic)
        if (styles['font-style'] === 'italic' || styles['font-style'] === 'oblique') {
          newFormats.add('italic');
        }

        // Text Decoration (Underline, Strikethrough)
        if (styles['text-decoration']) {
          const decoration = styles['text-decoration'];

          if (decoration.includes('underline')) {
            newFormats.add('underline');
          }

          if (decoration.includes('line-through')) {
            newFormats.add('strikethrough');
          }
        }
      }

      // Map HTML tags to format types
      switch (elem.tagName) {
        case 'strong':
        case 'b':
          newFormats.add('bold');
          break;

        case 'em':
        case 'i':
          newFormats.add('italic');
          break;

        case 'u':
          newFormats.add('underline');
          break;

        case 's':
        case 'strike':
        case 'del':
          newFormats.add('strikethrough');
          break;

        case 'code':
          newFormats.add('code');
          break;

        case 'a': {
          // Links are handled separately with data
          const href = elem.properties?.href as string;

          if (href) {
            const startOffset = currentOffset;
            const text = elem.children.map((child) => walkNode(child as HastElement | HastText, newFormats)).join('');

            formats.push({
              start: startOffset,
              end: currentOffset,
              type: 'link',
              data: { href },
            });
            return text;
          }

          break;
        }

        case 'span': {
          // Check for color styling
          const style = elem.properties?.style as string;

          if (style) {
            const colorMatch = /color:\s*([^;]+)/.exec(style);
            const bgColorMatch = /background-color:\s*([^;]+)/.exec(style);

            if (colorMatch) {
              const startOffset = currentOffset;
              const text = elem.children.map((child) => walkNode(child as HastElement | HastText, newFormats)).join('');

              formats.push({
                start: startOffset,
                end: currentOffset,
                type: 'color',
                data: { color: colorMatch[1].trim() },
              });

              if (bgColorMatch) {
                formats.push({
                  start: startOffset,
                  end: currentOffset,
                  type: 'bgColor',
                  data: { bgColor: bgColorMatch[1].trim() },
                });
              }

              return text;
            }
          }

          break;
        }
      }

      // Process children with accumulated formats
      return elem.children.map((child) => walkNode(child as HastElement | HastText, newFormats)).join('');
    }

    return '';
  }

  walkNode(node);
  return formats;
}

/**
 * Extracts plain text content from HAST node
 * @param node HAST node
 * @returns Plain text content
 */
export function extractTextFromHAST(node: HastElement | HastText): string {
  if (node.type === 'text') {
    return node.value;
  }

  if (node.type === 'element') {
    return node.children.map((child) => extractTextFromHAST(child as HastElement | HastText)).join('');
  }

  return '';
}

/**
 * Merges overlapping or adjacent format spans of the same type
 * @param formats Array of inline formats
 * @returns Merged formats
 */
export function mergeFormats(formats: InlineFormat[]): InlineFormat[] {
  if (formats.length === 0) return [];

  // Group by type
  const byType = new Map<string, InlineFormat[]>();

  formats.forEach((format) => {
    const key = format.type + (format.data?.href || format.data?.color || '');

    if (!byType.has(key)) {
      byType.set(key, []);
    }

    byType.get(key)!.push(format);
  });

  const merged: InlineFormat[] = [];

  // Merge each group
  byType.forEach((group) => {
    group.sort((a, b) => a.start - b.start);

    let current = group[0];

    for (let i = 1; i < group.length; i++) {
      const next = group[i];

      // Check if overlapping or adjacent
      if (next.start <= current.end) {
        // Merge
        current = {
          ...current,
          end: Math.max(current.end, next.end),
        };
      } else {
        // Push current and move to next
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
  });

  return merged;
}
