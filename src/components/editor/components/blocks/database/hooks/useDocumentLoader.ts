import EventEmitter from 'events';
import { useCallback, useEffect, useState } from 'react';

import { deleteCollabDB } from '@/application/db';
import { BindViewSync, LoadView, YDoc, YDocWithMeta } from '@/application/types';
import { determineErrorType, ErrorType } from '@/application/utils/error-utils';
import { isDatabaseViewNotFoundError } from '@/application/view-loader';
import { subscribeCollabDocReset } from '@/components/ws/sync/subscribeCollabDocReset';
import { CollabDocResetPayload } from '@/components/ws/sync/types';
import { Log } from '@/utils/log';

interface UseDocumentLoaderProps {
  viewId: string;
  databaseId?: string | null;
  loadView?: LoadView;
  bindViewSync?: BindViewSync;
  /**
   * Gives a sync binding back. With it the loader owns one binding of the doc
   * it loaded and releases it when it unmounts or loads another doc, so the
   * database stops syncing once nothing shows it. Without it the doc is bound
   * once and stays bound.
   */
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
  eventEmitter?: EventEmitter;
}

interface UseDocumentLoaderResult {
  doc: YDoc | null;
  notFound: boolean;
  noAccess: boolean;
  /** The load failed because the browser is offline (a network error, not a refusal). */
  offline: boolean;
  setNotFound: (notFound: boolean) => void;
}

function isOfflineError(error: unknown) {
  return (
    determineErrorType(error).type === ErrorType.NetworkError ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  );
}

/**
 * Hook for loading a database document.
 *
 * Handles:
 * - Loading the YDoc for the given viewId
 * - Retry logic on failure; a load nobody waits for any more is not retried
 * - NotFound / NoAccess state management
 * - Offline: a load that failed for the network is retried when the browser
 *   reports it is back online
 * - The realtime binding of the loaded doc, released on unmount when
 *   `scheduleDeferredCleanup` is given
 */
export function useDocumentLoader({
  viewId,
  databaseId,
  loadView,
  bindViewSync,
  scheduleDeferredCleanup,
  eventEmitter,
}: UseDocumentLoaderProps): UseDocumentLoaderResult {
  const [doc, setDoc] = useState<YDoc | null>(null);
  // The view `doc` was loaded for. Views of one database share a doc whose own
  // `view_id` names whichever view loaded it last.
  const [loadedViewId, setLoadedViewId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [offline, setOffline] = useState(false);
  // Bumped by the `online` event to load again after an offline failure.
  const [reloadToken, setReloadToken] = useState(0);
  const [syncBound, setSyncBound] = useState(false);

  const loadWithRetry = useCallback(
    async (viewIdToLoad: string, isCancelled: () => boolean, retries = 3): Promise<YDoc | null> => {
      if (!loadView) {
        Log.error('[useDocumentLoader] loadView not available', { viewIdToLoad });
        return null;
      }

      for (let attempt = 1; attempt <= retries; attempt++) {
        // The loader unmounted or moved on to another view: nobody waits for this load.
        if (isCancelled()) return null;

        try {
          Log.debug('[useDocumentLoader] attempt', { viewIdToLoad, attempt, retries });
          const result = await loadView(viewIdToLoad, false, false, { databaseId });

          if (result) {
            Log.debug('[useDocumentLoader] loadView returned doc', { viewIdToLoad, attempt });
            return result;
          }

          Log.debug('[useDocumentLoader] loadView returned null', { viewIdToLoad, attempt });
        } catch (error) {
          Log.error('[useDocumentLoader] loadView error', {
            viewIdToLoad,
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
          // Permission denials are permanent — retrying just hammers the server
          // with requests that will fail the same way, and so is a view its
          // database no longer holds: each retry would download the database
          // again. A network failure was already retried by the view loader;
          // the `online` event loads again.
          if (
            attempt === retries ||
            determineErrorType(error).type === ErrorType.Forbidden ||
            isDatabaseViewNotFoundError(error) ||
            isOfflineError(error) ||
            isCancelled()
          ) {
            throw error;
          }

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
      }

      return null;
    },
    [databaseId, loadView]
  );

  useEffect(() => {
    if (!viewId) return;

    let cancelled = false;

    const loadDocument = async () => {
      try {
        Log.debug('[useDocumentLoader] loading doc for viewId', { viewId });
        const loadedDoc = await loadWithRetry(viewId, () => cancelled);

        if (cancelled) return;

        Log.debug('[useDocumentLoader] loaded doc', { viewId, hasDoc: !!loadedDoc });
        setDoc(loadedDoc);
        setLoadedViewId(viewId);
        setNotFound(false);
        setNoAccess(false);
        setOffline(false);
        setSyncBound(false);
      } catch (error) {
        if (cancelled) return;

        Log.error('[useDocumentLoader] failed to load doc', {
          viewId,
          error: error instanceof Error ? error.message : String(error),
        });
        const isPermissionDenied = determineErrorType(error).type === ErrorType.Forbidden;

        // A permission failure must never be pinned by a stale local copy: evict
        // the collab keyed to this load so the next mount or reload refetches
        // once the server grants access, instead of serving the denial forever.
        if (isPermissionDenied) {
          void deleteCollabDB(databaseId ?? viewId, { destroyDoc: true }).catch(() => undefined);
        }

        setNoAccess(isPermissionDenied);
        setOffline(!isPermissionDenied && isOfflineError(error));
        setNotFound(true);
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;
    };
  }, [viewId, databaseId, loadWithRetry, reloadToken]);

  // Back online: try the failed load once more, so the source recovers without a reload.
  useEffect(() => {
    if (!viewId || !notFound || !offline) return;
    const handleOnline = () => setReloadToken((token) => token + 1);

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [notFound, offline, viewId]);

  // Without a way to give a binding back, the doc is bound once and stays bound.
  useEffect(() => {
    if (!doc || !bindViewSync || scheduleDeferredCleanup || syncBound) return;

    const docWithMeta = doc as YDocWithMeta;
    const docViewId = docWithMeta.view_id ?? docWithMeta.object_id;

    if (docViewId !== viewId) return;

    if (docWithMeta._syncBound) {
      setSyncBound(true);
      return;
    }

    const syncContext = bindViewSync(doc);

    if (syncContext) {
      setSyncBound(true);
    }
  }, [doc, bindViewSync, scheduleDeferredCleanup, syncBound, viewId]);

  // Otherwise the loader owns one binding of the doc, next to those of every
  // other view of the database, and releases it when it unmounts or its doc
  // changes. The sync layer drops the database once its last owner has left.
  useEffect(() => {
    if (!doc || !bindViewSync || !scheduleDeferredCleanup || loadedViewId !== viewId) return;

    const docWithMeta = doc as YDocWithMeta;
    const wasBound = docWithMeta._syncBound === true;
    const syncContext = bindViewSync(doc, { retain: true });

    if (!syncContext) return;
    // A binder that ignores `retain` marked the doc bound instead: that binding
    // belongs to the doc, and releasing it would leave the doc unsynced for good.
    if (!wasBound && docWithMeta._syncBound) return;

    const objectId = syncContext.doc.guid;

    return () => scheduleDeferredCleanup(objectId);
  }, [doc, bindViewSync, scheduleDeferredCleanup, loadedViewId, viewId]);

  useEffect(() => {
    if (!eventEmitter) return;

    const handleCollabDocReset = ({ objectId, viewId: resetViewId, doc: nextDoc }: CollabDocResetPayload) => {
      setDoc((currentDoc) => {
        if (!currentDoc) {
          return currentDoc;
        }

        const currentDocWithMeta = currentDoc as YDocWithMeta;
        const currentObjectId = currentDocWithMeta.object_id ?? currentDoc.guid;
        const currentViewId = currentDocWithMeta.view_id ?? currentObjectId;
        const matchesObject = objectId === currentObjectId || objectId === currentDoc.guid;
        const matchesView = resetViewId === viewId || resetViewId === currentViewId;

        if (!matchesObject && !matchesView) {
          return currentDoc;
        }

        const nextDocWithMeta = nextDoc as YDocWithMeta;

        nextDocWithMeta.object_id = nextDocWithMeta.object_id ?? currentObjectId;
        nextDocWithMeta.view_id = nextDocWithMeta.view_id ?? currentViewId;
        nextDocWithMeta._collabType = nextDocWithMeta._collabType ?? currentDocWithMeta._collabType;
        nextDocWithMeta._syncBound = true;

        return nextDoc;
      });
    };

    return subscribeCollabDocReset(eventEmitter, handleCollabDocReset);
  }, [eventEmitter, viewId]);

  return { doc, notFound, noAccess, offline, setNotFound };
}
