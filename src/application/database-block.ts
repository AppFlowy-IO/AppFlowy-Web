import { BlockType, ViewLayout } from '@/application/types';

export const DATABASE_BLOCK_TYPES = [
  BlockType.GridBlock,
  BlockType.BoardBlock,
  BlockType.CalendarBlock,
  BlockType.ListBlock,
  BlockType.ChartBlock,
] as const;

export type DatabaseBlockType = (typeof DATABASE_BLOCK_TYPES)[number];

const DATABASE_BLOCK_TYPE_SET: ReadonlySet<string> = new Set(DATABASE_BLOCK_TYPES);

export function isDatabaseBlockType(type: unknown): type is DatabaseBlockType {
  return typeof type === 'string' && DATABASE_BLOCK_TYPE_SET.has(type);
}

export function getDatabaseLayoutFromBlockType(type: unknown): ViewLayout | undefined {
  switch (type) {
    case BlockType.GridBlock:
      return ViewLayout.Grid;
    case BlockType.BoardBlock:
      return ViewLayout.Board;
    case BlockType.CalendarBlock:
      return ViewLayout.Calendar;
    case BlockType.ListBlock:
      return ViewLayout.List;
    case BlockType.ChartBlock:
      return ViewLayout.Chart;
    default:
      return undefined;
  }
}
