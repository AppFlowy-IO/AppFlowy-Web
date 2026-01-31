import React, { lazy, memo, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { APP_EVENTS } from '@/application/constants';
import { UIVariant, View, ViewLayout, ViewMetaProps, YDoc } from '@/application/types';
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
import type { YDocWithMeta } from '@/components/app/hooks/useViewOperations';
import { Document } from '@/components/document';
import RecordNotFound from '@/components/error/RecordNotFound';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

const ViewHelmet = lazy(() => import('@/components/_shared/helmet/ViewHelmet'));

function AppPage() {
  const viewId = useAppViewId();
  const outline = useAppOutline();
  const ref = React.useRef<HTMLDivElement>(null);
  const workspaceId = useCurrentWorkspaceId();
  const {
    toView,
    loadViewMeta,
    createRow,
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
    bindViewSync,
    ...handlers
  } = useAppHandlers();
  const { eventEmitter } = handlers;
  const { getViewReadOnlyStatus } = useViewOperations();

  const currentUser = useCurrentUser();
  const service = useService();

  // View from outline (may be undefined if outline hasn't updated yet)
  const outlineView = useMemo(() => {
    if (!outline || !viewId) return;
    return findView(outline, viewId);
  }, [outline, viewId]);

  // Fallback view fetched from server when not in outline
  const [fallbackView, setFallbackView] = React.useState<View | null>(null);

  // Fetch view metadata when not found in outline (handles race condition after creating new view)
  useEffect(() => {
    if (outlineView || !viewId || !workspaceId || !service) {
      // Clear fallback when outline has the view
      if (outlineView && fallbackView?.view_id === viewId) {
        setFallbackView(null);
      }

      return;
    }

    // Already fetched for this viewId.
    if (fallbackView?.view_id === viewId) {
      return;
    }

    // View not in outline - fetch from server directly
    let cancelled = false;

    service
      .getAppView(workspaceId, viewId)
      .then((fetchedView) => {
        if (!cancelled && fetchedView) {
          setFallbackView(fetchedView);
        }
      })
      .catch((e) => {
        console.warn('[AppPage] Failed to fetch view metadata for', viewId, e);
      });

    return () => {
      cancelled = true;
    };
  }, [outlineView, viewId, workspaceId, service, fallbackView?.view_id]);

  // Use outline view if available, otherwise use fallback
  const view = outlineView ?? fallbackView;
  const layout = view?.layout;

  const rendered = useContext(AppContext)?.rendered;

  const helmet = useMemo(() => {
    return view && rendered ? (
      <Suspense>
        <ViewHelmet name={view.name} icon={view.icon || undefined} />
      </Suspense>
    ) : null;
  }, [rendered, view]);
  const [doc, setDoc] = React.useState<YDoc | undefined>(undefined);
  const [error, setError] = React.useState<AppError | null>(null);
  // Track whether sync has been bound for the current doc
  const [syncBound, setSyncBound] = useState(false);

  // Track in-progress loads to prevent duplicate requests and enable recovery.
  const loadAttemptRef = useRef<{ viewId: string; timestamp: number } | null>(null);
  // Ref to access current doc in timer callbacks without stale closures.
  const docRef = useRef<YDoc | undefined>(undefined);

  docRef.current = doc;

  const loadPageDoc = useCallback(
    async (id: string) => {
      loadAttemptRef.current = { viewId: id, timestamp: Date.now() };
      setError(null);
      // Reset sync state when loading new doc
      setSyncBound(false);

      try {
        // loadView now uses view-loader which:
        // 1. Opens from IndexedDB cache if available (instant)
        // 2. Fetches from server only if not cached
        // 3. Does NOT bind sync - that happens after render
        const loadedDoc = await loadView(id, false, true);

        Log.debug('[AppPage] loadPageDoc complete, setting doc state', {
          viewId: id,
          docObjectId: loadedDoc.object_id,
        });

        // Set doc state - sync binding happens in separate effect after render
        // No flushSync needed since WebSocket sync starts AFTER render
        setDoc(loadedDoc);

        // Clear the attempt after successful load
        if (loadAttemptRef.current?.viewId === id) {
          loadAttemptRef.current = null;
        }
      } catch (e) {
        const appError = determineErrorType(e);

        setError(appError);
        console.error('[AppPage] Error loading view:', formatErrorForLogging(e));
        // Clear the attempt on error
        if (loadAttemptRef.current?.viewId === id) {
          loadAttemptRef.current = null;
        }
      }
    },
    [loadView]
  );

  // Load document when viewId changes. Skip if doc already loaded or load in progress
  // to prevent duplicate requests when outline updates trigger effect re-runs.
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

    // Skip if we already have the doc for this viewId or if a load is already in progress
    // This prevents double-loading when `view` dependency changes (e.g., outline updates)
    if (docRef.current?.object_id === viewId || loadAttemptRef.current?.viewId === viewId) {
      return;
    }

    void loadPageDoc(viewId);
  }, [loadPageDoc, viewId, layout, toView, view]);

  // Recovery: Re-trigger load if doc doesn't match viewId after timeout.
  // Acts as safety net for edge cases where initial load didn't complete.
  useEffect(() => {
    if (!viewId || layout === undefined || layout === ViewLayout.AIChat) return;
    if (isDatabaseContainer(view)) return;

    // Check if doc matches current viewId
    const docMatchesViewId = doc?.object_id === viewId;

    if (docMatchesViewId) return;

    // Only set recovery timer if there's no active load attempt for this viewId
    // This prevents multiple timers from being set when effect re-runs due to other dependencies
    if (loadAttemptRef.current?.viewId === viewId) {
      // Load already in progress for this viewId, don't set another timer
      return;
    }

    // Doc doesn't match and no load in progress - set up a recovery timer
    const recoveryTimer = setTimeout(() => {
      // Check if doc now matches (load completed while timer was pending)
      if (docRef.current?.object_id === viewId) {
        return;
      }

      // Double-check the condition after delay
      if (loadAttemptRef.current?.viewId === viewId) {
        // Load was attempted but doc still doesn't match
        const elapsed = Date.now() - loadAttemptRef.current.timestamp;

        if (elapsed > 2000) {
          // More than 2 seconds since load started - re-trigger
          void loadPageDoc(viewId);
        }
      } else if (!loadAttemptRef.current) {
        // No load attempt recorded - trigger one
        void loadPageDoc(viewId);
      }
    }, 500);

    return () => clearTimeout(recoveryTimer);
  }, [viewId, layout, view, doc?.object_id, loadPageDoc]);

  useEffect(() => {
    if (layout === ViewLayout.AIChat) {
      setDoc(undefined);
      setError(null);
      setSyncBound(false);
    }
  }, [layout]);

  // Bind sync AFTER component renders with the doc
  // This ensures WebSocket sync starts only after UI is ready
  useEffect(() => {
    if (!doc || !viewId || syncBound || !bindViewSync) return;

    const docWithMeta = doc as YDocWithMeta;

    // Verify doc matches current viewId
    if (docWithMeta.object_id !== viewId) {
      Log.debug('[AppPage] bindViewSync skipped - doc viewId mismatch', {
        docObjectId: docWithMeta.object_id,
        viewId,
      });
      return;
    }

    if (docWithMeta._syncBound) {
      setSyncBound(true);
      return;
    }

    Log.debug('[AppPage] bindViewSync starting', {
      viewId,
      docObjectId: docWithMeta.object_id,
    });

    // Bind sync for the document - starts WebSocket sync
    const syncContext = bindViewSync(doc);

    if (syncContext) {
      setSyncBound(true);
      Log.debug('[AppPage] bindViewSync complete', { viewId });
    }
  }, [doc, viewId, syncBound, bindViewSync]);

  const viewMeta: ViewMetaProps | null = useMemo(() => {
    if (view) {
      return {
        name: view.name,
        icon: view.icon || undefined,
        cover: view.extra?.cover || undefined,
        layout: view.layout,
        visibleViewIds: [],
        viewId: view.view_id,
        extra: view.extra,
        workspaceId,
      };
    }

    return null;
  }, [view, workspaceId]);

  const handleUploadFile = useCallback(
    (file: File, onProgress?: (progress: number) => void) => {
      if (viewId && uploadFile) {
        return uploadFile(viewId, file, onProgress);
      }

      return Promise.reject();
    },
    [uploadFile, viewId]
  );

  const requestInstance = service?.getAxiosInstance();

  // Check if view is in shareWithMe and determine readonly status
  const isReadOnly = useMemo(() => {
    if (!viewId) return false;
    return getViewReadOnlyStatus(viewId, outline);
  }, [getViewReadOnlyStatus, viewId, outline]);

  const viewDom = useMemo(() => {
    // Check if doc belongs to current viewId (handles race condition when doc from old view arrives after navigation)
    const docForCurrentView = doc && doc.object_id === viewId ? doc : undefined;

    if (!docForCurrentView && layout === ViewLayout.AIChat && viewId) {
      return (
        <Suspense>
          <AIChat chatId={viewId} onRendered={onRendered} />
        </Suspense>
      );
    }

    if (!docForCurrentView || !viewMeta || !workspaceId) {
      return null;
    }

    if (layout === ViewLayout.Document) {
      return (
        <Document
          key={viewId}
          requestInstance={requestInstance}
          workspaceId={workspaceId}
          doc={docForCurrentView}
          readOnly={isReadOnly}
          viewMeta={viewMeta}
          navigateToView={toView}
          loadViewMeta={loadViewMeta}
          createRow={createRow}
          appendBreadcrumb={appendBreadcrumb}
          loadView={loadView}
          bindViewSync={bindViewSync}
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
      );
    }

    return (
      <DatabaseView
        key={viewId}
        requestInstance={requestInstance}
        workspaceId={workspaceId}
        doc={docForCurrentView}
        readOnly={isReadOnly}
        viewMeta={viewMeta}
        navigateToView={toView}
        loadViewMeta={loadViewMeta}
        createRow={createRow}
        appendBreadcrumb={appendBreadcrumb}
        loadView={loadView}
        bindViewSync={bindViewSync}
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
    );
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
    createRow,
    appendBreadcrumb,
    loadView,
    bindViewSync,
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
    if (!viewId || !workspaceId || !currentUser?.uuid) return;
    // Use workspace and user specific key to avoid cross-user/workspace conflicts
    const key = `last_view_id_${workspaceId}_${currentUser.uuid}`;

    localStorage.setItem(key, viewId);
  }, [viewId, workspaceId, currentUser?.uuid]);

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
