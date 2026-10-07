import * as liveRegion from '@atlaskit/pragmatic-drag-and-drop-live-region';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useDatabaseContext } from '@/application/database-yjs';
import {
  duplicateDashboardWidget,
  findDashboardWidget,
  observeLocalDashboardRowsChanges,
  readStoredDashboardWidgets,
} from '@/application/database-yjs/dashboard-layout';
import {
  createOwnedDatabaseView,
  DashboardOwnedViewDeps,
  deleteOwnedDatabaseView,
  duplicateOwnedDatabaseView,
  renameDatabaseViewInDoc,
  repairDashboardOwnerMarkers,
  resolveDashboardViewOwner,
} from '@/application/database-yjs/dashboard-owned-view-ops';
import { readDashboardOwner } from '@/application/database-yjs/dashboard-owned-views';
import { seedNumberWidgetChart } from '@/application/database-yjs/dashboard-widget-seed';
import { DashboardRow } from '@/application/database-yjs/dashboard.type';
import { getDatabaseFromDoc } from '@/application/database-yjs/database-view-doc-ops';
import { DatabaseViewLayout, YDoc, YjsDatabaseKey, YjsEditorKey, YSharedRoot } from '@/application/types';
import { isWorkspaceLimitError } from '@/utils/billing-error';
import { getErrorMessage } from '@/utils/errors';
import { Log } from '@/utils/log';

import { DEFAULT_WIDGET_LAYOUTS, DefaultWidgetSpecKind } from '../add-widget/add-widget-flow';
import { DashboardEditOnlyAction, refusesEditOnlyAction } from '../dashboard-mode';
import { dashboardFullAnnouncement } from '../DashboardFullTooltip';
import { OwnedViewDeletionQueue } from '../owned-views/OwnedViewDeletionQueue';
import { canDuplicateWidget } from '../widget-moves';

import { dashboardViewMetaLoader } from './viewMetaBatch';

/** A Chart default view refused by the workspace plan: the add flow retries it as a table (WP06 §1.2). */
export class DefaultWidgetPlanError extends Error {
  constructor(readonly cause: unknown) {
    super('Chart views cannot be created in this workspace');
    this.name = 'DefaultWidgetPlanError';
  }
}

export interface CreateWidgetViewParams {
  /** The database of the new view (the host's or another one). */
  databaseId: string;
  /** A view of that database the new view is placed next to. */
  anchorViewId: string;
  layout: DatabaseViewLayout;
  /** The name before numbering (the layout label). */
  baseName: string;
}

/** A tiny external store, so only the widget whose duplicate is in flight re-renders. */
export interface ValueStore<T> {
  get: () => T;
  subscribe: (listener: () => void) => () => void;
}

function createValueStore<T>(initial: T): ValueStore<T> & { set: (value: T) => void } {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** What a dashboard does with the views it owns (WP05 §1, WP06 §1.1). Every member is stable. */
export interface OwnedWidgetViews {
  /** Create a view owned by this dashboard (the picker's "New view in {database}"). */
  createWidgetView: (params: CreateWidgetViewParams) => Promise<string>;
  /**
   * The add flow's default widget view on the host database, owned by this
   * dashboard and named `baseName` numbered; a Chart spec is seeded as a
   * compact Count all Number chart before it resolves. A plan refusal of the
   * Chart spec rejects with `DefaultWidgetPlanError`.
   */
  createDefaultWidgetView: (spec: DefaultWidgetSpecKind, baseName: string) => Promise<string>;
  /** Duplicate a widget with an owned copy of its view (WP05 §1.4). */
  duplicateWidget: (widgetId: string) => Promise<void>;
  /**
   * Rename the view a widget shows (folder and collab name, not an undo step).
   * Resolves to whether a rename was written: an empty name, the current
   * name or a mobile context write nothing.
   */
  renameWidgetView: (widgetId: string, name: string, current?: { name: string; doc?: YDoc | null }) => Promise<boolean>;
  /** Delete an owned view no widget ever showed (no queue, no undo step). */
  deleteOwnedViewNow: (viewId: string, databaseId: string) => Promise<void>;
  /** Queue an owned view the dashboard no longer shows. */
  enqueueOwnedViewDeletion: (viewId: string, databaseId: string) => void;
  /** Delete every queued view that is still unreferenced (Done, close). */
  flushOwnedViews: () => Promise<void>;
  /** The widget whose duplicate is in flight (its Duplicate entry is disabled meanwhile). */
  duplicatingWidget: ValueStore<string | null>;
}

/** Owned views that do nothing: for surfaces without a dashboard provider (published pages, tests). */
export function createInertOwnedWidgetViews(): OwnedWidgetViews {
  const unavailable = () => Promise.reject(new Error('Owned widget views are not available here'));

  return {
    createWidgetView: unavailable,
    createDefaultWidgetView: unavailable,
    duplicateWidget: async () => undefined,
    renameWidgetView: async () => false,
    deleteOwnedViewNow: async () => undefined,
    enqueueOwnedViewDeletion: () => undefined,
    flushOwnedViews: async () => undefined,
    duplicatingWidget: createValueStore<string | null>(null),
  };
}

export interface UseOwnedWidgetViewsOptions {
  dashboardViewId: string;
  hostDatabaseId: string;
  /** Writers queue, sweep and repair; readers never do. */
  canEdit: boolean;
  /** Edit-only actions are refused in a mobile context. */
  mobileContext: boolean;
  /** Persist a row transformation; resolves to whether it wrote. */
  updateRows: (updater: (rows: DashboardRow[]) => DashboardRow[]) => boolean;
  /** Latest persisted rows. */
  getRows: () => DashboardRow[];
  /** The owner of a view as known right now (`useDashboardOwnerLookup`). */
  ownerOfNow: (viewId: string, databaseId?: string) => string | null;
  /** A registered source doc of a widget database, if any (read at call time). */
  getSourceDoc: (databaseId: string) => YDoc | undefined;
}

function refuseOnMobile(mobileContext: boolean, action: DashboardEditOnlyAction) {
  if (!refusesEditOnlyAction(action, { mobileContext })) return false;
  Log.warn('[Dashboard] edit-only write refused on mobile', [action]);
  return true;
}

/**
 * Binds the owned-view operations (`dashboard-owned-view-ops.ts`) to the host
 * database and owns the dashboard's deletion queue (WP05 §1.5): every local
 * rows change (write, undo, redo) is reconciled, the queue is flushed by
 * `flushOwnedViews` (Done), when the dashboard closes or switches views, and
 * at each item's deadline. A writer's open sweeps this dashboard's
 * unreferenced owned views into the queue (a crash between creating a default
 * view and inserting its widget) and repairs half-written owner markers.
 */
export function useOwnedWidgetViews({
  dashboardViewId,
  hostDatabaseId,
  canEdit,
  mobileContext,
  updateRows,
  getRows,
  ownerOfNow,
  getSourceDoc,
}: UseOwnedWidgetViewsOptions): OwnedWidgetViews {
  const { t } = useTranslation();
  const context = useDatabaseContext();
  const latest = useRef({ context, t, mobileContext, updateRows, getRows, ownerOfNow, getSourceDoc });

  latest.current = { context, t, mobileContext, updateRows, getRows, ownerOfNow, getSourceDoc };
  const hostDoc = context.databaseDoc;
  // An async creation can finish after this hook starts serving another
  // dashboard. Its immediate cleanup keeps the originating services, while
  // still following service refreshes within that same scope.
  const cleanupScopeRef = useRef({ context, workspaceId: context.workspaceId, dashboardViewId, hostDoc });

  if (
    cleanupScopeRef.current.workspaceId !== context.workspaceId ||
    cleanupScopeRef.current.dashboardViewId !== dashboardViewId ||
    cleanupScopeRef.current.hostDoc !== hostDoc
  ) {
    cleanupScopeRef.current = { context, workspaceId: context.workspaceId, dashboardViewId, hostDoc };
  }

  const cleanupScope = cleanupScopeRef.current;

  cleanupScope.context = context;

  // The deps of every operation, read when it runs: the app rebuilds its
  // services, and a queue flush can run after the dashboard unmounted.
  const getDeps = useCallback((current = latest.current.context): DashboardOwnedViewDeps => {
    return {
      databaseDoc: current.databaseDoc,
      databasePageId: current.databasePageId,
      activeViewId: current.activeViewId,
      createDatabaseView: current.createDatabaseView,
      deletePage: current.deletePage,
      loadViewMeta: current.loadViewMeta,
      updatePage: current.updatePage,
      loadView: current.loadView,
      bindViewSync: current.bindViewSync,
      scheduleDeferredCleanup: current.scheduleDeferredCleanup,
      isDocumentBlock: current.isDocumentBlock,
      readOnly: current.readOnly,
      canWrite: current.canWrite,
    };
  }, []);

  const deleteOwnedViewNow = useCallback(
    async (viewId: string, databaseId: string) => {
      try {
        await deleteOwnedDatabaseView(getDeps(cleanupScope.context), { viewId, databaseId });
      } catch (error) {
        Log.warn('[Dashboard] could not delete an owned widget view', { viewId, error });
      }
    },
    [cleanupScope, getDeps]
  );

  const queue = useMemo(
    () =>
      new OwnedViewDeletionQueue({
        dashboardViewId,
        isReferenced: (viewId) =>
          readStoredDashboardWidgets(getDatabaseFromDoc(latest.current.context.databaseDoc), dashboardViewId).some(
            (widget) => widget.viewId === viewId
          ),
        ownerOfNow: (viewId, databaseId) => latest.current.ownerOfNow(viewId, databaseId),
        resolveOwner: (viewId, databaseId) =>
          resolveDashboardViewOwner(getDeps(), viewId, latest.current.getSourceDoc(databaseId)),
        deleteView: (viewId, databaseId) => deleteOwnedDatabaseView(getDeps(), { viewId, databaseId }),
      }),
    [dashboardViewId, getDeps]
  );

  // Closing the dashboard (or switching to another dashboard view) flushes.
  useEffect(() => () => void queue.flush(), [queue]);

  // Only this client's own rows changes queue anything, and only for writers.
  useEffect(() => {
    if (!canEdit) return;
    return observeLocalDashboardRowsChanges(hostDoc, dashboardViewId, (before, after) => queue.reconcile(before, after));
  }, [canEdit, dashboardViewId, hostDoc, queue]);

  // Once per open of a writer: sweep and repair.
  const sweptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!canEdit || sweptRef.current === dashboardViewId) return;
    sweptRef.current = dashboardViewId;
    const database = getDatabaseFromDoc(hostDoc);
    const widgets = readStoredDashboardWidgets(database, dashboardViewId);
    const shown = new Set(widgets.map((widget) => widget.viewId));

    database?.get(YjsDatabaseKey.views)?.forEach((view, viewId) => {
      if (shown.has(viewId) || readDashboardOwner(null, view) !== dashboardViewId) return;
      // Only at its deadline: a collaborator's add may be about to insert it.
      queue.enqueue(viewId, hostDatabaseId, { deadlineOnly: true });
    });
    if (widgets.length === 0) return;
    // Through the docs the dashboard has open: the repair never loads a source itself.
    const deps = getDeps();
    const workspaceId = latest.current.context.workspaceId;

    if (deps.loadViewMeta && workspaceId) {
      deps.loadViewMeta = dashboardViewMetaLoader(deps.loadViewMeta, workspaceId);
    }

    void repairDashboardOwnerMarkers(deps, dashboardViewId, latest.current.getRows(), {
      getOpenDoc: (databaseId) => latest.current.getSourceDoc(databaseId),
    }).catch((error) => Log.warn('[Dashboard] could not repair the owner markers', error));
  }, [canEdit, dashboardViewId, getDeps, hostDatabaseId, hostDoc, queue]);

  const createWidgetView = useCallback(
    async (params: CreateWidgetViewParams) => {
      if (refuseOnMobile(latest.current.mobileContext, 'addWidgetView')) {
        throw new Error('Widgets are added in Edit mode');
      }

      return createOwnedDatabaseView(getDeps(), { ...params, owner: dashboardViewId });
    },
    [dashboardViewId, getDeps]
  );

  const createDefaultWidgetView = useCallback(
    async (spec: DefaultWidgetSpecKind, baseName: string) => {
      if (refuseOnMobile(latest.current.mobileContext, 'addWidgetView')) {
        throw new Error('Widgets are added in Edit mode');
      }

      try {
        const viewId = await createOwnedDatabaseView(getDeps(), {
          databaseId: hostDatabaseId,
          anchorViewId: dashboardViewId,
          layout: DEFAULT_WIDGET_LAYOUTS[spec],
          baseName,
          owner: dashboardViewId,
        });

        if (spec === 'chart') {
          seedNumberWidgetChart(
            latest.current.context.databaseDoc.getMap(YjsEditorKey.data_section) as YSharedRoot,
            viewId
          );
        }

        return viewId;
      } catch (error) {
        if (spec === 'chart' && isWorkspaceLimitError(error)) throw new DefaultWidgetPlanError(error);
        throw error;
      }
    },
    [dashboardViewId, getDeps, hostDatabaseId]
  );

  const duplicatingWidget = useMemo(() => createValueStore<string | null>(null), []);

  const duplicateWidget = useCallback(
    async (widgetId: string) => {
      const { t: translate, mobileContext: mobile } = latest.current;

      if (duplicatingWidget.get() === widgetId || refuseOnMobile(mobile, 'duplicateWidget')) return;
      const rows = latest.current.getRows();
      const location = findDashboardWidget(rows, widgetId);

      // Refused before anything is created: a full dashboard gets no copy.
      if (!location || !canDuplicateWidget(rows, widgetId)) {
        liveRegion.announce(dashboardFullAnnouncement(translate));
        return;
      }

      const { viewId, databaseId } = location.widget;
      const deps = getDeps();

      duplicatingWidget.set(widgetId);
      try {
        const meta = await deps.loadViewMeta?.(viewId).catch(() => null);
        const doc = databaseId === hostDatabaseId ? deps.databaseDoc : latest.current.getSourceDoc(databaseId);
        const collabName = getDatabaseFromDoc(doc)?.get(YjsDatabaseKey.views)?.get(viewId)?.get(YjsDatabaseKey.name);
        const sourceName = (meta?.name || (typeof collabName === 'string' ? collabName : '') || '').trim();
        const copyId = await duplicateOwnedDatabaseView(deps, {
          sourceViewId: viewId,
          databaseId,
          owner: dashboardViewId,
          name: sourceName,
          numbered: true,
        });
        const written = latest.current.updateRows((current) =>
          duplicateDashboardWidget(current, widgetId, { viewId: copyId, databaseId })
        );

        if (!written) {
          // A concurrent edit filled the dashboard or removed the source widget.
          await deleteOwnedViewNow(copyId, databaseId);
          liveRegion.announce(dashboardFullAnnouncement(translate));
        }
      } catch (error) {
        Log.warn('[Dashboard] could not duplicate a widget', error);
        toast.error(
          getErrorMessage(
            error,
            translate('dashboard.picker.createFailed', { defaultValue: 'Could not create the view' })
          )
        );
      } finally {
        duplicatingWidget.set(null);
      }
    },
    [dashboardViewId, deleteOwnedViewNow, duplicatingWidget, getDeps, hostDatabaseId]
  );

  const renameWidgetView = useCallback(
    async (widgetId: string, name: string, current?: { name: string; doc?: YDoc | null }) => {
      const trimmed = name.trim();

      if (
        !trimmed ||
        trimmed === current?.name.trim() ||
        refuseOnMobile(latest.current.mobileContext, 'renameWidgetView')
      ) {
        return false;
      }

      const widget = findDashboardWidget(latest.current.getRows(), widgetId)?.widget;

      if (!widget) return false;
      const deps = getDeps();

      if (widget.databaseId === hostDatabaseId) {
        // As a tab rename: the folder page, then the collab name (not an undo step).
        await deps.updatePage?.(widget.viewId, { name: trimmed });
        await renameDatabaseViewInDoc({ doc: deps.databaseDoc, viewId: widget.viewId, name: trimmed });
        return true;
      }

      const doc = current?.doc ?? latest.current.getSourceDoc(widget.databaseId);
      const renamed = doc
        ? await renameDatabaseViewInDoc({ doc, viewId: widget.viewId, name: trimmed, updatePage: deps.updatePage })
        : false;

      // The collab name already matched (or the doc is not open): the folder page still takes it.
      if (!renamed) await deps.updatePage?.(widget.viewId, { name: trimmed });
      return true;
    },
    [getDeps, hostDatabaseId]
  );

  const enqueueOwnedViewDeletion = useCallback(
    (viewId: string, databaseId: string) => queue.enqueue(viewId, databaseId),
    [queue]
  );
  const flushOwnedViews = useCallback(() => queue.flush(), [queue]);

  return useMemo<OwnedWidgetViews>(
    () => ({
      createWidgetView,
      createDefaultWidgetView,
      duplicateWidget,
      renameWidgetView,
      deleteOwnedViewNow,
      enqueueOwnedViewDeletion,
      flushOwnedViews,
      duplicatingWidget,
    }),
    [
      createDefaultWidgetView,
      createWidgetView,
      deleteOwnedViewNow,
      duplicateWidget,
      duplicatingWidget,
      enqueueOwnedViewDeletion,
      flushOwnedViews,
      renameWidgetView,
    ]
  );
}
