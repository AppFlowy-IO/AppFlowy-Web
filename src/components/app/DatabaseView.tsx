import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ViewComponentProps, ViewLayout, YDatabase, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
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

function DatabaseView(props: ViewComponentProps) {
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

  // Observe Y.js changes to re-render when database data arrives via websocket
  const [renderKey, forceUpdate] = useState(0);
  const dataSection = doc?.getMap(YjsEditorKey.data_section);
  const database = dataSection?.get(YjsEditorKey.database) as YDatabase | undefined;

  // Use ref to track if database is available without causing effect re-runs
  const databaseRef = useRef(database);

  databaseRef.current = database;

  // Ref to track the container element for DOM recovery check
  const containerRef = useRef<HTMLDivElement>(null);

  // Ref to track pending update to debounce rapid Y.js changes
  const pendingUpdateRef = useRef<number | null>(null);

  // Debounced update function that avoids flushSync warnings
  // Uses setTimeout(0) to defer to next event loop tick, ensuring we're outside React's commit phase
  const scheduleUpdate = useCallback(() => {
    if (pendingUpdateRef.current !== null) return; // Already scheduled

    pendingUpdateRef.current = window.setTimeout(() => {
      pendingUpdateRef.current = null;
      forceUpdate((prev) => prev + 1);
    }, 0);
  }, []);

  // Cleanup pending update on unmount
  useEffect(() => {
    return () => {
      if (pendingUpdateRef.current !== null) {
        clearTimeout(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    };
  }, []);

  // Use doc.guid as dependency to ensure stable observer lifecycle
  // This prevents premature observer cleanup when doc reference changes
  // Use observeDeep to catch nested database updates from websocket sync
  useEffect(() => {
    if (!doc) return;

    const section = doc.getMap(YjsEditorKey.data_section);

    if (!section) return;

    section.observeDeep(scheduleUpdate);

    return () => {
      try {
        section.unobserveDeep(scheduleUpdate);
      } catch {
        // Ignore errors from unobserving destroyed Yjs objects
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.guid, databasePageId, scheduleUpdate]);

  // Separate effect to observe database deep changes when database becomes available
  useEffect(() => {
    if (!database) {
      return;
    }

    database.observeDeep(scheduleUpdate);

    return () => {
      try {
        database.unobserveDeep(scheduleUpdate);
      } catch {
        // Ignore errors from unobserving destroyed Yjs objects
      }
    };
  }, [database, databasePageId, scheduleUpdate]);

  // Polling fallback for race conditions when database data hasn't arrived yet
  // This handles cases where Y.js observer doesn't fire due to timing issues
  // NOTE: We don't include `database` in dependencies to prevent effect cancellation during polling
  useEffect(() => {
    if (!doc) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max

    const checkForDatabase = () => {
      if (cancelled) return;

      // Check ref first to avoid unnecessary work if component already has database
      if (databaseRef.current) {
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

    // Start polling after a short delay to avoid triggering during React's commit phase
    const initialTimeout = setTimeout(checkForDatabase, 0);

    return () => {
      cancelled = true;
      clearTimeout(initialTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.guid, databasePageId]);

  // Recovery mechanism: Check if we have database data but DOM is empty
  // This handles cases where render was discarded due to timing issues
  useLayoutEffect(() => {
    const container = containerRef.current;
    const hasData = database && database.get(YjsDatabaseKey.views)?.size > 0;

    if (!container || !hasData) return;

    // Check if the container has actual content (not just the wrapper div)
    // The Database component should render children inside the container
    const hasContent = container.querySelector('.appflowy-database') !== null;

    if (!hasContent) {
      // Schedule a re-render on next tick to avoid infinite loop
      const timeoutId = setTimeout(() => {
        forceUpdate((prev) => prev + 1);
      }, 0);

      return () => clearTimeout(timeoutId);
    }
  }, [database, renderKey, databasePageId]);

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
  // The Y.js observation above will trigger re-render when data arrives via websocket
  if (!activeViewId || !doc || !database || !hasViews) return skeleton;

  return (
    <div
      ref={containerRef}
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
