import EventEmitter from 'events';
import { useCallback, useEffect, useState } from 'react';

import { APP_EVENTS } from '@/application/constants';
import { LoadView, YDoc, YDocWithMeta } from '@/application/types';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { CollabDocResetPayload } from '@/components/ws/sync/types';
import { Log } from '@/utils/log';

type ResetCallback = (payload: CollabDocResetPayload) => void;
type ResetSubscriptionEntry = {
  callbacks: Set<ResetCallback>;
  handler: (payload: CollabDocResetPayload) => void;
};

const resetSubscriptions = new WeakMap<EventEmitter, ResetSubscriptionEntry>();

function subscribeCollabDocReset(eventEmitter: EventEmitter, callback: ResetCallback) {
  let entry = resetSubscriptions.get(eventEmitter);

  if (!entry) {
    entry = {
      callbacks: new Set(),
      handler: (payload) => {
        entry?.callbacks.forEach((cb) => cb(payload));
      },
    };
    resetSubscriptions.set(eventEmitter, entry);
    eventEmitter.on(APP_EVENTS.COLLAB_DOC_RESET, entry.handler);
  }

  entry.callbacks.add(callback);

  return () => {
    const current = resetSubscriptions.get(eventEmitter);

    if (!current) return;

    current.callbacks.delete(callback);

    if (current.callbacks.size === 0) {
      eventEmitter.off(APP_EVENTS.COLLAB_DOC_RESET, current.handler);
      resetSubscriptions.delete(eventEmitter);
    }
  };
}

interface UseDocumentLoaderProps {
  viewId: string;
  databaseId?: string | null;
  loadView?: LoadView;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
  eventEmitter?: EventEmitter;
}

interface UseDocumentLoaderResult {
  doc: YDoc | null;
  notFound: boolean;
  setNotFound: (notFound: boolean) => void;
}

/**
 * Hook for loading a database document.
 *
 * Handles:
 * - Loading the YDoc for the given viewId
 * - Retry logic on failure
 * - NotFound state management
 */
export function useDocumentLoader({
  viewId,
  databaseId,
  loadView,
  bindViewSync,
  eventEmitter,
}: UseDocumentLoaderProps): UseDocumentLoaderResult {
  const [doc, setDoc] = useState<YDoc | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [syncBound, setSyncBound] = useState(false);

  const loadWithRetry = useCallback(
    async (viewIdToLoad: string, retries = 3): Promise<YDoc | null> => {
      if (!loadView) {
        Log.error('[useDocumentLoader] loadView not available', { viewIdToLoad });
        return null;
      }

      for (let attempt = 1; attempt <= retries; attempt++) {
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
          if (attempt === retries) {
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
        setSyncBound(false);
      } catch (error) {
        if (cancelled) return;

        Log.error('[useDocumentLoader] failed to load doc', {
          viewId,
          error: error instanceof Error ? error.message : String(error),
        });
        setNotFound(true);
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;
    };
  }, [viewId, loadWithRetry]);

  useEffect(() => {
    if (!doc || !bindViewSync || syncBound) return;

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
  }, [doc, bindViewSync, syncBound, viewId]);

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

  return { doc, notFound, setNotFound };
}
