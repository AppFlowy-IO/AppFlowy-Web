import { useCallback, useEffect, useState } from 'react';

import { YDoc, YDocWithMeta } from '@/application/types';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { Log } from '@/utils/log';

interface UseDocumentLoaderProps {
  viewId: string;
  loadView?: (viewId: string) => Promise<YDoc | null>;
  bindViewSync?: (doc: YDoc) => SyncContext | null;
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
  loadView,
  bindViewSync,
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
          const result = await loadView(viewIdToLoad);

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
    [loadView]
  );

  useEffect(() => {
    if (!viewId) return;

    const loadDocument = async () => {
      try {
        Log.debug('[useDocumentLoader] loading doc for viewId', { viewId });
        const loadedDoc = await loadWithRetry(viewId);

        Log.debug('[useDocumentLoader] loaded doc', { viewId, hasDoc: !!loadedDoc });
        setDoc(loadedDoc);
        setNotFound(false);
        setSyncBound(false);
      } catch (error) {
        Log.error('[useDocumentLoader] failed to load doc', {
          viewId,
          error: error instanceof Error ? error.message : String(error),
        });
        setNotFound(true);
      }
    };

    void loadDocument();
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

  return { doc, notFound, setNotFound };
}
