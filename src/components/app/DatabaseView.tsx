import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { PageService } from '@/application/services/domains';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { View, ViewComponentProps, ViewLayout, YDatabase, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { ERROR_CODE } from '@/application/constants';
import { isDatabaseContainer, isDatabaseLayout, resolveActiveDatabaseViewId } from '@/application/view-utils';
import { findParentView, findView } from '@/components/_shared/outline/utils';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import CalendarSkeleton from '@/components/_shared/skeleton/CalendarSkeleton';
import DocumentSkeleton from '@/components/_shared/skeleton/DocumentSkeleton';
import GridSkeleton from '@/components/_shared/skeleton/GridSkeleton';
import KanbanSkeleton from '@/components/_shared/skeleton/KanbanSkeleton';
import {
  useAppOutline,
  useBreadcrumb,
  useCurrentWorkspaceIdOptional,
  useEnsureViewVisibleInOutline,
  useRefreshOutline,
} from '@/components/app/app.hooks';
import { DATABASE_TAB_VIEW_ID_QUERY_PARAM } from '@/components/app/hooks/resolveSidebarSelectedViewId';
import { Database } from '@/components/database';
import { useContainerVisibleViewIds } from '@/components/database/hooks';
import { Button } from '@/components/ui/button';
import { getErrorMessage, isAPIErrorCode } from '@/utils/errors';
import { Log } from '@/utils/log';

import ViewMetaPreview from 'src/components/view-meta/ViewMetaPreview';

type DatabaseViewProps = ViewComponentProps & {
  bindViewSync?: (doc: ViewComponentProps['doc']) => SyncContext | null;
};

const DATABASE_CONTAINER_STATUS_RETRY_DELAYS_MS = [500, 1500, 3000] as const;

function databaseContainerStatusRetryDelay(error: unknown, retryIndex: number): number {
  const retryAfterSecs =
    typeof error === 'object' && error !== null && 'retryAfterSecs' in error
      ? (error as { retryAfterSecs?: unknown }).retryAfterSecs
      : undefined;

  return typeof retryAfterSecs === 'number' && Number.isFinite(retryAfterSecs) && retryAfterSecs >= 0
    ? retryAfterSecs * 1000
    : DATABASE_CONTAINER_STATUS_RETRY_DELAYS_MS[retryIndex];
}

function DatabaseView(props: DatabaseViewProps) {
  const { viewMeta, uploadFile } = props;
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const outline = useAppOutline();

  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  const databasePageId = viewMeta.viewId || '';
  const breadcrumbs = useBreadcrumb();

  const view = useMemo(() => {
    if (!outline || !databasePageId) return;
    return findView(outline || [], databasePageId);
  }, [outline, databasePageId]);

  // Use hook to determine container view and visible view IDs
  const { containerView, visibleViewIds } = useContainerVisibleViewIds({
    view,
    outline,
    parentViewId: viewMeta.parentViewId,
    databaseId: viewMeta.extra?.database_id,
    embedded: viewMeta.extra?.embedded,
  });

  const outlineParentView = useMemo((): View | undefined => {
    if (!outline || !databasePageId) return undefined;

    const structuralParent = findParentView(outline, databasePageId);

    if (structuralParent) return structuralParent;

    const parentViewId = view?.parent_view_id || viewMeta.parentViewId;

    return parentViewId ? findView(outline, parentViewId) || undefined : undefined;
  }, [databasePageId, outline, view?.parent_view_id, viewMeta.parentViewId]);

  const breadcrumbParentView = useMemo((): View | undefined => {
    if (!breadcrumbs?.length) return undefined;
    const currentIdx = breadcrumbs.findIndex((crumb) => crumb.view_id === databasePageId);

    return currentIdx > 0 ? breadcrumbs[currentIdx - 1] : undefined;
  }, [breadcrumbs, databasePageId]);

  // Breadcrumb-based container fallback. The breadcrumb chain is built with
  // server fetches for any ancestor missing from the shallow outline, so it
  // resolves the database container even when the outline tree doesn't yet
  // include the route view's parent (e.g. immediately after refresh while
  // the outline still uses a bounded depth).
  const breadcrumbContainerView = useMemo((): View | undefined => {
    if (containerView) return undefined;
    if (viewMeta.extra?.embedded) return undefined;

    return breadcrumbParentView && isDatabaseContainer(breadcrumbParentView) ? breadcrumbParentView : undefined;
  }, [breadcrumbParentView, containerView, viewMeta.extra?.embedded]);

  // Use container view (if present) as the "page meta" view for naming/icon operations.
  const pageView = containerView || breadcrumbContainerView || view;

  const workspaceId = useCurrentWorkspaceIdOptional();
  const refreshOutline = useRefreshOutline();
  const ensureViewVisibleInOutline = useEnsureViewVisibleInOutline();
  const [isUpgradingContainer, setIsUpgradingContainer] = useState(false);
  const [upgradedDatabaseView, setUpgradedDatabaseView] = useState<{
    workspaceId: string;
    viewId: string;
  } | null>(null);
  const [databaseContainerUpgradeStatus, setDatabaseContainerUpgradeStatus] = useState<{
    workspaceId: string;
    viewId: string;
    eligible: boolean;
  } | null>(null);

  // Persist a tab reorder by moving the view within its database container.
  // No-ops for standalone databases (no container), which keep the local order.
  const handleReorderViews = useCallback(
    async (movedViewId: string, prevViewId: string | null) => {
      const container = containerView || breadcrumbContainerView;

      if (!container || !workspaceId) return;

      await PageService.moveTo(workspaceId, movedViewId, container.view_id, prevViewId);
      await refreshOutline?.();
    },
    [containerView, breadcrumbContainerView, workspaceId, refreshOutline]
  );

  const pageMeta = useMemo(() => {
    if (!pageView) {
      return viewMeta;
    }

    return {
      ...viewMeta,
      viewId: pageView.view_id,
      name: pageView.name,
      icon: pageView.icon || undefined,
      extra: pageView.extra,
      cover: pageView.extra?.cover,
      layout: pageView.layout,
    };
  }, [pageView, viewMeta]);

  /**
   * The currently active/selected view tab ID (Grid, Board, or Calendar).
   * Comes from URL param 'v', defaults to the route id for direct child-view
   * routes, or the first visible child when the route points at a database
   * container.
   */
  const activeViewId = useMemo(() => {
    return resolveActiveDatabaseViewId({
      databasePageId,
      tabViewId: search.get(DATABASE_TAB_VIEW_ID_QUERY_PARAM),
      visibleViewIds,
    });
  }, [search, databasePageId, visibleViewIds]);

  const handleChangeView = useCallback(
    (viewId: string) => {
      setSearch((prev) => {
        prev.set(DATABASE_TAB_VIEW_ID_QUERY_PARAM, viewId);
        return prev;
      });
    },
    [setSearch]
  );

  const handleNavigateToRow = useCallback(
    (rowId: string) => {
      setSearch((prev) => {
        prev.set('r', rowId);
        return prev;
      });
    },
    [setSearch]
  );

  const rowId = search.get('r') || undefined;
  const modalRowId = search.get('r-modal') || undefined;
  const doc = props.doc;

  // State to trigger re-render when Y.js data changes
  const [, forceUpdate] = useState(0);
  const dataSection = doc?.getMap(YjsEditorKey.data_section);
  const database = dataSection?.get(YjsEditorKey.database) as YDatabase | undefined;
  const databaseViews = database?.get(YjsDatabaseKey.views);
  const resolvedParentView = outlineParentView || breadcrumbParentView;
  const isPotentialLegacyDatabase =
    (upgradedDatabaseView === null ||
      upgradedDatabaseView.workspaceId !== workspaceId ||
      upgradedDatabaseView.viewId !== databasePageId) &&
    !containerView &&
    !breadcrumbContainerView &&
    viewMeta.extra?.embedded !== true &&
    Boolean(databasePageId) &&
    resolvedParentView !== undefined &&
    !isDatabaseContainer(resolvedParentView) &&
    !isDatabaseLayout(resolvedParentView.layout) &&
    databaseViews?.has(databasePageId) === true;
  const isLegacyDatabase =
    isPotentialLegacyDatabase &&
    databaseContainerUpgradeStatus?.workspaceId === workspaceId &&
    databaseContainerUpgradeStatus?.viewId === databasePageId &&
    databaseContainerUpgradeStatus.eligible;

  // A current linked-database alias has the same local shape as some historical mounted roots.
  // Ask the server, which can compare the Folder projection, Database body, and compatibility
  // catalog. POST performs the same validation again while holding the migration locks.
  useEffect(() => {
    if (!workspaceId || !databasePageId || !isPotentialLegacyDatabase || props.readOnly || props.canWrite === false) {
      return;
    }

    let cancelled = false;
    let retryIndex = 0;
    let retryTimeout: number | undefined;

    const loadStatus = async () => {
      try {
        const status = await PageService.getDatabaseContainerUpgradeStatus(workspaceId, databasePageId);

        if (cancelled) return;

        setDatabaseContainerUpgradeStatus({
          workspaceId,
          viewId: databasePageId,
          eligible: status.eligible && !status.already_upgraded,
        });
      } catch (error) {
        if (cancelled) return;

        if (
          isAPIErrorCode(error, ERROR_CODE.RETRY_LATER) &&
          retryIndex < DATABASE_CONTAINER_STATUS_RETRY_DELAYS_MS.length
        ) {
          const delay = databaseContainerStatusRetryDelay(error, retryIndex);

          retryIndex += 1;
          retryTimeout = window.setTimeout(() => void loadStatus(), delay);
          return;
        }

        setDatabaseContainerUpgradeStatus({ workspaceId, viewId: databasePageId, eligible: false });
      }
    };

    void loadStatus();

    return () => {
      cancelled = true;
      if (retryTimeout !== undefined) window.clearTimeout(retryTimeout);
    };
  }, [databasePageId, isPotentialLegacyDatabase, props.canWrite, props.readOnly, workspaceId]);

  const handleUpgradeDatabaseContainer = useCallback(async () => {
    if (!workspaceId || !databasePageId || isUpgradingContainer) return;

    setIsUpgradingContainer(true);
    try {
      const result = await PageService.upgradeDatabaseContainer(workspaceId, databasePageId);

      setUpgradedDatabaseView({ workspaceId, viewId: result.database_view_id });
      toast.success(
        t(result.upgraded ? 'web.databaseContainerUpgrade.success' : 'web.databaseContainerUpgrade.alreadyUpgraded')
      );
      try {
        await refreshOutline?.();
        await ensureViewVisibleInOutline?.(result.database_view_id);
      } catch (error) {
        // The POST is already committed. Keep its success state and let reload/server
        // notifications reconcile the outline rather than telling the user migration failed.
        Log.warn('[DatabaseView] Database upgraded, but outline reconciliation failed', getErrorMessage(error));
      }
    } catch (error) {
      toast.error(getErrorMessage(error) || t('web.databaseContainerUpgrade.failed'));
    } finally {
      setIsUpgradingContainer(false);
    }
  }, [databasePageId, ensureViewVisibleInOutline, isUpgradingContainer, refreshOutline, t, workspaceId]);

  // Ref to track if database is available
  const databaseRef = useRef(database);
  const pendingUpdateRef = useRef<number | null>(null);

  databaseRef.current = database;

  // Throttle re-renders to avoid render storms during sync
  const triggerUpdate = useCallback(() => {
    if (pendingUpdateRef.current !== null) return;

    pendingUpdateRef.current = window.requestAnimationFrame(() => {
      pendingUpdateRef.current = null;
      forceUpdate((prev) => prev + 1);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (pendingUpdateRef.current !== null) {
        window.cancelAnimationFrame(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    };
  }, []);

  // Observe Y.js data section for changes
  // Sync is bound AFTER render, so these observers only fire after component is mounted
  useEffect(() => {
    if (!doc) return;

    const section = doc.getMap(YjsEditorKey.data_section);

    if (!section) return;

    section.observeDeep(triggerUpdate);

    return () => {
      try {
        section.unobserveDeep(triggerUpdate);
      } catch {
        // Ignore errors from unobserving destroyed Yjs objects
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.guid, databasePageId, triggerUpdate]);

  // Observe database deep changes when database becomes available
  useEffect(() => {
    if (!database) return;

    database.observeDeep(triggerUpdate);

    return () => {
      try {
        database.unobserveDeep(triggerUpdate);
      } catch {
        // Ignore errors from unobserving destroyed Yjs objects
      }
    };
  }, [database, databasePageId, triggerUpdate]);

  // Polling fallback for when database data hasn't arrived yet
  // This handles edge cases where sync takes longer than expected
  useEffect(() => {
    if (!doc) return;

    // Skip polling if we already have database data
    if (databaseRef.current && databaseRef.current.get(YjsDatabaseKey.views)?.size > 0) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max

    const checkForDatabase = () => {
      if (cancelled) return;

      // Check if database data has arrived
      if (databaseRef.current && databaseRef.current.get(YjsDatabaseKey.views)?.size > 0) {
        return;
      }

      const section = doc.getMap(YjsEditorKey.data_section);
      const db = section?.get(YjsEditorKey.database) as YDatabase | undefined;
      const viewsSize = db?.get(YjsDatabaseKey.views)?.size || 0;

      if (db && viewsSize > 0) {
        forceUpdate((prev) => prev + 1);
        return;
      }

      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(checkForDatabase, 100);
      }
    };

    // Start polling after initial render
    const initialTimeout = setTimeout(checkForDatabase, 100);

    return () => {
      cancelled = true;
      clearTimeout(initialTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.guid, databasePageId]);

  const skeleton = useMemo(() => {
    if (rowId) {
      return <DocumentSkeleton />;
    }

    switch (viewMeta.layout) {
      case ViewLayout.Grid:
      case ViewLayout.List:
      case ViewLayout.Gallery:
        return <GridSkeleton includeTitle={false} />;
      case ViewLayout.Board:
        return <KanbanSkeleton includeTitle={false} />;
      case ViewLayout.Calendar:
        return <CalendarSkeleton includeTitle={false} />;
      default:
        return <ComponentLoading />;
    }
  }, [rowId, viewMeta.layout]);

  // Check if database has views - this ensures the data is actually populated
  const hasViews = (database?.get(YjsDatabaseKey.views)?.size ?? 0) > 0;

  // Wait for database data to be available before rendering
  // The Y.js observers will trigger re-render when data arrives via sync
  if (!activeViewId || !doc || !database || !hasViews) return skeleton;

  return (
    <div
      key={databasePageId}
      style={{
        minHeight: viewMeta.layout === ViewLayout.Calendar ? 'calc(100vh - 48px)' : undefined,
      }}
      className={'relative flex h-full w-full flex-col'}
    >
      {rowId ? null : (
        <>
          <ViewMetaPreview
            {...pageMeta}
            readOnly={props.readOnly}
            updatePage={props.updatePage}
            updatePageIcon={props.updatePageIcon}
            updatePageName={props.updatePageName}
            uploadFile={uploadFile}
          />
          {isLegacyDatabase && !props.readOnly && props.canWrite !== false ? (
            <div
              className='mx-24 mb-3 flex items-center justify-between gap-4 rounded-300 border border-border-primary bg-fill-content px-4 py-3'
              data-testid='legacy-database-upgrade-banner'
            >
              <span className='text-sm text-text-secondary'>{t('web.databaseContainerUpgrade.description')}</span>
              <Button
                data-testid='upgrade-database-container-button'
                loading={isUpgradingContainer}
                onClick={() => void handleUpgradeDatabaseContainer()}
              >
                {t('web.databaseContainerUpgrade.button')}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Suspense fallback={skeleton}>
        <Database
          key={databasePageId}
          databaseName={pageMeta.name || ''}
          databasePageId={databasePageId || ''}
          {...props}
          activeViewId={activeViewId}
          rowId={rowId}
          showActions={true}
          onChangeView={handleChangeView}
          onOpenRowPage={handleNavigateToRow}
          modalRowId={modalRowId}
          visibleViewIds={visibleViewIds}
          onReorderViews={handleReorderViews}
        />
      </Suspense>
    </div>
  );
}

export default DatabaseView;
