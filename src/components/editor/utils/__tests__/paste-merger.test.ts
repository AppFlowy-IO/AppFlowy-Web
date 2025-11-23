import { Text } from 'slate';

import { BlockType } from '@/application/types';

import { parsedBlocksToSlateNodes } from '../paste-merger';
import { ParsedBlock } from '../../parsers/types';

describe('paste-merger', () => {
  describe('parsedBlocksToSlateNodes', () => {
    it('should convert simple paragraph block', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.Paragraph,
          data: {},
          text: 'Hello World',
          formats: [],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe(BlockType.Paragraph);
    });

    it('should convert block with bold formatting', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.Paragraph,
          data: {},
          text: 'Hello World',
          formats: [
            {
              start: 0,
              end: 5,
              type: 'bold',
            },
          ],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);
      const textNode = (nodes[0].children[0] as any).children[0] as Text;

      expect(textNode.text).toBe('Hello');
      expect((textNode as any).bold).toBe(true);
    });

    it('should convert block with multiple formats', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.Paragraph,
          data: {},
          text: 'Text with bold and italic',
          formats: [
            {
              start: 10,
              end: 14,
              type: 'bold',
            },
            {
              start: 19,
              end: 25,
              type: 'italic',
            },
          ],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);
      const textChildren = (nodes[0].children[0] as any).children;

      expect(textChildren.length).toBeGreaterThan(1);
      expect(textChildren.some((n: any) => n.bold === true)).toBe(true);
      expect(textChildren.some((n: any) => n.italic === true)).toBe(true);
    });

    it('should convert block with link formatting', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.Paragraph,
          data: {},
          text: 'Visit our site',
          formats: [
            {
              start: 6,
              end: 14,
              type: 'link',
              data: { href: 'https://example.com' },
            },
          ],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);
      const textChildren = (nodes[0].children[0] as any).children;

      expect(textChildren.some((n: any) => n.href === 'https://example.com')).toBe(true);
    });

    it('should convert heading block with level', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.HeadingBlock,
          data: { level: 2 },
          text: 'Heading Text',
          formats: [],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);

      expect(nodes[0].type).toBe(BlockType.HeadingBlock);
      expect(nodes[0].data).toEqual({ level: 2 });
    });

    it('should convert code block with language', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.CodeBlock,
          data: { language: 'javascript' },
          text: 'const x = 10;',
          formats: [],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);

      expect(nodes[0].type).toBe(BlockType.CodeBlock);
      expect(nodes[0].data).toEqual({ language: 'javascript' });
    });

    it('should convert list block with children', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.BulletedListBlock,
          data: {},
          text: '',
          formats: [],
          children: [
            {
              type: BlockType.BulletedListBlock,
              data: {},
              text: 'Item 1',
              formats: [],
              children: [],
            },
            {
              type: BlockType.BulletedListBlock,
              data: {},
              text: 'Item 2',
              formats: [],
              children: [],
            },
          ],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);

      expect(nodes[0].children.length).toBe(2);
    });

    it('should convert todo list with checked state', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.TodoListBlock,
          data: { checked: true },
          text: 'Completed task',
          formats: [],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);

      expect(nodes[0].type).toBe(BlockType.TodoListBlock);
      expect(nodes[0].data).toEqual({ checked: true });
    });

    it('should handle empty text blocks', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.Paragraph,
          data: {},
          text: '',
          formats: [],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);

      expect(nodes).toHaveLength(1);
      const textNode = (nodes[0].children[0] as any).children[0];

      expect(textNode.text).toBe('');
    });

    it('should convert multiple blocks', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.HeadingBlock,
          data: { level: 1 },
          text: 'Title',
          formats: [],
          children: [],
        },
        {
          type: BlockType.Paragraph,
          data: {},
          text: 'Paragraph',
          formats: [],
          children: [],
        },
        {
          type: BlockType.QuoteBlock,
          data: {},
          text: 'Quote',
          formats: [],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);

      expect(nodes).toHaveLength(3);
      expect(nodes[0].type).toBe(BlockType.HeadingBlock);
      expect(nodes[1].type).toBe(BlockType.Paragraph);
      expect(nodes[2].type).toBe(BlockType.QuoteBlock);
    });

    it('should handle overlapping formats correctly', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.Paragraph,
          data: {},
          text: 'Bold and italic',
          formats: [
            {
              start: 0,
              end: 15,
              type: 'bold',
            },
            {
              start: 9,
              end: 15,
              type: 'italic',
            },
          ],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);
      const textChildren = (nodes[0].children[0] as any).children;

      // Should create separate text nodes for different format combinations
      expect(textChildren.length).toBeGreaterThan(1);
    });

    it('should handle color formatting', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.Paragraph,
          data: {},
          text: 'Red text',
          formats: [
            {
              start: 0,
              end: 8,
              type: 'color',
              data: { color: 'red' },
            },
          ],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);
      const textNode = (nodes[0].children[0] as any).children[0];

      expect(textNode.font_color).toBe('red');
    });

    it('should handle background color formatting', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.Paragraph,
          data: {},
          text: 'Highlighted',
          formats: [
            {
              start: 0,
              end: 11,
              type: 'bgColor',
              data: { bgColor: 'yellow' },
            },
          ],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);
      const textNode = (nodes[0].children[0] as any).children[0];

      expect(textNode.bg_color).toBe('yellow');
    });

    it('should handle all formatting types together', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.Paragraph,
          data: {},
          text: 'Formatted',
          formats: [
            { start: 0, end: 9, type: 'bold' },
            { start: 0, end: 9, type: 'italic' },
            { start: 0, end: 9, type: 'underline' },
            { start: 0, end: 9, type: 'strikethrough' },
            { start: 0, end: 9, type: 'code' },
          ],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);
      const textNode = (nodes[0].children[0] as any).children[0];

      expect(textNode.bold).toBe(true);
      expect(textNode.italic).toBe(true);
      expect(textNode.underline).toBe(true);
      expect(textNode.strikethrough).toBe(true);
      expect(textNode.code).toBe(true);
    });

    it('should handle divider blocks', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.DividerBlock,
          data: {},
          text: '',
          formats: [],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);

      expect(nodes[0].type).toBe(BlockType.DividerBlock);
    });

    it('should preserve block data for all block types', () => {
      const blocks: ParsedBlock[] = [
        {
          type: BlockType.CodeBlock,
          data: { language: 'typescript' },
          text: 'code',
          formats: [],
          children: [],
        },
      ];

      const nodes = parsedBlocksToSlateNodes(blocks);

      expect(nodes[0].data).toEqual({ language: 'typescript' });
    });
  });
});
