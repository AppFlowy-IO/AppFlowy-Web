import { Descendant } from 'slate';

import { BlockType, MentionType, YjsEditorKey } from '@/application/types';

import { extractHeadings, flattenHeadings, getActiveHeading, nestHeadings } from '../utils';

jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));
jest.mock('@/components/editor/parsers/markdown-parser', () => ({ parseMarkdown: jest.fn() }));

function heading(blockId: string, level: number, text = blockId, children: Descendant[] = []): Descendant {
  return {
    type: BlockType.HeadingBlock,
    blockId,
    data: { level },
    children: [{ type: YjsEditorKey.text, children: [{ text }] }, ...children],
  } as Descendant;
}

describe('document outline headings', () => {
  it('finds H1–H6, including nested headings, and ignores ordinary toggles and invalid levels', () => {
    const children = [
      heading('parent', 1, 'Parent', [heading('nested', 3)]),
      ...[2, 4, 5, 6].map((level) => heading(`h${level}`, level)),
      heading('invalid', 7),
      { type: BlockType.ToggleListBlock, data: { level: 0 }, children: [{ text: 'Not a heading' }] },
    ] as Descendant[];
    const result = extractHeadings({ children }, 6);

    expect(result.headings.map((item) => item.blockId)).toEqual(['parent', 'nested', 'h2', 'h4', 'h5', 'h6']);
    expect(result.headings[0].data.text).toBe('Parent');
    expect(result.hasHeadings).toBe(true);
    expect(extractHeadings({ children: [children[children.length - 1]] }, 6).hasHeadings).toBe(false);
  });

  it('keeps depth filtering independent and preserves inline mention and formula labels', () => {
    const children = [heading('h1', 1), heading('h6', 6)] as Descendant[];
    const inline = heading('inline', 2) as { children: Descendant[] };

    inline.children = [
      {
        type: YjsEditorKey.text,
        children: [
          { text: '@', mention: { type: MentionType.Person, person_id: 'ada', person_name: 'Ada' } },
          { text: ' ' },
          { text: '$', formula: 'x^2' },
        ],
      },
    ] as Descendant[];
    children.push(inline as Descendant);
    expect(extractHeadings({ children }, 2).headings.map((item) => item.data.text)).toEqual(['h1', 'Ada x^2']);
    expect(extractHeadings({ children }, 6).headings).toHaveLength(3);
  });

  it('indents by hierarchy when heading levels are skipped, without changing document order', () => {
    const { headings } = extractHeadings(
      { children: [heading('a', 2), heading('b', 6), heading('c', 3), heading('d', 1)] },
      6
    );

    expect(flattenHeadings(nestHeadings(headings)).map(({ heading, indent }) => [heading.blockId, indent])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 1],
      ['d', 0],
    ]);
  });

  it('tracks the last heading above the reading line, including before the first heading', () => {
    const positions = [
      { blockId: 'first', top: -200 },
      { blockId: 'second', top: 64 },
      { blockId: 'third', top: 600 },
    ];

    expect(getActiveHeading(positions, 80)).toBe('second');
    expect(getActiveHeading(positions, -300)).toBe('first');
    expect(getActiveHeading(positions, 900)).toBe('third');
    expect(getActiveHeading(positions, 80, true)).toBe('third');
    expect(getActiveHeading([], 80)).toBeUndefined();
  });
});
