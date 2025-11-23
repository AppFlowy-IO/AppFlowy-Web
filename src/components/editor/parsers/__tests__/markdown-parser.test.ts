import { BlockType } from '@/application/types';

import { parseMarkdown } from '../markdown-parser';

describe('markdown-parser', () => {
  describe('parseMarkdown', () => {
    it('should return empty array for empty markdown', () => {
      const blocks = parseMarkdown('');

      expect(blocks).toEqual([]);
    });

    it('should parse simple paragraph', () => {
      const markdown = 'Hello World';
      const blocks = parseMarkdown(markdown);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.Paragraph);
      expect(blocks[0].text).toBe('Hello World');
    });

    it('should parse heading level 1', () => {
      const markdown = '# Main Title';
      const blocks = parseMarkdown(markdown);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.HeadingBlock);
      expect(blocks[0].data).toEqual({ level: 1 });
      expect(blocks[0].text).toBe('Main Title');
    });

    it('should parse heading level 2', () => {
      const markdown = '## Subtitle';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].data).toEqual({ level: 2 });
    });

    it('should parse all heading levels (1-6)', () => {
      const markdown = `
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
      `.trim();
      const blocks = parseMarkdown(markdown);

      expect(blocks).toHaveLength(6);
      blocks.forEach((block, index) => {
        expect(block.type).toBe(BlockType.HeadingBlock);
        expect(block.data).toEqual({ level: index + 1 });
      });
    });

    it('should parse multiple paragraphs', () => {
      const markdown = `
First paragraph

Second paragraph

Third paragraph
      `.trim();
      const blocks = parseMarkdown(markdown);

      expect(blocks).toHaveLength(3);
      blocks.forEach((block) => {
        expect(block.type).toBe(BlockType.Paragraph);
      });
    });

    it('should parse bold text', () => {
      const markdown = 'This is **bold** text';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].text).toBe('This is bold text');
      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'bold',
        start: 8,
        end: 12,
      });
    });

    it('should parse bold with underscores', () => {
      const markdown = 'This is __bold__ text';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].formats[0]).toMatchObject({
        type: 'bold',
      });
    });

    it('should parse italic text', () => {
      const markdown = 'This is *italic* text';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].text).toBe('This is italic text');
      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'italic',
        start: 8,
        end: 14,
      });
    });

    it('should parse italic with underscores', () => {
      const markdown = 'This is _italic_ text';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].formats[0]).toMatchObject({
        type: 'italic',
      });
    });

    it('should parse strikethrough text (GFM)', () => {
      const markdown = 'This is ~~strikethrough~~ text';
      const blocks = parseMarkdown(markdown, { gfm: true });

      expect(blocks[0].text).toBe('This is strikethrough text');
      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'strikethrough',
      });
    });

    it('should parse inline code', () => {
      const markdown = 'Use `console.log()` to debug';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].text).toBe('Use console.log() to debug');
      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'code',
        start: 4,
        end: 17,
      });
    });

    it('should parse links', () => {
      const markdown = 'Visit [our site](https://example.com)';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].text).toBe('Visit our site');
      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'link',
        data: { href: 'https://example.com' },
      });
    });

    it('should parse code block with language', () => {
      const markdown = `
\`\`\`javascript
const x = 10;
console.log(x);
\`\`\`
      `.trim();
      const blocks = parseMarkdown(markdown);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.CodeBlock);
      expect(blocks[0].data).toEqual({ language: 'javascript' });
      expect(blocks[0].text).toContain('const x = 10;');
    });

    it('should parse code block without language', () => {
      const markdown = `
\`\`\`
code here
\`\`\`
      `.trim();
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].type).toBe(BlockType.CodeBlock);
      expect(blocks[0].data).toEqual({ language: 'plaintext' });
    });

    it('should parse blockquote', () => {
      const markdown = '> This is a quote';
      const blocks = parseMarkdown(markdown);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.QuoteBlock);
      expect(blocks[0].text).toBe('This is a quote');
    });

    it('should parse multi-line blockquote', () => {
      const markdown = `
> Line 1
> Line 2
> Line 3
      `.trim();
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].type).toBe(BlockType.QuoteBlock);
      expect(blocks[0].text).toContain('Line 1');
    });

    it('should parse horizontal rule', () => {
      const markdown = '---';
      const blocks = parseMarkdown(markdown);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.DividerBlock);
    });

    it('should parse alternative horizontal rules', () => {
      const markdowns = ['---', '***', '___'];

      markdowns.forEach((md) => {
        const blocks = parseMarkdown(md);

        expect(blocks[0].type).toBe(BlockType.DividerBlock);
      });
    });

    it('should parse unordered list', () => {
      const markdown = `
- Item 1
- Item 2
- Item 3
      `.trim();
      const blocks = parseMarkdown(markdown);

      // List items are returned as separate blocks (flattened)
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe(BlockType.BulletedListBlock);
      expect(blocks[0].text).toBe('Item 1');
      expect(blocks[1].type).toBe(BlockType.BulletedListBlock);
      expect(blocks[1].text).toBe('Item 2');
      expect(blocks[2].type).toBe(BlockType.BulletedListBlock);
      expect(blocks[2].text).toBe('Item 3');
    });

    it('should parse unordered list with asterisk', () => {
      const markdown = `
* Item 1
* Item 2
      `.trim();
      const blocks = parseMarkdown(markdown);

      // List items are returned as separate blocks (flattened)
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe(BlockType.BulletedListBlock);
      expect(blocks[1].type).toBe(BlockType.BulletedListBlock);
    });

    it('should parse ordered list', () => {
      const markdown = `
1. First
2. Second
3. Third
      `.trim();
      const blocks = parseMarkdown(markdown);

      // List items are returned as separate blocks (flattened)
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe(BlockType.NumberedListBlock);
      expect(blocks[0].text).toBe('First');
      expect(blocks[1].type).toBe(BlockType.NumberedListBlock);
      expect(blocks[1].text).toBe('Second');
      expect(blocks[2].type).toBe(BlockType.NumberedListBlock);
      expect(blocks[2].text).toBe('Third');
    });

    it('should parse task list (GFM)', () => {
      const markdown = `
- [x] Completed task
- [ ] Incomplete task
      `.trim();
      const blocks = parseMarkdown(markdown, { gfm: true });

      // List items are returned as separate blocks (flattened)
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe(BlockType.TodoListBlock);
      expect(blocks[0].data).toEqual({ checked: true });
      expect(blocks[1].type).toBe(BlockType.TodoListBlock);
      expect(blocks[1].data).toEqual({ checked: false });
    });

    it('should parse table (GFM)', () => {
      const markdown = `
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |
      `.trim();
      const blocks = parseMarkdown(markdown, { gfm: true });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.SimpleTableBlock);
      expect(blocks[0].children.length).toBeGreaterThan(0);
    });

    it('should parse nested formatting (bold + italic)', () => {
      const markdown = 'This is **bold and *italic***';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].text).toBe('This is bold and italic');
      expect(blocks[0].formats.length).toBeGreaterThan(0);
      expect(blocks[0].formats.some((f) => f.type === 'bold')).toBe(true);
      expect(blocks[0].formats.some((f) => f.type === 'italic')).toBe(true);
    });

    it('should parse complex markdown document', () => {
      const markdown = `
# Document Title

This is the introduction with **bold** and *italic* text.

## Section 1

Here's a paragraph with a [link](https://example.com).

- List item 1
- List item 2
- List item 3

> A meaningful quote

\`\`\`javascript
const code = true;
\`\`\`

---

## Section 2

More content here.
      `.trim();
      const blocks = parseMarkdown(markdown, { gfm: true });

      expect(blocks.length).toBeGreaterThan(5);
      expect(blocks.some((b) => b.type === BlockType.HeadingBlock)).toBe(true);
      expect(blocks.some((b) => b.type === BlockType.Paragraph)).toBe(true);
      expect(blocks.some((b) => b.type === BlockType.BulletedListBlock)).toBe(true);
      expect(blocks.some((b) => b.type === BlockType.QuoteBlock)).toBe(true);
      expect(blocks.some((b) => b.type === BlockType.CodeBlock)).toBe(true);
      expect(blocks.some((b) => b.type === BlockType.DividerBlock)).toBe(true);
    });

    it('should handle paragraphs with multiple formatting', () => {
      const markdown = 'Text with **bold**, *italic*, `code`, and [links](https://example.com)';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].formats.length).toBeGreaterThan(3);
    });

    it('should handle empty list items gracefully', () => {
      const markdown = `
-
- Item
-
      `.trim();
      const blocks = parseMarkdown(markdown);

      // List items are returned as separate blocks (flattened)
      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe(BlockType.BulletedListBlock);
      expect(blocks[1].type).toBe(BlockType.BulletedListBlock);
      expect(blocks[2].type).toBe(BlockType.BulletedListBlock);
    });

    it('should disable GFM when option is false', () => {
      const markdown = '~~strikethrough~~';
      const blocks = parseMarkdown(markdown, { gfm: false });

      // Without GFM, strikethrough should not be parsed
      expect(blocks[0].formats.some((f) => f.type === 'strikethrough')).toBe(false);
    });

    it('should handle inline code in headings', () => {
      const markdown = '# Heading with `code`';
      const blocks = parseMarkdown(markdown);

      expect(blocks[0].type).toBe(BlockType.HeadingBlock);
      expect(blocks[0].text).toBe('Heading with code');
      expect(blocks[0].formats.some((f) => f.type === 'code')).toBe(true);
    });

    it('should handle formatting in list items', () => {
      const markdown = `
- Item with **bold**
- Item with *italic*
- Item with \`code\`
      `.trim();
      const blocks = parseMarkdown(markdown);

      // Each list item is a separate block
      expect(blocks[0].formats.some((f) => f.type === 'bold')).toBe(true);
      expect(blocks[1].formats.some((f) => f.type === 'italic')).toBe(true);
      expect(blocks[2].formats.some((f) => f.type === 'code')).toBe(true);
    });

    it('should parse real-world GitHub markdown', () => {
      const markdown = `
# Project Title

## Installation

\`\`\`bash
npm install my-package
\`\`\`

## Features

- ✅ Feature 1
- ✅ Feature 2
- [ ] Planned feature

## Usage

Here's how to use it:

\`\`\`javascript
import { Something } from 'my-package';

const result = Something.doThing();
\`\`\`

For more info, visit [our docs](https://docs.example.com).

---

**License:** MIT
      `.trim();
      const blocks = parseMarkdown(markdown, { gfm: true });

      expect(blocks.length).toBeGreaterThan(8);
      expect(blocks.filter((b) => b.type === BlockType.HeadingBlock).length).toBeGreaterThan(2);
      expect(blocks.filter((b) => b.type === BlockType.CodeBlock).length).toBe(2);
      expect(blocks.some((b) => b.type === BlockType.BulletedListBlock)).toBe(true);
      expect(blocks.some((b) => b.type === BlockType.DividerBlock)).toBe(true);
    });
  });
});
