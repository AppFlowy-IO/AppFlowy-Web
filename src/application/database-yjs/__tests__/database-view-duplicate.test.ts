import * as Y from 'yjs';

import { copyDatabaseViewConfiguration } from '@/application/database-yjs/dispatch';
import {
  DatabaseViewLayout,
  YDatabaseFilter,
  YDatabaseRowOrders,
  YDatabaseView,
  YjsDatabaseKey,
} from '@/application/types';

function createView(id: string, name: string): YDatabaseView {
  const view = new Y.Map() as YDatabaseView;

  view.set(YjsDatabaseKey.id, id);
  view.set(YjsDatabaseKey.name, name);
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Gallery);
  return view;
}

describe('copyDatabaseViewConfiguration', () => {
  it('deep-copies nested Yjs configuration without replacing the target identity or name', () => {
    const doc = new Y.Doc();
    const views = doc.getMap<YDatabaseView>('views');
    const source = createView('source-view-id', 'Gallery');
    const target = createView('target-view-id', 'Gallery (Copy)');
    const sourceFilter = new Y.Map() as YDatabaseFilter;
    const sourceFilterChildren = new Y.Array<YDatabaseFilter>();
    const sourceFilters = new Y.Array<YDatabaseFilter>();
    const sourceGallerySettings = new Y.Map<unknown>();
    const sourceLayoutSettings = new Y.Map<Y.Map<unknown>>();
    const sourceGroupColumn = new Y.Map<unknown>();
    const sourceGroupColumns = new Y.Array<Y.Map<unknown>>();
    const sourceGroup = new Y.Map<unknown>();
    const sourceGroups = new Y.Array<Y.Map<unknown>>();
    const sourceFieldOrders = new Y.Array<{ id: string }>();

    sourceFilter.set(YjsDatabaseKey.id, 'filter-id');
    sourceFilter.set(YjsDatabaseKey.content, 'target');
    sourceFilterChildren.push([sourceFilter]);

    const sourceAdvancedFilter = new Y.Map() as YDatabaseFilter;

    sourceAdvancedFilter.set(YjsDatabaseKey.id, 'advanced-filter-id');
    sourceAdvancedFilter.set(YjsDatabaseKey.children, sourceFilterChildren);
    sourceFilters.push([sourceAdvancedFilter]);

    sourceGallerySettings.set(YjsDatabaseKey.card_width, 320);
    sourceLayoutSettings.set(String(DatabaseViewLayout.Gallery), sourceGallerySettings);

    sourceGroupColumn.set(YjsDatabaseKey.id, 'column-id');
    sourceGroupColumn.set(YjsDatabaseKey.visible, true);
    sourceGroupColumns.push([sourceGroupColumn]);
    sourceGroup.set(YjsDatabaseKey.id, 'group-id');
    sourceGroup.set(YjsDatabaseKey.groups, sourceGroupColumns);
    sourceGroups.push([sourceGroup]);

    sourceFieldOrders.push([{ id: 'field-id' }]);
    source.set(YjsDatabaseKey.filters, sourceFilters);
    source.set(YjsDatabaseKey.groups, sourceGroups);
    source.set(YjsDatabaseKey.layout_settings, sourceLayoutSettings);
    source.set(YjsDatabaseKey.field_orders, sourceFieldOrders);

    views.set('source-view-id', source);
    views.set('target-view-id', target);

    copyDatabaseViewConfiguration(source, target);

    expect(target.get(YjsDatabaseKey.id)).toBe('target-view-id');
    expect(target.get(YjsDatabaseKey.name)).toBe('Gallery (Copy)');
    expect(target.get(YjsDatabaseKey.filters).toJSON()).toEqual(sourceFilters.toJSON());
    expect(target.get(YjsDatabaseKey.groups).toJSON()).toEqual(sourceGroups.toJSON());
    expect(target.get(YjsDatabaseKey.layout_settings).toJSON()).toEqual(sourceLayoutSettings.toJSON());
    expect(target.get(YjsDatabaseKey.field_orders).toJSON()).toEqual(sourceFieldOrders.toJSON());

    const targetFilters = target.get(YjsDatabaseKey.filters);
    const targetAdvancedFilter = targetFilters.get(0);
    const targetFilterChildren = targetAdvancedFilter.get(YjsDatabaseKey.children) as Y.Array<YDatabaseFilter>;
    const targetFilter = targetFilterChildren.get(0);
    const targetGroups = target.get(YjsDatabaseKey.groups);
    const targetGroupColumns = targetGroups.get(0).get(YjsDatabaseKey.groups) as Y.Array<Y.Map<unknown>>;
    const targetGallerySettings = target
      .get(YjsDatabaseKey.layout_settings)
      .get(String(DatabaseViewLayout.Gallery)) as Y.Map<unknown>;

    expect(targetFilters).not.toBe(sourceFilters);
    expect(targetAdvancedFilter).not.toBe(sourceAdvancedFilter);
    expect(targetFilterChildren).not.toBe(sourceFilterChildren);
    expect(targetFilter).not.toBe(sourceFilter);
    expect(targetGroups).not.toBe(sourceGroups);
    expect(targetGroupColumns).not.toBe(sourceGroupColumns);
    expect(targetGallerySettings).not.toBe(sourceGallerySettings);

    targetFilter.set(YjsDatabaseKey.content, 'changed in duplicate');
    targetGallerySettings.set(YjsDatabaseKey.card_width, 640);
    sourceGroupColumn.set(YjsDatabaseKey.visible, false);
    (target.get(YjsDatabaseKey.field_orders).get(0) as { id: string }).id = 'duplicate-field-id';

    expect(sourceFilter.get(YjsDatabaseKey.content)).toBe('target');
    expect(sourceGallerySettings.get(YjsDatabaseKey.card_width)).toBe(320);
    expect(targetGroupColumns.get(0).get(YjsDatabaseKey.visible)).toBe(true);
    expect(sourceFieldOrders.get(0).id).toBe('field-id');
  });

  it('copies source row order while excluding rows deleted by Desktop canonical visibility', () => {
    const doc = new Y.Doc();
    const views = doc.getMap<YDatabaseView>('views');
    const canonicalState = doc.getMap<YDatabaseRowOrders>('canonical-state');
    const source = createView('source-view-id', 'Gallery');
    const target = createView('target-view-id', 'Gallery (Copy)');
    const sourceRowOrders = new Y.Array() as YDatabaseRowOrders;
    const canonicalRowOrders = new Y.Array() as YDatabaseRowOrders;

    sourceRowOrders.push([
      { id: 'visible-first', height: 10 },
      { id: 'canonical-deleted', height: 20 },
      { id: 'canonical-restored', height: 30, is_deleted: true },
      { id: 'raw-deleted', height: 40, is_deleted: true },
      { id: 'visible-last', height: 50 },
    ]);
    canonicalRowOrders.push([
      { id: 'visible-first', height: 10, is_deleted: false },
      { id: 'canonical-deleted', height: 20, is_deleted: true },
      { id: 'canonical-restored', height: 30, is_deleted: false },
      { id: 'visible-last', height: 50, is_deleted: false },
    ]);
    source.set(YjsDatabaseKey.row_orders, sourceRowOrders);
    views.set('source-view-id', source);
    views.set('target-view-id', target);
    canonicalState.set('rows', canonicalRowOrders);

    copyDatabaseViewConfiguration(source, target, canonicalRowOrders);

    expect(target.get(YjsDatabaseKey.row_orders).toJSON()).toEqual([
      { id: 'visible-first', height: 10 },
      { id: 'canonical-restored', height: 30, is_deleted: false },
      { id: 'visible-last', height: 50 },
    ]);
    expect(sourceRowOrders.toJSON()).toEqual([
      { id: 'visible-first', height: 10 },
      { id: 'canonical-deleted', height: 20 },
      { id: 'canonical-restored', height: 30, is_deleted: true },
      { id: 'raw-deleted', height: 40, is_deleted: true },
      { id: 'visible-last', height: 50 },
    ]);
    expect(target.get(YjsDatabaseKey.row_orders)).not.toBe(sourceRowOrders);
  });
});
