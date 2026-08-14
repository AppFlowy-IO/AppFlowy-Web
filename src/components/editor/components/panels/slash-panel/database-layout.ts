import { BlockType, ViewLayout } from '@/application/types';

const DATABASE_LAYOUTS = new Set<ViewLayout>([
  ViewLayout.Grid,
  ViewLayout.Board,
  ViewLayout.Calendar,
  ViewLayout.Chart,
  ViewLayout.List,
]);

/** Map each database view layout to its cross-client document block type. */
export function getDatabaseBlockTypeForLayout(layout: ViewLayout): BlockType | null {
  switch (layout) {
    case ViewLayout.Grid:
      return BlockType.GridBlock;
    case ViewLayout.List:
      return BlockType.ListBlock;
    case ViewLayout.Board:
      return BlockType.BoardBlock;
    case ViewLayout.Calendar:
      return BlockType.CalendarBlock;
    case ViewLayout.Chart:
      return BlockType.ChartBlock;
    default:
      return null;
  }
}

export function isSlashMenuDatabaseLayout(layout: ViewLayout): boolean {
  return DATABASE_LAYOUTS.has(layout);
}
