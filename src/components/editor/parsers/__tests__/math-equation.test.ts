import { BlockType } from '@/application/types';
import { parsedBlockToSlateElement } from '@/components/editor/parsers/parsed-block-to-slate';

import { parseMarkdown } from '../markdown-parser';

describe('Flutter math Markdown parity', () => {
  it('imports a display equation and an inline equation with their original TeX', () => {
    const blocks = parseMarkdown('The formula is:\n\n$$E = mc^2$$\n\nthe inline formula is $a^2 + b^2 = c^2$');

    expect(blocks[1]).toMatchObject({ type: BlockType.EquationBlock, data: { formula: 'E = mc^2' } });
    expect(blocks[2].text).toBe('the inline formula is $');
    expect(parsedBlockToSlateElement(blocks[2]).children[0]).toMatchObject({
      children: [{ text: 'the inline formula is ' }, { text: '$', formula: 'a^2 + b^2 = c^2' }],
    });
  });
  it('imports three display equations on the same line', () => {
    const blocks = parseMarkdown(String.raw`$$F_0 = 0$$ $$F_1 = 1$$ $$F_n = F_{n-1} + F_{n-2} \text{ for } n \geq 2$$`);

    expect(blocks.map((block) => block.type)).toEqual(Array(3).fill(BlockType.EquationBlock));
    expect(blocks.map((block) => block.data)).toEqual([
      { formula: 'F_0 = 0' },
      { formula: 'F_1 = 1' },
      { formula: String.raw`F_n = F_{n-1} + F_{n-2} \text{ for } n \geq 2` },
    ]);
  });
  it('preserves multiline environments, underscores, ampersands, and backslashes', () => {
    const formula = '\\begin{align*}\nx_1 &= \\frac{1}{2} \\\\\nx_2 &= 3\n\\end{align*}';

    expect(parseMarkdown(`$$\n${formula}\n$$`)[0].data).toEqual({ formula });
  });
  it('leaves escaped dollars and code literal', () => {
    const blocks = parseMarkdown('`$x$` and \\$y\\$\n\n```tex\n$$z$$\n```');

    expect(blocks[0].text).toBe('$x$ and $y$');
    expect(blocks[0].formats.some((format) => format.type === 'formula')).toBe(false);
    expect(blocks[1]).toMatchObject({ type: BlockType.CodeBlock, text: '$$z$$' });
  });
  it('keeps inline math within a formatted paragraph', () => {
    const blocks = parseMarkdown('**Before** $x_1$ *after*');

    expect(blocks[0].text).toBe('Before $ after');
    expect(blocks[0].formats).toContainEqual({ type: 'formula', start: 7, end: 8, data: { formula: 'x_1' } });
    expect(blocks[0].formats).toContainEqual({ type: 'italic', start: 9, end: 14 });
  });
});
