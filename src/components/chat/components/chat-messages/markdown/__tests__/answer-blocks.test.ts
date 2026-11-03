import { BlockType, ImageType } from '@/application/types';
import {
  answerBlocksToEditorData,
  parseAnswerBlocks,
} from '@/components/chat/components/chat-messages/markdown/answer-blocks';

describe('answer blocks', () => {
  it('parses math, code and tables with the document pipeline', () => {
    const blocks = parseAnswerBlocks(
      'Euler: \\( e^{i\\pi} + 1 = 0 \\)\n\n$$\nE = mc^2\n$$\n\n```python\nprint(1)\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |'
    );

    expect(blocks.map((block) => block.type)).toEqual([
      BlockType.Paragraph,
      BlockType.EquationBlock,
      BlockType.CodeBlock,
      BlockType.SimpleTableBlock,
    ]);
    expect(blocks[0].formats).toEqual([
      expect.objectContaining({ type: 'formula', data: { formula: expect.stringContaining('e^{i\\pi} + 1 = 0') } }),
    ]);
    expect(blocks[1].data).toEqual({ formula: 'E = mc^2' });
    expect(blocks[2].data).toEqual({ language: 'python' });
    expect(blocks[2].text).toBe('print(1)');
  });

  it('keeps equations, code languages and images in the data sent to pages', () => {
    const data = answerBlocksToEditorData(
      parseAnswerBlocks(
        '# Title\n\nSee **bold** and [docs](https://appflowy.io) with $x^2$.\n\n$$\na = b\n$$\n\n```rust\nfn main() {}\n```\n\n![Generated Image](https://example.com/a.png)'
      )
    );

    expect(data).toEqual([
      { type: 'heading', data: { level: 1 }, delta: [{ insert: 'Title' }], children: [] },
      {
        type: 'paragraph',
        data: {},
        delta: [
          { insert: 'See ' },
          { insert: 'bold', attributes: { bold: true } },
          { insert: ' and ' },
          { insert: 'docs', attributes: { href: 'https://appflowy.io' } },
          { insert: ' with ' },
          { insert: '$', attributes: { formula: 'x^2' } },
          { insert: '.' },
        ],
        children: [],
      },
      { type: 'math_equation', data: { formula: 'a = b' }, children: [] },
      { type: 'code', data: { language: 'rust' }, delta: [{ insert: 'fn main() {}' }], children: [] },
      { type: 'image', data: { url: 'https://example.com/a.png', image_type: ImageType.External }, children: [] },
    ]);
  });

  it('nests list children and table cells', () => {
    const data = answerBlocksToEditorData(parseAnswerBlocks('1. one\n   - nested\n\n| h |\n| - |\n| v |'));

    expect(data[0]).toMatchObject({
      type: 'numbered_list',
      data: { number: 1 },
      delta: [{ insert: 'one' }],
      children: [{ type: 'bulleted_list', delta: [{ insert: 'nested' }] }],
    });
    expect(data[1]).toMatchObject({
      type: 'simple_table',
      children: [
        { type: 'simple_table_row', children: [{ type: 'simple_table_cell', children: [{ type: 'paragraph', delta: [{ insert: 'h' }] }] }] },
        { type: 'simple_table_row', children: [{ type: 'simple_table_cell', children: [{ type: 'paragraph', delta: [{ insert: 'v' }] }] }] },
      ],
    });
    expect(data[1]).not.toHaveProperty('delta');
  });
});
