import { Element as HastElement } from 'hast';

import { BlockType } from '@/application/types';

import { elementToBlock, parseCodeBlock, parseHeading, parseList, parseParagraph } from '../block-converters';

describe('block-converters', () => {
  describe('parseHeading', () => {
    it('should parse h1 heading', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'h1',
        properties: {},
        children: [{ type: 'text', value: 'Heading 1' }],
      };

      const block = parseHeading(node);

      expect(block.type).toBe(BlockType.HeadingBlock);
      expect(block.data).toEqual({ level: 1 });
      expect(block.text).toBe('Heading 1');
      expect(block.formats).toEqual([]);
      expect(block.children).toEqual([]);
    });

    it('should parse h3 heading with formatting', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'h3',
        properties: {},
        children: [
          { type: 'text', value: 'Heading with ' },
          {
            type: 'element',
            tagName: 'strong',
            properties: {},
            children: [{ type: 'text', value: 'bold' }],
          },
        ],
      };

      const block = parseHeading(node);

      expect(block.type).toBe(BlockType.HeadingBlock);
      expect(block.data).toEqual({ level: 3 });
      expect(block.text).toBe('Heading with bold');
      expect(block.formats).toHaveLength(1);
      expect(block.formats[0]).toEqual({
        start: 13,
        end: 17,
        type: 'bold',
      });
    });

    it('should parse all heading levels (h1-h6)', () => {
      for (let level = 1; level <= 6; level++) {
        const node: HastElement = {
          type: 'element',
          tagName: `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
          properties: {},
          children: [{ type: 'text', value: `Heading ${level}` }],
        };

        const block = parseHeading(node);

        expect(block.data).toEqual({ level });
      }
    });
  });

  describe('parseParagraph', () => {
    it('should parse simple paragraph', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [{ type: 'text', value: 'Simple paragraph text' }],
      };

      const block = parseParagraph(node);

      expect(block.type).toBe(BlockType.Paragraph);
      expect(block.text).toBe('Simple paragraph text');
      expect(block.formats).toEqual([]);
    });

    it('should parse paragraph with inline formatting', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          { type: 'text', value: 'Text with ' },
          {
            type: 'element',
            tagName: 'strong',
            properties: {},
            children: [{ type: 'text', value: 'bold' }],
          },
          { type: 'text', value: ' and ' },
          {
            type: 'element',
            tagName: 'em',
            properties: {},
            children: [{ type: 'text', value: 'italic' }],
          },
        ],
      };

      const block = parseParagraph(node);

      expect(block.text).toBe('Text with bold and italic');
      expect(block.formats).toHaveLength(2);
    });

    it('should parse paragraph with link', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          { type: 'text', value: 'Visit ' },
          {
            type: 'element',
            tagName: 'a',
            properties: { href: 'https://example.com' },
            children: [{ type: 'text', value: 'our site' }],
          },
        ],
      };

      const block = parseParagraph(node);

      expect(block.text).toBe('Visit our site');
      expect(block.formats).toHaveLength(1);
      expect(block.formats[0]).toMatchObject({
        type: 'link',
        data: { href: 'https://example.com' },
      });
    });
  });

  describe('parseCodeBlock', () => {
    it('should parse pre/code block', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'const x = 10;' }],
          },
        ],
      };

      const block = parseCodeBlock(node);

      expect(block).not.toBeNull();
      expect(block?.type).toBe(BlockType.CodeBlock);
      expect(block?.text).toBe('const x = 10;');
      expect(block?.data).toEqual({ language: 'plaintext' });
    });

    it('should parse code block with language class', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-javascript'] },
            children: [{ type: 'text', value: 'console.log("Hello");' }],
          },
        ],
      };

      const block = parseCodeBlock(node);

      expect(block?.data).toEqual({ language: 'javascript' });
    });

    it('should return null for pre without code child', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [{ type: 'text', value: 'Not a code block' }],
      };

      const block = parseCodeBlock(node);

      expect(block).toBeNull();
    });
  });

  describe('parseList', () => {
    it('should parse unordered list', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'ul',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'li',
            properties: {},
            children: [{ type: 'text', value: 'Item 1' }],
          },
          {
            type: 'element',
            tagName: 'li',
            properties: {},
            children: [{ type: 'text', value: 'Item 2' }],
          },
        ],
      };

      const blocks = parseList(node);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe(BlockType.BulletedListBlock);
      expect(blocks[0].text).toBe('Item 1');
      expect(blocks[1].type).toBe(BlockType.BulletedListBlock);
      expect(blocks[1].text).toBe('Item 2');
    });

    it('should parse ordered list', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'ol',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'li',
            properties: {},
            children: [{ type: 'text', value: 'First' }],
          },
          {
            type: 'element',
            tagName: 'li',
            properties: {},
            children: [{ type: 'text', value: 'Second' }],
          },
        ],
      };

      const blocks = parseList(node);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe(BlockType.NumberedListBlock);
      expect(blocks[1].type).toBe(BlockType.NumberedListBlock);
    });

    it('should parse todo list with checkboxes', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'ul',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'li',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'input',
                properties: { type: 'checkbox', checked: true },
                children: [],
              },
              { type: 'text', value: 'Completed task' },
            ],
          },
          {
            type: 'element',
            tagName: 'li',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'input',
                properties: { type: 'checkbox' },
                children: [],
              },
              { type: 'text', value: 'Uncompleted task' },
            ],
          },
        ],
      };

      const blocks = parseList(node);

      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe(BlockType.TodoListBlock);
      expect(blocks[0].data).toEqual({ checked: true });
      expect(blocks[1].type).toBe(BlockType.TodoListBlock);
      expect(blocks[1].data).toEqual({ checked: false });
    });

    it('should handle nested lists', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'ul',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'li',
            properties: {},
            children: [
              { type: 'text', value: 'Parent item' },
              {
                type: 'element',
                tagName: 'ul',
                properties: {},
                children: [
                  {
                    type: 'element',
                    tagName: 'li',
                    properties: {},
                    children: [{ type: 'text', value: 'Child item' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const blocks = parseList(node);

      expect(blocks).toHaveLength(1);
      // Text extraction includes nested list content because parseList flattens structure for now
      // or extracts text recursively. Adjust expectation based on current extractText behavior.
      // Current extractText recursively joins all text.
      expect(blocks[0].text).toBe('Parent itemChild item');
    });
  });

  describe('elementToBlock', () => {
    it('should convert heading element', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'h2',
        properties: {},
        children: [{ type: 'text', value: 'Title' }],
      };

      const block = elementToBlock(node);

      expect(block).not.toBeNull();
      expect((block as any).type).toBe(BlockType.HeadingBlock);
    });

    it('should convert paragraph element', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [{ type: 'text', value: 'Text' }],
      };

      const block = elementToBlock(node);

      expect(block).not.toBeNull();
      expect((block as any).type).toBe(BlockType.Paragraph);
    });

    it('should convert blockquote element', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'blockquote',
        properties: {},
        children: [{ type: 'text', value: 'Quote' }],
      };

      const block = elementToBlock(node);

      expect(block).not.toBeNull();
      expect((block as any).type).toBe(BlockType.QuoteBlock);
    });

    it('should convert divider element', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'hr',
        properties: {},
        children: [],
      };

      const block = elementToBlock(node);

      expect(block).not.toBeNull();
      expect((block as any).type).toBe(BlockType.DividerBlock);
      expect((block as any).text).toBe('');
    });

    it('should convert unordered list', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'ul',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'li',
            properties: {},
            children: [{ type: 'text', value: 'Item' }],
          },
        ],
      };

      const blocks = elementToBlock(node);

      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks).toHaveLength(1);
      expect((blocks as any)[0].type).toBe(BlockType.BulletedListBlock);
    });

    it('should convert ordered list', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'ol',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'li',
            properties: {},
            children: [{ type: 'text', value: 'Item' }],
          },
        ],
      };

      const blocks = elementToBlock(node);

      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks).toHaveLength(1);
      expect((blocks as any)[0].type).toBe(BlockType.NumberedListBlock);
    });

    it('should convert code block', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'code' }],
          },
        ],
      };

      const block = elementToBlock(node);

      expect(block).not.toBeNull();
      expect(block?.type).toBe(BlockType.CodeBlock);
    });

    it('should return null for unsupported elements', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'video',
        properties: {},
        children: [],
      };

      const block = elementToBlock(node);

      expect(block).toBeNull();
    });
  });
});
