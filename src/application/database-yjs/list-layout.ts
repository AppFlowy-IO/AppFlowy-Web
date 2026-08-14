import * as Y from 'yjs';

import { DEFAULT_FIELD_WRAP } from '@/application/database-yjs/const';
import { FieldVisibility } from '@/application/database-yjs/database.type';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreatePageResponse,
  DatabaseViewLayout,
  LoadView,
  ViewLayout,
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
 * settings, while standalone List creation is unsupported. A standalone Grid
 * fallback contains exactly one database view, so a container ID can safely
 * resolve to that sole view.
 */
export function normalizeCreatedDatabaseListView(
  databaseDoc: YDoc,
  preferredViewId: string,
  options: { name?: string } = {}
): string | null {
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);

  if (!database || !views) return null;

  let targetViewId = preferredViewId;
  let view = views.get(preferredViewId);

  if (!view && views.size === 1) {
    views.forEach((candidate, viewId) => {
      targetViewId = viewId;
      view = candidate;
    });
  }

  const fieldOrders = view?.get(YjsDatabaseKey.field_orders);

  if (!view || !fieldOrders) return null;

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

export async function createDatabaseListPageViaGrid(params: {
  parentViewId: string;
  name?: string;
  prevViewId?: string;
  addPage: (
    parentId: string,
    payload: { layout: ViewLayout; name?: string; prev_view_id?: string }
  ) => Promise<CreatePageResponse>;
  loadView: LoadView;
  bindViewSync: (doc: YDoc) => SyncContext | null;
}): Promise<CreatePageResponse> {
  // AppFlowy Cloud currently rejects standalone List payloads. Grid creates
  // the same database schema and can be converted before the page is opened.
  const response = await params.addPage(params.parentViewId, {
    layout: ViewLayout.Grid,
    name: params.name,
    prev_view_id: params.prevViewId,
  });

  if (!response.database_id) {
    throw new Error('The server did not return a database ID for the new List');
  }

  const databaseDoc = await params.loadView(response.view_id, false, false, {
    databaseId: response.database_id,
    forceFetch: true,
  });
  const syncContext = params.bindViewSync(databaseDoc);
  const normalizedViewId = normalizeCreatedDatabaseListView(databaseDoc, response.view_id, { name: 'List' });

  if (!normalizedViewId) {
    throw new Error('The new database could not be converted to List');
  }

  // The outbox keeps the conversion durable if the socket is reconnecting.
  void syncContext?.flush?.();
  return response;
}
