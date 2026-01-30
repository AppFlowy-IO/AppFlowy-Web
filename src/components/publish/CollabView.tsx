import React, { Suspense, useMemo } from 'react';

import { usePublishContext } from '@/application/publish';
import { UIVariant, ViewComponentProps, ViewLayout, YDoc } from '@/application/types';
import CalendarSkeleton from '@/components/_shared/skeleton/CalendarSkeleton';
import DocumentSkeleton from '@/components/_shared/skeleton/DocumentSkeleton';
import GridSkeleton from '@/components/_shared/skeleton/GridSkeleton';
import KanbanSkeleton from '@/components/_shared/skeleton/KanbanSkeleton';
import { Document } from '@/components/document';
import DatabaseView from '@/components/publish/DatabaseView';
import { useViewMeta } from '@/components/publish/useViewMeta';

const ViewHelmet = React.lazy(() => import('@/components/_shared/helmet/ViewHelmet'));

export interface CollabViewProps {
  doc?: YDoc;
}

function CollabView({ doc }: CollabViewProps) {
  const visibleViewIds = usePublishContext()?.viewMeta?.visible_view_ids;
  const { viewId, layout, icon, cover, layoutClassName, style, name } = useViewMeta();
  const View = useMemo(() => {
    switch (layout) {
      case ViewLayout.Document:
        return Document;
      case ViewLayout.Grid:
      case ViewLayout.Board:
      case ViewLayout.Calendar:
        return DatabaseView;
      default:
        return null;
    }
  }, [layout]) as React.FC<ViewComponentProps>;

  const navigateToView = usePublishContext()?.toView;
  const loadViewMeta = usePublishContext()?.loadViewMeta;
  const createRow = usePublishContext()?.createRow;
  const loadView = usePublishContext()?.loadView;
  const isTemplateThumb = usePublishContext()?.isTemplateThumb;
  const appendBreadcrumb = usePublishContext()?.appendBreadcrumb;
  const onRendered = usePublishContext()?.onRendered;
  const rendered = usePublishContext()?.rendered;
  const getViewIdFromDatabaseId = usePublishContext()?.getViewIdFromDatabaseId;
  const className = useMemo(() => {
    const classList = ['relative w-full flex-1'];

    if (isTemplateThumb && layout !== ViewLayout.Document) {
      classList.push('flex justify-center h-full');
    }

    if (layoutClassName) {
      classList.push(layoutClassName);
    }

    return classList.join(' ');
  }, [isTemplateThumb, layout, layoutClassName]);

  const skeleton = useMemo(() => {
    switch (layout) {
      case ViewLayout.Grid:
        return <GridSkeleton />;
      case ViewLayout.Board:
        return <KanbanSkeleton />;
      case ViewLayout.Calendar:
        return <CalendarSkeleton />;
      case ViewLayout.Document:
        return <DocumentSkeleton />;
      default:
        return null;
    }
  }, [layout]);

  if (!View) return null;

  if (!doc) {
    return skeleton;
  }

  return (
    <>
      {rendered && (
        <Suspense>
          <ViewHelmet icon={icon} name={name} />
        </Suspense>
      )}

      <div style={style} className={className}>
        <View
          workspaceId={'publish'}
          doc={doc}
          readOnly={true}
          loadViewMeta={loadViewMeta}
          createRow={createRow}
          navigateToView={navigateToView}
          loadView={loadView}
          isTemplateThumb={isTemplateThumb}
          appendBreadcrumb={appendBreadcrumb}
          variant={UIVariant.Publish}
          onRendered={onRendered}
          viewMeta={{
            icon,
            cover,
            viewId,
            name,
            layout: layout || ViewLayout.Document,
            visibleViewIds: visibleViewIds || [],
          }}
          getViewIdFromDatabaseId={getViewIdFromDatabaseId}
        />
      </div>
    </>
  );
}

export default CollabView;
