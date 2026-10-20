import { Element, Text } from 'slate';

import { BlockType, YjsEditorKey } from '@/application/types';

import { ParsedBlock } from './types';

/**
 * Converts ParsedBlock to Slate Element with proper text wrapper
 */
export function parsedBlockToSlateElement(block: ParsedBlock): Element {
  const { type, data, children } = block;

  if (SIMPLE_TABLE_CONTAINER_BLOCK_TYPES.includes(type)) {
    return {
      type,
      data,
      children: children.map(parsedBlockToSlateElement),
    } as Element;
  }

  // Convert text + formats to Slate text nodes
  const textNodes = parsedBlockToTextNodes(block);

  // Create children - text wrapper + any nested blocks
  const slateChildren: (Element | Text)[] = [
    { type: YjsEditorKey.text, children: textNodes } as Element,
    ...children.map(parsedBlockToSlateElement),
  ];

  return {
    type,
    data,
    children: slateChildren,
  } as Element;
}

const SIMPLE_TABLE_CONTAINER_BLOCK_TYPES = [
  BlockType.SimpleTableBlock,
  BlockType.SimpleTableRowBlock,
  BlockType.SimpleTableCellBlock,
];

/**
 * Converts ParsedBlock text to Slate text nodes with formats
 */
export function parsedBlockToTextNodes(block: ParsedBlock): Text[] {
  const { text, formats } = block;

  if (formats.length === 0) {
    return [{ text }];
  }

  // Create segments based on format boundaries
  const boundaries = new Set<number>([0, text.length]);

  formats.forEach((format) => {
    boundaries.add(format.start);
    boundaries.add(format.end);
  });

  const positions = Array.from(boundaries).sort((a, b) => a - b);
  const nodes: Text[] = [];

  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i];
    const end = positions[i + 1];
    const segment = text.slice(start, end);

    if (segment.length === 0) continue;

    // Find all formats that apply to this segment
    const activeFormats = formats.filter((format) => format.start <= start && format.end >= end);

    // Build attributes object
    const attributes: Record<string, unknown> = {};

    activeFormats.forEach((format) => {
      switch (format.type) {
        case 'formula':
          attributes.formula = format.data?.formula;
          break;
        case 'bold':
          attributes.bold = true;
          break;
        case 'italic':
          attributes.italic = true;
          break;
        case 'underline':
          attributes.underline = true;
          break;
        case 'strikethrough':
          attributes.strikethrough = true;
          break;
        case 'code':
          attributes.code = true;
          break;
        case 'link':
          attributes.href = format.data?.href;
          break;
        case 'color':
          attributes.font_color = format.data?.color;
          break;
        case 'bgColor':
          attributes.bg_color = format.data?.bgColor;
          break;
      }
    });

    nodes.push({ text: segment, ...attributes } as Text);
  }

  return nodes;
}
