import { BlockType } from '@/application/types';

// Mock sanitizeHTML to prevent DOMPurify issues in tests
jest.mock('../sanitize', () => ({
  sanitizeHTML: (html: string) => html, // Pass through for testing
}));

// Mock rehype-parse and unified to avoid ESM issues
jest.mock('rehype-parse', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('unified', () => ({
  unified: jest.fn(() => ({
    use: jest.fn().mockReturnThis(),
    parse: jest.fn((html: string) => {
      // Simplified HAST parsing for tests
      return {
        type: 'root',
        children: [],
      };
    }),
  })),
}));

import { extractImageURLs, isImageOnlyHTML, parseHTML } from '../html-parser';

describe('html-parser', () => {
  describe('parseHTML', () => {
    it('should return empty array for empty HTML', () => {
      const blocks = parseHTML('');

      expect(blocks).toEqual([]);
    });

    it('should parse simple paragraph', () => {
      const html = '<p>Hello World</p>';
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.Paragraph);
      expect(blocks[0].text).toBe('Hello World');
    });

    it('should parse heading', () => {
      const html = '<h1>Main Title</h1>';
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.HeadingBlock);
      expect(blocks[0].data).toEqual({ level: 1 });
      expect(blocks[0].text).toBe('Main Title');
    });

    it('should parse multiple blocks', () => {
      const html = `
        <h1>Title</h1>
        <p>First paragraph</p>
        <p>Second paragraph</p>
      `;
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe(BlockType.HeadingBlock);
      expect(blocks[1].type).toBe(BlockType.Paragraph);
      expect(blocks[2].type).toBe(BlockType.Paragraph);
    });

    it('should parse paragraph with bold text', () => {
      const html = '<p>This is <strong>bold</strong> text</p>';
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].text).toBe('This is bold text');
      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'bold',
        start: 8,
        end: 12,
      });
    });

    it('should parse paragraph with italic text', () => {
      const html = '<p>This is <em>italic</em> text</p>';
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].text).toBe('This is italic text');
      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'italic',
        start: 8,
        end: 14,
      });
    });

    it('should parse paragraph with link', () => {
      const html = '<p>Visit <a href="https://example.com">our site</a></p>';
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].text).toBe('Visit our site');
      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'link',
        data: { href: 'https://example.com' },
      });
    });

    it('should parse paragraph with underline', () => {
      const html = '<p>This is <u>underlined</u> text</p>';
      const blocks = parseHTML(html);

      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'underline',
      });
    });

    it('should parse paragraph with strikethrough', () => {
      const html = '<p>This is <s>strikethrough</s> text</p>';
      const blocks = parseHTML(html);

      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'strikethrough',
      });
    });

    it('should parse paragraph with inline code', () => {
      const html = '<p>Use <code>console.log()</code> to debug</p>';
      const blocks = parseHTML(html);

      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'code',
      });
    });

    it('should parse code block', () => {
      const html = '<pre><code>const x = 10;\nconsole.log(x);</code></pre>';
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.CodeBlock);
      expect(blocks[0].text).toContain('const x = 10;');
    });

    it('should parse code block with language', () => {
      const html = '<pre><code class="language-javascript">const x = 10;</code></pre>';
      const blocks = parseHTML(html);

      expect(blocks[0].type).toBe(BlockType.CodeBlock);
      expect(blocks[0].data).toEqual({ language: 'javascript' });
    });

    it('should parse blockquote', () => {
      const html = '<blockquote>This is a quote</blockquote>';
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.QuoteBlock);
      expect(blocks[0].text).toBe('This is a quote');
    });

    it('should parse horizontal rule', () => {
      const html = '<hr>';
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.DividerBlock);
    });

    it('should parse unordered list', () => {
      const html = `
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
      `;
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.BulletedListBlock);
      expect(blocks[0].children).toHaveLength(3);
      expect(blocks[0].children[0].text).toBe('Item 1');
      expect(blocks[0].children[1].text).toBe('Item 2');
      expect(blocks[0].children[2].text).toBe('Item 3');
    });

    it('should parse ordered list', () => {
      const html = `
        <ol>
          <li>First</li>
          <li>Second</li>
        </ol>
      `;
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.NumberedListBlock);
      expect(blocks[0].children).toHaveLength(2);
    });

    it('should parse todo list with checkboxes', () => {
      const html = `
        <ul>
          <li><input type="checkbox" checked> Completed task</li>
          <li><input type="checkbox"> Incomplete task</li>
        </ul>
      `;
      const blocks = parseHTML(html);

      expect(blocks[0].children).toHaveLength(2);
      expect(blocks[0].children[0].type).toBe(BlockType.TodoListBlock);
      expect(blocks[0].children[0].data).toEqual({ checked: true });
      expect(blocks[0].children[1].type).toBe(BlockType.TodoListBlock);
      expect(blocks[0].children[1].data).toEqual({ checked: false });
    });

    it('should parse table', () => {
      const html = `
        <table>
          <thead>
            <tr>
              <th>Header 1</th>
              <th>Header 2</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cell 1</td>
              <td>Cell 2</td>
            </tr>
          </tbody>
        </table>
      `;
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.SimpleTableBlock);
      expect(blocks[0].children.length).toBeGreaterThan(0);
    });

    it('should parse nested formatting (bold + italic)', () => {
      const html = '<p>This is <strong>bold and <em>italic</em></strong> text</p>';
      const blocks = parseHTML(html);

      expect(blocks[0].text).toBe('This is bold and italic text');
      expect(blocks[0].formats.length).toBeGreaterThan(0);
      expect(blocks[0].formats.some((f) => f.type === 'bold')).toBe(true);
      expect(blocks[0].formats.some((f) => f.type === 'italic')).toBe(true);
    });

    it('should parse paragraph with colored text', () => {
      const html = '<p><span style="color: red;">Red text</span></p>';
      const blocks = parseHTML(html);

      expect(blocks[0].formats).toHaveLength(1);
      expect(blocks[0].formats[0]).toMatchObject({
        type: 'color',
        data: { color: 'red' },
      });
    });

    it('should parse complex document', () => {
      const html = `
        <h1>Document Title</h1>
        <p>This is an introduction with <strong>bold</strong> text.</p>
        <h2>Section 1</h2>
        <p>Some content with a <a href="https://example.com">link</a>.</p>
        <ul>
          <li>List item 1</li>
          <li>List item 2</li>
        </ul>
        <blockquote>A wise quote</blockquote>
        <pre><code>const code = true;</code></pre>
      `;
      const blocks = parseHTML(html);

      expect(blocks.length).toBeGreaterThan(5);
      expect(blocks[0].type).toBe(BlockType.HeadingBlock);
      expect(blocks[1].type).toBe(BlockType.Paragraph);
      expect(blocks.some((b) => b.type === BlockType.BulletedListBlock)).toBe(true);
      expect(blocks.some((b) => b.type === BlockType.QuoteBlock)).toBe(true);
      expect(blocks.some((b) => b.type === BlockType.CodeBlock)).toBe(true);
    });

    it('should handle deeply nested div wrappers', () => {
      const html = `
        <div>
          <div>
            <p>Nested paragraph</p>
          </div>
        </div>
      `;
      const blocks = parseHTML(html);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe(BlockType.Paragraph);
      expect(blocks[0].text).toBe('Nested paragraph');
    });

    it('should respect maxDepth option', () => {
      const deeplyNested = '<div>'.repeat(25) + '<p>Deep</p>' + '</div>'.repeat(25);
      const blocks = parseHTML(deeplyNested, { maxDepth: 10 });

      // Should stop parsing at max depth
      expect(blocks.length).toBeLessThanOrEqual(1);
    });

    it('should handle empty elements gracefully', () => {
      const html = '<p></p><h1></h1><ul><li></li></ul>';
      const blocks = parseHTML(html);

      expect(blocks.length).toBeGreaterThan(0);
      blocks.forEach((block) => {
        expect(block).toHaveProperty('type');
        expect(block).toHaveProperty('text');
      });
    });
  });

  describe('isImageOnlyHTML', () => {
    it('should return true for single image', () => {
      const html = '<img src="image.png" alt="Image">';

      expect(isImageOnlyHTML(html)).toBe(true);
    });

    it('should return true for multiple images', () => {
      const html = '<img src="1.png"><img src="2.png">';

      expect(isImageOnlyHTML(html)).toBe(true);
    });

    it('should return false for image with text', () => {
      const html = '<p>Text</p><img src="image.png">';

      expect(isImageOnlyHTML(html)).toBe(false);
    });

    it('should return false for empty HTML', () => {
      expect(isImageOnlyHTML('')).toBe(false);
    });

    it('should return false for text-only HTML', () => {
      const html = '<p>Just text</p>';

      expect(isImageOnlyHTML(html)).toBe(false);
    });
  });

  describe('extractImageURLs', () => {
    it('should extract single image URL', () => {
      const html = '<img src="https://example.com/image.png">';
      const urls = extractImageURLs(html);

      expect(urls).toEqual(['https://example.com/image.png']);
    });

    it('should extract multiple image URLs', () => {
      const html = `
        <img src="https://example.com/1.png">
        <img src="https://example.com/2.png">
      `;
      const urls = extractImageURLs(html);

      expect(urls).toHaveLength(2);
      expect(urls).toContain('https://example.com/1.png');
      expect(urls).toContain('https://example.com/2.png');
    });

    it('should extract images from nested elements', () => {
      const html = `
        <div>
          <p><img src="nested.png"></p>
        </div>
      `;
      const urls = extractImageURLs(html);

      expect(urls).toEqual(['nested.png']);
    });

    it('should return empty array for HTML without images', () => {
      const html = '<p>No images here</p>';
      const urls = extractImageURLs(html);

      expect(urls).toEqual([]);
    });

    it('should handle empty HTML', () => {
      const urls = extractImageURLs('');

      expect(urls).toEqual([]);
    });
  });
});
