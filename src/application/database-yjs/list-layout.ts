import * as Y from 'yjs';

import { DEFAULT_FIELD_WRAP } from '@/application/database-yjs/const';
import { FieldVisibility } from '@/application/database-yjs/database.type';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreatePageResponse,
  DatabaseViewLayout,
  LoadView,
  LoadViewMeta,
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
import { applyYDoc } from '@/application/ydoc/apply';
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

async function compensateCreatedListView(
  viewId: string,
  deletePage: (viewId: string) => Promise<void>,
  deleteTrash?: (viewId: string) => Promise<void>
): Promise<void> {
  try {
    await deletePage(viewId);
  } catch (error) {
    Log.warn('[List creation] failed to soft-delete a partially created view', { viewId, error });
  }

  if (!deleteTrash) return;

  try {
    await deleteTrash(viewId);
  } catch (error) {
    Log.warn('[List creation] failed to permanently delete a partially created view', { viewId, error });
  }
}

/**
 * Create and durably initialize a linked List view.
 *
 * Cloud creates the folder child and returns the matching Yjs update in one
 * response. The editor block must not reference that child until the update is
 * applied, the exact returned view is normalized, and the local normalization
 * has drained through the sync outbox. If any post-create stage fails, remove
 * only the child returned by this request.
 */
export async function createLinkedDatabaseListView(params: {
  requestViewId: string;
  payload: Omit<CreateDatabaseViewPayload, 'layout'>;
  createDatabaseView: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  loadView?: LoadView;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  deletePage?: (viewId: string) => Promise<void>;
}): Promise<CreateDatabaseViewResponse> {
  const { bindViewSync, createDatabaseView, deletePage, loadView, payload, requestViewId } = params;

  // These capabilities are all required after Cloud creates the child. Check
  // them first so an unavailable editor context cannot leak a server object.
  if (!loadView || !bindViewSync || !deletePage) {
    throw new Error('Linked List creation is not available right now');
  }

  const response = await createDatabaseView(requestViewId, {
    ...payload,
    layout: ViewLayout.List,
  });

  try {
    if (!response.view_id || response.database_id !== payload.database_id) {
      throw new Error('The server returned invalid metadata for the linked List');
    }

    if (!response.database_update?.length) {
      throw new Error('The server did not return the linked List database update');
    }

    const databaseDoc = await loadView(response.view_id, false, false, {
      databaseId: response.database_id,
    });

    applyYDoc(databaseDoc, new Uint8Array(response.database_update));

    // Do not let the normalizer's standalone fallback select an existing view
    // when the linked-view update did not actually contain the returned child.
    const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
    const createdView = database?.get(YjsDatabaseKey.views)?.get(response.view_id);

    if (!createdView?.get(YjsDatabaseKey.field_orders)) {
      throw new Error('The server did not return the linked List database view');
    }

    const syncContext = bindViewSync(databaseDoc);

    if (!syncContext) {
      throw new Error('The linked List could not be connected for persistence');
    }

    const normalizedViewId = normalizeCreatedDatabaseListView(databaseDoc, response.view_id);

    if (normalizedViewId !== response.view_id) {
      throw new Error('The linked database could not be initialized as a List');
    }

    if ((await syncContext.flush?.()) !== true) {
      throw new Error('The linked List could not be persisted');
    }

    return response;
  } catch (error) {
    // `response.view_id` is the only child authorized for rollback by this
    // operation. Preserve the core error if the best-effort cleanup fails.
    if (response.view_id) {
      await compensateCreatedListView(response.view_id, deletePage);
    }

    throw error;
  }
}

export async function createDatabaseListPageViaGrid(params: {
  parentViewId: string;
  name?: string;
  prevViewId?: string;
  standalone?: boolean;
  addPage: (
    parentId: string,
    payload: { layout: ViewLayout; name?: string; prev_view_id?: string }
  ) => Promise<CreatePageResponse>;
  loadViewMeta?: LoadViewMeta;
  loadView: LoadView;
  bindViewSync: (doc: YDoc) => SyncContext | null;
  createDatabaseView?: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  deletePage?: (viewId: string) => Promise<void>;
  deleteTrash?: (viewId: string) => Promise<void>;
  updatePage?: (viewId: string, payload: { name: string }) => Promise<void>;
}): Promise<CreatePageResponse> {
  const deletePage = params.deletePage;
  const deleteTrash = params.deleteTrash;

  // Validate every capability needed for compensation before creating any
  // server object. Standalone creation additionally needs the linked-view and
  // permanent-delete APIs for its two-phase Grid replacement.
  if (!deletePage) {
    throw new Error('List creation is not available right now');
  }

  if (params.standalone && (!params.loadViewMeta || !params.createDatabaseView || !deleteTrash)) {
    throw new Error('Standalone List creation is not available right now');
  }

  // AppFlowy Cloud currently rejects standalone List payloads. Grid creates
  // the same database schema and can be converted before the page is opened.
  const response = await params.addPage(params.parentViewId, {
    layout: ViewLayout.Grid,
    name: params.name,
    prev_view_id: params.prevViewId,
  });

  try {
    if (!response.database_id) {
      throw new Error('The server did not return a database ID for the new List');
    }

    if (params.standalone) {
      // The standalone capability guard above narrows these for the complete
      // operation. Capture them once so no asynchronous stage can silently
      // fall back to a partial conversion.
      const loadViewMeta = params.loadViewMeta!;
      const createDatabaseView = params.createDatabaseView!;

      // Standalone Grid creation returns a database container with one concrete
      // Grid child. Use that authorized child route to load the database, then
      // ask Cloud to create an actual List linked view under the same container.
      const createdViewMeta = await loadViewMeta(response.view_id).catch(() => null);
      const createdChildren = createdViewMeta?.children ?? [];

      if (createdChildren.length !== 1 || createdChildren[0].layout !== ViewLayout.Grid) {
        throw new Error('The new database container did not contain exactly one Grid view');
      }

      const gridViewId = createdChildren[0].view_id;
      const databaseDoc = await params.loadView(gridViewId, false, false, {
        databaseId: response.database_id,
        forceFetch: true,
      });
      const syncContext = params.bindViewSync(databaseDoc);

      if (!syncContext) {
        throw new Error('The new List database could not be connected for persistence');
      }

      const listResponse = await createDatabaseView(gridViewId, {
        parent_view_id: response.view_id,
        prev_view_id: gridViewId,
        database_id: response.database_id,
        layout: ViewLayout.List,
        name: 'List',
        embedded: false,
      });

      if (listResponse.view_id === gridViewId || listResponse.database_id !== response.database_id) {
        throw new Error('The server returned invalid metadata for the new List view');
      }

      if (listResponse.database_update?.length) {
        // The linked-view API commits this update before responding. Apply it
        // as remote state; the two local stages below are then independently
        // persisted and confirmed.
        applyYDoc(databaseDoc, new Uint8Array(listResponse.database_update));
      }

      const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
      const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
      const views = database?.get(YjsDatabaseKey.views);
      const metas = database?.get(YjsDatabaseKey.metas);
      const listView = views?.get(listResponse.view_id);

      if (!database || !views || !metas || !listView?.get(YjsDatabaseKey.field_orders)) {
        throw new Error('The server did not return the new List database view');
      }

      // Stage 1: initialize and select the List while retaining the complete
      // Grid view as a coherent fallback. No folder entry is removed until this
      // state is confirmed by the sync outbox.
      const normalizedViewId = normalizeCreatedDatabaseListView(databaseDoc, listResponse.view_id, { name: 'List' });

      if (normalizedViewId !== listResponse.view_id) {
        throw new Error('The new database could not be initialized as a List');
      }

      databaseDoc.transact(() => {
        metas.set(YjsDatabaseKey.iid, listResponse.view_id);
      }, 'selectStandaloneListView');

      if ((await syncContext.flush?.()) !== true) {
        throw new Error('The new List database could not be persisted');
      }

      // Stage 2: remove only the resolved implementation-created Grid folder
      // child, then its Y-view, and confirm that final deletion before success.
      await deletePage(gridViewId);
      await deleteTrash!(gridViewId);
      databaseDoc.transact(() => {
        views.delete(gridViewId);
      }, 'removeStandaloneGridView');

      if ((await syncContext.flush?.()) !== true) {
        throw new Error('The temporary Grid cleanup could not be persisted');
      }

      Log.debug('[List creation] created standalone List database view', {
        containerViewId: response.view_id,
        databaseId: response.database_id,
        removedGridViewId: gridViewId,
        listViewId: listResponse.view_id,
      });

      return { ...response, view_id: listResponse.view_id };
    }

    const createdViewId = response.view_id;

    // Embedded creation already returns the concrete child. Keep its folder
    // label aligned with the converted collab view; there is no container child
    // to replace in this path.
    await params.updatePage?.(createdViewId, { name: 'List' });

    const databaseDoc = await params.loadView(createdViewId, false, false, {
      databaseId: response.database_id,
      forceFetch: true,
    });
    const syncContext = params.bindViewSync(databaseDoc);

    if (!syncContext) {
      throw new Error('The new embedded List could not be connected for persistence');
    }

    const normalizedViewId = normalizeCreatedDatabaseListView(databaseDoc, createdViewId, { name: 'List' });

    if (!normalizedViewId) {
      throw new Error('The new database could not be converted to List');
    }

    Log.debug('[List creation] normalized embedded database view', {
      databaseViewId: response.view_id,
      databaseId: response.database_id,
      normalizedViewId,
    });

    // The durable outbox owns delivery if the socket is reconnecting.
    void syncContext.flush?.();
    return { ...response, view_id: normalizedViewId };
  } catch (error) {
    // Standalone compensation removes only the exact container returned by
    // this addPage call, including its operation-created descendants. Embedded
    // compensation is intentionally recoverable and soft-deletes only the exact
    // child returned by addPage.
    await compensateCreatedListView(response.view_id, deletePage, params.standalone ? deleteTrash : undefined);
    throw error;
  }
}
