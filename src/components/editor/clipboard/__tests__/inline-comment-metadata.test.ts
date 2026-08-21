import { Node } from 'slate';

import { BlockType } from '@/application/types';

import { stripInlineCommentIds } from '../inline-comment-metadata';

describe('inline comment clipboard metadata', () => {
  it('removes comment ids recursively while retaining rich-text marks', () => {
    const fragment: Node[] = [
      {
        type: BlockType.Paragraph,
        blockId: 'block-1',
        children: [
          { text: 'selected', bold: true, 'comment-ids': ['comment-1'] },
          { text: ' text', italic: true },
        ],
      },
    ];

    expect(stripInlineCommentIds(fragment)).toEqual([
      {
        type: BlockType.Paragraph,
        blockId: 'block-1',
        children: [
          { text: 'selected', bold: true },
          { text: ' text', italic: true },
        ],
      },
    ]);
  });

  it('preserves node identity when a fragment contains no comment ids', () => {
    const fragment: Node[] = [{ text: 'plain', underline: true }];

    const result = stripInlineCommentIds(fragment);

    expect(result[0]).toBe(fragment[0]);
  });
});
