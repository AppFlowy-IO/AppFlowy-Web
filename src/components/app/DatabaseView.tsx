import { Suspense, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ViewComponentProps, ViewLayout, YDatabase, YjsEditorKey } from '@/application/types';
import { getDatabaseTabViewIds, isDatabaseContainer } from '@/application/view-utils';
import { findView } from '@/components/_shared/outline/utils';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import CalendarSkeleton from '@/components/_shared/skeleton/CalendarSkeleton';
import DocumentSkeleton from '@/components/_shared/skeleton/DocumentSkeleton';
import GridSkeleton from '@/components/_shared/skeleton/GridSkeleton';
import KanbanSkeleton from '@/components/_shared/skeleton/KanbanSkeleton';
import { useAppOutline } from '@/components/app/app.hooks';
import { DATABASE_TAB_VIEW_ID_QUERY_PARAM } from '@/components/app/hooks/resolveSidebarSelectedViewId';
import { Database } from '@/components/database';

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

  const containerView = useMemo(() => {
    if (!outline || !view) return;

    if (isDatabaseContainer(view)) {
      return view;
    }

    const parentId = view.parent_view_id;

    if (!parentId) {
      return;
    }

    const parent = findView(outline || [], parentId);

    return isDatabaseContainer(parent) ? parent : undefined;
  }, [outline, view]);

  // Use container view (if present) as the "page meta" view for naming/icon operations.
  const pageView = containerView || view;

  const visibleViewIds = useMemo(() => {
    if (containerView) {
      return getDatabaseTabViewIds(databasePageId, containerView);
    }

    if (!view) return [];
    return [view.view_id, ...(view.children?.map((v) => v.view_id) || [])];
  }, [containerView, view, databasePageId]);

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
  const database = doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.database) as YDatabase;
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

  if (!activeViewId || !doc || !database) return null;

  return (
    <div
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

      <Suspense fallback={skeleton}>
        <Database
          databaseName={pageMeta.name || ''}
          databasePageId={databasePageId || ''}
          {...props}
          activeViewId={activeViewId}
          rowId={rowId}
          showActions={true}
          visibleViewIds={visibleViewIds}
          onChangeView={handleChangeView}
          onOpenRowPage={handleNavigateToRow}
          modalRowId={modalRowId}
        />
      </Suspense>
    </div>
  );
}

export default DatabaseView;
