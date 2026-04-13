import { BlockType, View, ViewLayout } from '@/application/types';

import {
  findDuplicatedContainerChild,
  getDatabaseLayoutFromBlockType,
  isDatabaseBlockType,
} from '../databaseDuplicateUtils';

function makeView(overrides: Partial<View>): View {
  return {
    view_id: overrides.view_id ?? 'view-id',
    name: overrides.name ?? 'View',
    icon: overrides.icon ?? null,
    layout: overrides.layout ?? ViewLayout.Document,
    created_at: overrides.created_at ?? '',
    is_published: overrides.is_published ?? false,
    is_locked: overrides.is_locked ?? false,
    extra: overrides.extra ?? {},
    children: overrides.children ?? [],
    parent_view_id: overrides.parent_view_id ?? '',
    workspace_id: overrides.workspace_id ?? '',
    last_edited_time: overrides.last_edited_time ?? '',
    created_by: overrides.created_by ?? null,
    last_edited_by: overrides.last_edited_by ?? null,
    is_private: overrides.is_private ?? false,
    is_space_owner: overrides.is_space_owner ?? false,
    is_space: overrides.is_space ?? false,
    has_children: overrides.has_children ?? false,
    database_relations: overrides.database_relations,
    access_level: overrides.access_level,
  };
}

describe('databaseDuplicateUtils', () => {
  it('identifies database block types', () => {
    expect(isDatabaseBlockType(BlockType.GridBlock)).toBe(true);
    expect(isDatabaseBlockType(BlockType.BoardBlock)).toBe(true);
    expect(isDatabaseBlockType(BlockType.CalendarBlock)).toBe(true);
    expect(isDatabaseBlockType(BlockType.Paragraph)).toBe(false);
  });

  it('maps database block types to view layouts', () => {
    expect(getDatabaseLayoutFromBlockType(BlockType.GridBlock)).toBe(ViewLayout.Grid);
    expect(getDatabaseLayoutFromBlockType(BlockType.BoardBlock)).toBe(ViewLayout.Board);
    expect(getDatabaseLayoutFromBlockType(BlockType.CalendarBlock)).toBe(ViewLayout.Calendar);
    expect(getDatabaseLayoutFromBlockType(BlockType.Paragraph)).toBeUndefined();
  });

  it('finds the duplicated container from newly added children', () => {
    const beforeChildren = [
      makeView({ view_id: 'source-container', name: 'Source', layout: ViewLayout.Grid }),
    ];
    const duplicatedChild = makeView({
      view_id: 'duplicate-container',
      name: 'Source (Copy)',
      layout: ViewLayout.Grid,
    });
    const afterChildren = [...beforeChildren, duplicatedChild];

    expect(
      findDuplicatedContainerChild({
        beforeChildren,
        afterChildren,
        sourceContainerId: 'source-container',
        duplicatedName: 'Source (Copy)',
      })
    ).toEqual(duplicatedChild);
  });

  it('returns the newly added child even when a pre-existing sibling has the same name', () => {
    const previousDuplicate = makeView({
      view_id: 'old-duplicate',
      name: 'Source (Copy)',
      layout: ViewLayout.Grid,
    });
    const beforeChildren = [
      makeView({ view_id: 'source-container', name: 'Source', layout: ViewLayout.Grid }),
      previousDuplicate,
    ];
    const newDuplicate = makeView({
      view_id: 'new-duplicate',
      name: 'Source (Copy)',
      layout: ViewLayout.Grid,
    });
    const afterChildren = [...beforeChildren, newDuplicate];

    expect(
      findDuplicatedContainerChild({
        beforeChildren,
        afterChildren,
        sourceContainerId: 'source-container',
        duplicatedName: 'Source (Copy)',
      })
    ).toEqual(newDuplicate);
  });
});
