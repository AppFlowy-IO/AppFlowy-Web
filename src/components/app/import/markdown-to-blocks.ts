import { Element, Text } from 'slate';

import { YjsEditorKey } from '@/application/types';
import { ParsedBlock, InlineFormat } from '@/components/editor/parsers/types';

/**
 * Convert a ParsedBlock to a Slate Element compatible with `slateContentInsertToYData`.
 * Mirrors the (unexported) pair in `withPasted.ts` and `ai-meeting.summary-regenerate.ts`.
 */
export function parsedBlockToSlateElement(block: ParsedBlock): Element {
  const textNodes = parsedBlockToTextNodes(block);
  const slateChildren: (Element | Text)[] = [
    { type: YjsEditorKey.text, children: textNodes } as unknown as Element,
    ...block.children.map(parsedBlockToSlateElement),
  ];

  return {
    type: block.type,
    data: block.data,
    children: slateChildren,
  } as unknown as Element;
}

function parsedBlockToTextNodes(block: ParsedBlock): Text[] {
  const { text, formats } = block;

  if (formats.length === 0) return [{ text }];

  const boundaries = new Set<number>([0, text.length]);

  formats.forEach((f: InlineFormat) => {
    boundaries.add(f.start);
    boundaries.add(f.end);
  });

  const positions = Array.from(boundaries).sort((a, b) => a - b);
  const nodes: Text[] = [];

  for (let i = 0; i < positions.length - 1; i++) {
    const start = positions[i];
    const end = positions[i + 1];
    const segment = text.slice(start, end);

    if (segment.length === 0) continue;

    const active = formats.filter((f) => f.start <= start && f.end >= end);
    const attributes: Record<string, unknown> = {};

    active.forEach((f) => {
      switch (f.type) {
        case 'bold': attributes.bold = true; break;
        case 'italic': attributes.italic = true; break;
        case 'underline': attributes.underline = true; break;
        case 'strikethrough': attributes.strikethrough = true; break;
        case 'code': attributes.code = true; break;
        case 'link': attributes.href = f.data?.href; break;
        case 'color': attributes.font_color = f.data?.color; break;
        case 'bgColor': attributes.bg_color = f.data?.bgColor; break;
      }
    });

    nodes.push({ text: segment, ...attributes } as Text);
  }

  return nodes;
}
