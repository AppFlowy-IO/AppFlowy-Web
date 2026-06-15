import { useCallback, useMemo } from 'react';

import { createDatabaseYjsRenderDocsFromSnapshot } from '@/application/publish-snapshot/database-yjs-render-bridge';
import { createDocumentYjsRenderDocFromRawData } from '@/application/publish-snapshot/document-yjs-render-bridge';
import type { PublishedDatabaseSnapshot } from '@/application/publish-snapshot/types';
import { UIVariant, type ViewMetaProps, type YDoc } from '@/application/types';
import DatabaseView from '@/components/publish/DatabaseView';
import { usePublishContext } from '@/application/publish';
import {
  getPublishedViewCover,
  parsePublishedViewExtra,
} from '@/components/publish-render/shared/PublishedPageMeta';

export function PublishedDatabaseRenderer({ snapshot }: { snapshot: PublishedDatabaseSnapshot }) {
  const publishContext = usePublishContext();
  const { database, view } = snapshot;
  const { doc, rowMap } = useMemo(() => createDatabaseYjsRenderDocsFromSnapshot(snapshot), [snapshot]);
  const rowDocumentMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(database.raw.row_documents).map(([documentId, raw]) => [
          documentId,
          createDocumentYjsRenderDocFromRawData(documentId, raw),
        ])
      ),
    [database.raw.row_documents]
  );
  const extra = useMemo(() => parsePublishedViewExtra(view.extra), [view.extra]);
  const loadView = publishContext?.loadView;
  const contextLoadRowDocument = publishContext?.loadRowDocument;
  const loadRowDocument = useCallback(
    async (documentId: string): Promise<YDoc | null> => {
      return rowDocumentMap[documentId] ?? (await contextLoadRowDocument?.(documentId)) ?? null;
    },
    [contextLoadRowDocument, rowDocumentMap]
  );
  const viewMeta = useMemo<ViewMetaProps>(
    () => ({
      icon: view.icon || undefined,
      cover: getPublishedViewCover(extra),
      name: view.name,
      viewId: view.viewId,
      layout: view.layout,
      visibleViewIds: database.visibleViewIds,
      database_relations: view.databaseRelations,
      extra: extra as ViewMetaProps['extra'],
    }),
    [
      database.visibleViewIds,
      extra,
      view.databaseRelations,
      view.icon,
      view.layout,
      view.name,
      view.viewId,
    ]
  );

  return (
    <DatabaseView
      workspaceId="publish"
      doc={doc}
      initialRowMap={rowMap}
      viewMeta={viewMeta}
      createRow={publishContext?.createRow}
      loadView={loadView}
      loadRowDocument={loadRowDocument}
      navigateToView={publishContext?.toView}
      loadViewMeta={publishContext?.loadViewMeta}
      appendBreadcrumb={publishContext?.appendBreadcrumb}
      onRendered={publishContext?.onRendered}
      variant={UIVariant.Publish}
      getViewIdFromDatabaseId={publishContext?.getViewIdFromDatabaseId}
    />
  );
}

export default PublishedDatabaseRenderer;
