import type { PublishedPageSnapshot } from '@/application/publish-snapshot/types';
import { BlockType } from '@/application/types';

const DATABASE_BLOCK_TYPES = new Set<string>([
  BlockType.GridBlock,
  BlockType.BoardBlock,
  BlockType.CalendarBlock,
  BlockType.ChartBlock,
]);

function nodeHasDatabaseBlock(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;

  const element = node as { type?: unknown; children?: unknown };

  if (typeof element.type === 'string' && DATABASE_BLOCK_TYPES.has(element.type)) {
    return true;
  }

  return Array.isArray(element.children) && element.children.some(nodeHasDatabaseBlock);
}

function documentRawHasDatabaseBlock(snapshot: PublishedPageSnapshot) {
  if (snapshot.kind !== 'document') return false;

  const blocks = snapshot.document.raw?.data.blocks;

  if (!blocks) return false;

  return Object.values(blocks).some((block) => DATABASE_BLOCK_TYPES.has(block.ty));
}

function documentChildrenHaveDatabaseBlock(snapshot: PublishedPageSnapshot) {
  if (snapshot.kind !== 'document') return false;

  return snapshot.document.children.some(nodeHasDatabaseBlock);
}

export function shouldDisableFixedGlobalCommentInput(snapshot?: PublishedPageSnapshot) {
  if (!snapshot) return false;
  if (snapshot.kind === 'database') return true;

  return documentRawHasDatabaseBlock(snapshot) || documentChildrenHaveDatabaseBlock(snapshot);
}
