import { BlockType, ViewLayout } from '@/application/types';

const DATABASE_LAYOUTS = new Set<ViewLayout>([
  ViewLayout.Grid,
  ViewLayout.Board,
  ViewLayout.Calendar,
  ViewLayout.Chart,
  ViewLayout.List,
  ViewLayout.Gallery,
  ViewLayout.Feed,
  ViewLayout.Timeline,
]);

/** Map each database view layout to its cross-client document block type. */
export function getDatabaseBlockTypeForLayout(layout: ViewLayout): BlockType | null {
  switch (layout) {
    // Timeline uses the generic database block; its view owns the native layout.
    case ViewLayout.Timeline:
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
    case ViewLayout.Gallery:
      return BlockType.DatabaseGalleryBlock;
    case ViewLayout.Feed:
      return BlockType.FeedBlock;
    default:
      return null;
  }
}

export function isSlashMenuDatabaseLayout(layout: ViewLayout): boolean {
  return DATABASE_LAYOUTS.has(layout);
}
