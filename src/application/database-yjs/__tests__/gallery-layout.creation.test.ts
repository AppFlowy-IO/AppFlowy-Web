import * as Y from 'yjs';

import {
  normalizeCreatedDatabaseGalleryView,
} from '@/application/database-yjs/gallery-layout';
import { FieldVisibility } from '@/application/database-yjs/database.type';
import {
  DatabaseViewLayout,
  GalleryCardPreview,
  GalleryCardSize,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';

function createGridDatabaseDoc(): YDoc {
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
  primaryField.set(YjsDatabaseKey.type, 0);
  secondaryField.set(YjsDatabaseKey.id, 'secondary-field');
  secondaryField.set(YjsDatabaseKey.is_primary, false);
  secondaryField.set(YjsDatabaseKey.type, 3);
  fields.set('primary-field', primaryField);
  fields.set('secondary-field', secondaryField);
  fieldOrders.push([{ id: 'primary-field' }, { id: 'secondary-field' }]);
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

describe('Gallery view normalization', () => {
  it('writes Flutter-compatible settings and shows only the primary field by default', () => {
    const doc = createGridDatabaseDoc();

    expect(normalizeCreatedDatabaseGalleryView(doc, 'grid-view-id', { name: 'Gallery' })).toBe('grid-view-id');

    const database = doc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase;
    const view = database.get(YjsDatabaseKey.views).get('grid-view-id');
    const fieldSettings = view.get(YjsDatabaseKey.field_settings);
    const gallery = view.get(YjsDatabaseKey.layout_settings).get('5');

    expect(view.get(YjsDatabaseKey.layout)).toBe(DatabaseViewLayout.Gallery);
    expect(view.get(YjsDatabaseKey.name)).toBe('Gallery');
    expect(view.get(YjsDatabaseKey.groups)).toHaveLength(0);
    expect(fieldSettings.get('primary-field').get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysShown);
    expect(fieldSettings.get('secondary-field').get(YjsDatabaseKey.visibility)).toBe(FieldVisibility.AlwaysHidden);
    expect(gallery.get(YjsDatabaseKey.show_cover)).toBe(true);
    expect(gallery.get(YjsDatabaseKey.fit_image)).toBe(false);
    expect(gallery.get(YjsDatabaseKey.card_size)).toBe(GalleryCardSize.Medium);
    expect(gallery.get(YjsDatabaseKey.card_preview)).toBe(GalleryCardPreview.PageCover);
    expect(gallery.get(YjsDatabaseKey.card_width)).toBe(0);
  });
});
