import { useCallback, useEffect, useState } from 'react';

import { YDoc } from '@/application/types';
import { SyncContext } from '@/application/services/js-services/sync-protocol';
import { YDocWithMeta } from '@/components/app/hooks/useViewOperations';
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
    async (id: string, retries = 3): Promise<YDoc | null> => {
      if (!loadView) return null;

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const result = await loadView(id);

          if (result) return result;
        } catch (error) {
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
        const loadedDoc = await loadWithRetry(viewId);

        Log.debug('[useDocumentLoader] loaded doc', { viewId });
        setDoc(loadedDoc);
        setNotFound(false);
        setSyncBound(false);
      } catch (error) {
        console.error('[useDocumentLoader] failed to load doc', { viewId, error });
        setNotFound(true);
      }
    };

    void loadDocument();
  }, [viewId, loadWithRetry]);

  useEffect(() => {
    if (!doc || !bindViewSync || syncBound) return;

    const docWithMeta = doc as YDocWithMeta;

    if (docWithMeta.object_id !== viewId) return;

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
