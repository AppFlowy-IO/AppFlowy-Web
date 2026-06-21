import { Element, Node as SlateNode } from 'slate';

import { BlockType } from '@/application/types';

const TABLE_BLOCK_TYPES = new Set<string>([
  BlockType.SimpleTableBlock,
  BlockType.SimpleTableRowBlock,
  BlockType.SimpleTableCellBlock,
]);

export function containsSimpleTableBlocks(nodes: SlateNode[]): boolean {
  return nodes.some(containsSimpleTableBlock);
}

export function extractTSVFromTableFragment(nodes: SlateNode[]): string | null {
  const rows: string[][] = [];

  for (const node of nodes) {
    if (!Element.isElement(node)) continue;

    if (node.type === BlockType.SimpleTableBlock) {
      rows.push(...extractRowsFromTable(node));
    } else if (node.type === BlockType.SimpleTableRowBlock) {
      const row = extractCellsFromRow(node);

      if (row.length > 0) rows.push(row);
    } else if (node.type === BlockType.SimpleTableCellBlock) {
      rows.push([SlateNode.string(node)]);
    } else {
      rows.push([SlateNode.string(node)]);
    }
  }

  return rows.length > 0 ? rows.map((row) => row.join('\t')).join('\n') : null;
}

function containsSimpleTableBlock(node: SlateNode): boolean {
  if (!Element.isElement(node)) return false;
  if (TABLE_BLOCK_TYPES.has(node.type as string)) return true;

  return node.children.some(containsSimpleTableBlock);
}

function extractRowsFromTable(table: Element): string[][] {
  const rows: string[][] = [];

  for (const row of table.children) {
    if (!Element.isElement(row) || row.type !== BlockType.SimpleTableRowBlock) continue;

    const cells = extractCellsFromRow(row);

    if (cells.length > 0) rows.push(cells);
  }

  return rows;
}

function extractCellsFromRow(row: Element): string[] {
  const cells: string[] = [];

  for (const cell of row.children) {
    if (!Element.isElement(cell) || cell.type !== BlockType.SimpleTableCellBlock) continue;

    cells.push(SlateNode.string(cell));
  }

  return cells;
}
