import { BlockType, View, ViewLayout } from '@/application/types';

import {
  assertLinkedDatabaseBlockDuplicateIsSafe,
  findDuplicatedContainerChild,
  getDatabaseLayoutFromBlockType,
  isDatabaseBlockType,
  loadDatabaseDuplicateSourceViews,
  LINKED_DATABASE_BLOCK_DUPLICATE_CHECK_FAILED_MESSAGE,
  LINKED_FORM_BLOCK_DUPLICATE_UNAVAILABLE_MESSAGE,
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
    expect(isDatabaseBlockType(BlockType.ListBlock)).toBe(true);
    expect(isDatabaseBlockType(BlockType.DatabaseGalleryBlock)).toBe(true);
    expect(isDatabaseBlockType(BlockType.ChartBlock)).toBe(true);
    expect(isDatabaseBlockType(BlockType.Paragraph)).toBe(false);
  });

  it('maps database block types to view layouts', () => {
    expect(getDatabaseLayoutFromBlockType(BlockType.GridBlock)).toBe(ViewLayout.Grid);
    expect(getDatabaseLayoutFromBlockType(BlockType.BoardBlock)).toBe(ViewLayout.Board);
    expect(getDatabaseLayoutFromBlockType(BlockType.CalendarBlock)).toBe(ViewLayout.Calendar);
    expect(getDatabaseLayoutFromBlockType(BlockType.ListBlock)).toBe(ViewLayout.List);
    expect(getDatabaseLayoutFromBlockType(BlockType.DatabaseGalleryBlock)).toBe(ViewLayout.Gallery);
    expect(getDatabaseLayoutFromBlockType(BlockType.ChartBlock)).toBe(ViewLayout.Chart);
    expect(getDatabaseLayoutFromBlockType(BlockType.Paragraph)).toBeUndefined();
  });

  it('preserves the authoritative first source view without reloading its List layout', async () => {
    const firstSourceView = makeView({ view_id: 'list-view', layout: ViewLayout.List });
    const secondSourceView = makeView({ view_id: 'board-view', layout: ViewLayout.Board });
    const loadViewMeta = jest.fn(async (viewId: string) => {
      if (viewId === secondSourceView.view_id) return secondSourceView;

      throw new Error('metadata unavailable');
    });

    await expect(
      loadDatabaseDuplicateSourceViews({
        sourceViewIds: [firstSourceView.view_id, secondSourceView.view_id, 'missing-view'],
        firstSourceView,
        loadViewMeta,
      })
    ).resolves.toEqual([firstSourceView, secondSourceView, null]);
    expect(loadViewMeta).toHaveBeenCalledTimes(2);
    expect(loadViewMeta).not.toHaveBeenCalledWith(firstSourceView.view_id);
  });

  it('blocks a linked database block containing a Form before creating children', () => {
    expect(() =>
      assertLinkedDatabaseBlockDuplicateIsSafe([
        makeView({ view_id: 'grid-view', layout: ViewLayout.Grid }),
        makeView({ view_id: 'form-view', layout: ViewLayout.Form }),
      ])
    ).toThrow(LINKED_FORM_BLOCK_DUPLICATE_UNAVAILABLE_MESSAGE);
  });

  it('fails closed when a linked tab layout could not be verified', () => {
    expect(() =>
      assertLinkedDatabaseBlockDuplicateIsSafe([makeView({ view_id: 'grid-view', layout: ViewLayout.Grid }), null])
    ).toThrow(LINKED_DATABASE_BLOCK_DUPLICATE_CHECK_FAILED_MESSAGE);
  });

  it('allows linked database blocks whose tabs are all non-Form layouts', () => {
    expect(() =>
      assertLinkedDatabaseBlockDuplicateIsSafe([
        makeView({ view_id: 'grid-view', layout: ViewLayout.Grid }),
        makeView({ view_id: 'board-view', layout: ViewLayout.Board }),
      ])
    ).not.toThrow();
  });

  it('finds the duplicated container from newly added children', () => {
    const beforeChildren = [makeView({ view_id: 'source-container', name: 'Source', layout: ViewLayout.Grid })];
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
