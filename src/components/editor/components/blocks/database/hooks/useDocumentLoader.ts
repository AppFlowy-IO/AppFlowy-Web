import EventEmitter from 'events';

import { useCallback, useEffect, useState } from 'react';

import { retainRollupSource } from '@/application/database-yjs/rollup/source-sync';
import { deleteCollabDB } from '@/application/db';
import { BindViewSync, LoadView, YDoc, YDocWithMeta } from '@/application/types';
import { determineErrorType, ErrorType } from '@/application/utils/error-utils';
import { subscribeCollabDocReset } from '@/components/ws/sync/subscribeCollabDocReset';
import { CollabDocResetPayload } from '@/components/ws/sync/types';
import { Log } from '@/utils/log';

interface UseDocumentLoaderProps {
  viewId: string;
  databaseId?: string | null;
  loadView?: LoadView;
  bindViewSync?: BindViewSync;
  scheduleDeferredCleanup?: (objectId: string, delayMs?: number) => void;
  eventEmitter?: EventEmitter;
}

interface UseDocumentLoaderResult {
  doc: YDoc | null;
  notFound: boolean;
  noAccess: boolean;
  setNotFound: (notFound: boolean) => void;
}

/**
 * Hook for loading a database document.
 *
 * Handles:
 * - Loading the YDoc for the given viewId
 * - Retry logic on failure
 * - NotFound / NoAccess state management
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
  const [notFound, setNotFound] = useState(false);
  const [noAccess, setNoAccess] = useState(false);

  const loadWithRetry = useCallback(
    async (viewIdToLoad: string, retries = 3): Promise<YDoc | null> => {
      if (!loadView) {
        Log.error('[useDocumentLoader] loadView not available', { viewIdToLoad });
        return null;
      }

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          Log.debug('[useDocumentLoader] attempt', { viewIdToLoad, attempt, retries });
          const result = await loadView(viewIdToLoad, false, false, {
            databaseId,
            databaseMetadataOnly: true,
            preserveViewMetadata: true,
          });

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
          // with requests that will fail the same way.
          if (attempt === retries || determineErrorType(error).type === ErrorType.Forbidden) {
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
        const loadedDoc = await loadWithRetry(viewId);

        if (cancelled) return;

        Log.debug('[useDocumentLoader] loaded doc', { viewId, hasDoc: !!loadedDoc });
        setDoc(loadedDoc);
        setNotFound(false);
        setNoAccess(false);
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
        setNotFound(true);
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;
    };
  }, [viewId, databaseId, loadWithRetry]);

  useEffect(() => {
    if (!doc || !bindViewSync) return;

    const docWithMeta = doc as YDocWithMeta;
    const docViewId = docWithMeta.view_id ?? docWithMeta.object_id ?? doc.guid;
    // A linked view can share a canonical doc whose metadata belongs to the
    // full-page view. Sync is keyed by the database, not by its individual views.
    const matchesDatabase = databaseId && (docWithMeta.object_id ?? doc.guid) === databaseId;

    if (docViewId !== viewId && !matchesDatabase) return;

    // An embedded view may share the page's canonical database. Own a realtime
    // subscription without replacing the page's view identity or sync flag.
    if (scheduleDeferredCleanup) {
      return retainRollupSource({ bindViewSync, scheduleDeferredCleanup }, doc);
    }

    if (!docWithMeta._syncBound) bindViewSync(doc);
  }, [doc, bindViewSync, scheduleDeferredCleanup, viewId, databaseId]);

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

  return { doc, notFound, noAccess, setNotFound };
}
