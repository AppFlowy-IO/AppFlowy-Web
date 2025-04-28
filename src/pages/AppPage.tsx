import { UIVariant, ViewLayout, ViewMetaProps, YDoc } from '@/application/types';
import Help from '@/components/_shared/help/Help';
import { findView } from '@/components/_shared/outline/utils';
import {
  AppContext,
  useAppHandlers,
  useAppOutline,
  useAppViewId,
  useCurrentWorkspaceId,
} from '@/components/app/app.hooks';
import DatabaseView from '@/components/app/DatabaseView';
import { Document } from '@/components/document';
import RecordNotFound from '@/components/error/RecordNotFound';
import { useService } from '@/components/main/app.hooks';
import { getPlatform } from '@/utils/platform';
import React, { lazy, memo, Suspense, useCallback, useContext, useEffect, useMemo } from 'react';
import { AIChat } from '@/components/ai-chat';

const ViewHelmet = lazy(() => import('@/components/_shared/helmet/ViewHelmet'));

function AppPage () {
  const viewId = useAppViewId();
  const outline = useAppOutline();
  const ref = React.useRef<HTMLDivElement>(null);
  const workspaceId = useCurrentWorkspaceId();
  const {
    toView,
    loadViewMeta,
    createRowDoc,
    loadView,
    appendBreadcrumb,
    onRendered,
    updatePage,
    addPage,
    deletePage,
    openPageModal,
    loadViews,
    setWordCount,
    uploadFile,
    ...handlers
  } = useAppHandlers();
  const view = useMemo(() => {
    if (!outline || !viewId) return;
    return findView(outline, viewId);
  }, [outline, viewId]);
  const rendered = useContext(AppContext)?.rendered;

  const helmet = useMemo(() => {
    return view && rendered ? (
      <Suspense>
        <ViewHelmet
          name={view.name}
          icon={view.icon || undefined}
        />
      </Suspense>
    ) : null;
  }, [rendered, view]);

  const layout = view?.layout;
  const [doc, setDoc] = React.useState<YDoc | undefined>(undefined);
  const [notFound, setNotFound] = React.useState(false);
  const loadPageDoc = useCallback(
    async (id: string) => {
      setNotFound(false);
      setDoc(undefined);
      try {
        const doc = await loadView(id);

        setDoc(doc);
      } catch (e) {
        setNotFound(true);
        console.error(e);
      }
    },
    [loadView],
  );

  useEffect(() => {
    if (!viewId || layout === undefined || layout === ViewLayout.AIChat) return;

    void loadPageDoc(viewId);
  }, [loadPageDoc, viewId, layout]);

  useEffect(() => {
    if (layout === ViewLayout.AIChat) {
      setDoc(undefined);
      setNotFound(false);
    }
  }, [layout]);

  const viewMeta: ViewMetaProps | null = useMemo(() => {
    return view
      ? {
        name: view.name,
        icon: view.icon || undefined,
        cover: view.extra?.cover || undefined,
        layout: view.layout,
        visibleViewIds: [],
        viewId: view.view_id,
        extra: view.extra,
        workspaceId,
      }
      : null;
  }, [view, workspaceId]);

  const handleUploadFile = useCallback(
    (file: File) => {
      if (view && uploadFile) {
        return uploadFile(view.view_id, file);
      }

      return Promise.reject();
    },
    [uploadFile, view],
  );

  const service = useService();
  const requestInstance = service?.getAxiosInstance();
  const isMobile = getPlatform().isMobile;

  const viewDom = useMemo(() => {

    if (!doc && layout === ViewLayout.AIChat && viewId) {
      return (
        <Suspense>
          <AIChat
            chatId={viewId}
            onRendered={onRendered}
          />
        </Suspense>
      );
    }

    const View = layout === ViewLayout.Document ? Document : DatabaseView;

    return doc && viewMeta && workspaceId && View ? (
      <View
        requestInstance={requestInstance}
        workspaceId={workspaceId}
        doc={doc}
        readOnly={Boolean(isMobile)}
        viewMeta={viewMeta}
        navigateToView={toView}
        loadViewMeta={loadViewMeta}
        createRowDoc={createRowDoc}
        appendBreadcrumb={appendBreadcrumb}
        loadView={loadView}
        onRendered={onRendered}
        updatePage={updatePage}
        addPage={addPage}
        deletePage={deletePage}
        openPageModal={openPageModal}
        loadViews={loadViews}
        onWordCountChange={setWordCount}
        uploadFile={handleUploadFile}
        variant={UIVariant.App}
        {...handlers}
      />
    ) : null;
  }, [doc, layout, handlers, viewId, viewMeta, workspaceId, requestInstance, isMobile, toView, loadViewMeta, createRowDoc, appendBreadcrumb, loadView, onRendered, updatePage, addPage, deletePage, openPageModal, loadViews, setWordCount, handleUploadFile]);

  useEffect(() => {
    if (!viewId) return;
    localStorage.setItem('last_view_id', viewId);
  }, [viewId]);

  if (!viewId) return null;
  return (
    <div
      ref={ref}
      className={'relative h-full w-full'}
    >
      {helmet}

      {notFound ? <RecordNotFound /> : <div className={'h-full w-full'}>{viewDom}</div>}
      {view && <Help />}
    </div>
  );
}

export default memo(AppPage);
