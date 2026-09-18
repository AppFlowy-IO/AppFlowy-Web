import { initializeDashboardLayoutSetting } from '@/application/database-yjs/dashboard-layout';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import {
  CreateDatabaseViewPayload,
  CreateDatabaseViewResponse,
  CreatePageResponse,
  LoadView,
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

    return { ...response, view_id: dashboardResponse.view_id };
  } catch (error) {
    try {
      await params.deletePage(response.view_id);
    } catch (cleanupError) {
      Log.warn('[Dashboard creation] failed to remove the partially created database', {
        viewId: response.view_id,
        error: cleanupError,
      });
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
