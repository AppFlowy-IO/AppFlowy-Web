import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { DEFAULT_FIELD_WRAP } from '@/application/database-yjs/const';
import { FieldType, FieldVisibility, SortCondition } from '@/application/database-yjs/database.type';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseFieldOrders,
  YDatabaseFieldSetting,
  YDatabaseFieldSettings,
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { Log } from '@/utils/log';

/**
 * Desktop parity for `layout_deps.rs`: a Feed view shows only the primary
 * field by default (the same projection as Gallery).
 */
export function generateFeedFieldSettings(
  database: YDatabase,
  fieldOrders: YDatabaseFieldOrders
): YDatabaseFieldSettings {
  const fieldSettings = new Y.Map() as YDatabaseFieldSettings;
  const fields = database.get(YjsDatabaseKey.fields);

  if (!fields) return fieldSettings;

  const orderedFieldIds: string[] = [];
  const seen = new Set<string>();

  fieldOrders.toArray().forEach(({ id }) => {
    if (!fields.has(id) || seen.has(id)) return;
    seen.add(id);
    orderedFieldIds.push(id);
  });
  fields.forEach((_, id) => {
    if (seen.has(id)) return;
    seen.add(id);
    orderedFieldIds.push(id);
  });

  orderedFieldIds.forEach((fieldId) => {
    const field = fields.get(fieldId);

    if (!field) return;

    const setting = new Y.Map() as YDatabaseFieldSetting;

    setting.set(
      YjsDatabaseKey.visibility,
      field.get(YjsDatabaseKey.is_primary) ? FieldVisibility.AlwaysShown : FieldVisibility.AlwaysHidden
    );
    setting.set(YjsDatabaseKey.wrap, DEFAULT_FIELD_WRAP);
    fieldSettings.set(fieldId, setting);
  });

  return fieldSettings;
}

/** Find the first CreatedTime field in the view's order, matching Desktop's lookup. */
export function findCreatedTimeFieldId(database: YDatabase, fieldOrders?: YDatabaseFieldOrders): string | undefined {
  const fields = database.get(YjsDatabaseKey.fields);

  if (!fields) return undefined;

  const candidateIds: string[] = [];
  const seen = new Set<string>();

  fieldOrders?.toArray().forEach(({ id }) => {
    if (seen.has(id)) return;
    seen.add(id);
    candidateIds.push(id);
  });
  fields.forEach((_, id) => {
    if (seen.has(id)) return;
    seen.add(id);
    candidateIds.push(id);
  });

  return candidateIds.find((fieldId) => {
    const field = fields.get(fieldId);

    return field !== undefined && Number(field.get(YjsDatabaseKey.type)) === FieldType.CreatedTime;
  });
}

/**
 * Desktop creates a persisted CreatedTime-descending sort for a new Feed view
 * whenever the database has a CreatedTime field. Views without that field
 * fall back to the renderer's in-memory newest-first ordering.
 *
 * Returns true when a sort was written.
 */
export function ensureFeedDefaultSort(database: YDatabase, view: YDatabaseView): boolean {
  const existingSorts = view.get(YjsDatabaseKey.sorts);

  if (existingSorts && existingSorts.length > 0) return false;

  const createdTimeFieldId = findCreatedTimeFieldId(database, view.get(YjsDatabaseKey.field_orders));

  if (!createdTimeFieldId) return false;

  let sorts = existingSorts;

  if (!sorts) {
    sorts = new Y.Array() as YDatabaseSorts;
    view.set(YjsDatabaseKey.sorts, sorts);
  }

  const sort = new Y.Map() as YDatabaseSort;

  sort.set(YjsDatabaseKey.id, nanoid(6));
  sort.set(YjsDatabaseKey.field_id, createdTimeFieldId);
  sort.set(YjsDatabaseKey.condition, SortCondition.Descending);
  sorts.push([sort]);

  return true;
}

/** Normalize the exact view returned by Cloud into Desktop-compatible Feed state. */
export function normalizeCreatedDatabaseFeedView(
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

  if (!view?.get(YjsDatabaseKey.field_orders)) {
    const inlineViewId = database.get(YjsDatabaseKey.metas)?.get(YjsDatabaseKey.iid);
    const inlineView = inlineViewId ? views.get(inlineViewId) : undefined;

    if (inlineView?.get(YjsDatabaseKey.field_orders)) {
      targetViewId = inlineViewId;
      view = inlineView;
    }
  }

  const fieldOrders = view?.get(YjsDatabaseKey.field_orders);

  if (!view || !fieldOrders) {
    Log.warn('[Feed creation] database payload has no convertible view', {
      preferredViewId,
      availableViewIds: Array.from(views.keys()).join(','),
    });
    return null;
  }

  databaseDoc.transact(() => {
    const groups = view?.get(YjsDatabaseKey.groups);

    if (groups?.length) groups.delete(0, groups.length);
    view?.set(YjsDatabaseKey.field_settings, generateFeedFieldSettings(database, fieldOrders));
    if (view) ensureFeedDefaultSort(database, view);
    view?.set(YjsDatabaseKey.layout, DatabaseViewLayout.Feed);
    if (options.name) view?.set(YjsDatabaseKey.name, options.name);
  }, 'normalizeCreatedDatabaseFeedView');

  return targetViewId;
}

export function updateCreatesExactFeedView(params: {
  databaseId: string;
  existingViewIds: ReadonlySet<string>;
  preRequestState: Uint8Array;
  update: number[];
  viewId: string;
}): boolean {
  if (params.existingViewIds.has(params.viewId)) return false;

  const validationDoc = new Y.Doc();

  try {
    Y.applyUpdate(validationDoc, params.preRequestState);
    Y.applyUpdate(validationDoc, new Uint8Array(params.update));

    const sharedRoot = validationDoc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
    const view = database?.get(YjsDatabaseKey.views)?.get(params.viewId);

    return database?.get(YjsDatabaseKey.id) === params.databaseId && Boolean(view?.get(YjsDatabaseKey.field_orders));
  } catch (error) {
    Log.warn('[Feed creation] failed to validate the Feed update', {
      viewId: params.viewId,
      error,
    });
    return false;
  } finally {
    validationDoc.destroy();
  }
}
