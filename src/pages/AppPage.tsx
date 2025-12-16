import React, { lazy, memo, Suspense, useCallback, useContext, useEffect, useMemo } from 'react';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { UIVariant, ViewLayout, ViewMetaProps, YDoc } from '@/application/types';
import { AppError, determineErrorType, formatErrorForLogging } from '@/application/utils/error-utils';
import { getFirstChildView, isDatabaseContainer } from '@/application/view-utils';
import Help from '@/components/_shared/help/Help';
import { findView } from '@/components/_shared/outline/utils';
import { AIChat } from '@/components/ai-chat';
import {
  AppContext,
  useAppHandlers,
  useAppOutline,
  useAppViewId,
  useCurrentWorkspaceId,
} from '@/components/app/app.hooks';
import DatabaseView from '@/components/app/DatabaseView';
import { useViewOperations } from '@/components/app/hooks/useViewOperations';
import { Document } from '@/components/document';
import RecordNotFound from '@/components/error/RecordNotFound';
import { useCurrentUser, useService } from '@/components/main/app.hooks';

const ViewHelmet = lazy(() => import('@/components/_shared/helmet/ViewHelmet'));

function AppPage() {
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
  const { eventEmitter } = handlers;
  const { getViewReadOnlyStatus } = useViewOperations();

  const currentUser = useCurrentUser();
  const view = useMemo(() => {
    if (!outline || !viewId) return;
    return findView(outline, viewId);
  }, [outline, viewId]);
  const rendered = useContext(AppContext)?.rendered;

  const helmet = useMemo(() => {
    return view && rendered ? (
      <Suspense>
        <ViewHelmet name={view.name} icon={view.icon || undefined} />
      </Suspense>
    ) : null;
  }, [rendered, view]);

  const layout = view?.layout;
  const [doc, setDoc] = React.useState<YDoc | undefined>(undefined);
  const [error, setError] = React.useState<AppError | null>(null);
  const loadPageDoc = useCallback(
    async (id: string) => {
      setError(null);
      setDoc(undefined);
      try {
        const doc = await loadView(id, false, true);

        setDoc(doc);
      } catch (e) {
        const appError = determineErrorType(e);

        setError(appError);
        console.error('[AppPage] Error loading view:', formatErrorForLogging(e));
      }
    },
    [loadView]
  );

  useEffect(() => {
    if (!viewId || layout === undefined || layout === ViewLayout.AIChat) return;

    if (isDatabaseContainer(view)) {
      const firstChild = getFirstChildView(view);

      if (firstChild) {
        // Clear current state to avoid rendering stale content while redirecting
        setError(null);
        setDoc(undefined);
        void toView(firstChild.view_id, undefined, true);
        return;
      }

      // If outline doesn't include container children yet, delegate to toView() so it can
      // resolve the first child (may fetch from server).
      setError(null);
      setDoc(undefined);
      void toView(viewId, undefined, true);
      return;
    }

    void loadPageDoc(viewId);
  }, [loadPageDoc, viewId, layout, toView, view]);

  useEffect(() => {
    if (layout === ViewLayout.AIChat) {
      setDoc(undefined);
      setError(null);
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
    [uploadFile, view]
  );

  const service = useService();
  const requestInstance = service?.getAxiosInstance();

  // Check if view is in shareWithMe and determine readonly status
  const isReadOnly = useMemo(() => {
    if (!viewId) return false;
    return getViewReadOnlyStatus(viewId, outline);
  }, [getViewReadOnlyStatus, viewId, outline]);

  const viewDom = useMemo(() => {
    if (!doc && layout === ViewLayout.AIChat && viewId) {
      return (
        <Suspense>
          <AIChat chatId={viewId} onRendered={onRendered} />
        </Suspense>
      );
    }

    const View = layout === ViewLayout.Document ? Document : DatabaseView;

    return doc && viewMeta && workspaceId && View ? (
      <View
        requestInstance={requestInstance}
        workspaceId={workspaceId}
        doc={doc}
        readOnly={isReadOnly}
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
  }, [
    doc,
    layout,
    handlers,
    viewId,
    viewMeta,
    workspaceId,
    requestInstance,
    isReadOnly,
    toView,
    loadViewMeta,
    createRowDoc,
    appendBreadcrumb,
    loadView,
    onRendered,
    updatePage,
    addPage,
    deletePage,
    openPageModal,
    loadViews,
    setWordCount,
    handleUploadFile,
  ]);

  useEffect(() => {
    if (!viewId) return;
    localStorage.setItem('last_view_id', viewId);
  }, [viewId]);

  useEffect(() => {
    const handleShareViewsChanged = ({ emails, viewId: id }: { emails: string[]; viewId: string }) => {
      if (id === viewId && emails.includes(currentUser?.email || '')) {
        toast.success('Permission changed');
      }
    };

    if (eventEmitter) {
      eventEmitter.on(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
    }

    return () => {
      if (eventEmitter) {
        eventEmitter.off(APP_EVENTS.SHARE_VIEWS_CHANGED, handleShareViewsChanged);
      }
    };
  }, [eventEmitter, viewId, currentUser?.email]);

  if (!viewId) return null;
  return (
    <div ref={ref} className={'relative h-full w-full'}>
      {helmet}

      {error ? <RecordNotFound viewId={viewId} error={error} /> : <div className={'h-full w-full'}>{viewDom}</div>}
      {view && <Help />}
    </div>
  );
}

export default memo(AppPage);
