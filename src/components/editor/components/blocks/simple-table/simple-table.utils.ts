import { BlockType } from '@/application/types';
import { SimpleTableCellBlockNode, SimpleTableRowNode } from '@/components/editor/editor.type';

export function getSlateNodeType(node: unknown): string | undefined {
  return node && typeof node === 'object' ? (node as { type?: string }).type : undefined;
}

export function isSimpleTableRowNode(node: unknown): node is SimpleTableRowNode {
  return getSlateNodeType(node) === BlockType.SimpleTableRowBlock;
}

export function isSimpleTableCellNode(node: unknown): node is SimpleTableCellBlockNode {
  return getSlateNodeType(node) === BlockType.SimpleTableCellBlock;
}
