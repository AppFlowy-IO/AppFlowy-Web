import { DATABASE_BLOCK_TYPES, getDatabaseLayoutFromBlockType, isDatabaseBlockType } from '@/application/database-block';
import { BlockType, ViewLayout } from '@/application/types';

describe('database block types', () => {
  it.each(DATABASE_BLOCK_TYPES)('classifies %s as a database block', (blockType) => {
    expect(isDatabaseBlockType(blockType)).toBe(true);
  });

  it('rejects non-database and malformed block types', () => {
    expect(isDatabaseBlockType(BlockType.Paragraph)).toBe(false);
    expect(isDatabaseBlockType('unknown')).toBe(false);
    expect(isDatabaseBlockType(undefined)).toBe(false);
  });

  it.each([
    [BlockType.ListBlock, ViewLayout.List],
    [BlockType.DatabaseGalleryBlock, ViewLayout.Gallery],
  ])('maps the native %s block to database layout %s', (blockType, layout) => {
    expect(getDatabaseLayoutFromBlockType(blockType)).toBe(layout);
  });
});
