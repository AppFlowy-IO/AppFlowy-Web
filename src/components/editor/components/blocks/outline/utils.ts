import { Editor, Element, Text } from 'slate';

import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { HeadingNode } from '@/components/editor/editor.type';

export interface OutlineHeading extends Omit<HeadingNode, 'data' | 'children'> {
  data: HeadingNode['data'] & { text: string };
  children: OutlineHeading[];
}

export function extractHeadings(
  editor: Pick<Editor, 'children'>,
  maxDepth: number
): {
  hasHeadings: boolean;
  headings: OutlineHeading[];
} {
  const headings: OutlineHeading[] = [];
  const blocks = editor.children;
  let hasHeadings = false;

  function traverse(children: (Element | Text)[]) {
    for (const block of children) {
      if (Text.isText(block)) continue;

      const level = (block as HeadingNode).data?.level;
      const isHeading =
        [BlockType.HeadingBlock, BlockType.ToggleListBlock].includes(block.type as BlockType) &&
        Number.isInteger(level) &&
        level >= 1 &&
        level <= 6;

      if (isHeading) {
        hasHeadings = true;
      }

      if (isHeading && level <= maxDepth) {
        headings.push({
          ...block,
          data: {
            level,
            text: CustomEditor.getBlockTextContent(block, 2).trim(),
          },
          children: [],
        } as OutlineHeading);
      }

      // Headings can contain nested blocks, including other headings.
      traverse(block.children);
    }
  }

  traverse(blocks);

  return {
    hasHeadings,
    headings,
  };
}

export interface OutlineItem {
  heading: OutlineHeading;
  indent: number;
}

export function flattenHeadings(headings: OutlineHeading[], indent = 0): OutlineItem[] {
  return headings.flatMap((heading) => [{ heading, indent }, ...flattenHeadings(heading.children, indent + 1)]);
}

/** The visually nearest heading above the reading line, or the topmost heading before scrolling. */
export function getActiveHeading(
  positions: readonly { blockId: string; top: number }[],
  readingLine: number,
  atBottom = false
): string | undefined {
  if (!positions.length) return undefined;
  let first = positions[0];
  let last = first;
  let active: (typeof positions)[number] | undefined;

  for (const position of positions) {
    // Column traversal order is not vertical order. Resolve ties in document order.
    if (position.top < first.top) first = position;
    if (position.top >= last.top) last = position;
    if (position.top <= readingLine && (!active || position.top >= active.top)) active = position;
  }

  return (atBottom ? last : active ?? first).blockId;
}

export function nestHeadings(headings: OutlineHeading[]): OutlineHeading[] {
  const root: OutlineHeading[] = [];
  const stack: OutlineHeading[] = [];

  headings.forEach((heading) => {
    const node = { ...heading, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].data.level >= node.data.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  });

  return root;
}
