import { useLiveQuery } from 'dexie-react-hooks';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { db } from '@/application/db';
import { ViewMeta } from '@/application/db/tables/view_metas';
import { createDatabaseYjsRenderDocsFromSnapshot } from '@/application/publish-snapshot/database-yjs-render-bridge';
import { createPublishSnapshotDataSource } from '@/application/publish-snapshot/data-source';
import {
  createDocumentYjsRenderDocFromRawData,
  createDocumentYjsRenderDocFromSnapshot,
} from '@/application/publish-snapshot/document-yjs-render-bridge';
import type { PublishedDocumentRaw, PublishedPageSnapshot, PublishedView } from '@/application/publish-snapshot/types';
import { AppendBreadcrumb, CreateRow, LoadView, LoadViewMeta, View, ViewInfo, ViewLayout, YDoc } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { findAncestors, findView } from '@/components/_shared/outline/utils';
import { PublishService, RowService } from '@/application/services/domains';

function publishedViewToViewInfo(view: PublishedView): ViewInfo {
  return {
    view_id: view.viewId,
    name: view.name,
    icon: view.icon,
    extra: view.extra,
    layout: view.layout,
    created_at: '',
    created_by: '',
    last_edited_time: '',
    last_edited_by: '',
    child_views: view.childViews,
  };
}

function publishedSnapshotToViewMeta(snapshot: PublishedPageSnapshot): ViewMeta {
  const viewInfo = publishedViewToViewInfo(snapshot.view);

  return {
    ...viewInfo,
    publish_name: `${snapshot.namespace}_${snapshot.publishName}`,
    child_views: snapshot.view.childViews,
    ancestor_views: snapshot.view.ancestorViews,
    visible_view_ids: snapshot.view.visibleViewIds,
    database_relations: snapshot.view.databaseRelations,
  };
}

function parseViewInfoToView(meta: ViewInfo | ViewMeta): View {
  let extra = null;

  try {
    extra = meta.extra ? JSON.parse(meta.extra) : null;
  } catch (e) {
    // do nothing
  }

  return {
    is_private: false,
    view_id: meta.view_id,
    name: meta.name,
    layout: meta.layout,
    extra,
    icon: meta.icon,
    children: meta.child_views?.map(parseViewInfoToView) || [],
    is_published: true,
    database_relations: 'database_relations' in meta ? meta.database_relations : undefined,
  };
}

function findViewInfoById(views: ViewInfo[] | null | undefined, viewId: string): ViewInfo | undefined {
  if (!views) return;

  for (const view of views) {
    if (view.view_id === viewId) return view;

    const child = findViewInfoById(view.child_views, viewId);

    if (child) return child;
  }
}

function snapshotToRenderDoc(snapshot: PublishedPageSnapshot) {
  if (snapshot.kind === 'database') {
    return createDatabaseYjsRenderDocsFromSnapshot(snapshot).doc;
  }

  return createDocumentYjsRenderDocFromSnapshot(snapshot);
}

function rowDocumentsFromSnapshot(snapshot: PublishedPageSnapshot): Record<string, PublishedDocumentRaw> {
  if (snapshot.kind !== 'database') return {};

  return snapshot.database.raw.row_documents;
}

export interface PublishContextType {
  namespace: string;
  publishName: string;
  isTemplate?: boolean;
  isTemplateThumb?: boolean;
  viewMeta?: ViewMeta;
  toView: (viewId: string, blockId?: string) => Promise<void>;
  loadViewMeta: LoadViewMeta;
  createRow?: CreateRow;
  loadView: LoadView;
  loadRowDocument?: (documentId: string) => Promise<YDoc | null>;
  outline?: View[];
  appendBreadcrumb?: AppendBreadcrumb;
  breadcrumbs: View[];
  rendered?: boolean;
  onRendered?: () => void;
  commentEnabled?: boolean;
  duplicateEnabled?: boolean;
  getViewIdFromDatabaseId?: (databaseId: string) => Promise<string | null>;
}

export const PublishContext = createContext<PublishContextType | null>(null);

export const PublishProvider = ({
  children,
  namespace,
  publishName,
  isTemplateThumb,
  isTemplate,
  snapshot,
}: {
  children: React.ReactNode;
  namespace: string;
  publishName: string;
  isTemplateThumb?: boolean;
  isTemplate?: boolean;
  snapshot?: PublishedPageSnapshot;
}) => {
  const [outline, setOutline] = useState<View[]>([]);
  const createdRowKeys = useRef<string[]>([]);
  const [rendered, setRendered] = useState(false);
  const [snapshotDataSource] = useState(() => createPublishSnapshotDataSource());
  const rowDocumentSnapshotsRef = useRef<Record<string, PublishedDocumentRaw>>({});
  const rowDocumentDocsRef = useRef<Map<string, YDoc>>(new Map());
  const viewMetaSubscribersRef = useRef<Map<string, (meta: ViewMeta) => void>>(new Map());

  const registerSnapshotRowDocuments = useCallback((snapshot: PublishedPageSnapshot) => {
    Object.assign(rowDocumentSnapshotsRef.current, rowDocumentsFromSnapshot(snapshot));
  }, []);

  const snapshotViewMeta = useMemo(() => {
    return snapshot ? publishedSnapshotToViewMeta(snapshot) : undefined;
  }, [snapshot]);

  const cachedViewMeta = useLiveQuery(async () => {
    const name = `${namespace}_${publishName}`;

    return db.view_metas.get(name);
  }, [namespace, publishName]);

  const viewMeta = useMemo(() => {
    const view = snapshotViewMeta ?? cachedViewMeta;

    if (!view) return;

    return {
      ...view,
      name: findView(outline, view.view_id)?.name || view.name,
    };
  }, [cachedViewMeta, outline, snapshotViewMeta]);

  const viewId = viewMeta?.view_id;

  const [publishInfo, setPublishInfo] = React.useState<
    | {
        commentEnabled: boolean;
        duplicateEnabled: boolean;
      }
    | undefined
  >();

  const originalCrumbs = useMemo(() => {
    if (!viewMeta) return [];
    const ancestors = outline.length > 0 ? findAncestors(outline, viewMeta.view_id) : undefined;

    if (ancestors) return ancestors;
    if (!viewMeta?.ancestor_views) return [];

    const currentView = parseViewInfoToView(viewMeta);
    const crumbs = viewMeta.ancestor_views
      .slice(1)
      .map((item) => findView(outline, item.view_id) || parseViewInfoToView(item));

    return crumbs.length > 0 ? crumbs : [currentView];
  }, [viewMeta, outline]);

  const [breadcrumbs, setBreadcrumbs] = useState<View[]>([]);

  useEffect(() => {
    setBreadcrumbs(originalCrumbs);
  }, [originalCrumbs]);

  const appendBreadcrumb = useCallback((view?: View) => {
    setBreadcrumbs((prev) => {
      if (!view) {
        return prev.slice(0, -1);
      }

      const index = prev.findIndex((v) => v.view_id === view.view_id);

      if (index === -1) {
        return [...prev, view];
      }

      const rest = prev.slice(0, index);

      return [...rest, view];
    });
  }, []);

  useEffect(() => {
    rowDocumentSnapshotsRef.current = {};
    rowDocumentDocsRef.current.clear();

    if (snapshot) {
      registerSnapshotRowDocuments(snapshot);
    }
  }, [namespace, publishName, registerSnapshotRowDocuments, snapshot]);

  useEffect(() => {
    const subscribers = viewMetaSubscribersRef.current;
    const handleCreating = (primaryKey: string, obj: ViewMeta) => {
      const subscriber = subscribers.get(String(primaryKey));

      subscriber?.(obj);

      return obj;
    };

    const handleDeleting = (primaryKey: string, obj: ViewMeta) => {
      const subscriber = subscribers.get(String(primaryKey));

      subscriber?.(obj);

      return;
    };

    const handleUpdating = (modifications: Partial<ViewMeta>, primaryKey: string, obj: ViewMeta) => {
      const subscriber = subscribers.get(String(primaryKey));

      subscriber?.({
        ...obj,
        ...modifications,
      });

      return modifications;
    };

    db.view_metas.hook('creating', handleCreating);
    db.view_metas.hook('deleting', handleDeleting);
    db.view_metas.hook('updating', handleUpdating);

    return () => {
      db.view_metas.hook('creating').unsubscribe(handleCreating);
      db.view_metas.hook('deleting').unsubscribe(handleDeleting);
      db.view_metas.hook('updating').unsubscribe(handleUpdating);
      subscribers.clear();
    };
  }, []);

  const prevViewMeta = useRef(viewMeta);

  useEffect(() => {
    const rowKeys = createdRowKeys.current;

    createdRowKeys.current = [];

    if (!rowKeys.length) return;
    rowKeys.forEach((rowKey) => {
      try {
        RowService.remove(rowKey);
      } catch (e) {
        console.error(e);
      }
    });
  }, [publishName]);

  const loadPublishInfo = useCallback(async () => {
    if (!viewId) return;
    try {
      const res = await PublishService.getViewInfo(viewId);

      setPublishInfo(res);

      // eslint-disable-next-line
    } catch (e: any) {
      // do nothing
    }
  }, [viewId]);

  useEffect(() => {
    void loadPublishInfo();
  }, [loadPublishInfo]);

  const navigate = useNavigate();

  const loadViewMeta = useCallback(
    async (viewId: string, callback?: (meta: View | null) => void) => {
      try {
        const snapshotMeta =
          viewMeta?.view_id === viewId
            ? viewMeta
            : findViewInfoById(snapshotViewMeta?.child_views, viewId) ||
              findViewInfoById(snapshotViewMeta?.ancestor_views, viewId);

        if (snapshotMeta) {
          const view = parseViewInfoToView(snapshotMeta);

          callback?.(view);
          return view;
        }

        const info = await PublishService.getViewInfo(viewId);

        if (!info) {
          throw new Error('View has not been published yet');
        }

        const { namespace, publishName } = info;
        const name = `${namespace}_${publishName}`;
        const meta = await PublishService.getViewMeta(namespace, publishName);

        if (!meta) {
          return Promise.reject(new Error('View meta has not been published yet'));
        }

        const res = parseViewInfoToView(meta);

        callback?.(res);

        if (callback) {
          viewMetaSubscribersRef.current.set(name, (meta) => {
            return callback?.(parseViewInfoToView(meta));
          });
        }

        return res;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [snapshotViewMeta, viewMeta]
  );

  const toView = useCallback(
    async (viewId: string, blockId?: string) => {
      try {
        const view = await loadViewMeta(viewId);

        const res = await PublishService.getViewInfo(viewId);

        if (!res) {
          throw new Error('View has not been published yet');
        }

        const { namespace: viewNamespace, publishName } = res;

        prevViewMeta.current = undefined;
        const searchParams = new URLSearchParams('');

        if (blockId) {
          switch (view.layout) {
            case ViewLayout.Document:
              searchParams.set('blockId', blockId);
              break;
            case ViewLayout.Grid:
            case ViewLayout.Board:
            case ViewLayout.Calendar:
              searchParams.set('r', blockId);
              break;
            default:
              break;
          }
        }

        if (isTemplate) {
          searchParams.set('template', 'true');
        }

        let url = `/${viewNamespace}/${publishName}`;

        if (searchParams.toString()) {
          url += `?${searchParams.toString()}`;
        }

        navigate(url, {
          replace: true,
        });
        return;
      } catch (e) {
        // For unpublished sibling database views, switch the tab via URL parameter
        // instead of navigating to a non-existent published page.
        // Only apply this fallback when a ?v= param is already present (indicating
        // we're on a database page with tabs). Otherwise, re-throw so callers
        // (e.g., relation pills, @-mentions) can handle the error.
        const currentParams = new URLSearchParams(window.location.search);

        currentParams.set('v', viewId);
        navigate(`${window.location.pathname}?${currentParams.toString()}`, {
          replace: true,
        });
      }
    },
    [loadViewMeta, isTemplate, navigate]
  );

  const loadOutline = useCallback(async () => {
    if (!namespace) return;
    try {
      const res = await PublishService.getOutline(namespace);

      if (!res) {
        throw new Error('Publish outline not found');
      }

      setOutline(res);
    } catch (e) {
      notify.error('Publish outline not found');
    }
  }, [namespace]);

  const createRow = useCallback(
    async (rowKey: string) => {
      try {
        const doc = await RowService.create(rowKey);

        if (!doc) {
          throw new Error('Failed to create row');
        }

        createdRowKeys.current.push(rowKey);
        return doc;
      } catch (e) {
        return Promise.reject(e);
      }
    },
    []
  );

  const loadRowDocument = useCallback(async (documentId: string): Promise<YDoc | null> => {
    const cachedDoc = rowDocumentDocsRef.current.get(documentId);

    if (cachedDoc) return cachedDoc;

    const rawDocument = rowDocumentSnapshotsRef.current[documentId];

    if (!rawDocument) return null;

    const doc = createDocumentYjsRenderDocFromRawData(documentId, rawDocument);

    rowDocumentDocsRef.current.set(documentId, doc);
    return doc;
  }, []);

  const loadView = useCallback(
    async (viewId: string, isSubDocument?: boolean) => {
      if (isSubDocument) {
        const data = await loadRowDocument(viewId);

        if (!data) {
          return Promise.reject(new Error('View has not been published yet'));
        }

        return data;
      }

      try {
        if (snapshot?.view.viewId === viewId) {
          return snapshotToRenderDoc(snapshot);
        }

        const res = await PublishService.getViewInfo(viewId);

        if (!res) {
          throw new Error('View has not been published yet');
        }

        const { namespace, publishName } = res;

        const data = await snapshotDataSource.getPage(namespace, publishName);

        if (!data) {
          throw new Error('View has not been published yet');
        }

        registerSnapshotRowDocuments(data);

        return snapshotToRenderDoc(data);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    [loadRowDocument, registerSnapshotRowDocuments, snapshot, snapshotDataSource]
  );

  const onRendered = useCallback(() => {
    setRendered(true);
  }, []);

  useEffect(() => {
    if (!viewMeta && prevViewMeta.current) {
      window.location.reload();
      return;
    }

    prevViewMeta.current = viewMeta;
  }, [viewMeta]);

  const getViewIdFromDatabaseId = useCallback(
    async (databaseId: string) => {
      const databaseRelations = Object.entries(viewMeta?.database_relations || {});

      for (const [relationDatabaseId, relationViewId] of databaseRelations) {
        if (relationDatabaseId === databaseId) {
          return relationViewId;
        }
      }

      if (!viewId) return null;
      const currentView = await loadViewMeta(viewId);

      if (!currentView) return null;

      for (const [relationDatabaseId, relationViewId] of Object.entries(currentView.database_relations || {})) {
        if (relationDatabaseId === databaseId) {
          return relationViewId;
        }
      }

      return null;
    },
    [loadViewMeta, viewId, viewMeta]
  );

  useEffect(() => {
    void loadOutline();
  }, [loadOutline]);
  const commentEnabled = publishInfo?.commentEnabled;
  const duplicateEnabled = publishInfo?.duplicateEnabled;
  const contextValue = useMemo(
    () => ({
      loadView,
      viewMeta,
      createRow,
      loadViewMeta,
      toView,
      namespace,
      publishName,
      isTemplateThumb,
      outline,
      breadcrumbs,
      appendBreadcrumb,
      onRendered,
      rendered,
      commentEnabled,
      duplicateEnabled,
      getViewIdFromDatabaseId,
      loadRowDocument,
    }),
    [
      loadView,
      viewMeta,
      createRow,
      loadViewMeta,
      toView,
      namespace,
      publishName,
      isTemplateThumb,
      outline,
      breadcrumbs,
      appendBreadcrumb,
      onRendered,
      rendered,
      commentEnabled,
      duplicateEnabled,
      getViewIdFromDatabaseId,
      loadRowDocument,
    ]
  );

  return (
    <PublishContext.Provider value={contextValue}>
      {children}
    </PublishContext.Provider>
  );
};

export function usePublishContext() {
  return useContext(PublishContext);
}
