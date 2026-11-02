import { BlockType, ViewLayout } from '@/application/types';

import { getDatabaseBlockTypeForLayout, isSlashMenuDatabaseLayout } from '../database-layout';

describe('slash menu database layout plumbing', () => {
  it.each([
    ['Grid', ViewLayout.Grid, BlockType.GridBlock],
    ['List', ViewLayout.List, BlockType.ListBlock],
    ['Gallery', ViewLayout.Gallery, BlockType.DatabaseGalleryBlock],
    ['Feed', ViewLayout.Feed, BlockType.FeedBlock],
    ['Board', ViewLayout.Board, BlockType.BoardBlock],
    ['Calendar', ViewLayout.Calendar, BlockType.CalendarBlock],
    ['Chart', ViewLayout.Chart, BlockType.ChartBlock],
    ['Timeline', ViewLayout.Timeline, BlockType.TimelineBlock],
    ['Dashboard', ViewLayout.Dashboard, BlockType.DashboardBlock],
  ])('maps %s to its database block type', (_name, layout, blockType) => {
    expect(getDatabaseBlockTypeForLayout(layout)).toBe(blockType);
  });

  it('allows List, Gallery, Feed, Timeline and Dashboard databases in the linked database picker', () => {
    expect(isSlashMenuDatabaseLayout(ViewLayout.List)).toBe(true);
    expect(isSlashMenuDatabaseLayout(ViewLayout.Gallery)).toBe(true);
    expect(isSlashMenuDatabaseLayout(ViewLayout.Feed)).toBe(true);
    expect(isSlashMenuDatabaseLayout(ViewLayout.Timeline)).toBe(true);
    expect(isSlashMenuDatabaseLayout(ViewLayout.Dashboard)).toBe(true);
  });

  it('rejects non-database layouts', () => {
    expect(getDatabaseBlockTypeForLayout(ViewLayout.Document)).toBeNull();
    expect(isSlashMenuDatabaseLayout(ViewLayout.Document)).toBe(false);
  });
});
