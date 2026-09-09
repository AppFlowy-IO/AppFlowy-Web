import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { DEFAULT_FIELD_WRAP } from '@/application/database-yjs/const';
import { FieldType, FieldVisibility, SortCondition } from '@/application/database-yjs/database.type';
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
  YDatabaseSort,
  YDatabaseSorts,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';
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

async function compensateCreatedFeedView(
  viewId: string,
  deletePage: (viewId: string) => Promise<void>,
  deleteTrash?: (viewId: string) => Promise<void>
): Promise<void> {
  try {
    await deletePage(viewId);
  } catch (error) {
    Log.warn('[Feed creation] failed to soft-delete a partially created view', { viewId, error });
  }

  if (!deleteTrash) return;

  try {
    await deleteTrash(viewId);
  } catch (error) {
    Log.warn('[Feed creation] failed to permanently delete a partially created view', { viewId, error });
  }
}

function removeCreatedFeedView(databaseDoc: YDoc, viewId: string): boolean {
  const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
  const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
  const views = database?.get(YjsDatabaseKey.views);

  if (!views?.has(viewId)) return false;

  databaseDoc.transact(() => {
    views.delete(viewId);
  }, 'removeCreatedFeedView');

  return true;
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

function releaseTemporarySyncOwner(
  databaseDoc: YDoc | null,
  scheduleDeferredCleanup: ((objectId: string, delayMs?: number) => void) | undefined
): void {
  if (!databaseDoc || !scheduleDeferredCleanup) return;

  try {
    scheduleDeferredCleanup(databaseDoc.guid);
  } catch (error) {
    Log.warn('[Feed creation] failed to release a temporary sync owner', {
      objectId: databaseDoc.guid,
      error,
    });
  }
}

/** Create, initialize, and durably persist a linked Feed view. */
export async function createLinkedDatabaseFeedView(params: {
  requestViewId: string;
  sourceViewId: string;
  payload: Omit<CreateDatabaseViewPayload, 'layout'>;
  createDatabaseView: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  loadView?: LoadView;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  deletePage?: (viewId: string) => Promise<void>;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
}): Promise<CreateDatabaseViewResponse> {
  const {
    bindViewSync,
    createDatabaseView,
    deletePage,
    loadView,
    payload,
    requestViewId,
    scheduleDeferredCleanup,
    sourceViewId,
  } = params;

  if (!loadView || !bindViewSync || !deletePage || !scheduleDeferredCleanup) {
    throw new Error('Linked Feed creation is not available right now');
  }

  let databaseDoc: YDoc | null = null;
  let syncOwnerDoc: YDoc | null = null;
  let response: CreateDatabaseViewResponse | null = null;
  let existingViewIds: Set<string> | null = null;
  let preRequestState: Uint8Array | null = null;

  try {
    databaseDoc = await loadView(sourceViewId, false, false, {
      databaseId: payload.database_id,
      forceFetch: true,
    });
    const syncContext = bindViewSync(databaseDoc);

    if (!syncContext) {
      throw new Error('The linked Feed could not be connected for persistence');
    }

    syncOwnerDoc = databaseDoc;
    const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
    const views = database?.get(YjsDatabaseKey.views);

    if (database?.get(YjsDatabaseKey.id) !== payload.database_id || !views?.has(sourceViewId)) {
      throw new Error('The source database is not available for linked Feed creation');
    }

    existingViewIds = new Set(views.keys());
    preRequestState = Y.encodeStateAsUpdate(databaseDoc);
    response = await createDatabaseView(requestViewId, {
      ...payload,
      layout: ViewLayout.Feed,
    });

    if (!response.view_id || response.database_id !== payload.database_id) {
      throw new Error('The server returned invalid metadata for the linked Feed');
    }

    if (!response.database_update?.length) {
      throw new Error('The server did not return the linked Feed database update');
    }

    if (
      !updateCreatesExactFeedView({
        databaseId: response.database_id,
        existingViewIds,
        preRequestState,
        update: response.database_update,
        viewId: response.view_id,
      })
    ) {
      throw new Error('The server did not return the linked Feed database view');
    }

    applyYDoc(databaseDoc, new Uint8Array(response.database_update));
    const updatedDatabase = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
    const createdView = updatedDatabase?.get(YjsDatabaseKey.views)?.get(response.view_id);

    if (!createdView?.get(YjsDatabaseKey.field_orders)) {
      throw new Error('The server did not return the linked Feed database view');
    }

    const normalizedViewId = normalizeCreatedDatabaseFeedView(databaseDoc, response.view_id);

    if (normalizedViewId !== response.view_id) {
      throw new Error('The linked database could not be initialized as a Feed');
    }

    if ((await syncContext.flush?.()) !== true) {
      throw new Error('The linked Feed could not be persisted');
    }

    return response;
  } catch (error) {
    if (response?.view_id && existingViewIds && !existingViewIds.has(response.view_id)) {
      if (databaseDoc) removeCreatedFeedView(databaseDoc, response.view_id);
      await compensateCreatedFeedView(response.view_id, deletePage);
    }

    throw error;
  } finally {
    releaseTemporarySyncOwner(syncOwnerDoc, scheduleDeferredCleanup);
  }
}

/**
 * Cloud standalone database creation is bootstrapped through Grid, then its
 * concrete view is replaced by a normalized Feed before navigation.
 */
export async function createDatabaseFeedPageViaGrid(params: {
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
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
}): Promise<CreatePageResponse> {
  const { deletePage, deleteTrash } = params;
  const scheduleDeferredCleanup = params.scheduleDeferredCleanup;

  if (!deletePage || !scheduleDeferredCleanup) throw new Error('Feed creation is not available right now');
  if (params.standalone && (!params.loadViewMeta || !params.createDatabaseView || !deleteTrash)) {
    throw new Error('Standalone Feed creation is not available right now');
  }

  const response = await params.addPage(params.parentViewId, {
    layout: ViewLayout.Grid,
    name: params.name,
    prev_view_id: params.prevViewId,
  });
  let syncOwnerDoc: YDoc | null = null;

  try {
    if (!response.database_id) throw new Error('The server did not return a database ID for the new Feed');

    if (params.standalone) {
      const loadViewMeta = params.loadViewMeta!;
      const createDatabaseView = params.createDatabaseView!;
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
      const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
      const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
      const existingViewIds = new Set(database?.get(YjsDatabaseKey.views)?.keys() ?? []);
      const syncContext = params.bindViewSync(databaseDoc);

      if (!syncContext) throw new Error('The new Feed database could not be connected for persistence');
      syncOwnerDoc = databaseDoc;

      const feedResponse = await createDatabaseView(gridViewId, {
        parent_view_id: response.view_id,
        prev_view_id: gridViewId,
        database_id: response.database_id,
        layout: ViewLayout.Feed,
        name: 'Feed',
        embedded: false,
      });

      if (feedResponse.view_id === gridViewId || feedResponse.database_id !== response.database_id) {
        throw new Error('The server returned invalid metadata for the new Feed view');
      }

      if (feedResponse.database_update?.length) {
        applyYDoc(databaseDoc, new Uint8Array(feedResponse.database_update));
      }

      const updatedDatabase = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
      const views = updatedDatabase?.get(YjsDatabaseKey.views);
      const metas = updatedDatabase?.get(YjsDatabaseKey.metas);
      const feedView = views?.get(feedResponse.view_id);

      if (
        !updatedDatabase ||
        !views ||
        !metas ||
        existingViewIds.has(feedResponse.view_id) ||
        !feedView?.get(YjsDatabaseKey.field_orders)
      ) {
        throw new Error('The server did not return the new Feed database view');
      }

      const normalizedViewId = normalizeCreatedDatabaseFeedView(databaseDoc, feedResponse.view_id, {
        name: 'Feed',
      });

      if (normalizedViewId !== feedResponse.view_id) {
        throw new Error('The new database could not be initialized as a Feed');
      }

      databaseDoc.transact(() => {
        metas.set(YjsDatabaseKey.iid, feedResponse.view_id);
      }, 'selectStandaloneFeedView');
      if ((await syncContext.flush?.()) !== true) {
        throw new Error('The new Feed database could not be persisted');
      }

      await deletePage(gridViewId);
      await deleteTrash!(gridViewId);
      databaseDoc.transact(() => views.delete(gridViewId), 'removeStandaloneFeedGridView');
      if ((await syncContext.flush?.()) !== true) {
        throw new Error('The temporary Grid cleanup could not be persisted');
      }

      return { ...response, view_id: feedResponse.view_id };
    }

    const createdViewId = response.view_id;

    const [databaseDoc] = await Promise.all([
      params.loadView(createdViewId, false, false, {
        databaseId: response.database_id,
        forceFetch: true,
      }),
      params.updatePage?.(createdViewId, { name: 'Feed' }) ?? Promise.resolve(),
    ]);
    const syncContext = params.bindViewSync(databaseDoc);

    if (!syncContext) throw new Error('The new embedded Feed could not be connected for persistence');
    syncOwnerDoc = databaseDoc;

    const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
    const createdView = database?.get(YjsDatabaseKey.views)?.get(createdViewId);

    if (!createdView?.get(YjsDatabaseKey.field_orders)) {
      throw new Error('The server did not return the embedded Feed database view');
    }

    const normalizedViewId = normalizeCreatedDatabaseFeedView(databaseDoc, createdViewId, { name: 'Feed' });

    if (normalizedViewId !== createdViewId) throw new Error('The new database could not be converted to Feed');
    void syncContext.flush?.();
    return { ...response, view_id: normalizedViewId };
  } catch (error) {
    await compensateCreatedFeedView(response.view_id, deletePage, params.standalone ? deleteTrash : undefined);
    throw error;
  } finally {
    releaseTemporarySyncOwner(syncOwnerDoc, scheduleDeferredCleanup);
  }
}
