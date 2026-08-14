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

  it('maps the native List block to the List database layout', () => {
    expect(getDatabaseLayoutFromBlockType(BlockType.ListBlock)).toBe(ViewLayout.List);
  });
});
