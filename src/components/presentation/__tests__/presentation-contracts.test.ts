import { parseMarkdown, splitDocument } from '../source';

describe('document presentation snapshots', () => {
  it('gives dividers priority over headings without mutating or dropping content', () => {
    const source = parseMarkdown('## One\nParagraph\n## Two\nMore\n---\nLast');
    const before = JSON.stringify(source);
    const slides = splitDocument(source);
    expect(slides).toHaveLength(3);
    expect(slides[0].titleSlide).toBe(true);
    expect(slides[1].blocks.map((b) => b.text)).toEqual(['One', 'Paragraph', 'Two', 'More']);
    expect(slides[2].blocks[0].text).toBe('Last');
    expect(JSON.stringify(source)).toBe(before);
  });
  it('splits by headings and leaves block pagination to the measured presenter', () => {
    expect(splitDocument(parseMarkdown('## A\na\n## B\nb'))).toHaveLength(3);
    const source = parseMarkdown(Array.from({ length: 15 }, (_, i) => `Paragraph ${i}`).join('\n'));
    const slides = splitDocument(source);
    expect(slides.map((s) => s.blocks.length)).toEqual([0, 15]);
    expect(slides.flatMap((s) => s.blocks)).toEqual(source.blocks);
  });
  it('keeps long code blocks intact and supports empty pages', () => {
    const longCode = 'line\n'.repeat(1000);
    const source = parseMarkdown(`\`\`\`\n${longCode}\`\`\``);
    expect(splitDocument(source)[1].blocks[0].text).toBe(longCode);
    expect(splitDocument(parseMarkdown(''))).toHaveLength(1);
  });
});
