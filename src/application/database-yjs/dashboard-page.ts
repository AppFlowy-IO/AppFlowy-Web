import { seedDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import {
  copyDashboardLayoutSetting,
  duplicateDashboardOwnedWidgets,
} from '@/application/database-yjs/dashboard-owned-view-ops';
import { markDashboardCreatedThisSession } from '@/application/database-yjs/dashboard-session';
import { getDatabaseFromDoc } from '@/application/database-yjs/database-view-doc-ops';
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
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
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

    const existingViewIds = new Set(getDatabaseFromDoc(databaseDoc)?.get(YjsDatabaseKey.views)?.keys() ?? []);

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

    const dashboardView = getDatabaseFromDoc(databaseDoc)?.get(YjsDatabaseKey.views)?.get(dashboardResponse.view_id);

    if (!dashboardView) throw new Error('The server did not return the new Dashboard view');

    // The server writes no dashboard settings; seed the empty rows / global
    // filters so every reader sees a stable shape from the first render.
    seedDashboardLayoutSetting(databaseDoc, dashboardView);
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

/** What both linked Dashboard creations need. */
export interface LinkedDashboardViewParams {
  requestViewId: string;
  payload: Omit<CreateDatabaseViewPayload, 'layout'>;
  createDatabaseView: (viewId: string, payload: CreateDatabaseViewPayload) => Promise<CreateDatabaseViewResponse>;
  bindViewSync?: BindViewSync;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
}

/**
 * Open the database of a just-created linked Dashboard view with a retained
 * sync owner, apply the server's update and run `write` on the new view. A
 * retained owner persists the write whether or not the database is already
 * open elsewhere; releasing it drops only this reference.
 */
async function writeLinkedDashboardView(
  response: CreateDatabaseViewResponse,
  params: Pick<LinkedDashboardViewParams, 'payload' | 'bindViewSync' | 'scheduleDeferredCleanup'> & {
    loadView: LoadView;
  },
  write: (databaseDoc: YDoc, dashboardView: YDatabaseView) => void | Promise<void>
) {
  const { bindViewSync, loadView, scheduleDeferredCleanup } = params;
  const databaseDoc = await loadView(response.view_id, false, false, {
    databaseId: response.database_id || params.payload.database_id,
  });
  const syncContext = scheduleDeferredCleanup ? bindViewSync?.(databaseDoc, { retain: true }) ?? null : null;

  try {
    if (response.database_update?.length) {
      applyYDoc(databaseDoc, new Uint8Array(response.database_update));
    }

    const dashboardView = getDatabaseFromDoc(databaseDoc)?.get(YjsDatabaseKey.views)?.get(response.view_id);

    if (!dashboardView) throw new Error('The linked Dashboard view is not in the database');

    try {
      await write(databaseDoc, dashboardView);
    } finally {
      // Persist what the write left: the seed, the copy, or the removal of a failed copy.
      void syncContext?.flush?.();
    }
  } finally {
    if (syncContext && scheduleDeferredCleanup) scheduleDeferredCleanup(syncContext.doc.guid);
  }
}

/**
 * A new linked Dashboard view of an existing database (the `/linked`
 * dashboard slash command). It starts empty.
 *
 * Desktop seeds every linked Dashboard view (`resolve_linked_view_layout_deps`)
 * and the server seeds none, so seed the empty rows / global filters here as the
 * tab bar's "+" and `/dashboard` do. The server has already created the view, so
 * a failed seed is logged rather than thrown: readers tolerate a missing setting.
 */
export async function createLinkedDatabaseDashboardView(
  params: LinkedDashboardViewParams & { loadView?: LoadView }
): Promise<CreateDatabaseViewResponse> {
  const { loadView } = params;
  const response = await params.createDatabaseView(params.requestViewId, {
    ...params.payload,
    layout: ViewLayout.Dashboard,
  });

  if (loadView && response.view_id) {
    try {
      await writeLinkedDashboardView(response, { ...params, loadView }, seedDashboardLayoutSetting);
    } catch (error) {
      Log.warn('[Dashboard creation] failed to seed the linked dashboard setting', {
        viewId: response.view_id,
        error,
      });
    }
  }

  // R-MODE: a dashboard created here opens in Edit mode on its first load.
  if (response.view_id) markDashboardCreatedThisSession(response.view_id);
  return response;
}

/**
 * The linked Dashboard view of a duplicated block: the new dashboard copies
 * the whole layout setting of `sourceViewId` and gets its own copies of the
 * views the source's widgets own (WP05 §1.7). The copy either succeeds
 * completely or the new view is removed and the error rethrown: no partial
 * dashboards. That guarantee is why every dependency is required here.
 *
 * R-MODE: a duplicate is not marked as created in this session (desktop skips
 * `source_view_id` creations too): it opens like any existing dashboard.
 */
export async function duplicateLinkedDatabaseDashboardView(
  params: LinkedDashboardViewParams & {
    /** The dashboard view the duplicated block shows. */
    sourceViewId: string;
    loadView: LoadView;
    loadViewMeta: LoadViewMeta;
    updatePage: (viewId: string, payload: UpdatePagePayload) => Promise<void>;
    deletePage: (viewId: string) => Promise<void>;
  }
): Promise<CreateDatabaseViewResponse> {
  const { bindViewSync, createDatabaseView, deletePage, loadView, loadViewMeta, scheduleDeferredCleanup, sourceViewId } =
    params;
  const response = await createDatabaseView(params.requestViewId, {
    ...params.payload,
    layout: ViewLayout.Dashboard,
  });

  try {
    if (!response.view_id) throw new Error('The linked dashboard could not be duplicated right now');

    await writeLinkedDashboardView(response, params, async (databaseDoc, dashboardView) => {
      try {
        if (!copyDashboardLayoutSetting(databaseDoc, sourceViewId, response.view_id)) {
          seedDashboardLayoutSetting(databaseDoc, dashboardView);
        }

        await duplicateDashboardOwnedWidgets(
          {
            databaseDoc,
            databasePageId: response.view_id,
            activeViewId: response.view_id,
            createDatabaseView,
            deletePage,
            loadViewMeta,
            updatePage: params.updatePage,
            loadView,
            bindViewSync,
            scheduleDeferredCleanup,
          },
          { sourceDashboardViewId: sourceViewId, targetDashboardViewId: response.view_id }
        );
      } catch (error) {
        removeCreatedDatabaseView(databaseDoc, response.view_id);
        throw error;
      }
    });
  } catch (error) {
    if (response.view_id) {
      try {
        await deletePage(response.view_id);
      } catch (cleanupError) {
        Log.warn('[Dashboard creation] failed to remove a partially duplicated dashboard', {
          viewId: response.view_id,
          error: cleanupError,
        });
      }
    }

    throw error;
  }

  return response;
}
