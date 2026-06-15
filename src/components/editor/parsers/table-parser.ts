
import { BlockData, BlockType } from '@/application/types';

import { extractInlineFormatsFromHAST, extractTextFromHAST } from './inline-converters';
import { extractInlineFormatsFromMDAST, extractTextFromMDAST } from './mdast-utils';
import { ParsedBlock } from './types';

import type { Element as HastElement } from 'hast';
import type { Table as MdastTable, TableRow, TableCell } from 'mdast';

/**
 * Parses HTML table element to SimpleTable structure
 * @param node HAST table element
 * @returns Parsed table block
 */
export function parseHTMLTable(node: HastElement): ParsedBlock | null {
  if (node.tagName !== 'table') return null;

  const rows: ParsedBlock[] = [];

  // Find tbody or process table children directly
  const tbody = node.children.find((child) => {
    return child.type === 'element' && (child).tagName === 'tbody';
  }) as HastElement | undefined;

  const thead = node.children.find((child) => {
    return child.type === 'element' && (child).tagName === 'thead';
  }) as HastElement | undefined;

  // Process header rows first
  if (thead) {
    processTableSection(thead, rows, true);
  }

  // Process body rows
  if (tbody) {
    processTableSection(tbody, rows, false);
  } else {
    // No tbody, process tr directly under table
    node.children.forEach((child) => {
      if (child.type === 'element') {
        const elem = child;

        if (elem.tagName === 'tr') {
          const row = parseHTMLTableRow(elem, false);

          if (row) {
            rows.push(row);
          }
        }
      }
    });
  }

  if (rows.length === 0) return null;

  return {
    type: BlockType.SimpleTableBlock,
    data: {},
    text: '',
    formats: [],
    children: rows,
  };
}

/**
 * Processes a table section (thead or tbody)
 */
function processTableSection(section: HastElement, rows: ParsedBlock[], isHeader: boolean): void {
  section.children.forEach((child) => {
    if (child.type === 'element') {
      const elem = child;

      if (elem.tagName === 'tr') {
        const row = parseHTMLTableRow(elem, isHeader);

        if (row) {
          rows.push(row);
        }
      }
    }
  });
}

/**
 * Parses a single table row
 */
function parseHTMLTableRow(node: HastElement, isHeader: boolean): ParsedBlock | null {
  const cells: ParsedBlock[] = [];

  node.children.forEach((child) => {
    if (child.type === 'element') {
      const elem = child;

      if (elem.tagName === 'td' || elem.tagName === 'th') {
        cells.push({
          type: BlockType.SimpleTableCellBlock,
          data: { isHeader: isHeader || elem.tagName === 'th' } as BlockData,
          text: '',
          formats: [],
          children: [
            {
              type: BlockType.Paragraph,
              data: {},
              text: extractTextFromHAST(elem),
              formats: extractInlineFormatsFromHAST(elem),
              children: [],
            },
          ],
        });
      }
    }
  });

  if (cells.length === 0) return null;

  return {
    type: BlockType.SimpleTableRowBlock,
    data: {},
    text: '',
    formats: [],
    children: cells,
  };
}

/**
 * Parses Markdown table (from MDAST) to SimpleTable structure
 * @param node MDAST table node
 * @returns Parsed table block
 */
export function parseMarkdownTable(node: MdastTable): ParsedBlock | null {
  const rows: ParsedBlock[] = [];

  node.children.forEach((rowNode: TableRow, rowIndex: number) => {
    const cells: ParsedBlock[] = [];

    rowNode.children.forEach((cellNode: TableCell) => {
      // Extract text from cell
      const text = extractTextFromMDAST(cellNode);

      cells.push({
        type: BlockType.SimpleTableCellBlock,
        data: { isHeader: rowIndex === 0 } as BlockData, // First row is header in Markdown
        text: '',
        formats: [],
        children: [
          {
            type: BlockType.Paragraph,
            data: {},
            text,
            formats: extractInlineFormatsFromMDAST(cellNode),
            children: [],
          },
        ],
      });
    });

    if (cells.length > 0) {
      rows.push({
        type: BlockType.SimpleTableRowBlock,
        data: {},
        text: '',
        formats: [],
        children: cells,
      });
    }
  });

  if (rows.length === 0) return null;

  return {
    type: BlockType.SimpleTableBlock,
    data: {},
    text: '',
    formats: [],
    children: rows,
  };
}

/**
 * Parses TSV string into SimpleTable structure
 * @param text TSV string
 * @returns Parsed table block
 */
export function parseTSVTable(text: string): ParsedBlock | null {
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) return null;

  const rows: ParsedBlock[] = [];

  lines.forEach((line, rowIndex) => {
    const cells: ParsedBlock[] = [];
    const values = line.split('\t');

    values.forEach((value) => {
      cells.push({
        type: BlockType.SimpleTableCellBlock,
        data: { isHeader: rowIndex === 0 } as BlockData,
        text: '',
        formats: [],
        children: [
          {
            type: BlockType.Paragraph,
            data: {},
            text: value.trim(),
            formats: [],
            children: [],
          },
        ],
      });
    });

    if (cells.length > 0) {
      rows.push({
        type: BlockType.SimpleTableRowBlock,
        data: {},
        text: '',
        formats: [],
        children: cells,
      });
    }
  });

  if (rows.length === 0) return null;

  return {
    type: BlockType.SimpleTableBlock,
    data: {},
    text: '',
    formats: [],
    children: rows,
  };
}

