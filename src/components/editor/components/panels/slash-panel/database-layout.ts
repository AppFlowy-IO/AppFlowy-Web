import { BlockType, ViewLayout } from '@/application/types';

const DATABASE_LAYOUTS = new Set<ViewLayout>([
  ViewLayout.Grid,
  ViewLayout.Board,
  ViewLayout.Calendar,
  ViewLayout.Chart,
  ViewLayout.List,
]);

/**
 * List views use the generic grid database block on Web. The block data points
 * at the created view, and the database renderer reads that view's actual
 * layout from Yjs.
 */
export function getDatabaseBlockTypeForLayout(layout: ViewLayout): BlockType | null {
  switch (layout) {
    case ViewLayout.Grid:
    case ViewLayout.List:
      return BlockType.GridBlock;
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
