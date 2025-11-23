import { Element as HastElement, Text as HastText } from 'hast';

import { extractInlineFormatsFromHAST, extractTextFromHAST, mergeFormats } from '../inline-converters';
import { InlineFormat } from '../types';

describe('inline-converters', () => {
  describe('extractTextFromHAST', () => {
    it('should extract text from text node', () => {
      const node: HastText = {
        type: 'text',
        value: 'Hello World',
      };

      expect(extractTextFromHAST(node)).toBe('Hello World');
    });

    it('should extract text from element with children', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          { type: 'text', value: 'Hello ' },
          {
            type: 'element',
            tagName: 'strong',
            properties: {},
            children: [{ type: 'text', value: 'World' }],
          },
        ],
      };

      expect(extractTextFromHAST(node)).toBe('Hello World');
    });

    it('should extract text from nested elements', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          { type: 'text', value: 'This is ' },
          {
            type: 'element',
            tagName: 'em',
            properties: {},
            children: [
              { type: 'text', value: 'really ' },
              {
                type: 'element',
                tagName: 'strong',
                properties: {},
                children: [{ type: 'text', value: 'nested' }],
              },
            ],
          },
          { type: 'text', value: ' text' },
        ],
      };

      expect(extractTextFromHAST(node)).toBe('This is really nested text');
    });
  });

  describe('extractInlineFormatsFromHAST', () => {
    it('should extract bold formatting', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          { type: 'text', value: 'Hello ' },
          {
            type: 'element',
            tagName: 'strong',
            properties: {},
            children: [{ type: 'text', value: 'World' }],
          },
        ],
      };

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(1);
      expect(formats[0]).toEqual({
        start: 6,
        end: 11,
        type: 'bold',
      });
    });

    it('should extract italic formatting', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          { type: 'text', value: 'Hello ' },
          {
            type: 'element',
            tagName: 'em',
            properties: {},
            children: [{ type: 'text', value: 'World' }],
          },
        ],
      };

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(1);
      expect(formats[0]).toEqual({
        start: 6,
        end: 11,
        type: 'italic',
      });
    });

    it('should extract underline formatting', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'u',
            properties: {},
            children: [{ type: 'text', value: 'Underlined' }],
          },
        ],
      };

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(1);
      expect(formats[0]).toEqual({
        start: 0,
        end: 10,
        type: 'underline',
      });
    });

    it('should extract strikethrough formatting', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 's',
            properties: {},
            children: [{ type: 'text', value: 'Strikethrough' }],
          },
        ],
      };

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(1);
      expect(formats[0]).toEqual({
        start: 0,
        end: 13,
        type: 'strikethrough',
      });
    });

    it('should extract code formatting', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          { type: 'text', value: 'Use ' },
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'console.log()' }],
          },
        ],
      };

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(1);
      expect(formats[0]).toEqual({
        start: 4,
        end: 17,
        type: 'code',
      });
    });

    it('should extract link formatting with href', () => {
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

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(1);
      expect(formats[0]).toEqual({
        start: 6,
        end: 14,
        type: 'link',
        data: { href: 'https://example.com' },
      });
    });

    it('should extract color formatting from span style', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { style: 'color: red;' },
            children: [{ type: 'text', value: 'Red text' }],
          },
        ],
      };

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(1);
      expect(formats[0]).toEqual({
        start: 0,
        end: 8,
        type: 'color',
        data: { color: 'red' },
      });
    });

    it('should extract background color formatting from span style', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { style: 'color: blue; background-color: yellow;' },
            children: [{ type: 'text', value: 'Highlighted' }],
          },
        ],
      };

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(2);
      expect(formats[0]).toEqual({
        start: 0,
        end: 11,
        type: 'color',
        data: { color: 'blue' },
      });
      expect(formats[1]).toEqual({
        start: 0,
        end: 11,
        type: 'bgColor',
        data: { bgColor: 'yellow' },
      });
    });

    it('should handle nested formatting (bold + italic)', () => {
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
            children: [
              { type: 'text', value: 'bold and ' },
              {
                type: 'element',
                tagName: 'em',
                properties: {},
                children: [{ type: 'text', value: 'italic' }],
              },
            ],
          },
        ],
      };

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(3);
      // Bold spans entire "bold and italic"
      expect(formats).toContainEqual({
        start: 10,
        end: 19,
        type: 'bold',
      });
      expect(formats).toContainEqual({
        start: 19,
        end: 25,
        type: 'bold',
      });
      // Italic only on "italic"
      expect(formats).toContainEqual({
        start: 19,
        end: 25,
        type: 'italic',
      });
    });

    it('should handle multiple separate formatted spans', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'strong',
            properties: {},
            children: [{ type: 'text', value: 'Bold' }],
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

      const formats = extractInlineFormatsFromHAST(node);

      expect(formats).toHaveLength(2);
      expect(formats).toContainEqual({
        start: 0,
        end: 4,
        type: 'bold',
      });
      expect(formats).toContainEqual({
        start: 9,
        end: 15,
        type: 'italic',
      });
    });
  });

  describe('mergeFormats', () => {
    it('should return empty array for empty input', () => {
      expect(mergeFormats([])).toEqual([]);
    });

    it('should merge overlapping formats of the same type', () => {
      const formats: InlineFormat[] = [
        { start: 0, end: 5, type: 'bold' },
        { start: 3, end: 8, type: 'bold' },
      ];

      const merged = mergeFormats(formats);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual({
        start: 0,
        end: 8,
        type: 'bold',
      });
    });

    it('should merge adjacent formats of the same type', () => {
      const formats: InlineFormat[] = [
        { start: 0, end: 5, type: 'italic' },
        { start: 5, end: 10, type: 'italic' },
      ];

      const merged = mergeFormats(formats);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual({
        start: 0,
        end: 10,
        type: 'italic',
      });
    });

    it('should not merge formats of different types', () => {
      const formats: InlineFormat[] = [
        { start: 0, end: 5, type: 'bold' },
        { start: 0, end: 5, type: 'italic' },
      ];

      const merged = mergeFormats(formats);

      expect(merged).toHaveLength(2);
    });

    it('should not merge non-adjacent formats of same type', () => {
      const formats: InlineFormat[] = [
        { start: 0, end: 5, type: 'bold' },
        { start: 10, end: 15, type: 'bold' },
      ];

      const merged = mergeFormats(formats);

      expect(merged).toHaveLength(2);
    });

    it('should handle complex merge scenarios', () => {
      const formats: InlineFormat[] = [
        { start: 0, end: 5, type: 'bold' },
        { start: 3, end: 8, type: 'bold' },
        { start: 7, end: 12, type: 'bold' },
        { start: 15, end: 20, type: 'bold' },
      ];

      const merged = mergeFormats(formats);

      expect(merged).toHaveLength(2);
      expect(merged[0]).toEqual({
        start: 0,
        end: 12,
        type: 'bold',
      });
      expect(merged[1]).toEqual({
        start: 15,
        end: 20,
        type: 'bold',
      });
    });

    it('should keep data property when merging links', () => {
      const formats: InlineFormat[] = [
        { start: 0, end: 5, type: 'link', data: { href: 'https://example.com' } },
        { start: 3, end: 8, type: 'link', data: { href: 'https://example.com' } },
      ];

      const merged = mergeFormats(formats);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual({
        start: 0,
        end: 8,
        type: 'link',
        data: { href: 'https://example.com' },
      });
    });
  });
});
