import { Element as HastElement } from 'hast';
import { Table } from 'mdast';

import { BlockType } from '@/application/types';

import { parseHTMLTable, parseMarkdownTable } from '../table-parser';

describe('table-parser', () => {
  describe('parseHTMLTable', () => {
    it('should parse simple table with thead and tbody', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'table',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'thead',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'tr',
                properties: {},
                children: [
                  {
                    type: 'element',
                    tagName: 'th',
                    properties: {},
                    children: [{ type: 'text', value: 'Header 1' }],
                  },
                  {
                    type: 'element',
                    tagName: 'th',
                    properties: {},
                    children: [{ type: 'text', value: 'Header 2' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'element',
            tagName: 'tbody',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'tr',
                properties: {},
                children: [
                  {
                    type: 'element',
                    tagName: 'td',
                    properties: {},
                    children: [{ type: 'text', value: 'Cell 1' }],
                  },
                  {
                    type: 'element',
                    tagName: 'td',
                    properties: {},
                    children: [{ type: 'text', value: 'Cell 2' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const block = parseHTMLTable(node);

      expect(block).not.toBeNull();
      expect(block?.type).toBe(BlockType.SimpleTableBlock);
      expect(block?.children.length).toBeGreaterThan(0);
    });

    it('should parse table with multiple rows', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'table',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'tbody',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'tr',
                properties: {},
                children: [
                  {
                    type: 'element',
                    tagName: 'td',
                    properties: {},
                    children: [{ type: 'text', value: 'Row 1 Cell 1' }],
                  },
                  {
                    type: 'element',
                    tagName: 'td',
                    properties: {},
                    children: [{ type: 'text', value: 'Row 1 Cell 2' }],
                  },
                ],
              },
              {
                type: 'element',
                tagName: 'tr',
                properties: {},
                children: [
                  {
                    type: 'element',
                    tagName: 'td',
                    properties: {},
                    children: [{ type: 'text', value: 'Row 2 Cell 1' }],
                  },
                  {
                    type: 'element',
                    tagName: 'td',
                    properties: {},
                    children: [{ type: 'text', value: 'Row 2 Cell 2' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const block = parseHTMLTable(node);

      expect(block?.children.length).toBe(2);
    });

    it('should parse table with formatted content in cells', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'table',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'tbody',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'tr',
                properties: {},
                children: [
                  {
                    type: 'element',
                    tagName: 'td',
                    properties: {},
                    children: [
                      { type: 'text', value: 'Text with ' },
                      {
                        type: 'element',
                        tagName: 'strong',
                        properties: {},
                        children: [{ type: 'text', value: 'bold' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const block = parseHTMLTable(node);

      expect(block).not.toBeNull();
      // Check that formatting is preserved
      const firstCell = block?.children[0]?.children[0];
      const firstCellContent = firstCell?.children[0]; // Paragraph inside the cell

      expect(firstCellContent?.text).toBe('Text with bold');
      expect(firstCellContent?.formats.some((f) => f.type === 'bold')).toBe(true);
    });

    it('should return null for non-table element', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'div',
        properties: {},
        children: [],
      };

      const block = parseHTMLTable(node);

      expect(block).toBeNull();
    });

    it('should handle table with only thead', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'table',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'thead',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'tr',
                properties: {},
                children: [
                  {
                    type: 'element',
                    tagName: 'th',
                    properties: {},
                    children: [{ type: 'text', value: 'Header' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const block = parseHTMLTable(node);

      expect(block).not.toBeNull();
      expect(block?.children.length).toBeGreaterThan(0);
    });

    it('should handle empty table cells', () => {
      const node: HastElement = {
        type: 'element',
        tagName: 'table',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'tbody',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'tr',
                properties: {},
                children: [
                  {
                    type: 'element',
                    tagName: 'td',
                    properties: {},
                    children: [],
                  },
                  {
                    type: 'element',
                    tagName: 'td',
                    properties: {},
                    children: [{ type: 'text', value: 'Content' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const block = parseHTMLTable(node);

      expect(block).not.toBeNull();
      expect(block?.children[0]?.children[0]?.children[0]?.text).toBe('');
      expect(block?.children[0]?.children[1]?.children[0]?.text).toBe('Content');
    });
  });

  describe('parseMarkdownTable', () => {
    it('should parse simple markdown table', () => {
      const node: Table = {
        type: 'table',
        align: [null, null],
        children: [
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'Header 1' }],
              },
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'Header 2' }],
              },
            ],
          },
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'Cell 1' }],
              },
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'Cell 2' }],
              },
            ],
          },
        ],
      };

      const block = parseMarkdownTable(node);

      expect(block).not.toBeNull();
      expect(block?.type).toBe(BlockType.SimpleTableBlock);
      expect(block?.children.length).toBe(2);
    });

    it('should parse table with multiple rows', () => {
      const node: Table = {
        type: 'table',
        align: [null, null],
        children: [
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'H1' }],
              },
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'H2' }],
              },
            ],
          },
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'R1C1' }],
              },
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'R1C2' }],
              },
            ],
          },
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'R2C1' }],
              },
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'R2C2' }],
              },
            ],
          },
        ],
      };

      const block = parseMarkdownTable(node);

      expect(block?.children.length).toBe(3);
    });

    it('should parse table with formatted content', () => {
      const node: Table = {
        type: 'table',
        align: [null, null],
        children: [
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [
                  { type: 'text', value: 'Text with ' },
                  {
                    type: 'strong',
                    children: [{ type: 'text', value: 'bold' }],
                  },
                ],
              },
              {
                type: 'tableCell',
                children: [
                  { type: 'text', value: 'Text with ' },
                  {
                    type: 'emphasis',
                    children: [{ type: 'text', value: 'italic' }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const block = parseMarkdownTable(node);

      expect(block).not.toBeNull();
      const firstCell = block?.children[0]?.children[0];
      const secondCell = block?.children[0]?.children[1];
      const firstCellContent = firstCell?.children[0]; // Paragraph inside the cell
      const secondCellContent = secondCell?.children[0]; // Paragraph inside the cell

      expect(firstCellContent?.text).toBe('Text with bold');
      expect(firstCellContent?.formats.some((f) => f.type === 'bold')).toBe(true);
      expect(secondCellContent?.text).toBe('Text with italic');
      expect(secondCellContent?.formats.some((f) => f.type === 'italic')).toBe(true);
    });

    it('should handle empty table cells', () => {
      const node: Table = {
        type: 'table',
        align: [null, null],
        children: [
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [],
              },
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'Content' }],
              },
            ],
          },
        ],
      };

      const block = parseMarkdownTable(node);

      expect(block?.children[0]?.children[0]?.children[0]?.text).toBe('');
      expect(block?.children[0]?.children[1]?.children[0]?.text).toBe('Content');
    });

    it('should handle table with single column', () => {
      const node: Table = {
        type: 'table',
        align: [null],
        children: [
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'Header' }],
              },
            ],
          },
          {
            type: 'tableRow',
            children: [
              {
                type: 'tableCell',
                children: [{ type: 'text', value: 'Cell' }],
              },
            ],
          },
        ],
      };

      const block = parseMarkdownTable(node);

      expect(block).not.toBeNull();
      expect(block?.children[0]?.children.length).toBe(1);
    });

    it('should handle table with many columns', () => {
      const node: Table = {
        type: 'table',
        align: [null, null, null, null, null],
        children: [
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [{ type: 'text', value: 'C1' }] },
              { type: 'tableCell', children: [{ type: 'text', value: 'C2' }] },
              { type: 'tableCell', children: [{ type: 'text', value: 'C3' }] },
              { type: 'tableCell', children: [{ type: 'text', value: 'C4' }] },
              { type: 'tableCell', children: [{ type: 'text', value: 'C5' }] },
            ],
          },
        ],
      };

      const block = parseMarkdownTable(node);

      expect(block?.children[0]?.children.length).toBe(5);
    });
  });
});
