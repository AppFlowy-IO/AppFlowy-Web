import * as Y from 'yjs';

import { DEFAULT_FIELD_WRAP } from '@/application/database-yjs/const';
import { FieldVisibility } from '@/application/database-yjs/database.type';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseFieldOrders,
  YDatabaseFieldSetting,
  YDatabaseFieldSettings,
  YDatabaseLayoutSettings,
  YDatabaseListLayoutSetting,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { Log } from '@/utils/log';

const LIST_DEFAULT_VISIBLE_FIELD_POSITION_COUNT = 3;

export function generateListFieldSettings(
  database: YDatabase,
  fieldOrders: YDatabaseFieldOrders
): YDatabaseFieldSettings {
  const fieldSettings = new Y.Map() as YDatabaseFieldSettings;
  const fields = database.get(YjsDatabaseKey.fields);

  if (!fields) return fieldSettings;

  const orderedFieldIds: string[] = [];
  const seenFieldIds = new Set<string>();

  fieldOrders.toArray().forEach(({ id }) => {
    if (!fields.has(id) || seenFieldIds.has(id)) return;

    seenFieldIds.add(id);
    orderedFieldIds.push(id);
  });

  fields.forEach((_, fieldId) => {
    if (seenFieldIds.has(fieldId)) return;

    seenFieldIds.add(fieldId);
    orderedFieldIds.push(fieldId);
  });

  // Desktop applies the List cutoff to each field's absolute ordered
  // position, while the primary field remains visible in every position.
  orderedFieldIds.forEach((fieldId, fieldIndex) => {
    const field = fields.get(fieldId);

    if (!field) return;

    const isPrimary = Boolean(field.get(YjsDatabaseKey.is_primary));
    const visible = isPrimary || fieldIndex < LIST_DEFAULT_VISIBLE_FIELD_POSITION_COUNT;
    const setting = new Y.Map() as YDatabaseFieldSetting;

    setting.set(YjsDatabaseKey.visibility, visible ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden);
    setting.set(YjsDatabaseKey.wrap, DEFAULT_FIELD_WRAP);
    fieldSettings.set(fieldId, setting);
  });

  return fieldSettings;
}

export function initializeListLayoutSetting(view: YDatabaseView): void {
  let layoutSettings = view.get(YjsDatabaseKey.layout_settings);

  if (!layoutSettings) {
    layoutSettings = new Y.Map() as YDatabaseLayoutSettings;
    view.set(YjsDatabaseKey.layout_settings, layoutSettings);
  }

  let listSetting = layoutSettings.get('4') as YDatabaseListLayoutSetting | undefined;

  if (!listSetting) {
    listSetting = new Y.Map() as YDatabaseListLayoutSetting;
    layoutSettings.set('4', listSetting);
  }

  if (listSetting.get(YjsDatabaseKey.display_mode) === undefined) {
    listSetting.set(YjsDatabaseKey.display_mode, 1);
  }

  if (listSetting.get(YjsDatabaseKey.visible_field_ids) === undefined) {
    listSetting.set(YjsDatabaseKey.visible_field_ids, []);
  }

  if (listSetting.get(YjsDatabaseKey.show_cover) === undefined) {
    listSetting.set(YjsDatabaseKey.show_cover, true);
  }

  if (listSetting.get(YjsDatabaseKey.show_icon) === undefined) {
    listSetting.set(YjsDatabaseKey.show_icon, true);
  }

  if (listSetting.get(YjsDatabaseKey.card_width) === undefined) {
    listSetting.set(YjsDatabaseKey.card_width, 0);
  }

  if (listSetting.get(YjsDatabaseKey.show_field_names) === undefined) {
    listSetting.set(YjsDatabaseKey.show_field_names, true);
  }
}

/**
 * Convert a freshly-created server view to Desktop-compatible List state.
 *
 * The current Cloud linked-view endpoint creates a List view with Grid field
 * settings, while standalone List creation is unsupported. Standalone Grid
 * creation returns its folder container ID, so the database inline-view
 * metadata is the authoritative route to the child view that must be
 * converted.
 */
export function normalizeCreatedDatabaseListView(
  databaseDoc: YDoc,
  preferredViewId: string,
  options: { name?: string } = {}
): string | null {
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);

  if (!database || !views) {
    Log.warn('[List creation] database payload is missing its database or views map', {
      hasDatabase: Boolean(database),
      hasViews: Boolean(views),
      preferredViewId,
    });
    return null;
  }

  let targetViewId = preferredViewId;
  let view = views.get(preferredViewId);

  if (!view?.get(YjsDatabaseKey.field_orders)) {
    const inlineViewId = database.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.iid);
    const inlineView = inlineViewId ? views.get(inlineViewId) : undefined;

    if (inlineView?.get(YjsDatabaseKey.field_orders)) {
      targetViewId = inlineViewId;
      view = inlineView;
    }
  }

  if (!view?.get(YjsDatabaseKey.field_orders)) {
    const convertibleViews = Array.from(views.entries()).filter(([, candidate]) =>
      Boolean(candidate.get(YjsDatabaseKey.field_orders))
    );

    // A standalone create can include a non-layout metadata entry alongside
    // its only real database view. Select by the field-order contract needed
    // below instead of relying on the raw Y.Map size.
    if (convertibleViews.length === 1) {
      [targetViewId, view] = convertibleViews[0];
    }
  }

  const fieldOrders = view?.get(YjsDatabaseKey.field_orders);

  if (!view || !fieldOrders) {
    Log.warn('[List creation] database payload has no convertible view', {
      availableViewIds: Array.from(views.keys()).join(','),
      hasFieldOrders: Boolean(fieldOrders),
      preferredViewId,
    });
    return null;
  }

  databaseDoc.transact(() => {
    const groups = view?.get(YjsDatabaseKey.groups);

    if (groups?.length) groups.delete(0, groups.length);
    view?.set(YjsDatabaseKey.field_settings, generateListFieldSettings(database, fieldOrders));
    initializeListLayoutSetting(view);
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.List);
    if (options.name) view?.set(YjsDatabaseKey.name, options.name);
  }, 'normalizeCreatedDatabaseListView');

  return targetViewId;
}

export function removeCreatedDatabaseView(databaseDoc: YDoc, viewId: string): boolean {
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);

  if (!views?.has(viewId)) return false;

  databaseDoc.transact(() => {
    views.delete(viewId);
  }, 'removeCreatedDatabaseView');

  return true;
}
