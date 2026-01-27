import { expect, describe, it, beforeEach, afterEach } from '@jest/globals';

import { convertToAppFlowyFragment } from '../lib/copy';

describe('convertToAppFlowyFragment', () => {
  beforeEach(() => {
    // Mock window.btoa
    global.btoa = jest.fn((str) => Buffer.from(str).toString('base64'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Basic Conversion', () => {
    it('should return object with correct key', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'Hello' }],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);

      expect(result.key).toBe('application/x-appflowy-fragment');
    });

    it('should return encoded value', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'Hello' }],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);

      expect(result.value).toBeDefined();
      expect(typeof result.value).toBe('string');
    });

    it('should produce decodable fragment', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'Test' }],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);

      // Decode the fragment
      const decoded = decodeURIComponent(
        Buffer.from(result.value, 'base64').toString()
      );
      const parsed = JSON.parse(decoded);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].type).toBe('paragraph');
    });
  });

  describe('Text Node Handling', () => {
    it('should create text node from delta', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'Hello World' }],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      // Text node should be first child
      expect(decoded[0].children[0].type).toBe('text');
      expect(decoded[0].children[0].children[0].text).toBe('Hello World');
    });

    it('should preserve text attributes', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [
            { insert: 'Bold', attributes: { bold: true } },
            { insert: 'Italic', attributes: { italic: true } },
          ],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      const textChildren = decoded[0].children[0].children;
      expect(textChildren[0].text).toBe('Bold');
      expect(textChildren[0].bold).toBe(true);
      expect(textChildren[1].text).toBe('Italic');
      expect(textChildren[1].italic).toBe(true);
    });

    it('should handle empty delta', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      // Text node should have empty children
      expect(decoded[0].children[0].type).toBe('text');
      expect(decoded[0].children[0].children).toEqual([]);
    });

    it('should handle missing delta', () => {
      const data = [
        {
          type: 'divider',
          data: {},
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      // No text node should be created
      expect(decoded[0].children).toEqual([]);
    });
  });

  describe('Children Handling', () => {
    it('should convert nested children', () => {
      const data = [
        {
          type: 'bulleted_list',
          data: {},
          delta: [{ insert: 'Parent' }],
          children: [
            {
              type: 'bulleted_list',
              data: {},
              delta: [{ insert: 'Child' }],
              children: [],
            },
          ],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      expect(decoded[0].type).toBe('bulleted_list');
      // First child is text node, second is the nested list
      expect(decoded[0].children.length).toBe(2);
      expect(decoded[0].children[1].type).toBe('bulleted_list');
    });

    it('should handle deeply nested structures', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'Level 1' }],
          children: [
            {
              type: 'paragraph',
              data: {},
              delta: [{ insert: 'Level 2' }],
              children: [
                {
                  type: 'paragraph',
                  data: {},
                  delta: [{ insert: 'Level 3' }],
                  children: [],
                },
              ],
            },
          ],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      // Navigate to the deepest level
      const level3 = decoded[0].children[1].children[1];
      expect(level3.type).toBe('paragraph');
      expect(level3.children[0].children[0].text).toBe('Level 3');
    });
  });

  describe('Data Preservation', () => {
    it('should preserve node data', () => {
      const data = [
        {
          type: 'heading',
          data: { level: 1, align: 'center' },
          delta: [{ insert: 'Title' }],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      expect(decoded[0].data.level).toBe(1);
      expect(decoded[0].data.align).toBe('center');
    });

    it('should handle missing data', () => {
      const data = [
        {
          type: 'paragraph',
          delta: [{ insert: 'Test' }],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      expect(decoded[0].data).toEqual({});
    });
  });

  describe('Multiple Nodes', () => {
    it('should handle multiple top-level nodes', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'First' }],
          children: [],
        },
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'Second' }],
          children: [],
        },
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'Third' }],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      expect(decoded).toHaveLength(3);
      expect(decoded[0].children[0].children[0].text).toBe('First');
      expect(decoded[1].children[0].children[0].text).toBe('Second');
      expect(decoded[2].children[0].children[0].text).toBe('Third');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty array', () => {
      const data: any[] = [];

      const result = convertToAppFlowyFragment(data);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      expect(decoded).toEqual([]);
    });

    it('should handle unicode characters', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'こんにちは 🎉 émoji' }],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      expect(decoded[0].children[0].children[0].text).toBe('こんにちは 🎉 émoji');
    });

    it('should handle special characters in text', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [{ insert: 'Code: <script>alert("xss")</script>' }],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      expect(decoded[0].children[0].children[0].text).toBe(
        'Code: <script>alert("xss")</script>'
      );
    });

    it('should handle complex attributes', () => {
      const data = [
        {
          type: 'paragraph',
          data: {},
          delta: [
            {
              insert: 'Link',
              attributes: {
                href: 'https://example.com',
                bold: true,
                underline: true,
              },
            },
          ],
          children: [],
        },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      const textNode = decoded[0].children[0].children[0];
      expect(textNode.href).toBe('https://example.com');
      expect(textNode.bold).toBe(true);
      expect(textNode.underline).toBe(true);
    });
  });

  describe('Node Types', () => {
    it('should preserve various node types', () => {
      const data = [
        { type: 'paragraph', data: {}, delta: [], children: [] },
        { type: 'heading', data: { level: 1 }, delta: [], children: [] },
        { type: 'bulleted_list', data: {}, delta: [], children: [] },
        { type: 'numbered_list', data: {}, delta: [], children: [] },
        { type: 'todo_list', data: { checked: false }, delta: [], children: [] },
        { type: 'quote', data: {}, delta: [], children: [] },
        { type: 'code', data: { language: 'javascript' }, delta: [], children: [] },
      ];

      const result = convertToAppFlowyFragment(data as any);
      const decoded = JSON.parse(
        decodeURIComponent(Buffer.from(result.value, 'base64').toString())
      );

      expect(decoded[0].type).toBe('paragraph');
      expect(decoded[1].type).toBe('heading');
      expect(decoded[2].type).toBe('bulleted_list');
      expect(decoded[3].type).toBe('numbered_list');
      expect(decoded[4].type).toBe('todo_list');
      expect(decoded[5].type).toBe('quote');
      expect(decoded[6].type).toBe('code');
    });
  });
});
