import * as Y from 'yjs';

import { FieldType, FieldVisibility, SortCondition } from '@/application/database-yjs/database.type';
import {
  ensureFeedDefaultSort,
  findCreatedTimeFieldId,
  normalizeCreatedDatabaseFeedView,
} from '@/application/database-yjs/feed-layout';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

function createGridDatabaseDoc({ withCreatedTimeField = false }: { withCreatedTimeField?: boolean } = {}): YDoc {
  const doc = new Y.Doc() as unknown as YDoc;
  const sharedRoot = doc.getMap(YjsEditorKey.data_section);
  const database = new Y.Map();
  const fields = new Y.Map();
  const primaryField = new Y.Map();
  const secondaryField = new Y.Map();
  const views = new Y.Map();
  const gridView = new Y.Map();
  const fieldOrders = new Y.Array<{ id: string }>();
  const groups = new Y.Array();
  const metas = new Y.Map();

  primaryField.set(YjsDatabaseKey.id, 'primary-field');
  primaryField.set(YjsDatabaseKey.is_primary, true);
  primaryField.set(YjsDatabaseKey.type, FieldType.RichText);
  secondaryField.set(YjsDatabaseKey.id, 'secondary-field');
  secondaryField.set(YjsDatabaseKey.is_primary, false);
  secondaryField.set(YjsDatabaseKey.type, FieldType.SingleSelect);
  fields.set('primary-field', primaryField);
  fields.set('secondary-field', secondaryField);
  fieldOrders.push([{ id: 'primary-field' }, { id: 'secondary-field' }]);

  if (withCreatedTimeField) {
    const createdTimeField = new Y.Map();

    createdTimeField.set(YjsDatabaseKey.id, 'created-time-field');
    createdTimeField.set(YjsDatabaseKey.is_primary, false);
    createdTimeField.set(YjsDatabaseKey.type, FieldType.CreatedTime);
    fields.set('created-time-field', createdTimeField);
    fieldOrders.push([{ id: 'created-time-field' }]);
  }

  groups.push([{ id: 'legacy-group' }]);
  gridView.set(YjsDatabaseKey.id, 'grid-view-id');
  gridView.set(YjsDatabaseKey.name, 'Grid');
  gridView.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  gridView.set(YjsDatabaseKey.field_orders, fieldOrders);
  gridView.set(YjsDatabaseKey.field_settings, new Y.Map());
  gridView.set(YjsDatabaseKey.groups, groups);
  gridView.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set('grid-view-id', gridView);
  metas.set(YjsDatabaseKey.iid, 'grid-view-id');
  database.set(YjsDatabaseKey.id, 'database-id');
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, metas);
  sharedRoot.set(YjsEditorKey.database, database);
  return doc;
}

function getDatabase(doc: YDoc): YDatabase {
  return doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
}

describe('Feed view normalization', () => {
  it('shows only the primary field, clears groups, and marks the view as Feed', () => {
    const doc = createGridDatabaseDoc();

    expect(normalizeCreatedDatabaseFeedView(doc, 'grid-view-id', { name: 'Feed' })).toBe('grid-view-id');

    const view = getDatabase(doc).get(YjsDatabaseKey.views).get('grid-view-id');
    const fieldSettings = view.get(YjsDatabaseKey.field_settings);

    expect(view.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Feed);
    expect(view.get(YjsDatabaseKey.name)).toBe('Feed');
    expect(view.get(YjsDatabaseKey.groups)).toHaveLength(0);
    expect(fieldSettings.get('primary-field').get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);
    expect(fieldSettings.get('secondary-field').get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysHidden);
    expect(view.get(YjsDatabaseKey.sorts) ?? []).toHaveLength(0);
  });

  it('adds a CreatedTime descending sort when the database has a CreatedTime field (Desktop layout_deps)', () => {
    const doc = createGridDatabaseDoc({ withCreatedTimeField: true });

    expect(normalizeCreatedDatabaseFeedView(doc, 'grid-view-id')).toBe('grid-view-id');

    const view = getDatabase(doc).get(YjsDatabaseKey.views).get('grid-view-id');
    const sorts = view.get(YjsDatabaseKey.sorts);

    expect(sorts).toHaveLength(1);
    expect(sorts.get(0).get(YjsDatabaseKey.field_id)).toBe('created-time-field');
    expect(Number(sorts.get(0).get(YjsDatabaseKey.condition))).toBe(SortCondition.Descending);
    expect(sorts.get(0).get(YjsDatabaseKey.id)).toBeTruthy();
  });

  it('keeps an existing sort instead of adding the CreatedTime default', () => {
    const doc = createGridDatabaseDoc({ withCreatedTimeField: true });
    const database = getDatabase(doc);
    const view = database.get(YjsDatabaseKey.views).get('grid-view-id') as YDatabaseView;
    const sorts = new Y.Array();
    const existing = new Y.Map();

    existing.set(YjsDatabaseKey.id, 'existing');
    existing.set(YjsDatabaseKey.field_id, 'primary-field');
    existing.set(YjsDatabaseKey.condition, SortCondition.Ascending);
    sorts.push([existing]);
    view.set(YjsDatabaseKey.sorts, sorts);

    expect(ensureFeedDefaultSort(database, view)).toBe(false);
    expect(view.get(YjsDatabaseKey.sorts)).toHaveLength(1);
    expect(view.get(YjsDatabaseKey.sorts).get(0).get(YjsDatabaseKey.id)).toBe('existing');
  });

  it('finds the CreatedTime field following the view order', () => {
    const doc = createGridDatabaseDoc({ withCreatedTimeField: true });
    const database = getDatabase(doc);
    const view = database.get(YjsDatabaseKey.views).get('grid-view-id');

    expect(findCreatedTimeFieldId(database, view.get(YjsDatabaseKey.field_orders))).toBe('created-time-field');
    expect(findCreatedTimeFieldId(getDatabase(createGridDatabaseDoc()))).toBeUndefined();
  });

  it('falls back to the inline view when the preferred view has no field orders', () => {
    const doc = createGridDatabaseDoc();

    expect(normalizeCreatedDatabaseFeedView(doc, 'missing-view-id')).toBe('grid-view-id');
    expect(getDatabase(doc).get(YjsDatabaseKey.views).get('grid-view-id').get(YjsDatabaseKey.layout)).toBe(
      DatabaseViewLayout.Feed
    );
  });
});
