import { Suspense, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { usePublishContext } from '@/application/publish';
import {
  AppendBreadcrumb,
  CreateRow,
  LoadView,
  LoadViewMeta,
  ViewLayout,
  ViewMetaProps,
  YDatabase,
  YDoc,
  YjsEditorKey,
} from '@/application/types';
import ComponentLoading from '@/components/_shared/progress/ComponentLoading';
import CalendarSkeleton from '@/components/_shared/skeleton/CalendarSkeleton';
import DocumentSkeleton from '@/components/_shared/skeleton/DocumentSkeleton';
import GridSkeleton from '@/components/_shared/skeleton/GridSkeleton';
import KanbanSkeleton from '@/components/_shared/skeleton/KanbanSkeleton';
import { Database } from '@/components/database';

import ViewMetaPreview from 'src/components/view-meta/ViewMetaPreview';

export interface DatabaseProps {
  workspaceId: string;
  doc: YDoc;
  createRow?: CreateRow;
  loadView?: LoadView;
  /**
   * Load a row sub-document from published cache.
   */
  loadRowDocument?: (documentId: string) => Promise<YDoc | null>;
  navigateToView?: (viewId: string, blockId?: string) => Promise<void>;
  loadViewMeta?: LoadViewMeta;
  viewMeta: ViewMetaProps;
  appendBreadcrumb?: AppendBreadcrumb;
  onRendered?: () => void;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
}

function DatabaseView({ viewMeta, ...props }: DatabaseProps) {
  const [search, setSearch] = useSearchParams();
  const visibleViewIds = useMemo(() => viewMeta.visibleViewIds || [], [viewMeta]);

  const isTemplateThumb = usePublishContext()?.isTemplateThumb;

  /**
   * The database's page ID in the folder/outline structure.
   * This is the main entry point for the database and remains constant.
   */
  const databasePageId = viewMeta.viewId;

  /**
   * The currently active/selected view tab ID (Grid, Board, or Calendar).
   * Comes from URL param 'v', defaults to databasePageId when not specified.
   */
  const activeViewId = useMemo(() => {
    return search.get('v') || databasePageId;
  }, [search, databasePageId]);

  const handleChangeView = useCallback(
    (viewId: string) => {
      setSearch((prev) => {
        prev.set('v', viewId);
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

  if (!activeViewId || !database) return null;

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 48px)',
        maxWidth: isTemplateThumb ? '964px' : undefined,
      }}
      className={'relative flex h-full w-full flex-col'}
    >
      {rowId ? null : <ViewMetaPreview {...viewMeta} readOnly={true} />}

      <Suspense fallback={skeleton}>
        <Database
          databaseName={viewMeta.name || ''}
          databasePageId={databasePageId || ''}
          {...props}
          activeViewId={activeViewId}
          rowId={rowId}
          visibleViewIds={visibleViewIds}
          onChangeView={handleChangeView}
          onOpenRowPage={handleNavigateToRow}
          showActions={false}
        />
      </Suspense>
    </div>
  );
}

export default DatabaseView;
