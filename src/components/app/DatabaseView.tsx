import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ViewComponentProps, ViewLayout, YDatabase, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { findView } from '@/components/_shared/outline/utils';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import CalendarSkeleton from '@/components/_shared/skeleton/CalendarSkeleton';
import DocumentSkeleton from '@/components/_shared/skeleton/DocumentSkeleton';
import GridSkeleton from '@/components/_shared/skeleton/GridSkeleton';
import KanbanSkeleton from '@/components/_shared/skeleton/KanbanSkeleton';
import { useAppOutline } from '@/components/app/app.hooks';
import { DATABASE_TAB_VIEW_ID_QUERY_PARAM } from '@/components/app/hooks/resolveSidebarSelectedViewId';
import { Database } from '@/components/database';
import { useContainerVisibleViewIds } from '@/components/database/hooks';

import ViewMetaPreview from 'src/components/view-meta/ViewMetaPreview';

type DatabaseViewProps = ViewComponentProps & {
  bindViewSync?: (doc: ViewComponentProps['doc']) => SyncContext | null;
};

function DatabaseView(props: DatabaseViewProps) {
  const { viewMeta, uploadFile } = props;
  const [search, setSearch] = useSearchParams();
  const outline = useAppOutline();

  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  const databasePageId = viewMeta.viewId || '';

  const view = useMemo(() => {
    if (!outline || !databasePageId) return;
    return findView(outline || [], databasePageId);
  }, [outline, databasePageId]);

  // Use hook to determine container view and visible view IDs
  const { containerView, visibleViewIds } = useContainerVisibleViewIds({ view, outline });

  // Use container view (if present) as the "page meta" view for naming/icon operations.
  const pageView = containerView || view;

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
   * Comes from URL param 'v', defaults to databasePageId when not specified.
   */
  const activeViewId = useMemo(() => {
    return search.get(DATABASE_TAB_VIEW_ID_QUERY_PARAM) || databasePageId;
  }, [search, databasePageId]);

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
        <ViewMetaPreview
          {...pageMeta}
          readOnly={props.readOnly}
          updatePage={props.updatePage}
          updatePageIcon={props.updatePageIcon}
          updatePageName={props.updatePageName}
          uploadFile={uploadFile}
        />
      )}

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
      />
    </div>
  );
}

export default DatabaseView;
