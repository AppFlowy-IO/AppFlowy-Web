import { initializeDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import {
  copyDashboardLayoutSetting,
  duplicateDashboardOwnedWidgets,
} from '@/application/database-yjs/dashboard-owned-view-ops';
import { markDashboardCreatedThisSession } from '@/application/database-yjs/dashboard-session';
import { removeCreatedDatabaseView } from '@/application/database-yjs/list-layout';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  BindViewSync,
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreatePageResponse,
  LoadView,
  LoadViewMeta,
  UpdatePagePayload,
  ViewLayout,
  YDatabase,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { applyYDoc } from '@/application/ydoc/apply';
import { Log } from '@/utils/log';

export const NEW_DASHBOARD_VIEW_NAME = 'Dashboard';

/**
 * `/dashboard` in a document: a new database whose first tab is a dashboard.
 *
 * The server does not create a page as a dashboard (a dashboard is always a
 * view of an existing database), so this creates the document's embedded
 * Grid first and then adds a Dashboard view next to it, exactly as the tab
 * bar's "+" does. The returned `view_id` is the dashboard's, so the document
 * block shows the dashboard; the Grid stays as its data tab.
 */
export async function createDatabaseDashboardPageViaGrid(params: {
  parentViewId: string;
  name?: string;
  prevViewId?: string;
  addPage: (
    parentId: string,
    payload: { layout: ViewLayout; name?: string; prev_view_id?: string }
  ) => Promise<CreatePageResponse>;
  loadView: LoadView;
  bindViewSync: (doc: YDoc) => SyncContext | null;
  createDatabaseView: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  deletePage: (viewId: string) => Promise<void>;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
}): Promise<CreatePageResponse> {
  const response = await params.addPage(params.parentViewId, {
    layout: ViewLayout.Grid,
    name: params.name,
    prev_view_id: params.prevViewId,
  });
  let syncOwnerDoc: YDoc | null = null;
  // The dashboard tab is a sibling page of the grid under the document, so a
  // failure after it exists must remove it as well.
  let createdDashboardViewId: string | null = null;

  try {
    if (!response.database_id) throw new Error('The server did not return a database ID for the new dashboard');

    const gridViewId = response.view_id;
    const databaseDoc = await params.loadView(gridViewId, false, false, {
      databaseId: response.database_id,
      forceFetch: true,
    });
    const syncContext = params.bindViewSync(databaseDoc);

    if (!syncContext) throw new Error('The new dashboard database could not be connected for persistence');
    syncOwnerDoc = databaseDoc;

    const sharedRoot = databaseDoc.getMap(YjsEditorKey.data_section);
    const database = sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined;
    const existingViewIds = new Set(database?.get(YjsDatabaseKey.views)?.keys() ?? []);

    // An embedded database without a container attaches its tabs under the document.
    const dashboardResponse = await params.createDatabaseView(gridViewId, {
      parent_view_id: params.parentViewId,
      prev_view_id: gridViewId,
      database_id: response.database_id,
      layout: ViewLayout.Dashboard,
      name: NEW_DASHBOARD_VIEW_NAME,
      embedded: true,
    });

    if (dashboardResponse.view_id && dashboardResponse.view_id !== gridViewId) {
      createdDashboardViewId = dashboardResponse.view_id;
    }

    if (
      !dashboardResponse.view_id ||
      existingViewIds.has(dashboardResponse.view_id) ||
      dashboardResponse.database_id !== response.database_id
    ) {
      throw new Error('The server returned invalid metadata for the new Dashboard view');
    }

    if (dashboardResponse.database_update?.length) {
      applyYDoc(databaseDoc, new Uint8Array(dashboardResponse.database_update));
    }

    const dashboardView = (sharedRoot.get(YjsEditorKey.database) as YDatabase | undefined)
      ?.get(YjsDatabaseKey.views)
      ?.get(dashboardResponse.view_id);

    if (!dashboardView) throw new Error('The server did not return the new Dashboard view');

    // The server writes no dashboard settings; seed the empty rows / global
    // filters so every reader sees a stable shape from the first render.
    databaseDoc.transact(() => initializeDashboardLayoutSetting(dashboardView), 'initializeDashboardLayout');
    void syncContext.flush?.();
    // R-MODE: a dashboard created here opens in Edit mode on its first load.
    markDashboardCreatedThisSession(dashboardResponse.view_id);

    return { ...response, view_id: dashboardResponse.view_id };
  } catch (error) {
    const partial = createdDashboardViewId ? [createdDashboardViewId, response.view_id] : [response.view_id];

    for (const viewId of partial) {
      try {
        await params.deletePage(viewId);
      } catch (cleanupError) {
        Log.warn('[Dashboard creation] failed to remove a partially created page', { viewId, error: cleanupError });
      }
    }

    throw error;
  } finally {
    if (syncOwnerDoc && params.scheduleDeferredCleanup) {
      try {
        params.scheduleDeferredCleanup(syncOwnerDoc.guid);
      } catch (cleanupError) {
        Log.warn('[Dashboard creation] failed to release a temporary sync owner', {
          objectId: syncOwnerDoc.guid,
          error: cleanupError,
        });
      }
    }
  }
}

/**
 * A linked Dashboard view of an existing database: the `/linked` dashboard
 * slash command and a duplicated linked dashboard block.
 *
 * Desktop seeds every linked Dashboard view (`resolve_linked_view_layout_deps`)
 * and the server seeds none, so seed the empty rows / global filters here as the
 * tab bar's "+" and `/dashboard` do. The server has already created the view, so
 * a failed seed is logged rather than thrown: readers tolerate a missing setting.
 *
 * With `sourceViewId` (a duplicated block) the new dashboard instead copies the
 * source's whole layout setting and gets its own copies of the views the
 * source's widgets own (WP05 §1.7). That copy either succeeds completely or the
 * new view is removed and the error rethrown: no partial dashboards.
 */
export async function createLinkedDatabaseDashboardView(params: {
  requestViewId: string;
  payload: Omit<CreateDatabaseViewPayload, 'layout'>;
  createDatabaseView: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  loadView?: LoadView;
  bindViewSync?: BindViewSync;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
  /** The dashboard view a duplicated block copies. */
  sourceViewId?: string;
  loadViewMeta?: LoadViewMeta;
  updatePage?: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
  deletePage?: (viewId: string) => Promise<void>;
}): Promise<CreateDatabaseViewResponse> {
  const response = await params.createDatabaseView(params.requestViewId, {
    ...params.payload,
    layout: ViewLayout.Dashboard,
  });

  try {
    await seedLinkedDashboardView(response, params);
  } catch (error) {
    if (params.sourceViewId) {
      if (response.view_id) {
        try {
          await params.deletePage?.(response.view_id);
        } catch (cleanupError) {
          Log.warn('[Dashboard creation] failed to remove a partially duplicated dashboard', {
            viewId: response.view_id,
            error: cleanupError,
          });
        }
      }

      throw error;
    }

    Log.warn('[Dashboard creation] failed to seed the linked dashboard setting', {
      viewId: response.view_id,
      error,
    });
  }

  // R-MODE: a dashboard created here opens in Edit mode on its first load. A
  // duplicate is not marked (desktop skips `source_view_id` creations too): it
  // opens like any existing dashboard.
  if (response.view_id && !params.sourceViewId) markDashboardCreatedThisSession(response.view_id);
  return response;
}

async function seedLinkedDashboardView(
  response: CreateDatabaseViewResponse,
  params: Parameters<typeof createLinkedDatabaseDashboardView>[0]
) {
  const { bindViewSync, loadView, scheduleDeferredCleanup, sourceViewId } = params;

  if (sourceViewId && (!loadView || !response.view_id)) {
    throw new Error('The linked dashboard could not be duplicated right now');
  }

  if (!loadView || !response.view_id) return;

  const databaseDoc = await loadView(response.view_id, false, false, {
    databaseId: response.database_id || params.payload.database_id,
  });
  // A retained owner persists the seed whether or not the database is already
  // open elsewhere, and releasing it drops only this reference.
  const syncContext = scheduleDeferredCleanup ? bindViewSync?.(databaseDoc, { retain: true }) ?? null : null;

  try {
    if (response.database_update?.length) {
      applyYDoc(databaseDoc, new Uint8Array(response.database_update));
    }

    const dashboardView = (databaseDoc.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as
      | YDatabase
      | undefined)
      ?.get(YjsDatabaseKey.views)
      ?.get(response.view_id);

    if (!dashboardView) throw new Error('The linked Dashboard view is not in the database');

    if (sourceViewId) {
      try {
        if (!copyDashboardLayoutSetting(databaseDoc, sourceViewId, response.view_id)) {
          databaseDoc.transact(() => initializeDashboardLayoutSetting(dashboardView), 'initializeDashboardLayout');
        }

        await duplicateDashboardOwnedWidgets(
          {
            databaseDoc,
            databasePageId: response.view_id,
            activeViewId: response.view_id,
            createDatabaseView: params.createDatabaseView,
            deletePage: params.deletePage,
            loadViewMeta: params.loadViewMeta,
            updatePage: params.updatePage,
            loadView,
            bindViewSync,
            scheduleDeferredCleanup,
          },
          { sourceDashboardViewId: sourceViewId, targetDashboardViewId: response.view_id }
        );
      } catch (error) {
        removeCreatedDatabaseView(databaseDoc, response.view_id);
        void syncContext?.flush?.();
        throw error;
      }
    } else {
      databaseDoc.transact(() => initializeDashboardLayoutSetting(dashboardView), 'initializeDashboardLayout');
    }

    void syncContext?.flush?.();
  } finally {
    if (syncContext && scheduleDeferredCleanup) scheduleDeferredCleanup(syncContext.doc.guid);
  }
}
